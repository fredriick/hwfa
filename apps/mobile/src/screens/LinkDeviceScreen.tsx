/**
 * LinkDeviceScreen — shown on an existing (primary) device to add another
 * device to the same account. It mints a short-lived provisioning code via the
 * client core; the new device enters that code on its onboarding screen to link.
 *
 * The code carries a one-time token (valid ~5 min) plus the service URLs, so the
 * new device is self-configuring. A QR rendering is a later, camera-gated
 * polish; for now the code is copy/paste (long-press to copy).
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getClient } from '../client/hwfaClient';
import { theme } from '../theme';

interface Props {
  onBack: () => void;
}

export function LinkDeviceScreen({ onBack }: Props): React.JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setCode(await getClient().createLinkCode());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void generate();
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Link a device</Text>
      </View>

      <Text style={styles.intro}>
        On your other device, choose “Link to an existing account” and enter this
        code. It expires in a few minutes.
      </Text>

      {busy && !code ? (
        <ActivityIndicator color={theme.accent} style={styles.spinner} />
      ) : code ? (
        <>
          <TextInput
            style={styles.code}
            value={code}
            editable={false}
            multiline
            selectTextOnFocus
          />
          <Text style={styles.hint}>Long-press the code to copy it.</Text>
          <TouchableOpacity style={styles.refresh} onPress={generate} disabled={busy}>
            <Text style={styles.refreshText}>Generate a new code</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  back: { color: theme.text, fontSize: 34, lineHeight: 34, marginRight: 4 },
  heading: { color: theme.text, fontSize: 26, fontWeight: '700' },
  intro: { color: theme.textDim, marginTop: 16, marginBottom: 24, lineHeight: 20 },
  spinner: { marginTop: 40 },
  code: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  hint: { color: theme.textDim, fontSize: 12, marginTop: 10, textAlign: 'center' },
  refresh: { marginTop: 24, alignItems: 'center' },
  refreshText: { color: theme.accent, fontSize: 15, fontWeight: '700' },
  error: { color: theme.danger, marginTop: 20, textAlign: 'center' },
});
