import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  Share,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useWallet } from "../context/WalletContext";

// ── SD-JWT helpers ────────────────────────────────────────────────────────────

function b64urlToString(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(b64 + padding);
}

interface Disclosure {
  encoded: string;
  name: string;
  value: string;
}

function parseDisclosureList(sdJwt: string): Disclosure[] {
  const parts = sdJwt.split("~").slice(1).filter(Boolean);
  const result: Disclosure[] = [];
  for (const encoded of parts) {
    try {
      const decoded = JSON.parse(b64urlToString(encoded)) as unknown[];
      if (Array.isArray(decoded) && decoded.length === 3) {
        result.push({
          encoded,
          name: String(decoded[1]),
          value: String(decoded[2]),
        });
      }
    } catch {
      // skip malformed
    }
  }
  return result;
}

function getJwtPart(sdJwt: string): string {
  return sdJwt.split("~")[0] ?? "";
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ShareVcScreen() {
  const { type, index } = useLocalSearchParams<{ type: string; index?: string }>();
  const { kycVc, studentStatusVc, academicVcs } = useWallet();

  const sdJwt = useMemo(() => {
    if (type === "kyc") return kycVc ?? "";
    if (type === "studentStatus") return studentStatusVc ?? "";
    if (type === "academic") {
      const i = parseInt(index ?? "0", 10);
      return academicVcs[i] ?? "";
    }
    return "";
  }, [type, index, kycVc, studentStatusVc, academicVcs]);

  const disclosures = useMemo(() => parseDisclosureList(sdJwt), [sdJwt]);
  const [selected, setSelected] = useState<Set<number>>(() => {
    // All disclosures included by default
    return new Set(disclosures.map((_, i) => i));
  });

  const [generated, setGenerated] = useState<string | null>(null);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    setGenerated(null);
  }

  function generate() {
    const jwtPart = getJwtPart(sdJwt);
    const chosenDisclosures = disclosures
      .filter((_, i) => selected.has(i))
      .map((d) => d.encoded);
    const presentation = jwtPart + "~" + chosenDisclosures.join("~") + "~";
    setGenerated(presentation);
  }

  async function copy() {
    if (!generated) return;
    try {
      await Share.share({ message: generated, title: "SD-JWT Presentation" });
    } catch (err) {
      Alert.alert("Share failed", err instanceof Error ? err.message : "Unknown error");
    }
  }

  const vcTitle = type === "kyc"
    ? "KYC Credential"
    : type === "studentStatus"
    ? "StudentStatus Credential"
    : `Academic Result #${(parseInt(index ?? "0", 10) + 1)}`;

  if (!sdJwt) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Credential not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{vcTitle}</Text>
      <Text style={styles.subtitle}>
        Toggle which claims to include in the shared presentation. Unchecked claims
        remain private — verifiers cannot learn their values.
      </Text>

      <Text style={styles.sectionLabel}>SELECTABLE DISCLOSURES</Text>
      {disclosures.length === 0 && (
        <Text style={styles.muted}>This credential has no selectable disclosures.</Text>
      )}
      {disclosures.map((d, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.claimName}>{d.name}</Text>
            <Text style={styles.claimValue}>{d.value}</Text>
          </View>
          <Switch
            value={selected.has(i)}
            onValueChange={() => toggle(i)}
            trackColor={{ false: "#2a2d3a", true: "#3b3ff0" }}
            thumbColor="#ffffff"
          />
        </View>
      ))}

      <TouchableOpacity style={styles.generateBtn} onPress={generate}>
        <Text style={styles.generateBtnText}>Generate Presentation</Text>
      </TouchableOpacity>

      {generated && (
        <View style={styles.resultBox}>
          <Text style={styles.sectionLabel}>GENERATED SD-JWT</Text>
          <Text style={styles.sdJwtText} selectable numberOfLines={6} ellipsizeMode="tail">
            {generated}
          </Text>
          <TouchableOpacity style={styles.copyBtn} onPress={copy}>
            <Text style={styles.copyBtnText}>Share / Copy</Text>
          </TouchableOpacity>
        </View>
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
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: "#0f1115",
    justifyContent: "center",
    alignItems: "center",
  },
  error: {
    color: "#888",
    fontSize: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
  },
  subtitle: {
    color: "#7a7e96",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 24,
  },
  sectionLabel: {
    color: "#555",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  muted: {
    color: "#555",
    fontSize: 13,
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1d26",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  rowText: {
    flex: 1,
  },
  claimName: {
    color: "#a0a4b8",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  claimValue: {
    color: "#ffffff",
    fontSize: 15,
  },
  generateBtn: {
    backgroundColor: "#3b3ff0",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
    marginBottom: 24,
  },
  generateBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  resultBox: {
    backgroundColor: "#1a1d26",
    borderRadius: 12,
    padding: 16,
  },
  sdJwtText: {
    color: "#a0a4b8",
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 16,
  },
  copyBtn: {
    backgroundColor: "#2a2d3a",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  copyBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});
