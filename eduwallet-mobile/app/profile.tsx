// app/profile.tsx
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Button,
  Alert,
} from "react-native";
import { useWallet } from "../context/WalletContext";
import { useStudent } from "../context/StudentContext";
import { router } from "expo-router";

function b64urlToString(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(b64 + padding);
}

function parseDisclosures(sdJwt: string): Record<string, string> {
  const parts = sdJwt.split("~").slice(1).filter(Boolean);
  const result: Record<string, string> = {};
  for (const part of parts) {
    try {
      const decoded = JSON.parse(b64urlToString(part)) as unknown[];
      if (Array.isArray(decoded) && decoded.length === 3) {
        result[String(decoded[1])] = String(decoded[2]);
      }
    } catch {
      // skip malformed
    }
  }
  return result;
}

/**
 * Profile screen.
 *
 * Shows personal data from the KYC VC (BankID-verified) and wallet
 * information. Offers a wallet reset that clears all local state.
 */
export default function ProfileScreen() {
  const { did, scaAddress, kycVc, academicVcs, clearWallet } = useWallet();
  const { clearAuthentication } = useStudent();

  const kycClaims = kycVc ? parseDisclosures(kycVc) : {};

  const handleReset = () => {
    Alert.alert(
      "Reset wallet",
      "This will delete your keys and all stored credentials from this device. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            clearAuthentication();
            await clearWallet();
            router.replace("/create-wallet");
          },
        },
      ],
      { cancelable: true }
    );
  };

  const shortDid = did ? `${did.slice(0, 28)}…` : "—";
  const shortSca = scaAddress
    ? `${scaAddress.slice(0, 10)}…${scaAddress.slice(-8)}`
    : "—";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Personal details from KYC VC */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Personal details</Text>
        {kycClaims.name ? (
          <Text style={styles.row}>
            <Text style={styles.label}>Name: </Text>
            {kycClaims.name}
          </Text>
        ) : null}
        {kycClaims.birthdate ? (
          <Text style={styles.row}>
            <Text style={styles.label}>Birthdate: </Text>
            {kycClaims.birthdate}
          </Text>
        ) : null}
        {kycClaims.nationalId ? (
          <Text style={styles.row}>
            <Text style={styles.label}>National ID: </Text>
            {kycClaims.nationalId}
          </Text>
        ) : null}
        {!kycVc && (
          <Text style={styles.muted}>
            Complete BankID verification to see your personal details here.
          </Text>
        )}
      </View>

      {/* Wallet card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Wallet</Text>
        <Text style={styles.row}>
          <Text style={styles.label}>DID: </Text>
          <Text style={styles.mono}>{shortDid}</Text>
        </Text>
        {scaAddress ? (
          <Text style={styles.row}>
            <Text style={styles.label}>Smart account: </Text>
            <Text style={styles.mono}>{shortSca}</Text>
          </Text>
        ) : null}
        <Text style={styles.row}>
          <Text style={styles.label}>Academic VCs: </Text>
          {academicVcs.length}
        </Text>
      </View>

      {/* Reset */}
      <View style={styles.resetWrapper}>
        <Button title="Reset wallet" color="#ff6b6b" onPress={handleReset} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 32,
    backgroundColor: "#0f1115",
    flexGrow: 1,
  },
  muted: {
    color: "#888",
    fontSize: 13,
  },
  card: {
    backgroundColor: "#1a1d23",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 10,
  },
  row: {
    color: "#ffffff",
    fontSize: 14,
    marginBottom: 4,
  },
  label: {
    fontWeight: "600",
    color: "#9fa9ff",
  },
  mono: {
    fontFamily: "monospace",
    color: "#c0c4d8",
  },
  resetWrapper: {
    marginTop: 8,
  },
});
