/**
 * Hwfa mobile — Phase 1 scaffold.
 *
 * Minimal state-based navigation across three screens (onboard → new chat →
 * conversation) so the scaffold stays dependency-light. All behaviour flows
 * through the shared `@hwfa/client` core; swap in `react-navigation` when the
 * screen graph grows.
 */
import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SplashScreen } from './src/screens/SplashScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StarredScreen } from './src/screens/StarredScreen';
import { NewGroupScreen } from './src/screens/NewGroupScreen';
import { conversationStore } from './src/store/conversations';
import { tryResume } from './src/client/hwfaClient';
import { initPush } from './src/push/setup';
import { mediaCipherSelfTest } from './src/media/selfTest';
import { theme } from './src/theme';

/** Minimum time the branded splash stays up, so it doesn't flash by on a fast resume. */
const SPLASH_MIN_MS = 1400;

type Screen =
  | { name: 'splash' }
  | { name: 'welcome' }
  | { name: 'onboarding' }
  | { name: 'home' }
  | { name: 'contacts' }
  | { name: 'settings' }
  | { name: 'starred' }
  | { name: 'newgroup' }
  | { name: 'chat'; peerUserId: string; peerPhone?: string };

function App(): React.JSX.Element {
  const [userId, setUserId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'splash' });

  // Dev sanity check: the native media cipher round-trips + is WebCrypto-compatible.
  useEffect(() => {
    if (__DEV__) void mediaCipherSelfTest();
  }, []);

  // On launch, hold the splash for a beat, then resume a persisted identity if
  // there is one (→ home); otherwise show the welcome/consent screen first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const minSplash = new Promise<void>(r => setTimeout(r, SPLASH_MIN_MS));
      try {
        const [resumedId] = await Promise.all([tryResume(), minSplash]);
        if (cancelled) return;
        if (resumedId) {
          setUserId(resumedId);
          conversationStore.start();
          setScreen({ name: 'home' });
        } else {
          setScreen({ name: 'welcome' });
        }
      } catch {
        if (!cancelled) setScreen({ name: 'welcome' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Once online, set up push (permission + FCM token + wake→reconnect).
  useEffect(() => {
    if (!userId) return;
    let cleanup: (() => void) | undefined;
    void initPush().then(fn => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [userId]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {screen.name === 'splash' && <SplashScreen />}

        {screen.name === 'welcome' && (
          <WelcomeScreen onAgree={() => setScreen({ name: 'onboarding' })} />
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
          <HomeScreen
            myUserId={userId}
            onNewChat={() => setScreen({ name: 'contacts' })}
            onOpenChat={(peerUserId, peerPhone) =>
              setScreen({ name: 'chat', peerUserId, peerPhone })
            }
            onSettings={() => setScreen({ name: 'settings' })}
            onStarred={() => setScreen({ name: 'starred' })}
            onNewGroup={() => setScreen({ name: 'newgroup' })}
          />
        )}

        {screen.name === 'newgroup' && userId && (
          <NewGroupScreen
            onBack={() => setScreen({ name: 'home' })}
            onCreated={groupId =>
              setScreen({ name: 'chat', peerUserId: groupId })
            }
          />
        )}

        {screen.name === 'settings' && userId && (
          <SettingsScreen
            myUserId={userId}
            onBack={() => setScreen({ name: 'home' })}
            onSignedOut={() => {
              setUserId(null);
              setScreen({ name: 'welcome' });
            }}
          />
        )}

        {screen.name === 'starred' && userId && (
          <StarredScreen
            onBack={() => setScreen({ name: 'home' })}
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
