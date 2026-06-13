/**
 * End-to-End Latency Benchmarks — EduWallet V3.0
 *
 * Measures wall-clock round-trip times for the three key user-facing flows
 * against a running gateway + Hardhat node. These numbers are the "user
 * experience" counterpart to the cryptographic microbenchmarks in bench-sdjwt.ts.
 *
 * Flows measured:
 *   1. Auth round-trip  —  GET /auth/challenge → sign → POST /auth/login
 *   2. Issue KYC VC     —  POST /kyc/callback mock path (via direct API call)
 *   3. Verify round-trip —  POST /vc/verify with a pre-issued SD-JWT
 *   4. Full flow        —  challenge → issue → verify (sequential)
 *
 * Run:
 *   npx ts-node scripts/bench-e2e.ts
 *
 * Prerequisites:
 *   - Gateway running:   npm run dev   (in gateway/)
 *   - GATEWAY_URL env or defaults to http://localhost:3000
 */

import "dotenv/config";
import { ethers } from "ethers";
import { GATEWAY_URL, GATEWAY_DID_PRIVATE_KEY } from "../src/config";
import { issueKycSdJwt } from "../src/vc/sdJwt";

const N_ITER = 50; // lower than crypto benchmarks — each involves HTTP RTT

// ── Test key (Hardhat account 1) ──────────────────────────────────────────────

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const testWallet = new ethers.Wallet(TEST_PRIVATE_KEY);

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

function deriveDidKey(compressedPubKeyHex: string): string {
  const hex = compressedPubKeyHex.startsWith("0x")
    ? compressedPubKeyHex.slice(2)
    : compressedPubKeyHex;
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

const TEST_DID = deriveDidKey(testWallet.signingKey.compressedPublicKey);
const TEST_SCA = testWallet.address;

// ── Statistics ────────────────────────────────────────────────────────────────

function statsMs(samples: number[]): {
  mean: string; median: string; min: string; max: string; p95: string;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean   = samples.reduce((s, v) => s + v, 0) / samples.length;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95    = sorted[Math.floor(sorted.length * 0.95)]!;
  return {
    mean:   mean.toFixed(1),
    median: median.toFixed(1),
    min:    sorted[0]!.toFixed(1),
    max:    sorted[sorted.length - 1]!.toFixed(1),
    p95:    p95.toFixed(1),
  };
}

async function bench(
  fn: () => Promise<void> | void,
  n = N_ITER,
): Promise<number[]> {
  // Warm-up
  for (let i = 0; i < 3; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return samples;
}

// ── Table ─────────────────────────────────────────────────────────────────────

const COL = { label: 46, val: 9 };
const LINE = "─".repeat(COL.label + COL.val * 5 + 6);

function printHeader() {
  console.log(`\n${LINE}`);
  console.log(
    `${"Flow".padEnd(COL.label)} ${"mean ms".padStart(COL.val)} ${"median".padStart(COL.val)} ${"min".padStart(COL.val)} ${"max".padStart(COL.val)} ${"p95".padStart(COL.val)}`
  );
  console.log(LINE);
}

function printRow(
  label: string,
  s: { mean: string; median: string; min: string; max: string; p95: string },
) {
  console.log(
    `${label.padEnd(COL.label)} ${s.mean.padStart(COL.val)} ${s.median.padStart(COL.val)} ${s.min.padStart(COL.val)} ${s.max.padStart(COL.val)} ${s.p95.padStart(COL.val)}`
  );
}

function printFooter() {
  console.log(LINE);
  console.log(`  ${N_ITER} iterations each — wall-clock milliseconds (includes network RTT)\n`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function getChallenge(): Promise<{ challenge: string }> {
  const r = await fetch(`${GATEWAY_URL}/auth/challenge`);
  if (!r.ok) throw new Error(`GET /auth/challenge → ${r.status}`);
  return r.json() as Promise<{ challenge: string }>;
}

async function postLogin(body: object): Promise<unknown> {
  const r = await fetch(`${GATEWAY_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`POST /auth/login → ${r.status}: ${t}`);
  }
  return r.json();
}

async function postVerify(sdJwt: string): Promise<unknown> {
  const r = await fetch(`${GATEWAY_URL}/vc/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdJwtPresentation: sdJwt }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`POST /vc/verify → ${r.status}: ${t}`);
  }
  return r.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Preflight: resolve issuer DID ─────────────────────────────────────────
  let issuerDid: string;
  try {
    const r = await fetch(`${GATEWAY_URL}/.well-known/did.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = await r.json() as { id: string };
    issuerDid = doc.id;
  } catch {
    const host = GATEWAY_URL.replace(/^https?:\/\//, "").replace(/:/g, "%3A");
    issuerDid = `did:web:${host}`;
  }

  // Pre-issue a VC for the verify benchmarks (not part of the timed flow)
  const { sdJwt: kycVc } = issueKycSdJwt(
    { sub: TEST_DID, name: "Test Student", birthdate: "1998-05-15", nationalId: "12345678901" },
    issuerDid,
    GATEWAY_DID_PRIVATE_KEY,
  );

  console.log("\nEduWallet V3.0 — End-to-End Latency Benchmarks");
  console.log(`Gateway: ${GATEWAY_URL}  (${N_ITER} iterations per flow)`);

  // ── Preflight connectivity check ──────────────────────────────────────────
  try {
    await getChallenge();
  } catch {
    console.error("\nERROR: Gateway not reachable. Start it with: npm run dev");
    process.exit(1);
  }

  printHeader();

  // ── Flow 1: Auth challenge round-trip (GET only) ──────────────────────────
  const s1 = await bench(async () => {
    await getChallenge();
  });
  printRow("Auth challenge  (GET /auth/challenge)", statsMs(s1));

  // ── Flow 2: Full challenge-response auth ──────────────────────────────────
  const s2 = await bench(async () => {
    const { challenge } = await getChallenge();
    const signature = await testWallet.signMessage(challenge);
    await postLogin({ did: TEST_DID, signature, challenge, scaAddress: TEST_SCA });
  });
  printRow("Auth round-trip  (challenge + sign + login)", statsMs(s2));

  // ── Flow 3: Verify pre-issued VC ─────────────────────────────────────────
  let verifyAvailable = true;
  try {
    await postVerify(kycVc);
  } catch (e: any) {
    if (String(e.message).includes("404") || String(e.message).includes("ECONNREFUSED")) {
      verifyAvailable = false;
    }
  }

  if (verifyAvailable) {
    const s3 = await bench(async () => {
      await postVerify(kycVc);
    });
    printRow("Verify KYC VC  (POST /vc/verify)", statsMs(s3));

    // ── Flow 4: Issue then verify (gateway-side issuance) ──────────────────
    // Issue via a minimal direct-call to the SDK (not a gateway route since
    // KYC issuance requires Signicat OIDC callback — so we time the SDK path)
    const s4 = await bench(async () => {
      const { sdJwt } = issueKycSdJwt(
        { sub: TEST_DID, name: "Test Student", birthdate: "1998-05-15", nationalId: "12345678901" },
        issuerDid,
        GATEWAY_DID_PRIVATE_KEY,
      );
      await postVerify(sdJwt);
    });
    printRow("Issue + verify KYC VC  (SDK issue + HTTP verify)", statsMs(s4));

    // ── Flow 5: Full auth + verify ─────────────────────────────────────────
    const s5 = await bench(async () => {
      const { challenge } = await getChallenge();
      const signature = await testWallet.signMessage(challenge);
      await postLogin({ did: TEST_DID, signature, challenge });
      await postVerify(kycVc);
    });
    printRow("Auth + verify  (full two-step flow)", statsMs(s5));
  } else {
    console.log("  [skip] Verify benchmarks require POST /vc/verify endpoint");
    console.log("         (endpoint may not be available in this gateway build)");
  }

  // ── Flow 6: Read-only permissions ────────────────────────────────────────
  const encoded = encodeURIComponent(TEST_SCA);
  const s6 = await bench(async () => {
    const r = await fetch(`${GATEWAY_URL}/students/${encoded}/permissions`);
    if (!r.ok) throw new Error(`GET /students/:sca/permissions → ${r.status}`);
    await r.json();
  });
  printRow("Read permissions  (GET /students/:sca/permissions)", statsMs(s6));

  printFooter();

  // ── Network decomposition note for thesis ────────────────────────────────
  console.log("Note: all measurements include loopback TCP overhead (~0.1-0.3 ms).");
  console.log("Cryptographic-only costs are in bench-sdjwt.ts.");
  console.log("Gas costs are in gas-report.txt (run: REPORT_GAS=true npx hardhat test test/gas-benchmarks.ts)\n");
}

main().catch((e) => {
  console.error("\nFatal:", e);
  process.exit(1);
});
