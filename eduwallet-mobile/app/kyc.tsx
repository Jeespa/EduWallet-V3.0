import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useWallet } from "../context/WalletContext";
import { API_BASE_URL } from "../lib/api";

/**
 * KYC screen
 *
 * Flow:
 *   1. User taps "Verify with BankID"
 *   2. We call GET /kyc/authorize with our DID and a deep-link redirect URI
 *   3. Gateway responds with a Signicat authorization URL
 *   4. We open it in Chrome Custom Tabs via openAuthSessionAsync
 *   5. After BankID auth, Signicat redirects to gateway /kyc/callback
 *   6. Gateway issues the KYC SD-JWT VC and redirects to eduwalletmobile://kyc-complete?vc=...
 *   7. openAuthSessionAsync intercepts the redirect and returns it
 *   8. We parse the vc query param, store it, and navigate to the main app
 *
 * The screen also handles incoming deep links in case the app was backgrounded
 * instead of staying in the WebBrowser session (some Android devices).
 */
export default function KycScreen() {
  const { did, storeKycVc } = useWallet();
  const params = useLocalSearchParams<{ vc?: string; error?: string }>();

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Track whether we already processed an incoming VC to avoid double-runs
  const processed = useRef(false);

  // Handle the case where the app returns from background via a deep link
  // (Android can sometimes close the custom tab and relaunch via intent)
  useEffect(() => {
    if (processed.current) return;
    if (params.vc) {
      processed.current = true;
      handleVcReceived(params.vc);
    } else if (params.error) {
      setErrorMsg(decodeURIComponent(params.error));
      setStatus("error");
    }
  }, [params.vc, params.error]);

  const handleVcReceived = async (vc: string) => {
    try {
      setStatus("loading");
      await storeKycVc(decodeURIComponent(vc));
      setStatus("success");
    } catch (e: any) {
      setErrorMsg(e.message ?? "Failed to store credential");
      setStatus("error");
    }
  };

  const startKyc = async () => {
    if (!did) return;

    setStatus("loading");
    setErrorMsg(null);
    processed.current = false;

    try {
      const appRedirect = Linking.createURL("kyc");

      const resp = await fetch(
        `${API_BASE_URL}/kyc/authorize?` +
          new URLSearchParams({ did, app_redirect: appRedirect }).toString()
      );

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `Gateway error ${resp.status}`);
      }

      const { authorizationUrl } = await resp.json();

      // On Android, Chrome Custom Tabs sometimes don't intercept the final
      // deep-link redirect — instead Android fires it as a Linking event.
      // We race openAuthSessionAsync against a Linking listener so whichever
      // path resolves first wins, then clean up the other.
      let linkingSubscription: ReturnType<typeof Linking.addEventListener> | null = null;

      const linkingPromise = new Promise<string | null>((resolve) => {
        linkingSubscription = Linking.addEventListener("url", ({ url }) => {
          if (url.startsWith(appRedirect)) resolve(url);
        });
      });

      const browserPromise = WebBrowser.openAuthSessionAsync(
        authorizationUrl,
        appRedirect
      ).then((r) => (r.type === "success" ? r.url : null));

      const resultUrl = await Promise.race([browserPromise, linkingPromise]);

      linkingSubscription?.remove();
      // Close the browser if it's still open (Android deep-link path)
      WebBrowser.dismissBrowser();

      if (!resultUrl) {
        // User cancelled — browser closed without a redirect
        setStatus("idle");
        return;
      }

      if (processed.current) return;
      processed.current = true;

      const url = new URL(resultUrl);
      const vc = url.searchParams.get("vc");
      const err = url.searchParams.get("error");

      if (err) throw new Error(decodeURIComponent(err));
      if (!vc) throw new Error("No credential returned from gateway");

      await handleVcReceived(vc);
    } catch (e: any) {
      setErrorMsg(e.message ?? "BankID verification failed");
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.appName}>EduWallet</Text>
        <Text style={styles.tagline}>Identity verified</Text>

        <View style={styles.successCard}>
          <Text style={styles.successIcon}>Identity verified</Text>
          <Text style={styles.successBody}>
            Your KYC credential has been issued and stored on this device. It
            is bound to your DID and signed by the EduWallet gateway.
          </Text>
        </View>

        <Pressable style={styles.button} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.buttonText}>Continue to wallet</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.appName}>EduWallet</Text>
      <Text style={styles.tagline}>Verify your identity</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>BankID verification</Text>
        <Text style={styles.cardBody}>
          To use EduWallet you must verify your identity using Norwegian BankID.
          You will be redirected to Signicat's secure login page.
        </Text>
        <Text style={styles.cardBody}>
          After verification, a Verifiable Credential will be issued to your
          DID and stored on this device. No personal data leaves the device.
        </Text>
      </View>

      {errorMsg ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Verification failed</Text>
          <Text style={styles.errorBody}>{errorMsg}</Text>
        </View>
      ) : null}

      {status === "loading" ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#3b3ff0" />
          <Text style={styles.loadingText}>Opening BankID...</Text>
        </View>
      ) : (
        <>
          <Pressable style={styles.button} onPress={startKyc}>
            <Text style={styles.buttonText}>Verify with BankID</Text>
          </Pressable>

          <Pressable
            style={styles.skipButton}
            onPress={() => router.replace("/(tabs)")}
          >
            <Text style={styles.skipText}>Skip for now</Text>
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
    gap: 12,
  },
  successIcon: {
    fontSize: 18,
    fontWeight: "600",
    color: "#4ade80",
  },
  successBody: {
    fontSize: 14,
    color: "#cccccc",
    lineHeight: 22,
  },
  errorCard: {
    backgroundColor: "#2a1a1a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 6,
  },
  errorTitle: {
    color: "#ff6b6b",
    fontWeight: "600",
    fontSize: 14,
  },
  errorBody: {
    color: "#ffaaaa",
    fontSize: 13,
    lineHeight: 20,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  loadingText: {
    color: "#888888",
    fontSize: 14,
  },
  button: {
    backgroundColor: "#3b3ff0",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  skipButton: {
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  skipText: {
    color: "#666666",
    fontSize: 14,
  },
});
