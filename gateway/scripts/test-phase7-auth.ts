/**
 * Integration tests — keypair challenge-response authentication.
 *
 * Uses a deterministic secp256k1 test key (NOT the gateway DID key) so the
 * tests are self-contained and reproducible. Runs against a live gateway.
 *
 * Run with:
 *   npx ts-node scripts/test-phase7-auth.ts
 *
 * Prerequisites:
 *   - Gateway running (npm run dev in gateway/)
 *   - GATEWAY_URL env var or defaults to http://localhost:3000
 */

import { ethers } from "ethers";

const GATEWAY_BASE = process.env.GATEWAY_URL ?? "http://localhost:3000";

// ── did:key derivation (mirrors eduwallet-mobile/lib/did.ts) ──────────────────

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let leading = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leading++;
  }
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return (
    "1".repeat(leading) +
    digits
      .reverse()
      .map((d) => BASE58_ALPHABET[d]!)
      .join("")
  );
}

function deriveDidKey(compressedPublicKeyHex: string): string {
  const hex = compressedPublicKeyHex.startsWith("0x")
    ? compressedPublicKeyHex.slice(2)
    : compressedPublicKeyHex;
  const pubBytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < pubBytes.length; i++) {
    pubBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const prefix = new Uint8Array([0xe7, 0x01]);
  const prefixed = new Uint8Array(prefix.length + pubBytes.length);
  prefixed.set(prefix, 0);
  prefixed.set(pubBytes, prefix.length);
  return "did:key:z" + base58Encode(prefixed);
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getChallenge(): Promise<{ challenge: string; expiresAt: number }> {
  const r = await fetch(`${GATEWAY_BASE}/auth/challenge`);
  if (!r.ok) throw new Error(`GET /auth/challenge failed: ${r.status}`);
  return r.json() as Promise<{ challenge: string; expiresAt: number }>;
}

async function postLogin(body: object): Promise<{ status: number; json: unknown }> {
  const r = await fetch(`${GATEWAY_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return { status: r.status, json };
}

// ── test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label: string, detail?: unknown) {
  console.error(`  ✗  ${label}`);
  if (detail !== undefined) console.error("     →", detail);
  failed++;
}

function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) ok(label);
  else fail(label, detail);
}

// ── tests ─────────────────────────────────────────────────────────────────────

async function main() {
  // Deterministic test wallet — NOT a real user key, safe for tests only
  const TEST_PRIVATE_KEY =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Hardhat account 1
  const testWallet = new ethers.Wallet(TEST_PRIVATE_KEY);
  const testDid = deriveDidKey(testWallet.signingKey.compressedPublicKey);
  const testSca = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Hardhat account 1 address

  console.log(`\nGateway: ${GATEWAY_BASE}`);
  console.log(`Test DID: ${testDid}`);
  console.log(`Test SCA: ${testSca}\n`);

  // ── Test 1: GET /auth/challenge smoke ──────────────────────────────────────
  console.log("Test 1 — GET /auth/challenge");
  try {
    const { challenge, expiresAt } = await getChallenge();
    assert(typeof challenge === "string" && challenge.length > 0, "challenge is a non-empty string");
    assert(typeof expiresAt === "number" && expiresAt > Date.now(), "expiresAt is a future timestamp");
    assert(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(challenge),
      "challenge has UUID format"
    );
  } catch (e) {
    fail("GET /auth/challenge threw", e);
  }

  // ── Test 2: Valid challenge-response login (no SCA) ────────────────────────
  console.log("\nTest 2 — Valid login, no SCA provided");
  try {
    const { challenge } = await getChallenge();
    const signature = await testWallet.signMessage(challenge);
    const { status, json } = await postLogin({ did: testDid, signature, challenge });
    assert(status === 200, `status 200 (got ${status})`, json);
    assert((json as any).studentSca === null, "studentSca is null when not provided", json);
  } catch (e) {
    fail("threw unexpectedly", e);
  }

  // ── Test 3: Valid login with SCA → echoed back ─────────────────────────────
  console.log("\nTest 3 — Valid login with scaAddress");
  try {
    const { challenge } = await getChallenge();
    const signature = await testWallet.signMessage(challenge);
    const { status, json } = await postLogin({
      did: testDid,
      signature,
      challenge,
      scaAddress: testSca,
    });
    assert(status === 200, `status 200 (got ${status})`, json);
    assert(
      (json as any).studentSca?.toLowerCase() === testSca.toLowerCase(),
      `studentSca echoed back as ${testSca}`,
      json
    );
  } catch (e) {
    fail("threw unexpectedly", e);
  }

  // ── Test 4: Replay attack — same challenge used twice ──────────────────────
  console.log("\nTest 4 — Replay: same challenge used twice");
  try {
    const { challenge } = await getChallenge();
    const signature = await testWallet.signMessage(challenge);

    const first = await postLogin({ did: testDid, signature, challenge });
    assert(first.status === 200, `first use succeeds (got ${first.status})`, first.json);

    const second = await postLogin({ did: testDid, signature, challenge });
    assert(second.status === 401, `second use rejected with 401 (got ${second.status})`, second.json);
    assert(
      String((second.json as any).error).includes("expired") ||
        String((second.json as any).error).includes("Invalid"),
      "error message mentions invalid/expired challenge",
      (second.json as any).error
    );
  } catch (e) {
    fail("threw unexpectedly", e);
  }

  // ── Test 5: Wrong signature (signed with a different key) ──────────────────
  console.log("\nTest 5 — Wrong signature for the DID");
  try {
    const attackerWallet = new ethers.Wallet(
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" // Hardhat account 2
    );
    const { challenge } = await getChallenge();
    // Sign with attacker's key but claim to be the test DID
    const wrongSignature = await attackerWallet.signMessage(challenge);
    const { status, json } = await postLogin({ did: testDid, signature: wrongSignature, challenge });
    assert(status === 401, `status 401 (got ${status})`, json);
    assert(
      String((json as any).error).toLowerCase().includes("signature"),
      "error message mentions signature",
      (json as any).error
    );
  } catch (e) {
    fail("threw unexpectedly", e);
  }

  // ── Test 6: Missing required fields ───────────────────────────────────────
  console.log("\nTest 6 — Missing required fields");
  try {
    const { challenge } = await getChallenge();
    const signature = await testWallet.signMessage(challenge);

    const noDid = await postLogin({ signature, challenge });
    assert(noDid.status === 400, `missing did → 400 (got ${noDid.status})`, noDid.json);

    const noSig = await postLogin({ did: testDid, challenge });
    assert(noSig.status === 400, `missing signature → 400 (got ${noSig.status})`, noSig.json);

    const noChallenge = await postLogin({ did: testDid, signature });
    assert(noChallenge.status === 400, `missing challenge → 400 (got ${noChallenge.status})`, noChallenge.json);
  } catch (e) {
    fail("threw unexpectedly", e);
  }

  // ── Test 7: Read-only permissions endpoint ─────────────────────────────────
  console.log("\nTest 7 — GET /students/:sca/permissions (read-only)");
  try {
    const encoded = encodeURIComponent(testSca);
    const r = await fetch(`${GATEWAY_BASE}/students/${encoded}/permissions`);
    const json = await r.json();
    assert(r.status === 200, `status 200 (got ${r.status})`, json);
    assert(
      typeof (json as any).studentSca === "string",
      "response has studentSca field",
      json
    );
    assert(
      Array.isArray((json as any).permissions),
      "response has permissions array",
      json
    );
  } catch (e) {
    fail("threw unexpectedly", e);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
