// app/course/[index].tsx
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useWallet } from "../../context/WalletContext";

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
 * Detail screen for a single academic result VC.
 *
 * The route is `/course/[index]` where `index` is the 0-based position
 * in the `academicVcs` array from WalletContext.
 */
export default function CourseDetailsScreen() {
  const { index } = useLocalSearchParams<{ index?: string }>();
  const { academicVcs } = useWallet();

  const courseIndex = index ? parseInt(index, 10) : NaN;

  if (
    Number.isNaN(courseIndex) ||
    courseIndex < 0 ||
    courseIndex >= academicVcs.length
  ) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No course data available.</Text>
      </View>
    );
  }

  const vc = academicVcs[courseIndex]!;
  const claims = parseDisclosures(vc);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{claims.courseName ?? "Unknown Course"}</Text>
      {claims.degreeProgramme ? (
        <Text style={styles.subtitle}>{claims.degreeProgramme}</Text>
      ) : null}

      <View style={styles.card}>
        {claims.courseCode ? (
          <>
            <Text style={styles.label}>Course code</Text>
            <Text style={styles.value}>{claims.courseCode}</Text>
          </>
        ) : null}

        {claims.ects ? (
          <>
            <Text style={styles.label}>ECTS</Text>
            <Text style={styles.value}>{claims.ects}</Text>
          </>
        ) : null}

        {claims.grade ? (
          <>
            <Text style={styles.label}>Grade</Text>
            <Text style={styles.value}>{claims.grade}</Text>
          </>
        ) : null}

        {claims.date ? (
          <>
            <Text style={styles.label}>Date</Text>
            <Text style={styles.value}>{claims.date}</Text>
          </>
        ) : null}

        {claims.universityName ? (
          <>
            <Text style={styles.label}>University</Text>
            <Text style={styles.value}>{claims.universityName}</Text>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
    backgroundColor: "#0f1115",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#cccccc",
    marginBottom: 16,
  },
  card: {
    borderRadius: 16,
    paddingTop: 4,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: "#1a1d23",
  },
  label: {
    fontSize: 12,
    color: "#9fa9ff",
    marginTop: 10,
  },
  value: {
    fontSize: 14,
    color: "#ffffff",
    marginTop: 2,
  },
  errorText: {
    color: "#ff6b6b",
    fontSize: 14,
  },
});
