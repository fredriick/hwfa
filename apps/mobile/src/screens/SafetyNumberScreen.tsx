/**
 * SafetyNumberScreen — out-of-band identity verification for a 1:1 chat.
 *
 * Shows a number derived from both parties' identity keys. If you and your
 * contact see the SAME number (compared in person, by call, or any channel
 * outside Hwfa), no machine-in-the-middle sits between your keys. The number is
 * symmetric — both devices compute the same value.
 *
 * The peer's identity key is learned when a session is established (i.e. once
 * you've exchanged a message). Until then the number can't be shown.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { safetyNumber } from '@hwfa/client';
import { getClient } from '../client/hwfaClient';
import { conversationStore, useConversations } from '../store/conversations';
import { theme } from '../theme';

interface Props {
  peerUserId: string;
  peerPhone?: string;
  onBack: () => void;
}

export function SafetyNumberScreen({ peerUserId, peerPhone, onBack }: Props): React.JSX.Element {
  const conversations = useConversations();
  const conv = conversations.find(c => c.peerUserId === peerUserId);
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = await getClient().localIdentityKey();
        // Prefer a live key; fall back to the one cached on the thread, and seed
        // the client from the cache so both agree after a restart.
        let peer = getClient().peerIdentityKey(peerUserId) ?? conv?.peerIdentityB64 ?? null;
        if (peer) {
          getClient().setPeerIdentityKey(peerUserId, peer);
          conversationStore.setPeerIdentity(peerUserId, peer);
        }
        if (cancelled) return;
        if (!local || !peer) {
          setError('Send a message to this contact first, then come back to verify.');
          return;
        }
        setNumber(safetyNumber(local, peer));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peerUserId, conv?.peerIdentityB64]);

  const groups = number ? number.split(' ') : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Verify safety number</Text>
      </View>

      <Text style={styles.peer}>
        with {peerPhone ?? `${peerUserId.slice(0, 8)}…`}
      </Text>

      {number ? (
        <>
          <View style={styles.numberBox}>
            <View style={styles.grid}>
              {groups.map((g, i) => (
                <Text key={i} style={styles.group}>
                  {g}
                </Text>
              ))}
            </View>
          </View>
          <Text style={styles.explain}>
            Compare this number with your contact through another channel (in
            person or a call). If both devices show the same number, your
            conversation is end-to-end encrypted with no one in between.
          </Text>
        </>
      ) : (
        <Text style={styles.explain}>{error ?? 'Computing…'}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  back: { color: theme.text, fontSize: 34, lineHeight: 34, marginRight: 4 },
  heading: { color: theme.text, fontSize: 24, fontWeight: '700' },
  peer: { color: theme.textDim, marginTop: 6, marginBottom: 28 },
  numberBox: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14 },
  group: {
    color: theme.text,
    fontSize: 22,
    fontFamily: 'monospace',
    letterSpacing: 2,
    width: '28%',
    textAlign: 'center',
  },
  explain: { color: theme.textDim, fontSize: 14, lineHeight: 21, marginTop: 24 },
});
