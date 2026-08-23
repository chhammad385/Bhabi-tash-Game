import { Socket } from 'socket.io-client';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export class WebRTCVoiceManager {
  private socket: Socket | null = null;
  private localStream: MediaStream | null = null;
  private peers: Map<string, RTCPeerConnection> = new Map();
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: any = null;
  public isJoined: boolean = false;
  public isMuted: boolean = false;
  public isSpeaking: boolean = false;

  private onSpeakingChange?: (speaking: boolean) => void;
  private onPeerSpeakingChange?: (peerId: string, speaking: boolean) => void;
  private onError?: (err: string) => void;

  constructor(
    socket: Socket,
    callbacks?: {
      onSpeakingChange?: (speaking: boolean) => void;
      onPeerSpeakingChange?: (peerId: string, speaking: boolean) => void;
      onError?: (err: string) => void;
    }
  ) {
    this.socket = socket;
    this.onSpeakingChange = callbacks?.onSpeakingChange;
    this.onPeerSpeakingChange = callbacks?.onPeerSpeakingChange;
    this.onError = callbacks?.onError;
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on('voice:peer_joined', async ({ peerId }: { peerId: string }) => {
      if (!this.isJoined || !this.localStream) return;
      // We create offer to the newly joined peer
      await this.createPeerConnection(peerId, true);
    });

    this.socket.on('voice:offer', async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
      // Only ever respond while we have explicitly joined voice and hold a live
      // local stream. An offer from anyone we are not in a call with is ignored;
      // the server additionally refuses to relay cross-room signaling.
      if (!this.isJoined || !this.localStream) return;
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
      // Ignore answers that arrive in an unexpected state (duplicate or late).
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

  public async joinVoice(): Promise<boolean> {
    if (this.isJoined && this.localStream) return true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access is not supported by your browser.');
      }

      // The microphone is NEVER enabled automatically. getUserMedia runs only
      // here, as a direct result of the user pressing "Join Voice", so the
      // browser permission prompt is always tied to an explicit action.

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.isJoined = true;
      this.isMuted = false;
      this.setupVAD(this.localStream);

      this.socket?.emit('voice:join');
      return true;
    } catch (err: any) {
      console.warn('[WebRTC] Voice join error:', err);
      const msg = err.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Please allow mic access to use voice chat.'
        : err.message || 'Failed to access microphone.';
      if (this.onError) this.onError(msg);
      return false;
    }
  }

  public toggleMute(): boolean {
    if (!this.localStream) return this.isMuted;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });
    this.socket?.emit('voice:mute', { muted: this.isMuted });
    return this.isMuted;
  }

  public leaveVoice() {
    this.isJoined = false;
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.peers.forEach((_, peerId) => this.closePeer(peerId));
    this.peers.clear();
    this.audioElements.clear();

    this.analyser = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.socket?.emit('voice:leave');
  }

  private async createPeerConnection(peerId: string, isInitiator: boolean): Promise<RTCPeerConnection> {
    if (this.peers.has(peerId)) {
      this.closePeer(peerId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('voice:ice_candidate', { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      let audio = this.audioElements.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        this.audioElements.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === 'failed') {
        // Most commonly a symmetric NAT / restrictive firewall that STUN alone
        // cannot traverse. There is no free TURN relay configured, so the peer
        // simply cannot be reached — report it and clean up rather than
        // retrying forever or breaking the game.
        console.warn(`[WebRTC] Connection to peer ${peerId} failed.`);
        this.closePeer(peerId);
        this.onError?.(
          'Voice connection could not be established. Please try again.'
        );
        return;
      }

      if (state === 'disconnected' || state === 'closed') {
        this.closePeer(peerId);
      }
    };

    pc.onicecandidateerror = () => {
      // Non-fatal: one STUN server failing is fine as long as another works.
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
    const audio = this.audioElements.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.audioElements.delete(peerId);
    }
  }

  // Voice Activity Detection to detect when speaking
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
        if (!this.analyser || this.isMuted) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.onSpeakingChange?.(false);
            this.socket?.emit('voice:speaking', { speaking: false });
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Threshold for speaking
        const isNowSpeaking = average > 18;

        if (isNowSpeaking) {
          speakingCounter = 4; // hold for a few ticks
        } else if (speakingCounter > 0) {
          speakingCounter--;
        }

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
