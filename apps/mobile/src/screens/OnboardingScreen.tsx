/**
 * OnboardingScreen — enter a phone number, register with Discovery, verify the
 * (dev) OTP, and open the relay socket. All of this runs through the shared
 * `@hwfa/client` core; the only piece not yet wired is the native crypto
 * provider, so `onboard()` will surface a clear "native binding" error until
 * that lands. The UI + networking path is otherwise complete.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getClient, saveAccount } from '../client/hwfaClient';
import { theme } from '../theme';

interface Props {
  onOnboarded: (userId: string) => void;
}

export function OnboardingScreen({ onOnboarded }: Props): React.JSX.Element {
  const [phone, setPhone] = useState('+234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = phone.trim();
      const userId = await getClient().onboard(trimmed);
      // Remember this identity so the next launch resumes instead of re-registering.
      await saveAccount(userId, trimmed);
      onOnboarded(userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Hwfa</Text>
      <Text style={styles.tagline}>Encrypted messaging with on-device scam detection.</Text>

      <Text style={styles.label}>Your phone number</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+234…"
        placeholderTextColor={theme.textDim}
        autoFocus
      />

      <TouchableOpacity
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={busy}>
        {busy ? (
          <ActivityIndicator color={theme.text} />
        ) : (
          <Text style={styles.buttonText}>Create account</Text>
        )}
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 24, justifyContent: 'center' },
  logo: { color: theme.accent, fontSize: 44, fontWeight: '800', textAlign: 'center' },
  tagline: { color: theme.textDim, textAlign: 'center', marginTop: 8, marginBottom: 40 },
  label: { color: theme.textDim, marginBottom: 8 },
  input: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: theme.text, fontSize: 16, fontWeight: '700' },
  error: { color: theme.danger, marginTop: 20, textAlign: 'center' },
});
