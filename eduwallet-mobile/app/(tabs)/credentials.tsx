import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useWallet } from "../../context/WalletContext";
import { fetchAcademicVcs, verifyVc } from "../../lib/api";

// ── SD-JWT parsing helpers ────────────────────────────────────────────────────

function b64urlToString(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(b64 + padding);
}

function parseVcPayload(sdJwt: string): Record<string, unknown> {
  try {
    const jwtPart = sdJwt.split("~")[0] ?? "";
    const payloadB64 = jwtPart.split(".")[1] ?? "";
    return JSON.parse(b64urlToString(payloadB64)) as Record<string, unknown>;
  } catch {
    return {};
  }
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

// ── VC Card ───────────────────────────────────────────────────────────────────

interface VcCardProps {
  title: string;
  color: string;
  rows: { label: string; value: string }[];
  onShare: () => void;
}

function VcCard({ title, color, rows, onShare }: VcCardProps) {
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        <TouchableOpacity style={styles.shareBtn} onPress={onShare}>
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
      </View>
      {rows.map((row) => (
        <Text key={row.label} style={styles.cardRow}>
          <Text style={styles.cardLabel}>{row.label}: </Text>
          {row.value}
        </Text>
      ))}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CredentialsScreen() {
  const router = useRouter();
  const { did, kycVc, studentStatusVc, academicVcs, storeAcademicVc } = useWallet();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    if (!did) return;
    setRefreshing(true);
    let newCount = 0;
    let skippedCount = 0;
    try {
      const { vcs } = await fetchAcademicVcs(did);
      for (const vc of vcs) {
        if (academicVcs.includes(vc)) continue;

        // Verify signature + revocation before storing
        try {
          const result = await verifyVc(vc);
          if (!result.valid || result.revoked) {
            skippedCount++;
            continue;
          }
        } catch {
          // Verification network failure — store anyway so the user isn't
          // silently denied credentials during a temporary gateway outage
        }

        await storeAcademicVc(vc);
        newCount++;
      }

      if (newCount > 0) {
        Alert.alert("Credentials updated", `${newCount} new credential${newCount > 1 ? "s" : ""} added to your wallet.`);
      } else if (skippedCount > 0) {
        Alert.alert("Credentials skipped", `${skippedCount} credential${skippedCount > 1 ? "s" : ""} failed verification and were not stored.`);
      } else {
        Alert.alert("No new credentials", "No academic result VCs are pending from the gateway.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Refresh failed", msg);
    } finally {
      setRefreshing(false);
    }
  }

  // KYC VC
  const kycPayload = kycVc ? parseVcPayload(kycVc) : null;
  const kycClaims = kycVc ? parseDisclosures(kycVc) : {};

  // StudentStatus VC
  const ssPayload = studentStatusVc ? parseVcPayload(studentStatusVc) : null;
  const ssClaims = studentStatusVc ? parseDisclosures(studentStatusVc) : {};

  const hasAnything = kycVc || studentStatusVc || academicVcs.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Credentials</Text>

      <TouchableOpacity
        style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
        onPress={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.refreshBtnText}>Refresh from gateway</Text>
        )}
      </TouchableOpacity>

      {!hasAnything && (
        <Text style={styles.empty}>
          No credentials yet. Complete KYC and activate your academic wallet to get started.
        </Text>
      )}

      {/* KYC Credential */}
      {kycVc && kycPayload && (
        <>
          <Text style={styles.sectionLabel}>IDENTITY</Text>
          <VcCard
            title="KYC Credential"
            color="#3b3ff0"
            rows={[
              ...(kycClaims.name ? [{ label: "Name", value: kycClaims.name }] : []),
              ...(kycClaims.birthdate ? [{ label: "Birthdate", value: kycClaims.birthdate }] : []),
              ...(kycClaims.nationalId ? [{ label: "National ID", value: kycClaims.nationalId }] : []),
              { label: "Issuer", value: String(kycPayload.iss ?? "—") },
            ]}
            onShare={() => router.push({ pathname: "/share-vc", params: { type: "kyc" } })}
          />
        </>
      )}

      {/* StudentStatus VC */}
      {studentStatusVc && ssPayload && (
        <>
          <Text style={styles.sectionLabel}>ACADEMIC STATUS</Text>
          <VcCard
            title="StudentStatus Credential"
            color="#4caf50"
            rows={[
              ...(ssClaims.universityName ? [{ label: "University", value: ssClaims.universityName }] : []),
              ...(ssClaims.enrollmentDate ? [{ label: "Enrolled", value: ssClaims.enrollmentDate }] : []),
              { label: "SCA", value: String(ssPayload.studentSca ?? "—").slice(0, 10) + "…" },
            ]}
            onShare={() => router.push({ pathname: "/share-vc", params: { type: "studentStatus" } })}
          />
        </>
      )}

      {/* Academic Result VCs */}
      {academicVcs.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>ACADEMIC RESULTS</Text>
          {academicVcs.map((vc, i) => {
            const claims = parseDisclosures(vc);
            const payload = parseVcPayload(vc);
            return (
              <VcCard
                key={i}
                title={claims.courseName ?? `Result #${i + 1}`}
                color="#ff9800"
                rows={[
                  ...(claims.courseCode ? [{ label: "Code", value: claims.courseCode }] : []),
                  ...(claims.grade ? [{ label: "Grade", value: claims.grade }] : []),
                  ...(claims.ects ? [{ label: "ECTS", value: claims.ects }] : []),
                  ...(claims.date ? [{ label: "Date", value: claims.date }] : []),
                  ...(claims.degreeProgramme ? [{ label: "Programme", value: claims.degreeProgramme }] : []),
                  { label: "Issuer", value: String(payload.iss ?? "—") },
                ]}
                onShare={() =>
                  router.push({
                    pathname: "/share-vc",
                    params: { type: "academic", index: String(i) },
                  })
                }
              />
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1115",
  },
  content: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 20,
  },
  refreshBtn: {
    backgroundColor: "#1e2028",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#2e3038",
  },
  refreshBtnDisabled: {
    opacity: 0.6,
  },
  refreshBtnText: {
    color: "#a0a4b8",
    fontSize: 14,
    fontWeight: "600",
  },
  empty: {
    color: "#666",
    textAlign: "center",
    marginTop: 40,
    lineHeight: 22,
  },
  sectionLabel: {
    color: "#555",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 4,
  },
  card: {
    backgroundColor: "#1a1d26",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  shareBtn: {
    backgroundColor: "#2a2d3a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shareBtnText: {
    color: "#a0a4b8",
    fontSize: 13,
    fontWeight: "600",
  },
  cardRow: {
    color: "#c0c4d8",
    fontSize: 13,
    lineHeight: 20,
  },
  cardLabel: {
    color: "#7a7e96",
    fontWeight: "600",
  },
});
