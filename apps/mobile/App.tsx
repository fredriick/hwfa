/**
 * Hwfa mobile — Phase 1 scaffold.
 *
 * Minimal state-based navigation across three screens (onboard → new chat →
 * conversation) so the scaffold stays dependency-light. All behaviour flows
 * through the shared `@hwfa/client` core; swap in `react-navigation` when the
 * screen graph grows.
 */
import React, { useState } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ConversationsScreen } from './src/screens/ConversationsScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { conversationStore } from './src/store/conversations';
import { theme } from './src/theme';

type Screen =
  | { name: 'onboarding' }
  | { name: 'home' }
  | { name: 'contacts' }
  | { name: 'chat'; peerUserId: string; peerPhone?: string };

function App(): React.JSX.Element {
  const [userId, setUserId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'onboarding' });

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
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
});

export default App;
