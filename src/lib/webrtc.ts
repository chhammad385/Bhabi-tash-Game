import { Socket } from 'socket.io-client';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

/**
 * Peer-to-peer voice for a game room, with SPEAKER and MICROPHONE as two
 * independent controls:
 *
 *   speaker on  -> you hear everyone else
 *   mic on      -> everyone else hears you
 *
 * Previously a single "Join Voice" button did both at once, so you could not
 * listen without also broadcasting, and you could not talk without first
 * opting into hearing.
 *
 * Each peer connection is created with a sendrecv audio transceiver that
 * starts with NO track. Turning the mic on swaps a real track in via
 * `RTCRtpSender.replaceTrack()`, which does not require renegotiation — so
 * toggling the mic mid-call is instant and cannot desync the connection.
 *
 * The microphone is still never opened without an explicit user action:
 * getUserMedia runs only inside `enableMic()`.
 */
export class WebRTCVoiceManager {
  private socket: Socket | null = null;
  private localStream: MediaStream | null = null;
  private peers: Map<string, RTCPeerConnection> = new Map();
  /** The outgoing audio sender per peer, so the mic can be swapped in/out. */
  private senders: Map<string, RTCRtpSender> = new Map();
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: any = null;

  /** Connected to the room's voice mesh at all. */
  public isJoined = false;
  /** Are we transmitting? */
  public micOn = false;
  /** Are we playing what we receive? */
  public speakerOn = true;
  public isSpeaking = false;

  private onSpeakingChange?: (speaking: boolean) => void;
  private onPeerSpeakingChange?: (peerId: string, speaking: boolean) => void;
  private onError?: (err: string) => void;
  private onStateChange?: () => void;

  constructor(
    socket: Socket,
    callbacks?: {
      onSpeakingChange?: (speaking: boolean) => void;
      onPeerSpeakingChange?: (peerId: string, speaking: boolean) => void;
      onError?: (err: string) => void;
      onStateChange?: () => void;
    }
  ) {
    this.socket = socket;
    this.onSpeakingChange = callbacks?.onSpeakingChange;
    this.onPeerSpeakingChange = callbacks?.onPeerSpeakingChange;
    this.onError = callbacks?.onError;
    this.onStateChange = callbacks?.onStateChange;
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on('voice:peer_joined', async ({ peerId }: { peerId: string }) => {
      // No local stream required — we can be receive-only.
      if (!this.isJoined) return;
      await this.createPeerConnection(peerId, true);
    });

    this.socket.on('voice:offer', async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
      if (!this.isJoined) return;
      try {
        const pc = await this.createPeerConnection(from, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket?.emit('voice:answer', { to: from, answer });
      } catch (e) {
        console.warn('[WebRTC] Failed to answer offer:', e);
        this.closePeer(from);
        this.onError?.('Voice connection could not be established. Please try again.');
      }
    });

    this.socket.on('voice:answer', async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
      const pc = this.peers.get(from);
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (e) {
        console.warn('[WebRTC] Failed to apply answer:', e);
      }
    });

    this.socket.on('voice:ice_candidate', async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = this.peers.get(from);
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {}
      }
    });

    this.socket.on('voice:peer_left', ({ peerId }: { peerId: string }) => {
      this.closePeer(peerId);
    });
  }

  /* ------------------------------------------------------------------ *
   * Joining / leaving the mesh
   * ------------------------------------------------------------------ */

  /**
   * Connects to the room's voice mesh WITHOUT touching the microphone.
   * After this you can hear other players; use `enableMic()` to be heard.
   */
  public async joinVoice(): Promise<boolean> {
    if (this.isJoined) return true;
    this.isJoined = true;
    this.speakerOn = true;
    this.socket?.emit('voice:join');
    this.onStateChange?.();
    return true;
  }

  public leaveVoice() {
    this.isJoined = false;
    this.micOn = false;
    this.stopMicTracks();

    this.peers.forEach((_, peerId) => this.closePeer(peerId));
    this.peers.clear();
    this.senders.clear();
    this.audioElements.clear();

    this.socket?.emit('voice:leave');
    this.onStateChange?.();
  }

  /* ------------------------------------------------------------------ *
   * Microphone — "do they hear me?"
   * ------------------------------------------------------------------ */

  /**
   * Requests microphone permission and starts transmitting. This is the only
   * place getUserMedia is ever called, and only in response to the user
   * pressing the mic button.
   */
  public async enableMic(): Promise<boolean> {
    if (this.micOn && this.localStream) return true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported by your browser.');
      }

      // Joining the mesh implicitly if the user goes straight for the mic.
      if (!this.isJoined) await this.joinVoice();

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });

      const track = this.localStream.getAudioTracks()[0];
      if (!track) throw new Error('No microphone track available.');

      // Swap the live track into every existing peer connection. replaceTrack
      // needs no renegotiation, so this takes effect immediately.
      this.senders.forEach(sender => {
        sender.replaceTrack(track).catch(e => console.warn('[WebRTC] replaceTrack failed:', e));
      });

      this.micOn = true;
      this.setupVAD(this.localStream);
      this.socket?.emit('voice:mute', { muted: false });
      this.onStateChange?.();
      return true;
    } catch (err: any) {
      this.micOn = false;
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow mic access to talk.'
          : err?.message || 'Failed to access the microphone.';
      this.onError?.(msg);
      this.onStateChange?.();
      return false;
    }
  }

  /** Stops transmitting. Others can no longer hear you; you still hear them. */
  public disableMic() {
    this.micOn = false;

    // Detach from peers first so nothing leaks out mid-teardown.
    this.senders.forEach(sender => {
      sender.replaceTrack(null).catch(() => {});
    });
    this.stopMicTracks();

    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.onSpeakingChange?.(false);
    }
    this.socket?.emit('voice:speaking', { speaking: false });
    this.socket?.emit('voice:mute', { muted: true });
    this.onStateChange?.();
  }

  public async toggleMic(): Promise<boolean> {
    if (this.micOn) {
      this.disableMic();
      return false;
    }
    return this.enableMic();
  }

  private stopMicTracks() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    this.analyser = null;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;

    if (this.localStream) {
      // Releases the OS mic indicator, so the browser stops showing "recording".
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
  }

  /* ------------------------------------------------------------------ *
   * Speaker — "do I hear them?"
   * ------------------------------------------------------------------ */

  /** Turns incoming audio on or off without dropping the connection. */
  public setSpeaker(on: boolean) {
    this.speakerOn = on;
    this.audioElements.forEach(audio => {
      audio.muted = !on;
      if (on) audio.play().catch(() => {});
    });
    this.onStateChange?.();
  }

  public toggleSpeaker(): boolean {
    this.setSpeaker(!this.speakerOn);
    return this.speakerOn;
  }

  /* ------------------------------------------------------------------ *
   * Peer plumbing
   * ------------------------------------------------------------------ */

  private async createPeerConnection(peerId: string, isInitiator: boolean): Promise<RTCPeerConnection> {
    if (this.peers.has(peerId)) {
      this.closePeer(peerId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(peerId, pc);

    /*
     * Always negotiate a bidirectional audio transceiver, even with the mic
     * off. The sender starts empty and gets a real track later via
     * replaceTrack, which avoids renegotiating every time the mic is toggled.
     */
    const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.senders.set(peerId, transceiver.sender);

    const micTrack = this.localStream?.getAudioTracks()[0];
    if (this.micOn && micTrack) {
      transceiver.sender.replaceTrack(micTrack).catch(() => {});
    }

    pc.onicecandidate = event => {
      if (event.candidate && this.socket) {
        this.socket.emit('voice:ice_candidate', { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = event => {
      let audio = this.audioElements.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        this.audioElements.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
      audio.muted = !this.speakerOn;
      audio.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed') {
        console.warn(`[WebRTC] Connection to peer ${peerId} failed.`);
        this.closePeer(peerId);
        this.onError?.('Voice connection could not be established. Please try again.');
        return;
      }
      if (state === 'disconnected' || state === 'closed') {
        this.closePeer(peerId);
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket?.emit('voice:offer', { to: peerId, offer });
    }

    return pc;
  }

  private closePeer(peerId: string) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }
    this.senders.delete(peerId);

    const audio = this.audioElements.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.audioElements.delete(peerId);
    }
  }

  /* ------------------------------------------------------------------ *
   * Voice activity detection (only meaningful while transmitting)
   * ------------------------------------------------------------------ */

  private setupVAD(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let speakingCounter = 0;

      this.vadInterval = setInterval(() => {
        if (!this.analyser || !this.micOn) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.onSpeakingChange?.(false);
            this.socket?.emit('voice:speaking', { speaking: false });
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const average = sum / bufferLength;

        if (average > 18) speakingCounter = 4;
        else if (speakingCounter > 0) speakingCounter--;

        const currentlySpeaking = speakingCounter > 0;
        if (currentlySpeaking !== this.isSpeaking) {
          this.isSpeaking = currentlySpeaking;
          this.onSpeakingChange?.(currentlySpeaking);
          this.socket?.emit('voice:speaking', { speaking: currentlySpeaking });
        }
      }, 150);
    } catch (e) {}
  }
}
