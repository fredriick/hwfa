/**
 * OnboardingScreen — two-step phone registration:
 *   1. Enter a phone number → register with Discovery, which sends an SMS OTP
 *      (via TextBee) to that number.
 *   2. Enter the 6-digit code → verify, persist the identity, open the relay.
 *
 * In dev (DISCOVERY_DEV=1) the register response echoes the code, so we auto-fill
 * it and the user can just tap Verify — no real SMS needed. All networking runs
 * through the shared `@hwfa/client` core.
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

type Phase = 'phone' | 'code' | 'link';

export function OnboardingScreen({ onOnboarded }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('phone');
  const [phone, setPhone] = useState('+234');
  const [code, setCode] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [devHint, setDevHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await getClient().requestOtp(phone.trim());
      // Dev mode echoes the code — pre-fill it so verification is one tap.
      if (res.devOtp) {
        setCode(res.devOtp);
        setDevHint(`Dev mode: code ${res.devOtp} filled in for you.`);
      } else {
        setDevHint(null);
      }
      setPhase('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    setError(null);
    try {
      const userId = await getClient().confirmOtp(code.trim());
      // Remember this identity so the next launch resumes instead of re-registering.
      await saveAccount(userId, phone.trim());
      onOnboarded(userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleEditNumber() {
    setPhase('phone');
    setCode('');
    setDevHint(null);
    setError(null);
  }

  async function handleLink() {
    setBusy(true);
    setError(null);
    try {
      const { userId } = await getClient().linkWithCode(linkCode.trim());
      // A linked device shares the account but has no phone of its own; persist
      // its own device id so the next launch resumes.
      await saveAccount(userId, '');
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

      {phase === 'phone' ? (
        <>
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
            onPress={handleRequestCode}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <Text style={styles.buttonText}>Send code</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setPhase('link'); setError(null); }} disabled={busy}>
            <Text style={styles.secondary}>Link to an existing account</Text>
          </TouchableOpacity>
        </>
      ) : phase === 'link' ? (
        <>
          <Text style={styles.label}>Paste the code from your other device</Text>
          <TextInput
            style={styles.input}
            value={linkCode}
            onChangeText={setLinkCode}
            placeholder="Linking code…"
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleLink}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <Text style={styles.buttonText}>Link device</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setPhase('phone'); setError(null); }} disabled={busy}>
            <Text style={styles.secondary}>Use a phone number instead</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the 6-digit code sent to {phone.trim()}</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="000000"
            placeholderTextColor={theme.textDim}
            maxLength={6}
            autoFocus
          />
          {devHint && <Text style={styles.devHint}>{devHint}</Text>}
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleVerify}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={handleEditNumber} disabled={busy}>
            <Text style={styles.secondary}>Change number</Text>
          </TouchableOpacity>
        </>
      )}

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
  codeInput: { fontSize: 28, letterSpacing: 8, textAlign: 'center' },
  devHint: { color: theme.accent, fontSize: 12, marginTop: 10 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: theme.text, fontSize: 16, fontWeight: '700' },
  secondary: { color: theme.textDim, textAlign: 'center', marginTop: 18, fontSize: 14 },
  error: { color: theme.danger, marginTop: 20, textAlign: 'center' },
});
