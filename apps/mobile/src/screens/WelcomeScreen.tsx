/**
 * WelcomeScreen — first-run intro + consent gate. Shown to users who haven't
 * onboarded yet, between the splash and the phone-number screen. Tapping
 * "Agree & continue" advances to onboarding.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';

interface Props {
  onAgree: () => void;
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.feature}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{body}</Text>
      </View>
    </View>
  );
}

export function WelcomeScreen({ onAgree }: Props): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.mark}>
          <Text style={styles.markText}>H</Text>
        </View>
        <Text style={styles.title}>Welcome to Hwfa</Text>
        <Text style={styles.subtitle}>
          Encrypted messaging with on-device scam detection.
        </Text>
      </View>

      <View style={styles.features}>
        <Feature
          icon="🔒"
          title="End-to-end encrypted"
          body="Messages and photos are encrypted on your device. No one in between can read them."
        />
        <Feature
          icon="🛡️"
          title="On-device scam detection"
          body="Suspicious messages are flagged locally — the check never leaves your phone."
        />
        <Feature
          icon="🕵️"
          title="Minimal by design"
          body="The server only ever sees ciphertext, and your number is stored only as a salted hash."
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.legal}>
          By tapping “Agree &amp; continue” you accept the Terms of Service and Privacy Policy.
        </Text>
        <TouchableOpacity style={styles.button} onPress={onAgree}>
          <Text style={styles.buttonText}>Agree &amp; continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 24, justifyContent: 'space-between' },
  hero: { alignItems: 'center', marginTop: 24 },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  markText: { color: theme.bg, fontSize: 34, fontWeight: '800' },
  title: { color: theme.text, fontSize: 26, fontWeight: '800' },
  subtitle: {
    color: theme.textDim,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 21,
  },
  features: { gap: 22 },
  feature: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  featureIcon: { fontSize: 24, width: 30, textAlign: 'center' },
  featureText: { flex: 1 },
  featureTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  featureBody: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginTop: 2 },
  footer: { gap: 16 },
  legal: { color: theme.textDim, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: theme.bg, fontSize: 16, fontWeight: '700' },
});
