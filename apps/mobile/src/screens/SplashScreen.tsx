/**
 * SplashScreen — the branded launch screen. Shown while the app resumes a
 * persisted identity (see App.tsx); a minimum display time keeps the logo from
 * flashing by on fast resumes. Purely presentational.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

export function SplashScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.mark}>
        <Text style={styles.markText}>H</Text>
      </View>
      <Text style={styles.logo}>Hwfa</Text>
      <Text style={styles.tagline}>Private by design</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  markText: { color: theme.bg, fontSize: 48, fontWeight: '800' },
  logo: { color: theme.text, fontSize: 40, fontWeight: '800', letterSpacing: 1 },
  tagline: { color: theme.textDim, fontSize: 14, marginTop: 6 },
});
