/**
 * Hwfa mobile — Phase 1 scaffold.
 *
 * Minimal state-based navigation across three screens (onboard → new chat →
 * conversation) so the scaffold stays dependency-light. All behaviour flows
 * through the shared `@hwfa/client` core; swap in `react-navigation` when the
 * screen graph grows.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ConversationsScreen } from './src/screens/ConversationsScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { conversationStore } from './src/store/conversations';
import { tryResume } from './src/client/hwfaClient';
import { theme } from './src/theme';

type Screen =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'home' }
  | { name: 'contacts' }
  | { name: 'chat'; peerUserId: string; peerPhone?: string };

function App(): React.JSX.Element {
  const [userId, setUserId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });

  // On launch, resume a persisted identity if there is one; else go to onboarding.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resumedId = await tryResume();
        if (cancelled) return;
        if (resumedId) {
          setUserId(resumedId);
          conversationStore.start();
          setScreen({ name: 'home' });
        } else {
          setScreen({ name: 'onboarding' });
        }
      } catch {
        if (!cancelled) setScreen({ name: 'onboarding' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {screen.name === 'loading' && (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.accent} size="large" />
          </View>
        )}

        {screen.name === 'onboarding' && (
          <OnboardingScreen
            onOnboarded={id => {
              setUserId(id);
              // Start the single app-level inbound handler once we're online.
              conversationStore.start();
              setScreen({ name: 'home' });
            }}
          />
        )}

        {screen.name === 'home' && userId && (
          <ConversationsScreen
            myUserId={userId}
            onNewChat={() => setScreen({ name: 'contacts' })}
            onOpenChat={(peerUserId, peerPhone) =>
              setScreen({ name: 'chat', peerUserId, peerPhone })
            }
          />
        )}

        {screen.name === 'contacts' && userId && (
          <ContactsScreen
            myUserId={userId}
            onBack={() => setScreen({ name: 'home' })}
            onOpenChat={(peerUserId, peerPhone) =>
              setScreen({ name: 'chat', peerUserId, peerPhone })
            }
          />
        )}

        {screen.name === 'chat' && (
          <ChatScreen
            peerUserId={screen.peerUserId}
            peerPhone={screen.peerPhone}
            onBack={() => setScreen({ name: 'home' })}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

export default App;
