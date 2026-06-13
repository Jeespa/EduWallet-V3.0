/**
 * KYC routes
 *
 * GET /kyc/authorize   Mobile calls this to get the Signicat authorization URL.
 * GET /kyc/callback    Signicat redirects here after BankID authentication.
 *                      The gateway issues the KYC SD-JWT VC and redirects
 *                      back to the mobile app via the deep-link URI.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { buildAuthorizationUrl, exchangeCodeForClaims } from "../oidc/signicat";
import { issueKycSdJwt } from "../vc/sdJwt";
import { buildDidDocument } from "../did/didDocument";
import { GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL } from "../config";
import { registerCredential } from "../revocation/registry";

export const kycRouter = Router();

// ---------------------------------------------------------------------------
// In-memory state store
// Keyed by the `state` CSRF nonce sent to Signicat.
// Entries expire after 10 minutes to limit memory growth.
// ---------------------------------------------------------------------------

interface PendingKyc {
  did: string;
  appRedirectUri: string;
  createdAt: number;
}

const pendingStore = new Map<string, PendingKyc>();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingStore) {
    if (v.createdAt < cutoff) pendingStore.delete(k);
  }
}, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// GET /kyc/authorize?did=<studentDid>&app_redirect=<deepLinkUrl>
// ---------------------------------------------------------------------------

/**
 * Returns the Signicat authorization URL for the mobile app to open in a
 * browser. Also stores the student DID and the app's deep-link redirect URI
 * so the callback knows where to send the issued VC.
 *
 * Query parameters:
 *   did           Student's did:key identifier
 *   app_redirect  Deep-link URL the mobile app listens on, e.g.
 *                 "eduwalletmobile://kyc-complete"
 */
kycRouter.get("/authorize", (req, res) => {
  const { did, app_redirect } = req.query as {
    did?: string;
    app_redirect?: string;
  };

  if (!did || !did.startsWith("did:")) {
    return res.status(400).json({ error: "Missing or invalid did parameter" });
  }
  if (!app_redirect) {
    return res.status(400).json({ error: "Missing app_redirect parameter" });
  }

  const state = randomUUID();
  pendingStore.set(state, {
    did,
    appRedirectUri: app_redirect,
    createdAt: Date.now(),
  });

  const authorizationUrl = buildAuthorizationUrl(state);
  res.json({ authorizationUrl });
});

// ---------------------------------------------------------------------------
// GET /kyc/callback?code=<code>&state=<state>
// ---------------------------------------------------------------------------

/**
 * OIDC callback called by Signicat after BankID authentication.
 *
 * 1. Looks up the pending KYC entry by `state`.
 * 2. Exchanges the authorization code for BankID identity claims.
 * 3. Issues a KYC SD-JWT VC with the student's DID as the subject.
 * 4. Redirects to the mobile app's deep link with the VC as a query param.
 */
kycRouter.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<
    string,
    string | undefined
  >;

  // Handle OIDC errors returned by Signicat
  if (error) {
    const msg = error_description ?? error ?? "KYC failed";
    console.error("OIDC error from Signicat:", msg);
    return res.redirect(
      `eduwalletmobile://kyc-error?error=${encodeURIComponent(msg)}`
    );
  }

  if (!state || !code) {
    return res.status(400).send("Missing code or state");
  }

  const pending = pendingStore.get(state);
  if (!pending) {
    return res
      .status(400)
      .send("Unknown or expired state — please restart the KYC flow");
  }
  pendingStore.delete(state);

  try {
    // Exchange code for BankID claims
    const bankIdClaims = await exchangeCodeForClaims(code);

    // Resolve full name: prefer the `name` claim, fall back to given + family
    const fullName =
      bankIdClaims.name ||
      [bankIdClaims.given_name, bankIdClaims.family_name]
        .filter(Boolean)
        .join(" ") ||
      "Unknown";

    const birthdate = bankIdClaims.birthdate ?? "";

    // Derive the issuer DID from the gateway's signing key
    const doc = buildDidDocument(GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL);
    const issuerDid = doc.id as string;

    const kycClaims = {
      sub: pending.did,
      name: fullName,
      birthdate,
      ...(bankIdClaims.nin !== undefined && { nationalId: bankIdClaims.nin }),
    };

    const { sdJwt: vc, credentialId } = issueKycSdJwt(
      kycClaims,
      issuerDid,
      GATEWAY_DID_PRIVATE_KEY
    );

    // Register on-chain so the credential can later be revoked.
    // Fire-and-forget: a registry failure must not block issuance.
    registerCredential(credentialId).catch((err) =>
      console.error("Failed to register credential on-chain:", err)
    );

    // Redirect back to the mobile app carrying the VC
    const deepLink = `${pending.appRedirectUri}?vc=${encodeURIComponent(vc)}`;
    res.redirect(deepLink);
  } catch (err: any) {
    console.error("KYC callback processing failed:", err);
    const msg = encodeURIComponent("Credential issuance failed. Please try again.");
    res.redirect(`${pending.appRedirectUri}?error=${msg}`);
  }
});
