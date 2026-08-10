/**
 * CallManager — the WebRTC engine behind encrypted P2P calls.
 *
 * Owns a single RTCPeerConnection and the local/remote media, and exchanges
 * signaling with the peer over the E2EE relay (see call/wire.ts). It drives the
 * `callStore` (UI state) but keeps the MediaStream objects here, pushing only
 * `toURL()` strings out for `<RTCView>`.
 *
 * One call at a time: a second incoming ring while busy is auto-declined.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';
import { getClient } from '../client/hwfaClient';
import { callStore, type CallLogEntry } from './store';
import { onCallSignal } from './signalBus';
import { buildCallBody, newCallId, type CallSignal } from './wire';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

class CallManager {
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private remote: MediaStream | null = null;

  private callId: string | null = null;
  private peerId: string | null = null;
  private direction: 'outgoing' | 'incoming' = 'outgoing';
  private video = false;
  private answered = false;
  /** ICE candidates that arrived before the remote description was set. */
  private pendingIce: RTCIceCandidate[] = [];
  /** Stashed offer for an incoming call (applied on accept). */
  private pendingOffer: CallSignal['sdp'] | null = null;

  init(): void {
    onCallSignal((from, signal) => void this.onSignal(from, signal));
  }

  // --- outbound ---

  /** Place a call to a peer. */
  async start(peerId: string, peerName: string | undefined, video: boolean): Promise<void> {
    if (this.pc) return; // already in a call
    if (!(await ensurePermissions(video))) {
      callStore.set({ status: 'ended', endedReason: 'Permission denied' });
      setTimeout(() => callStore.reset(), 1500);
      return;
    }
    this.callId = newCallId();
    this.peerId = peerId;
    this.direction = 'outgoing';
    this.video = video;
    this.answered = false;
    callStore.set({
      status: 'outgoing',
      callId: this.callId,
      peerId,
      peerName,
      video,
      muted: false,
      cameraOff: false,
      remoteUrl: null,
    });

    this.pc = this.newPeerConnection();
    await this.attachLocalMedia(video);
    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(offer);
    this.signal({ type: 'ring', callId: this.callId, video, sdp: offer as any });
  }

  // --- inbound signaling ---

  private async onSignal(from: string, signal: CallSignal): Promise<void> {
    switch (signal.type) {
      case 'ring': {
        // Busy? politely decline the newcomer.
        if (this.pc || this.callId) {
          this.sendTo(from, { type: 'decline', callId: signal.callId });
          return;
        }
        this.callId = signal.callId;
        this.peerId = from;
        this.direction = 'incoming';
        this.video = !!signal.video;
        this.pendingOffer = signal.sdp ?? null;
        callStore.set({
          status: 'incoming',
          callId: signal.callId,
          peerId: from,
          video: !!signal.video,
          muted: false,
          cameraOff: false,
          remoteUrl: null,
        });
        break;
      }
      case 'accept': {
        if (signal.callId !== this.callId || !this.pc) return;
        if (signal.sdp) {
          await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp as any));
          await this.drainIce();
        }
        this.answered = true;
        callStore.set({ status: 'active', startedAt: Date.now() });
        break;
      }
      case 'ice': {
        if (signal.callId !== this.callId || !signal.candidate) return;
        const cand = new RTCIceCandidate(signal.candidate as any);
        if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(cand);
        else this.pendingIce.push(cand);
        break;
      }
      case 'decline': {
        if (signal.callId !== this.callId) return;
        this.finish('declined', 'Call declined');
        break;
      }
      case 'hangup': {
        if (signal.callId !== this.callId) return;
        this.finish(this.answered ? 'completed' : 'missed', 'Call ended');
        break;
      }
    }
  }

  // --- accept / decline / hangup (user actions) ---

  async accept(): Promise<void> {
    if (this.direction !== 'incoming' || !this.pendingOffer || !this.callId || !this.peerId) return;
    if (!(await ensurePermissions(this.video))) {
      this.decline();
      return;
    }
    this.pc = this.newPeerConnection();
    await this.attachLocalMedia(this.video);
    await this.pc.setRemoteDescription(new RTCSessionDescription(this.pendingOffer as any));
    await this.drainIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.answered = true;
    this.signal({ type: 'accept', callId: this.callId, sdp: answer as any });
    callStore.set({ status: 'active', startedAt: Date.now() });
  }

  decline(): void {
    if (this.callId && this.peerId) this.signal({ type: 'decline', callId: this.callId });
    this.finish('declined', 'Declined');
  }

  hangup(): void {
    if (this.callId && this.peerId) this.signal({ type: 'hangup', callId: this.callId });
    this.finish(this.answered ? 'completed' : 'missed', 'Call ended');
  }

  toggleMute(): void {
    if (!this.local) return;
    const enabled = this.local.getAudioTracks().some(t => t.enabled);
    this.local.getAudioTracks().forEach(t => (t.enabled = !enabled));
    callStore.set({ muted: enabled });
  }

  toggleCamera(): void {
    if (!this.local) return;
    const enabled = this.local.getVideoTracks().some(t => t.enabled);
    this.local.getVideoTracks().forEach(t => (t.enabled = !enabled));
    callStore.set({ cameraOff: enabled });
  }

  switchCamera(): void {
    this.local?.getVideoTracks().forEach(t => {
      // react-native-webrtc extends MediaStreamTrack with _switchCamera.
      (t as any)._switchCamera?.();
    });
  }

  // --- internals ---

  private newPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    (pc as any).addEventListener('icecandidate', (e: any) => {
      if (e.candidate && this.callId) {
        this.signal({
          type: 'ice',
          callId: this.callId,
          candidate: {
            candidate: e.candidate.candidate,
            sdpMid: e.candidate.sdpMid,
            sdpMLineIndex: e.candidate.sdpMLineIndex,
          },
        });
      }
    });
    (pc as any).addEventListener('track', (e: any) => {
      this.remote = e.streams?.[0] ?? this.remote;
      if (this.remote) callStore.set({ remoteUrl: this.remote.toURL() });
    });
    (pc as any).addEventListener('connectionstatechange', () => {
      const st = (pc as any).connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        if (this.callId) this.finish(this.answered ? 'completed' : 'failed', 'Call ended');
      }
    });
    return pc;
  }

  private async attachLocalMedia(video: boolean): Promise<void> {
    const stream = await mediaDevices.getUserMedia({ audio: true, video });
    this.local = stream as unknown as MediaStream;
    this.local.getTracks().forEach(t => this.pc!.addTrack(t, this.local!));
    callStore.set({ localUrl: this.local.toURL() });
  }

  private async drainIce(): Promise<void> {
    if (!this.pc) return;
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        /* stale candidate */
      }
    }
  }

  /** Send a signal to the current peer. */
  private signal(signal: CallSignal): void {
    if (this.peerId) this.sendTo(this.peerId, signal);
  }

  private sendTo(peerId: string, signal: CallSignal): void {
    void getClient()
      .sendText(peerId, buildCallBody(signal))
      .catch(() => {});
  }

  /** Tear down the call and log it. */
  private finish(outcome: CallLogEntry['outcome'], reason: string): void {
    if (this.callId && this.peerId) {
      callStore.addLog({
        callId: this.callId,
        peerId: this.peerId,
        peerName: callStore.getState().peerName,
        video: this.video,
        direction: this.direction,
        outcome,
        at: Date.now(),
      });
    }
    this.local?.getTracks().forEach(t => t.stop());
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.local = null;
    this.remote = null;
    this.callId = null;
    this.peerId = null;
    this.answered = false;
    this.pendingIce = [];
    this.pendingOffer = null;
    callStore.set({ status: 'ended', endedReason: reason, localUrl: null, remoteUrl: null });
    setTimeout(() => callStore.reset(), 1200);
  }
}

export const callManager = new CallManager();

/** Runtime camera/mic permission request (Android). */
async function ensurePermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (video) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    const res = await PermissionsAndroid.requestMultiple(perms);
    return perms.every(p => res[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}
