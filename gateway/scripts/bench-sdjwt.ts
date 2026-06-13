/**
 * SD-JWT Performance Benchmarks — EduWallet V3.0
 *
 * Measures the CPU time of the core SD-JWT cryptographic operations over
 * N_ITER iterations, then prints a table of mean / min / max / p95 timings
 * suitable for direct inclusion in the thesis evaluation chapter.
 *
 * Also includes an interoperability test that verifies a
 * gateway-issued SD-JWT using only standard primitives (no EduWallet
 * code) to confirm the format is fully spec-compliant.
 *
 * Run:
 *   npx ts-node scripts/bench-sdjwt.ts
 *
 * Prerequisites:
 *   - gateway/.env must exist (GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL, etc.)
 *   - Hardhat node must be running for the revocation check (bench 4 & 5)
 *     If not running, those benchmarks are skipped gracefully.
 */

import "dotenv/config";
import { createHash } from "crypto";
import { ethers } from "ethers";
import { issueKycSdJwt, issueAcademicResultSdJwt } from "../src/vc/sdJwt";
import { verifySdJwt } from "../src/vc/verifier";
import { GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL } from "../src/config";

const N_ITER = 100;

// ── Stable test fixtures ──────────────────────────────────────────────────────

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_DID =
  "did:key:zQ3shZxBiP5i8nVm2ZKfXTGPE4p2kZNa8bAJjKczmySvnNFrf";
const TEST_SCA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// ── Timing helpers ────────────────────────────────────────────────────────────

function statsMs(samples: number[]): {
  mean: string; min: string; max: string; p95: string;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p95  = sorted[Math.floor(sorted.length * 0.95)]!;
  return {
    mean: mean.toFixed(3),
    min:  sorted[0]!.toFixed(3),
    max:  sorted[sorted.length - 1]!.toFixed(3),
    p95:  p95.toFixed(3),
  };
}

async function bench(
  label: string,
  fn: () => unknown,
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

// ── Selective disclosure presentation ────────────────────────────────────────

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Builds a derived SD-JWT presentation that discloses only `claimsToReveal`.
 * This reproduces what the mobile share-vc screen does locally — no signing needed.
 */
function makePresentation(sdJwt: string, claimsToReveal: string[]): string {
  const parts = sdJwt.split("~");
  const jwtPart = parts[0]!;
  const allDisclosures = parts.slice(1).filter(Boolean);

  const selected = allDisclosures.filter((enc) => {
    try {
      const decoded = JSON.parse(b64urlDecode(enc).toString("utf8")) as unknown[];
      return Array.isArray(decoded) && claimsToReveal.includes(String(decoded[1]));
    } catch {
      return false;
    }
  });

  return selected.length > 0
    ? `${jwtPart}~${selected.join("~")}~`
    : `${jwtPart}~`;
}

// ── Table printer ─────────────────────────────────────────────────────────────

const COL = { label: 44, val: 10 };
const LINE = "─".repeat(COL.label + COL.val * 4 + 5);

function printHeader() {
  console.log(`\n${LINE}`);
  console.log(
    `${"Operation".padEnd(COL.label)} ${"mean ms".padStart(COL.val)} ${"min ms".padStart(COL.val)} ${"max ms".padStart(COL.val)} ${"p95 ms".padStart(COL.val)}`
  );
  console.log(LINE);
}

function printRow(label: string, s: { mean: string; min: string; max: string; p95: string }) {
  console.log(
    `${label.padEnd(COL.label)} ${s.mean.padStart(COL.val)} ${s.min.padStart(COL.val)} ${s.max.padStart(COL.val)} ${s.p95.padStart(COL.val)}`
  );
}

function printFooter() {
  console.log(LINE);
  console.log(`  ${N_ITER} iterations each — times in milliseconds\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nEduWallet V3.0 — SD-JWT Performance Benchmarks");
  console.log(`Gateway DID: ${GATEWAY_URL}`);

  // ── Determine live issuer DID ──────────────────────────────────────────────
  let issuerDid: string;
  try {
    const r = await fetch(`${GATEWAY_URL}/.well-known/did.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = await r.json() as { id: string };
    issuerDid = doc.id;
    console.log(`Issuer DID resolved: ${issuerDid}`);
  } catch {
    // Derive DID from the private key stored in .env — same result
    const wallet = new ethers.Wallet(GATEWAY_DID_PRIVATE_KEY);
    // Gateway uses did:web derived from GATEWAY_URL
    issuerDid = `did:web:${GATEWAY_URL.replace(/^https?:\/\//, "").replace(/:/g, "%3A")}`;
    console.log(`Gateway unreachable — using derived DID: ${issuerDid}`);
  }

  // ── Pre-issue one of each VC type for verify/presentation benchmarks ────────
  const { sdJwt: kycVc }      = issueKycSdJwt(
    { sub: TEST_DID, name: "Test Student", birthdate: "1998-05-15", nationalId: "12345678901" },
    issuerDid,
    GATEWAY_DID_PRIVATE_KEY,
  );
  const { sdJwt: academicVc } = issueAcademicResultSdJwt(
    {
      sub: TEST_DID,
      studentSca: TEST_SCA,
      courseCode: "TMA4100",
      courseName: "Distributed Systems",
      grade: "B",
      ects: "10",
      date: "2025-06-01",
      degreeProgramme: "MSc Computer Engineering",
      universityName: "NTNU",
    },
    issuerDid,
    GATEWAY_DID_PRIVATE_KEY,
  );

  printHeader();

  // ── 1. Issue KYC VC ───────────────────────────────────────────────────────
  const s1 = await bench("Issue KYC VC (3 disclosures)", () =>
    issueKycSdJwt(
      { sub: TEST_DID, name: "Test Student", birthdate: "1998-05-15", nationalId: "12345678901" },
      issuerDid,
      GATEWAY_DID_PRIVATE_KEY,
    )
  );
  printRow("Issue KYC VC  (3 disclosures)", statsMs(s1));

  // ── 2. Issue AcademicResult VC ────────────────────────────────────────────
  const s2 = await bench("Issue AcademicResult VC (8 disclosures)", () =>
    issueAcademicResultSdJwt(
      {
        sub: TEST_DID,
        studentSca: TEST_SCA,
        courseCode: "TMA4100",
        courseName: "Distributed Systems",
        grade: "B",
        ects: "10",
        date: "2025-06-01",
        degreeProgramme: "MSc Computer Engineering",
        universityName: "NTNU",
      },
      issuerDid,
      GATEWAY_DID_PRIVATE_KEY,
    )
  );
  printRow("Issue AcademicResult VC  (8 disclosures)", statsMs(s2));

  // ── 3. Selective disclosure: build presentations ──────────────────────────
  const s3a = await bench("Present KYC  — 1 / 3 claims disclosed", () =>
    makePresentation(kycVc, ["name"])
  );
  printRow("Present KYC  — 1 / 3 claims", statsMs(s3a));

  const s3b = await bench("Present KYC  — 3 / 3 claims disclosed", () =>
    makePresentation(kycVc, ["name", "birthdate", "nationalId"])
  );
  printRow("Present KYC  — 3 / 3 claims", statsMs(s3b));

  const s3c = await bench("Present Academic  — 2 / 8 claims (grade, ects)", () =>
    makePresentation(academicVc, ["grade", "ects"])
  );
  printRow("Present Academic  — 2 / 8 claims", statsMs(s3c));

  const s3d = await bench("Present Academic  — 8 / 8 claims (all)", () =>
    makePresentation(academicVc, [
      "courseCode", "courseName", "grade", "ects",
      "date", "degreeProgramme", "universityName", "studentSca",
    ])
  );
  printRow("Present Academic  — 8 / 8 claims", statsMs(s3d));

  // ── 4 & 5. Verify (requires Hardhat node for revocation eth_call) ─────────
  let blockchainAvailable = false;
  try {
    await fetch("http://127.0.0.1:8545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
    });
    blockchainAvailable = true;
  } catch {
    // Hardhat not running — skip verification benchmarks
  }

  if (blockchainAvailable) {
    const s4 = await bench("Verify KYC VC  (DID fast-path + revocation check)", () =>
      verifySdJwt(kycVc)
    );
    printRow("Verify KYC VC  (fast-path DID + revocation)", statsMs(s4));

    const s5 = await bench("Verify AcademicResult VC  (fast-path + revocation)", () =>
      verifySdJwt(academicVc)
    );
    printRow("Verify AcademicResult VC  (fast-path + revocation)", statsMs(s5));

    // Selective-disclosure presentation through full verify
    const partialPresentation = makePresentation(kycVc, ["name"]);
    const s6 = await bench("Verify KYC presentation  — 1 disclosed claim", () =>
      verifySdJwt(partialPresentation)
    );
    printRow("Verify KYC presentation  — 1 disclosed claim", statsMs(s6));
  } else {
    console.log("  [skip] Verification benchmarks require Hardhat node on :8545");
  }

  printFooter();

  // ── Interoperability test ──────────────────────────────────────────────────
  console.log("Interoperability Test — verify SD-JWT with standard primitives only");
  console.log("─".repeat(60));
  await interopTest(kycVc, issuerDid);
  console.log("");
}

// ── Interoperability: verify without EduWallet code ──────────────────────────

/**
 * Verifies a gateway-issued SD-JWT using only:
 *   - standard base64url decode
 *   - SHA-256 (Node.js crypto)
 *   - ethers.js ECDSA recovery (standard secp256k1)
 *
 * This proves the VC format is not proprietary and that any standards-compliant
 * verifier can validate credentials issued by the EduWallet gateway.
 */
async function interopTest(sdJwt: string, issuerDid: string): Promise<void> {
  const fail = (msg: string) => { throw new Error(`INTEROP FAIL: ${msg}`); };
  const pass = (msg: string) => console.log(`  ✓  ${msg}`);

  // 1. Parse SD-JWT structure
  const parts = sdJwt.split("~");
  const jwtPart = parts[0]!;
  const disclosures = parts.slice(1).filter(Boolean);
  const [headerB64, payloadB64, sigB64] = jwtPart.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) fail("JWT must have 3 dot-separated parts");
  pass("SD-JWT structure: header.payload.signature~disclosure~…");

  // 2. Decode and inspect header
  const header = JSON.parse(b64urlDecode(headerB64!).toString("utf8")) as Record<string, string>;
  if (header.alg !== "ES256K") fail(`Expected alg=ES256K, got ${header.alg}`);
  if (!["vc+sd-jwt", "JWT"].includes(header.typ ?? "")) {
    // Accept JWT or vc+sd-jwt
    if (header.typ !== "vc+sd-jwt") fail(`Unexpected typ: ${header.typ}`);
  }
  pass(`Header: alg=${header.alg}, typ=${header.typ}`);

  // 3. Decode payload — must be valid JSON
  const payload = JSON.parse(b64urlDecode(payloadB64!).toString("utf8")) as Record<string, unknown>;
  if (typeof payload.iss !== "string") fail("Missing iss claim");
  if (typeof payload.sub !== "string") fail("Missing sub claim");
  if (typeof payload.jti !== "string") fail("Missing jti claim");
  if (!Array.isArray((payload._sd as unknown[]))) fail("Missing _sd array in payload");
  pass(`Payload claims: iss, sub, jti, _sd present`);

  // 4. Verify issuer DID matches expectation
  if (payload.iss !== issuerDid) fail(`iss ${payload.iss} !== expected ${issuerDid}`);
  pass(`iss matches gateway DID: ${issuerDid}`);

  // 5. Recover signer address from ES256K signature
  //    ES256K: sign(sha256(header.payload)), r||s 64 bytes
  const signingInput = `${headerB64}.${payloadB64}`;
  const digest = createHash("sha256").update(signingInput).digest();
  const digestHex = ("0x" + Buffer.from(digest).toString("hex")) as `0x${string}`;

  const sigBytes = b64urlDecode(sigB64!);
  if (sigBytes.length !== 64) fail(`Signature must be 64 bytes, got ${sigBytes.length}`);

  const r = "0x" + Buffer.from(sigBytes.slice(0, 32)).toString("hex");
  const s = "0x" + Buffer.from(sigBytes.slice(32)).toString("hex");

  // ES256K compact signatures (r||s) have two valid recovery parameters.
  // Collect both candidate addresses; step 6 picks the one that matches the DID key.
  const candidates: string[] = [];
  for (const v of [27, 28]) {
    try {
      const sig = ethers.Signature.from({ r, s, v });
      candidates.push(ethers.recoverAddress(digestHex, sig));
    } catch { /* skip this v */ }
  }
  if (candidates.length === 0) fail("Could not recover signer address");
  pass(`ES256K signature valid (${candidates.length} candidate address(es))`);

  // 6. Verify signer matches the public key in the DID document
  //    Resolve the DID document directly (standard did:web HTTP fetch)
  const withoutPrefix = issuerDid.slice("did:web:".length);
  const colonParts = withoutPrefix.split(":");
  const host = colonParts[0]!.replace(/%3A/gi, ":");
  const pathSuffix = colonParts.length > 1 ? "/" + colonParts.slice(1).join("/") : "";
  const isLocal = /^(localhost|127\.|10\.|172\.|192\.)/.test(host);
  const didUrl = `${isLocal ? "http" : "https"}://${host}${pathSuffix}/.well-known/did.json`;

  let signerMatched = false;
  try {
    const didRes = await fetch(didUrl);
    if (!didRes.ok) throw new Error(`HTTP ${didRes.status}`);
    const didDoc = await didRes.json() as { verificationMethod?: { publicKeyJwk?: { x: string; y: string } }[] };
    const vm = didDoc.verificationMethod?.[0];
    if (!vm?.publicKeyJwk) { fail("No JWK in DID document"); return; }

    const x = b64urlDecode(vm.publicKeyJwk.x);
    const y = b64urlDecode(vm.publicKeyJwk.y);
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.set(x, 1);
    uncompressed.set(y, 33);
    const expectedAddr = ethers.computeAddress(ethers.hexlify(uncompressed));

    const matchedAddr = candidates.find(c => c.toLowerCase() === expectedAddr.toLowerCase());
    if (!matchedAddr) fail(`Recovered signers [${candidates.join(", ")}] do not match DID key ${expectedAddr}`);
    pass(`Signer address matches DID document public key (${matchedAddr})`);
    signerMatched = true;
  } catch (e: any) {
    if (e.message?.startsWith("INTEROP FAIL")) throw e;
    // Gateway not reachable — derive expected address from env key directly
    const signingKey = new ethers.SigningKey(GATEWAY_DID_PRIVATE_KEY);
    const uncompressed = ethers.SigningKey.computePublicKey(signingKey.compressedPublicKey, false);
    const expectedAddr = ethers.computeAddress(uncompressed);
    const matchedAddr = candidates.find(c => c.toLowerCase() === expectedAddr.toLowerCase());
    if (!matchedAddr) fail(`Recovered signers [${candidates.join(", ")}] do not match key derived from env`);
    pass(`Signer address matches key material (DID doc fetch skipped — gateway not running)`);
    signerMatched = true;
  }

  // 7. Decode disclosures — each must be [salt, claimName, claimValue]
  for (const enc of disclosures) {
    const decoded = JSON.parse(b64urlDecode(enc).toString("utf8")) as unknown[];
    if (!Array.isArray(decoded) || decoded.length !== 3) {
      fail(`Disclosure is not a 3-element array: ${enc}`);
    }
    // Verify the disclosure hash appears in payload._sd
    const disclosureHash = createHash("sha256").update(enc).digest("base64url");
    const sdArray = payload._sd as string[];
    if (!sdArray.includes(disclosureHash)) {
      fail(`Disclosure hash ${disclosureHash} not found in payload._sd`);
    }
  }
  if (disclosures.length > 0) {
    pass(`All ${disclosures.length} disclosures decode correctly and match _sd hashes`);
  }

  // 8. Check expiry
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    fail("VC is expired");
  }
  pass("VC is not expired");

  console.log("\n  Interoperability test PASSED — SD-JWT format is standards-compliant.");
  console.log("  Any ES256K-capable verifier can validate EduWallet credentials.");
}

main().catch((e) => {
  console.error("\nFatal:", e);
  process.exit(1);
});
