import { Socket } from 'socket.io-client';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'failed';

export interface VoiceState {
  status: VoiceStatus;
  micOn: boolean;
  speakerOn: boolean;
  /** True while our own microphone is picking up speech. */
  speaking: boolean;
  /** Peers we currently hold a live audio connection to. */
  peerCount: number;
  error: string | null;
}

/**
 * Peer-to-peer voice for a game room.
 *
 * MIC AND SPEAKER ARE COMPLETELY INDEPENDENT:
 *
 *   mic     -> is MY audio track attached to the peer connections?
 *              Controls only whether OTHERS can hear ME.
 *   speaker  -> are the incoming audio elements unmuted?
 *              Controls only whether I can hear OTHERS.
 *
 * Neither one gates the other. Turning the mic off does not stop incoming
 * audio, and turning the speaker off does not stop transmitting. That means
 * "listen only" (mic off, speaker on) and "talk only" (mic on, speaker off)
 * are both perfectly valid states.
 *
 * The mesh is joined as soon as the player enters a room, before any
 * microphone is involved, so both toggles act instantly with no setup delay
 * and no permission prompt until the mic is actually switched on.
 *
 * Each connection negotiates a sendrecv audio transceiver. Toggling the mic
 * swaps a track in or out with RTCRtpSender.replaceTrack(), which needs no
 * renegotiation, so it can never desync the peer.
 */
export class WebRTCVoiceManager {
  private socket: Socket;
  private peers = new Map<string, RTCPeerConnection>();
  private senders = new Map<string, RTCRtpSender>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();

  private micStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadTimer: any = null;

  private joined = false;
  private destroyed = false;

  private state: VoiceState = {
    status: 'idle',
    micOn: false,
    speakerOn: true,
    speaking: false,
    peerCount: 0,
    error: null,
  };

  private onChange: (s: VoiceState) => void;
  private onPeerSpeaking: (peerId: string, speaking: boolean) => void;

  constructor(
    socket: Socket,
    handlers: {
      onChange: (s: VoiceState) => void;
      onPeerSpeaking: (peerId: string, speaking: boolean) => void;
    }
  ) {
    this.socket = socket;
    this.onChange = handlers.onChange;
    this.onPeerSpeaking = handlers.onPeerSpeaking;
    this.bind();
  }

  public getState(): VoiceState {
    return { ...this.state };
  }

  private emit(patch: Partial<VoiceState> = {}) {
    this.state = { ...this.state, ...patch, peerCount: this.peers.size };
    this.onChange(this.getState());
  }

  /* ------------------------------------------------------------------ *
   * Signalling
   * ------------------------------------------------------------------ */

  private bind() {
    this.socket.on('voice:peer_joined', async ({ peerId }: { peerId: string }) => {
      // Existing members call the newcomer, so only one side ever offers.
      if (!this.joined || peerId === undefined) return;
      await this.connectTo(peerId, true);
    });

    this.socket.on('voice:offer', async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
      if (!this.joined) return;
      try {
        const pc = await this.connectTo(from, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // The transceiver now exists because the remote description created
        // it. Claim its sender so the mic can be swapped in later.
        const tr = pc.getTransceivers().find(t => t.receiver?.track?.kind === 'audio') ?? pc.getTransceivers()[0];
        if (tr) {
          try {
            tr.direction = 'sendrecv';
          } catch {}
          this.senders.set(from, tr.sender);
          if (this.micTrack) await tr.sender.replaceTrack(this.micTrack).catch(() => {});
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('voice:answer', { to: from, answer });
        await this.flushIce(from);
      } catch (e) {
        this.failPeer(from, e);
      }
    });

    this.socket.on('voice:answer', async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
      const pc = this.peers.get(from);
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await this.flushIce(from);
      } catch (e) {
        this.failPeer(from, e);
      }
    });

    this.socket.on('voice:ice_candidate', async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      if (!candidate) return;
      const pc = this.peers.get(from);
      // Candidates can arrive before the remote description; queue them.
      if (!pc || !pc.remoteDescription) {
        const q = this.pendingIce.get(from) ?? [];
        q.push(candidate);
        this.pendingIce.set(from, q);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    });

    this.socket.on('voice:peer_left', ({ peerId }: { peerId: string }) => this.closePeer(peerId));
    this.socket.on('voice:peer_speaking', ({ peerId, speaking }: { peerId: string; speaking: boolean }) =>
      this.onPeerSpeaking(peerId, speaking)
    );
  }

  private async flushIce(peerId: string) {
    const pc = this.peers.get(peerId);
    const queued = this.pendingIce.get(peerId);
    if (!pc || !queued) return;
    this.pendingIce.delete(peerId);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {}
    }
  }

  /* ------------------------------------------------------------------ *
   * Mesh membership
   * ------------------------------------------------------------------ */

  /** Joins the room's voice mesh. Never touches the microphone. */
  public join() {
    if (this.joined || this.destroyed) return;
    this.joined = true;
    this.emit({ status: 'connecting', error: null });

    this.socket.emit('voice:join', {}, async (res: any) => {
      if (!res?.success) {
        this.joined = false;
        this.emit({ status: 'idle', error: null });
        return;
      }
      // Peers already present will call us; nothing to do but wait.
      this.emit({ status: 'connected' });
    });
  }

  public leave() {
    if (!this.joined) return;
    this.joined = false;
    this.stopMic();
    this.peers.forEach((_, id) => this.closePeer(id));
    this.peers.clear();
    this.senders.clear();
    this.audioEls.clear();
    this.pendingIce.clear();
    this.socket.emit('voice:leave');
    this.emit({ status: 'idle', micOn: false, speaking: false, error: null });
  }

  public destroy() {
    this.destroyed = true;
    this.leave();
    ['voice:peer_joined', 'voice:offer', 'voice:answer', 'voice:ice_candidate', 'voice:peer_left', 'voice:peer_speaking']
      .forEach(e => this.socket.off(e));
  }

  /* ------------------------------------------------------------------ *
   * MIC — "can they hear me?"  (independent of the speaker)
   * ------------------------------------------------------------------ */

  public async setMic(on: boolean): Promise<boolean> {
    if (on) return this.startMic();
    this.stopMic();
    this.socket.emit('voice:mic_state', { micOn: false });
    this.emit({ micOn: false, speaking: false });
    return false;
  }

  public toggleMic(): Promise<boolean> {
    return this.setMic(!this.state.micOn);
  }

  private async startMic(): Promise<boolean> {
    if (this.state.micOn && this.micTrack) return true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support microphone access.');
      }
      // Make sure we are in the mesh, but note this is NOT a prerequisite for
      // hearing others — the speaker works with the mic off.
      if (!this.joined) this.join();

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.micTrack = this.micStream.getAudioTracks()[0] ?? null;
      if (!this.micTrack) throw new Error('No microphone was found.');

      // replaceTrack needs no renegotiation, so this is instant for every peer.
      await Promise.all(
        [...this.senders.values()].map(sn => sn.replaceTrack(this.micTrack).catch(() => {}))
      );

      this.startVad(this.micStream);
      this.socket.emit('voice:mic_state', { micOn: true });
      this.emit({ micOn: true, error: null });
      return true;
    } catch (err: any) {
      this.stopMic();
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      this.emit({
        micOn: false,
        error: denied
          ? 'Microphone blocked. Allow mic access in your browser to talk.'
          : err?.name === 'NotFoundError'
            ? 'No microphone found on this device.'
            : err?.message || 'Could not start the microphone.',
      });
      return false;
    }
  }

  private stopMic() {
    // Detach from peers first so nothing leaks out during teardown.
    this.senders.forEach(sn => sn.replaceTrack(null).catch(() => {}));

    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    this.analyser = null;
    if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close().catch(() => {});
    this.audioCtx = null;

    // Stopping the tracks clears the browser's "recording" indicator.
    this.micStream?.getTracks().forEach(t => t.stop());
    this.micStream = null;
    this.micTrack = null;
  }

  /* ------------------------------------------------------------------ *
   * SPEAKER — "can I hear them?"  (independent of the mic)
   * ------------------------------------------------------------------ */

  public setSpeaker(on: boolean) {
    // Purely local: mute or unmute the incoming audio elements. It never
    // touches the microphone, the senders, or the peer connections, so the
    // mic's state is irrelevant here and vice versa.
    this.audioEls.forEach(el => {
      el.muted = !on;
      if (on) el.play().catch(() => {});
    });
    this.emit({ speakerOn: on });
  }

  public toggleSpeaker(): boolean {
    const next = !this.state.speakerOn;
    this.setSpeaker(next);
    return next;
  }

  /* ------------------------------------------------------------------ *
   * Peer plumbing
   * ------------------------------------------------------------------ */

  private async connectTo(peerId: string, initiator: boolean): Promise<RTCPeerConnection> {
    const existing = this.peers.get(peerId);
    if (existing && existing.connectionState !== 'failed' && existing.connectionState !== 'closed') {
      if (!initiator) return existing;
      this.closePeer(peerId);
    } else if (existing) {
      this.closePeer(peerId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(peerId, pc);

    pc.onicecandidate = e => {
      if (e.candidate) this.socket.emit('voice:ice_candidate', { to: peerId, candidate: e.candidate });
    };

    pc.ontrack = e => {
      let el = this.audioEls.get(peerId);
      if (!el) {
        el = new Audio();
        el.autoplay = true;
        (el as any).playsInline = true;
        this.audioEls.set(peerId, el);
      }

      /*
       * `e.streams` is EMPTY when the sender attached its track with
       * replaceTrack() on a transceiver created by addTransceiver(), which is
       * exactly what happens here every time somebody switches their mic on.
       * Assigning e.streams[0] then set srcObject to undefined: the packets
       * kept arriving but nothing ever played. Wrap the bare track instead.
       */
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      el.srcObject = stream;

      // Honour the CURRENT speaker setting, whatever the mic is doing.
      el.muted = !this.state.speakerOn;
      el.play().catch(() => {});
      this.emit();
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') this.emit({ status: 'connected', error: null });
      if (st === 'failed') {
        this.closePeer(peerId);
        this.emit({
          error: 'Could not connect voice to a player. Their network may be blocking it.',
        });
      } else if (st === 'closed' || st === 'disconnected') {
        this.closePeer(peerId);
      }
    };

    if (initiator) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.senders.set(peerId, tr.sender);
      if (this.micTrack) await tr.sender.replaceTrack(this.micTrack).catch(() => {});

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('voice:offer', { to: peerId, offer });
    }

    this.emit();
    return pc;
  }

  private failPeer(peerId: string, err: unknown) {
    console.warn('[voice] peer failed', peerId, err);
    this.closePeer(peerId);
    this.emit({ error: 'Voice connection could not be established. Please try again.' });
  }

  private closePeer(peerId: string) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {}
      this.peers.delete(peerId);
    }
    this.senders.delete(peerId);
    this.pendingIce.delete(peerId);

    const el = this.audioEls.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audioEls.delete(peerId);
    }
    this.emit();
  }

  /* ------------------------------------------------------------------ *
   * Voice activity detection (only while the mic is on)
   * ------------------------------------------------------------------ */

  private startVad(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      const src = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      let hold = 0;

      this.vadTimer = setInterval(() => {
        if (!this.analyser || !this.state.micOn) return;
        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;

        if (avg > 18) hold = 4;
        else if (hold > 0) hold--;

        const speaking = hold > 0;
        if (speaking !== this.state.speaking) {
          this.emit({ speaking });
          this.socket.emit('voice:speaking', { speaking });
        }
      }, 150);
    } catch {}
  }
}
