// app/request-status.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useWallet } from "../context/WalletContext";
import { requestStudentStatus } from "../lib/api";

/**
 * Request Status screen
 *
 * Lets the student activate their academic wallet by presenting their
 * KYC VC to the gateway.  On success the gateway deploys their smart
 * contract account and issues a StudentStatus SD-JWT VC.
 */
export default function RequestStatusScreen() {
  const router = useRouter();
  const { kycVc, ownerAddress, storeStudentStatus, hasStudentStatusVc, scaAddress } =
    useWallet();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    if (!kycVc || !ownerAddress) return;

    setLoading(true);
    setError(null);

    try {
      const result = await requestStudentStatus(kycVc, ownerAddress);
      await storeStudentStatus(result.studentStatusVc, result.studentSca);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Activation failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Success view ────────────────────────────────────────────────────────────
  if (hasStudentStatusVc && scaAddress) {
    return (
      <View style={styles.container}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={64} color="#4caf50" />
        </View>
        <Text style={styles.successTitle}>Academic wallet activated</Text>
        <Text style={styles.successBody}>
          Your StudentStatus credential has been issued and your smart account is
          deployed on-chain.
        </Text>

        <View style={styles.scaCard}>
          <Text style={styles.scaLabel}>Smart Account Address</Text>
          <Text style={styles.scaAddress} numberOfLines={2} selectable>
            {scaAddress}
          </Text>
        </View>

        <Pressable style={styles.doneBtn} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // ── Activation view ─────────────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Activate academic wallet</Text>

      <Text style={styles.body}>
        Presenting your verified identity to the university will deploy your
        on-chain smart account and issue a{" "}
        <Text style={styles.highlight}>StudentStatus</Text> credential.
      </Text>

      {/* What happens checklist */}
      <View style={styles.stepsCard}>
        <StepRow icon="shield-checkmark-outline" text="KYC identity verified by BankID" done />
        <StepRow icon="wallet-outline" text="Smart account deployed on-chain" done={false} />
        <StepRow icon="card-outline" text="StudentStatus VC issued to your wallet" done={false} />
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color="#ff6b6b" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Pressable
        style={[styles.activateBtn, loading && styles.activateBtnDisabled]}
        onPress={activate}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.activateBtnText}>Activate</Text>
        )}
      </Pressable>

      {loading && (
        <Text style={styles.loadingHint}>
          Deploying smart account — this may take a few seconds…
        </Text>
      )}
    </ScrollView>
  );
}

function StepRow({
  icon,
  text,
  done,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
  done: boolean;
}) {
  return (
    <View style={styles.stepRow}>
      <Ionicons
        name={done ? "checkmark-circle" : icon}
        size={20}
        color={done ? "#4caf50" : "#9fa9ff"}
        style={{ marginRight: 10 }}
      />
      <Text style={[styles.stepText, done && styles.stepTextDone]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 32,
    backgroundColor: "#0f1115",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    color: "#aaaaaa",
    lineHeight: 22,
    marginBottom: 24,
  },
  highlight: {
    color: "#9fa9ff",
    fontWeight: "600",
  },
  stepsCard: {
    backgroundColor: "#1a1d23",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  stepText: {
    color: "#cccccc",
    fontSize: 14,
    flex: 1,
  },
  stepTextDone: {
    color: "#888888",
    textDecorationLine: "line-through",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2a1515",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: "#ff6b6b",
    fontSize: 13,
    flex: 1,
  },
  activateBtn: {
    backgroundColor: "#3b3ff0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  activateBtnDisabled: {
    opacity: 0.6,
  },
  activateBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  loadingHint: {
    marginTop: 12,
    color: "#666666",
    fontSize: 12,
    textAlign: "center",
  },
  // Success view
  successIcon: {
    alignItems: "center",
    marginBottom: 20,
    marginTop: 40,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 10,
  },
  successBody: {
    fontSize: 14,
    color: "#aaaaaa",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  scaCard: {
    backgroundColor: "#1a1d23",
    borderRadius: 12,
    padding: 16,
    marginBottom: 28,
  },
  scaLabel: {
    color: "#888888",
    fontSize: 12,
    marginBottom: 6,
  },
  scaAddress: {
    color: "#9fa9ff",
    fontSize: 13,
    fontFamily: "monospace",
  },
  doneBtn: {
    backgroundColor: "#3b3ff0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  doneBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
