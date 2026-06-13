import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StudentProvider } from "../context/StudentContext";
import { WalletProvider, useWallet } from "../context/WalletContext";

/**
 * Inner navigator.
 *
 * Sits inside both WalletProvider and StudentProvider so it can read
 * wallet state. On every render it checks whether the user has created
 * a wallet yet and redirects to the onboarding screen if they haven't.
 */
function RootNavigator() {
  const { isLoading, hasWallet } = useWallet();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inOnboarding =
      segments[0] === "create-wallet" ||
      segments[0] === "kyc" ||
      segments[0] === "request-status";
    if (!hasWallet && !inOnboarding) {
      // No wallet yet — redirect to onboarding.
      // create-wallet.tsx handles the forward navigation after creation.
      router.replace("/create-wallet");
    }
  }, [isLoading, hasWallet]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0f1115",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#3b3ff0" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0f1115" },
        headerTintColor: "#ffffff",
        headerTitleStyle: { color: "#ffffff" },
        contentStyle: { backgroundColor: "#0f1115" },
      }}
    >
      {/* Onboarding — no header chrome */}
      <Stack.Screen name="create-wallet" options={{ headerShown: false }} />

      {/* KYC / BankID identity verification */}
      <Stack.Screen name="kyc" options={{ headerShown: false }} />

      {/* Academic wallet activation */}
      <Stack.Screen
        name="request-status"
        options={{ title: "Activate Academic Wallet" }}
      />

      {/* Main tabbed app — its own nested layout handles the tab bar */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      {/* Selective disclosure / sharing */}
      <Stack.Screen name="share-vc" options={{ title: "Share Credential" }} />

      {/* Course detail keeps its own nested layout and back button */}
      <Stack.Screen name="course" options={{ headerShown: false }} />

      {/* Profile gets a native header with back arrow */}
      <Stack.Screen name="profile" options={{ title: "Profile" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <WalletProvider>
      <StudentProvider>
        <View style={{ flex: 1, backgroundColor: "#0f1115" }}>
          <RootNavigator />
        </View>
      </StudentProvider>
    </WalletProvider>
  );
}
