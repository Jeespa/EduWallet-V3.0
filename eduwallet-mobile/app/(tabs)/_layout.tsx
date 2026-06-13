// app/(tabs)/_layout.tsx
import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useWallet } from "../../context/WalletContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Root tab layout for the mobile app.
 *
 * Tab bar is shown whenever a wallet exists.
 * Adds safe area padding at the bottom on devices with a gesture bar.
 */
export default function TabLayout() {
  const { hasWallet } = useWallet();
  const isLoggedIn = hasWallet;

  const insets = useSafeAreaInsets();

  // Shared base style for the tab bar background
  const baseTabBarStyle = {
    backgroundColor: "#0f1115",
    borderTopWidth: 0,
  } as const;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#ffffff",
        tabBarInactiveTintColor: "#888888",
        // When logged in, show a normal tab bar.
        // When logged out, collapse and hide it.
        tabBarStyle: isLoggedIn
          ? {
              ...baseTabBarStyle,
              height: 60 + (insets.bottom || 0),
              paddingBottom: insets.bottom || 8,
            }
          : { ...baseTabBarStyle, height: 0, display: "none" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="permissions"
        options={{
          title: "Permissions",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="lock-closed-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="credentials"
        options={{
          title: "Credentials",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="id-card-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
