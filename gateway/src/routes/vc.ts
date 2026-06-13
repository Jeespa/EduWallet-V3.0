/**
 * VC routes
 *
 * GET  /vc/status/:credentialId  — public revocation check
 * POST /vc/revoke                — issuer-authenticated revocation
 * POST /vc/verify                — generic SD-JWT verification
 */

import { Router } from "express";
import { checkRevocation, revokeCredential } from "../revocation/registry";
import { GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL } from "../config";
import { buildDidDocument } from "../did/didDocument";
import { verifySdJwt } from "../vc/verifier";

export const vcRouter = Router();

// ---------------------------------------------------------------------------
// GET /vc/status/:credentialId
// ---------------------------------------------------------------------------

/**
 * Returns the on-chain revocation status of a credential.
 *
 * Params:
 *   credentialId  keccak256(jti) in 0x-prefixed hex, as returned by the
 *                 gateway when the credential was issued
 *
 * Response:
 *   { revoked: boolean }
 */
vcRouter.get("/status/:credentialId", async (req, res) => {
  const { credentialId } = req.params;

  if (!credentialId || !credentialId.startsWith("0x")) {
    return res
      .status(400)
      .json({ error: "credentialId must be a 0x-prefixed hex string" });
  }

  try {
    const revoked = await checkRevocation(credentialId);
    res.json({ revoked });
  } catch (err: any) {
    console.error("Failed to check revocation status:", err);
    res.status(500).json({ error: "Failed to check revocation status" });
  }
});

// ---------------------------------------------------------------------------
// POST /vc/revoke
// ---------------------------------------------------------------------------

/**
 * Revokes a credential on-chain.
 *
 * Only the gateway issuer key may call this — the request must include a
 * simple bearer token equal to the issuer DID (sufficient for a prototype;
 * replace with a real auth scheme before production use).
 *
 * Request body:
 *   { "credentialId": "0x..." }
 *
 * Response on success:
 *   { "status": "ok" }
 */
vcRouter.post("/revoke", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const doc = buildDidDocument(GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL);
  const issuerDid = doc.id as string;

  if (authHeader !== `Bearer ${issuerDid}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { credentialId } = req.body as { credentialId?: string };
  if (!credentialId || !credentialId.startsWith("0x")) {
    return res
      .status(400)
      .json({ error: "credentialId must be a 0x-prefixed hex string" });
  }

  try {
    await revokeCredential(credentialId);
    res.json({ status: "ok" });
  } catch (err: any) {
    console.error("Failed to revoke credential:", err);
    res.status(500).json({ error: err.message ?? "Failed to revoke credential" });
  }
});

// ---------------------------------------------------------------------------
// POST /vc/verify
// ---------------------------------------------------------------------------

/**
 * Verifies any EduWallet SD-JWT Verifiable Credential.
 *
 * Checks signature, expiry, issuer DID resolution, and on-chain revocation.
 * Returns a result object — `valid: false` means the credential cannot be
 * trusted; `valid: true, revoked: true` means the credential was genuine
 * but has since been revoked.
 *
 * Request body:
 *   { "sdJwtPresentation": "<SD-JWT string>" }
 *
 * Response:
 *   {
 *     valid: boolean,
 *     issuer: string,
 *     subject: string,
 *     credentialType: string,
 *     claims: Record<string, string>,
 *     credentialId: string,
 *     revoked: boolean,
 *     error?: string       // present only when valid: false
 *   }
 */
vcRouter.post("/verify", async (req, res) => {
  const { sdJwtPresentation } = req.body as { sdJwtPresentation?: string };

  if (!sdJwtPresentation || typeof sdJwtPresentation !== "string") {
    return res.status(400).json({ error: "sdJwtPresentation is required" });
  }

  try {
    const result = await verifySdJwt(sdJwtPresentation);
    res.json(result);
  } catch (err: any) {
    console.error("Unexpected error during VC verification:", err);
    res.status(500).json({ error: err.message ?? "Failed to verify credential" });
  }
});
