import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useWallet } from "../context/WalletContext";

export default function CreateWalletScreen() {
  const { createWallet } = useWallet();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    did: string;
    ownerAddress: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await createWallet();
      setResult(info);
    } catch (e: any) {
      setError(e.message ?? "Failed to create wallet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.appName}>EduWallet</Text>
      <Text style={styles.tagline}>Your decentralised identity wallet</Text>

      {!result ? (
        <>
          {/* Explanation card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create your wallet</Text>
            <Text style={styles.cardBody}>
              A secp256k1 key pair will be generated on this device. Your
              private key is stored in the device secure enclave and never
              transmitted anywhere.
            </Text>
            <Text style={styles.cardBody}>
              A Decentralised Identifier (DID) will be derived from your public
              key. Use it to receive and present Verifiable Credentials.
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Create wallet</Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          {/* Success card */}
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Wallet created</Text>

            <Text style={styles.fieldLabel}>Your DID</Text>
            <Text style={styles.mono} selectable>
              {result.did}
            </Text>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
              Owner address
            </Text>
            <Text style={styles.mono} selectable>
              {result.ownerAddress}
            </Text>

            <Text style={styles.hint}>
              Your DID and address are shown for reference. You can always find
              them in your profile later.
            </Text>
          </View>

          <Pressable
            style={styles.button}
            onPress={() => router.replace("/kyc")}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#0f1115",
    paddingTop: 80,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  appName: {
    fontSize: 34,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    color: "#888888",
    marginBottom: 40,
  },
  card: {
    backgroundColor: "#1a1d23",
    borderRadius: 14,
    padding: 20,
    marginBottom: 24,
    gap: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
  },
  cardBody: {
    fontSize: 14,
    color: "#cccccc",
    lineHeight: 22,
  },
  successCard: {
    backgroundColor: "#1a1d23",
    borderRadius: 14,
    padding: 20,
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#4ade80",
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 11,
    color: "#888888",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  mono: {
    fontSize: 12,
    color: "#9fa9ff",
    fontFamily: "monospace",
    lineHeight: 18,
  },
  hint: {
    marginTop: 20,
    fontSize: 12,
    color: "#666666",
    lineHeight: 18,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#3b3ff0",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
