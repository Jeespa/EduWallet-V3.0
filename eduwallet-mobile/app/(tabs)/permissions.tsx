// app/(tabs)/permissions.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
} from "react-native";
import { useWallet } from "../../context/WalletContext";
import {
  getPermissionsReadOnly,
  getChallenge,
  preparePermissionOp,
  executePermissionOp,
} from "../../lib/api";
import type { PermissionStatus } from "../../types";

type PendingAction = "revoke" | "grant-read" | "grant-write";

export default function PermissionsScreen() {
  const { scaAddress, did, signMessage, signTypedData } = useWallet();

  const [perms, setPerms] = useState<PermissionStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mapPermissionsToStatuses = (all: {
    studentSca: string;
    permissions: {
      universityAddress: string;
      read: boolean;
      write: boolean;
      readRequested: boolean;
      writeRequested: boolean;
      universityName?: string;
      universityCountry?: string;
      universityShortName?: string;
    }[];
  }): PermissionStatus[] => {
    return all.permissions.map((entry) => {
      const read = !!entry.read;
      const write = !!entry.write;
      let level: 0 | 1 | 2 | 3 = 0;
      if (read) level = (level | 1) as 0 | 1 | 2 | 3;
      if (write) level = (level | 2) as 0 | 1 | 2 | 3;
      return {
        studentSca: all.studentSca,
        universitySmartAccount: entry.universityAddress,
        universityName: entry.universityName ?? "",
        universityCountry: entry.universityCountry ?? "",
        universityShortName: entry.universityShortName ?? "",
        read,
        write,
        readRequested: !!entry.readRequested,
        writeRequested: !!entry.writeRequested,
        level,
      };
    });
  };

  const loadPermissions = async () => {
    if (!scaAddress) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPermissionsReadOnly(scaAddress);
      setPerms(mapPermissionsToStatuses(data));
    } catch (e: any) {
      setError(e.message || "Failed to load permissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPermissions();
  }, [scaAddress]);

  const handleAction = (action: PendingAction, perm: PermissionStatus) => {
    const actionLabel =
      action === "revoke"
        ? "revoke this university's access"
        : action === "grant-read"
        ? "grant read access"
        : "grant write access";

    Alert.alert(
      "Confirm",
      `Sign with your wallet key to ${actionLabel}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign & Confirm",
          onPress: () => submitAction(action, perm),
        },
      ]
    );
  };

  const submitAction = async (action: PendingAction, perm: PermissionStatus) => {
    if (!scaAddress || !did) return;
    setSubmitting(true);
    setError(null);

    try {
      const baseAction = action === "revoke" ? "revoke" : "grant";
      const permType =
        action === "grant-write" ? "write" : action === "grant-read" ? "read" : undefined;
      const uni = perm.universitySmartAccount;

      // Step 1: get the unsigned packed UserOp from the gateway
      const prepared = await preparePermissionOp(scaAddress, baseAction, uni, permType);

      // Step 2: sign the packed UserOp with EIP-712
      const userOpSignature = await signTypedData(
        prepared.eip712.domain as Record<string, unknown>,
        prepared.eip712.types as Record<string, Array<{ name: string; type: string }>>,
        {
          sender: prepared.packedUserOp.sender,
          nonce: BigInt(prepared.packedUserOp.nonce),
          initCode: prepared.packedUserOp.initCode,
          callData: prepared.packedUserOp.callData,
          accountGasLimits: prepared.packedUserOp.accountGasLimits,
          preVerificationGas: BigInt(prepared.packedUserOp.preVerificationGas),
          gasFees: prepared.packedUserOp.gasFees,
          paymasterAndData: prepared.packedUserOp.paymasterAndData,
        }
      );

      // Step 3: get a challenge and sign it (proves DID ownership to the gateway)
      const { challenge } = await getChallenge();
      const challengeSignature = await signMessage(challenge);

      // Step 4: submit
      await executePermissionOp(scaAddress, baseAction, {
        did,
        challenge,
        challengeSignature,
        signedUserOp: { ...prepared.packedUserOp, signature: userOpSignature },
      });

      await loadPermissions();
    } catch (e: any) {
      setError(e.message || "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!scaAddress) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Permissions</Text>
        <Text style={styles.muted}>
          Activate your academic wallet to manage permissions.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Permissions</Text>

      {(loading || submitting) && <ActivityIndicator style={{ marginBottom: 8 }} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {perms.length === 0 && !loading && !error && (
        <Text style={styles.muted}>No permissions or requests found.</Text>
      )}

      <ScrollView style={{ marginTop: 8 }}>
        {perms.map((perm) => {
          const effectiveRead = perm.read || perm.write;
          const effectiveWrite = perm.write;
          const hasPermission = effectiveRead || effectiveWrite;
          const hasReadRequest = perm.readRequested && !effectiveRead;
          const hasWriteRequest = perm.writeRequested && !effectiveWrite;

          const universityLabel =
            perm.universityName && perm.universityShortName
              ? `${perm.universityName} (${perm.universityShortName})`
              : perm.universityShortName ||
                perm.universityName ||
                perm.universitySmartAccount;

          return (
            <View style={styles.card} key={perm.universitySmartAccount}>
              <Text style={styles.cardTitle}>{universityLabel}</Text>
              <Text style={styles.muted}>{perm.universitySmartAccount}</Text>
              {perm.universityCountry ? (
                <Text style={styles.muted}>Country: {perm.universityCountry}</Text>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Current access</Text>
                <Text style={styles.row}>
                  Read:{" "}
                  <Text style={styles.value}>{effectiveRead ? "Yes" : "No"}</Text>
                </Text>
                <Text style={styles.row}>
                  Write:{" "}
                  <Text style={styles.value}>{effectiveWrite ? "Yes" : "No"}</Text>
                </Text>
              </View>

              {(hasReadRequest || hasWriteRequest) && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Pending requests</Text>
                  {hasReadRequest && (
                    <Text style={styles.row}>
                      Read: <Text style={styles.value}>Pending</Text>
                    </Text>
                  )}
                  {hasWriteRequest && (
                    <Text style={styles.row}>
                      Write: <Text style={styles.value}>Pending</Text>
                    </Text>
                  )}
                </View>
              )}

              <View style={styles.buttons}>
                {hasPermission && (
                  <Pressable
                    style={[styles.btn, styles.btnDanger, submitting && styles.btnDisabled]}
                    disabled={submitting}
                    onPress={() => handleAction("revoke", perm)}
                  >
                    <Text style={styles.btnDangerText}>Revoke access</Text>
                  </Pressable>
                )}
                {hasReadRequest && (
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, submitting && styles.btnDisabled]}
                    disabled={submitting}
                    onPress={() => handleAction("grant-read", perm)}
                  >
                    <Text style={styles.btnPrimaryText}>Accept read request</Text>
                  </Pressable>
                )}
                {hasWriteRequest && (
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, submitting && styles.btnDisabled]}
                    disabled={submitting}
                    onPress={() => handleAction("grant-write", perm)}
                  >
                    <Text style={styles.btnPrimaryText}>Accept write request</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
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
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 16,
  },
  error: { color: "#ff6b6b", marginBottom: 8 },
  muted: { fontSize: 12, color: "#888", marginBottom: 4 },
  card: {
    backgroundColor: "#1a1d23",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  section: { marginTop: 8 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  row: { fontSize: 13, color: "#ddd", marginBottom: 2 },
  value: { fontWeight: "600" },
  buttons: { marginTop: 16, gap: 8 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: "#3b3ff0" },
  btnPrimaryText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  btnDanger: { backgroundColor: "#2a1414", borderWidth: 1, borderColor: "#ff6b6b" },
  btnDangerText: { color: "#ff6b6b", fontWeight: "600", fontSize: 13 },
  btnDisabled: { opacity: 0.4 },
});
