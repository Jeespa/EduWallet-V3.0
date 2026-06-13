// app/(tabs)/index.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useWallet } from "../../context/WalletContext";
import { useStudent } from "../../context/StudentContext";
import { getChallenge, loginWithDid } from "../../lib/api";

// ── SD-JWT disclosure parsing ─────────────────────────────────────────────────

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

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const {
    did,
    scaAddress,
    kycVc,
    hasKycVc,
    hasStudentStatusVc,
    academicVcs,
    signMessage,
  } = useWallet();
  const { isAuthenticated, setAuthenticated } = useStudent();

  const [authError, setAuthError] = useState<string | null>(null);
  const [authing, setAuthing] = useState(false);
  const hasTriedAuth = useRef(false);

  // Auto-authenticate once per session when the wallet is ready
  useEffect(() => {
    if (isAuthenticated || !did || !hasStudentStatusVc || hasTriedAuth.current) return;
    hasTriedAuth.current = true;
    authenticate();
  }, [did, hasStudentStatusVc, isAuthenticated]);

  async function authenticate() {
    setAuthing(true);
    setAuthError(null);
    try {
      const { challenge } = await getChallenge();
      const signature = await signMessage(challenge);
      await loginWithDid(did!, signature, challenge, scaAddress ?? undefined);
      setAuthenticated();
    } catch (err: any) {
      setAuthError(err.message ?? "Could not connect to gateway");
    } finally {
      setAuthing(false);
    }
  }

  // Derive student name from KYC VC disclosures
  const kycClaims = kycVc ? parseDisclosures(kycVc) : {};
  const studentName = kycClaims.name ?? null;

  // ECTS total from academic VCs
  const totalEcts = academicVcs.reduce((sum, vc) => {
    const claims = parseDisclosures(vc);
    const ects = parseFloat(claims.ects ?? "0");
    return sum + (isNaN(ects) ? 0 : ects);
  }, 0);

  const shortDid = did ? `${did.slice(0, 20)}…${did.slice(-6)}` : "—";
  const shortSca = scaAddress
    ? `${scaAddress.slice(0, 8)}…${scaAddress.slice(-6)}`
    : "—";

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.appTitle}>EduWallet</Text>
        <Pressable onPress={() => router.push("/profile")}>
          <Ionicons name="person-outline" size={24} color="#ffffff" />
        </Pressable>
      </View>

      {/* KYC banner */}
      {!hasKycVc && (
        <Pressable style={styles.kycBanner} onPress={() => router.push("/kyc")}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Verify your identity</Text>
            <Text style={styles.bannerBody}>
              Complete BankID verification to unlock full wallet features.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9fa9ff" />
        </Pressable>
      )}

      {/* StudentStatus banner */}
      {hasKycVc && !hasStudentStatusVc && (
        <Pressable
          style={styles.statusBanner}
          onPress={() => router.push("/request-status")}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Activate academic wallet</Text>
            <Text style={styles.bannerBody}>
              Deploy your on-chain smart account and receive your StudentStatus credential.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9fa9ff" />
        </Pressable>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Auth status */}
        {authing && (
          <View style={styles.authRow}>
            <ActivityIndicator size="small" color="#9fa9ff" />
            <Text style={styles.authText}>Connecting to gateway…</Text>
          </View>
        )}
        {authError && !authing && (
          <Pressable style={styles.authErrorRow} onPress={authenticate}>
            <Ionicons name="cloud-offline-outline" size={16} color="#ff6b6b" />
            <Text style={styles.authErrorText}>{authError}</Text>
            <Text style={styles.retryText}> Retry</Text>
          </Pressable>
        )}

        {/* Greeting */}
        {studentName && (
          <Text style={styles.greeting}>
            Hello, <Text style={styles.greetingName}>{studentName}</Text>
          </Text>
        )}

        {/* ECTS balance card — only when academic wallet is active */}
        {hasStudentStatusVc && (
          <View style={styles.ectsCard}>
            <Text style={styles.ectsLabel}>Total academic credits</Text>
            <Text style={styles.ectsValue}>{totalEcts.toFixed(1)} ECTS</Text>
            <Text style={styles.ectsSubtitle}>
              {academicVcs.length} credential{academicVcs.length !== 1 ? "s" : ""} stored
            </Text>
          </View>
        )}

        {/* Identity card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Identity</Text>
          <Text style={styles.infoRow}>
            <Text style={styles.infoLabel}>DID  </Text>
            <Text style={styles.infoValue}>{shortDid}</Text>
          </Text>
          {scaAddress && (
            <Text style={styles.infoRow}>
              <Text style={styles.infoLabel}>SCA  </Text>
              <Text style={styles.infoValue}>{shortSca}</Text>
            </Text>
          )}
          <View style={styles.badgeRow}>
            <View style={[styles.badge, hasKycVc ? styles.badgeActive : styles.badgeInactive]}>
              <Text style={styles.badgeText}>KYC</Text>
            </View>
            <View style={[styles.badge, hasStudentStatusVc ? styles.badgeActive : styles.badgeInactive]}>
              <Text style={styles.badgeText}>Student</Text>
            </View>
            <View style={[styles.badge, academicVcs.length > 0 ? styles.badgeActive : styles.badgeInactive]}>
              <Text style={styles.badgeText}>Academic</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
    backgroundColor: "#0f1115",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#ffffff",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  authRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  authText: {
    color: "#9fa9ff",
    fontSize: 13,
  },
  authErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1d23",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    gap: 6,
  },
  authErrorText: {
    color: "#ff6b6b",
    fontSize: 13,
    flex: 1,
  },
  retryText: {
    color: "#9fa9ff",
    fontSize: 13,
    fontWeight: "600",
  },
  greeting: {
    fontSize: 22,
    color: "#ffffff",
    marginBottom: 16,
  },
  greetingName: {
    fontWeight: "bold",
    color: "#9fa9ff",
  },
  ectsCard: {
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#3b3ff0",
  },
  ectsLabel: {
    color: "#c8c8ff",
    fontSize: 13,
    marginBottom: 4,
  },
  ectsValue: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 4,
  },
  ectsSubtitle: {
    color: "#c8c8ff",
    fontSize: 12,
  },
  infoCard: {
    backgroundColor: "#1a1d26",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  infoCardTitle: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 15,
    marginBottom: 10,
  },
  infoRow: {
    fontSize: 13,
    color: "#c0c4d8",
    lineHeight: 20,
    marginBottom: 2,
  },
  infoLabel: {
    color: "#7a7e96",
    fontWeight: "600",
  },
  infoValue: {
    fontFamily: "monospace",
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeActive: {
    backgroundColor: "#1e3a1e",
    borderWidth: 1,
    borderColor: "#4caf50",
  },
  badgeInactive: {
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: "#555",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  kycBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1d23",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#3b3ff0",
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1d23",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#4caf50",
  },
  bannerTitle: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
    marginBottom: 2,
  },
  bannerBody: {
    color: "#888888",
    fontSize: 12,
    lineHeight: 18,
  },
});
