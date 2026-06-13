import { Router } from "express";
import { ethers } from "ethers";
import { randomUUID } from "node:crypto";
import { didKeyToAddress } from "../vc/verifier";

export const authRouter = Router();

// In-memory challenge store: challenge string → expiry timestamp (ms)
const challenges = new Map<string, number>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Verifies a challenge-response and consumes the challenge (single-use).
 *
 * Returns true if the challenge is valid, unexpired, and the signature was
 * produced by the private key corresponding to `did`. The challenge is
 * deleted on success so it cannot be replayed.
 */
export function verifyAndConsumeChallenge(
  challenge: string,
  did: string,
  signature: string
): boolean {
  const expiresAt = challenges.get(challenge);
  if (!expiresAt || Date.now() > expiresAt) return false;
  challenges.delete(challenge);

  let expectedAddress: string;
  try {
    expectedAddress = didKeyToAddress(did);
  } catch {
    return false;
  }

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(challenge, signature);
  } catch {
    return false;
  }

  return recovered.toLowerCase() === expectedAddress.toLowerCase();
}

/**
 * GET /auth/challenge
 *
 * Issues a one-time challenge nonce for keypair-based login.
 * The client signs this with their wallet private key and sends it back
 * via POST /auth/login together with their did:key and optional SCA address.
 *
 * Response: { challenge: string, expiresAt: number }
 */
authRouter.get("/challenge", (_req, res) => {
  const now = Date.now();
  for (const [k, exp] of challenges) {
    if (exp < now) challenges.delete(k);
  }
  const challenge = randomUUID();
  const expiresAt = now + CHALLENGE_TTL_MS;
  challenges.set(challenge, expiresAt);
  res.json({ challenge, expiresAt });
});

/**
 * POST /auth/login
 *
 * Keypair-based challenge-response authentication.
 * Replaces the legacy PBKDF2 id+password flow.
 *
 * Request body:
 *   { did: string, signature: string, challenge: string, scaAddress?: string }
 *
 * The gateway verifies that `signature` was produced by the private key
 * corresponding to `did` (a did:key secp256k1 identifier) over `challenge`.
 * Challenges are single-use and expire after 5 minutes.
 *
 * Response: { studentSca: string | null }
 */
authRouter.post("/login", async (req, res) => {
  const { did, signature, challenge, scaAddress } = req.body as {
    did?: string;
    signature?: string;
    challenge?: string;
    scaAddress?: string;
  };

  if (!did || !signature || !challenge) {
    return res
      .status(400)
      .json({ error: "did, signature, and challenge are required" });
  }

  const expiresAt = challenges.get(challenge);
  if (!expiresAt || Date.now() > expiresAt) {
    return res.status(401).json({ error: "Invalid or expired challenge" });
  }
  challenges.delete(challenge);

  let expectedAddress: string;
  try {
    expectedAddress = didKeyToAddress(did);
  } catch {
    return res.status(400).json({ error: "Invalid DID format" });
  }

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(challenge, signature);
  } catch {
    return res.status(401).json({ error: "Malformed signature" });
  }

  if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
    return res.status(401).json({ error: "Signature does not match DID" });
  }

  res.json({ studentSca: scaAddress ?? null });
});
