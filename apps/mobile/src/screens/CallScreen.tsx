/**
 * CallOverlay — full-screen call UI, rendered above everything from App when a
 * call is active. Covers all states: incoming (ring), outgoing (dialing),
 * active (media + controls), and a brief ended card. Video uses `<RTCView>`;
 * audio calls show an avatar. All actions go through the call manager.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { callManager } from '../call/manager';
import { useCall } from '../call/store';
import { theme } from '../theme';

function useCallTimer(startedAt?: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return '';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function RoundButton({
  label,
  glyph,
  onPress,
  tint,
  active,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  tint?: string;
  active?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.ctrl} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.ctrlCircle, tint ? { backgroundColor: tint } : null, active && styles.ctrlActive]}>
        <Text style={styles.ctrlGlyph}>{glyph}</Text>
      </View>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function CallOverlay(): React.JSX.Element | null {
  const call = useCall();
  const timer = useCallTimer(call.startedAt);

  if (call.status === 'idle') return null;

  const name = call.peerName ?? (call.peerId ? `${call.peerId.slice(0, 8)}…` : 'Unknown');
  const showVideo = call.video && call.status === 'active';

  return (
    <View style={styles.root}>
      {/* Remote video fills the screen; audio shows an avatar. */}
      {showVideo && call.remoteUrl ? (
        <RTCView streamURL={call.remoteUrl} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.slice(-2).toUpperCase()}</Text>
          </View>
        </View>
      )}

      {/* Local preview (video calls only). */}
      {showVideo && call.localUrl && !call.cameraOff && (
        <RTCView streamURL={call.localUrl} style={styles.pip} objectFit="cover" zOrder={1} />
      )}

      {/* Header: name + status/timer. */}
      <View style={styles.header}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.status}>
          {call.status === 'incoming'
            ? `Incoming ${call.video ? 'video ' : ''}call…`
            : call.status === 'outgoing'
              ? 'Calling…'
              : call.status === 'active'
                ? timer || 'Connected'
                : call.endedReason ?? 'Call ended'}
        </Text>
      </View>

      {/* Controls. */}
      <View style={styles.controls}>
        {call.status === 'incoming' ? (
          <View style={styles.row}>
            <RoundButton label="Decline" glyph="✕" tint={theme.danger} onPress={() => callManager.decline()} />
            <RoundButton label="Accept" glyph="✓" tint={theme.accent} onPress={() => void callManager.accept()} />
          </View>
        ) : call.status === 'active' ? (
          <View style={styles.row}>
            <RoundButton label={call.muted ? 'Unmute' : 'Mute'} glyph={call.muted ? '🔇' : '🎙'} active={call.muted} onPress={() => callManager.toggleMute()} />
            {call.video && (
              <RoundButton label="Flip" glyph="🔄" onPress={() => callManager.switchCamera()} />
            )}
            {call.video && (
              <RoundButton label={call.cameraOff ? 'Cam on' : 'Cam off'} glyph="📷" active={call.cameraOff} onPress={() => callManager.toggleCamera()} />
            )}
            <RoundButton label="End" glyph="📵" tint={theme.danger} onPress={() => callManager.hangup()} />
          </View>
        ) : call.status === 'outgoing' ? (
          <View style={styles.row}>
            <RoundButton label="Cancel" glyph="📵" tint={theme.danger} onPress={() => callManager.hangup()} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  root: { ...FILL, backgroundColor: theme.bg, zIndex: 100 },
  avatarWrap: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 128,
    height: 128,
    borderRadius: 40,
    backgroundColor: theme.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.neon,
  },
  avatarText: { color: theme.neon, fontSize: 44, fontWeight: '800' },
  pip: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 108,
    height: 156,
    borderRadius: 12,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  header: { position: 'absolute', top: 72, left: 0, right: 0, alignItems: 'center' },
  name: { color: theme.text, fontSize: 26, fontWeight: '800' },
  status: { color: theme.textDim, fontSize: 15, marginTop: 6 },
  controls: { position: 'absolute', bottom: 56, left: 0, right: 0, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 22, alignItems: 'center' },
  ctrl: { alignItems: 'center', gap: 8 },
  ctrlCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  ctrlActive: { backgroundColor: theme.surface, borderColor: theme.neon },
  ctrlGlyph: { fontSize: 26 },
  ctrlLabel: { color: theme.text, fontSize: 12 },
});
