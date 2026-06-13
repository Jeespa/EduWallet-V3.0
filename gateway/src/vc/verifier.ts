import { createHash } from "crypto";
import { ethers } from "ethers";
import { checkRevocation } from "../revocation/registry";
import { buildDidDocument } from "../did/didDocument";
import { GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL } from "../config";

// ── base58btc helpers ─────────────────────────────────────────────────────────

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
  let value = BigInt(0);
  for (const c of str) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base58 character: ${c}`);
    value = value * BigInt(58) + BigInt(idx);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;

  let leadingZeros = 0;
  for (const c of str) {
    if (c !== "1") break;
    leadingZeros++;
  }

  const body = Buffer.from(hex, "hex");
  const bytes = new Uint8Array(leadingZeros + body.length);
  bytes.set(body, leadingZeros);
  return bytes;
}

/**
 * Decodes a did:key (secp256k1) to the corresponding Ethereum EOA address.
 *
 * Format: `did:key:z<base58btc( 0xe7 0x01 || 33-byte compressed pubkey )>`
 */
function didKeyToAddress(did: string): string {
  if (!did.startsWith("did:key:z")) throw new Error("Not a did:key identifier");
  const multibaseKey = did.slice("did:key:z".length);
  const bytes = base58Decode(multibaseKey);
  // first 2 bytes are the multicodec prefix (0xe7 0x01)
  const compressedPub = ethers.hexlify(bytes.slice(2));
  return ethers.computeAddress(compressedPub);
}

// ── base64url helpers ─────────────────────────────────────────────────────────

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// ── DID document resolution ───────────────────────────────────────────────────

async function resolveDidDocument(
  issuerDid: string
): Promise<Record<string, unknown>> {
  // Fast path: skip the network round-trip for our own DID
  const ownDoc = buildDidDocument(GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL);
  if ((ownDoc.id as string) === issuerDid) return ownDoc;

  if (!issuerDid.startsWith("did:web:")) {
    throw new Error(`Unsupported DID method: ${issuerDid}`);
  }

  // did:web spec: unencoded `:` are path separators; `%3A` is the host:port separator.
  const withoutPrefix = issuerDid.slice("did:web:".length);
  const colonParts = withoutPrefix.split(":");
  const host = colonParts[0]!.replace(/%3A/gi, ":");
  const pathSuffix = colonParts.length > 1 ? "/" + colonParts.slice(1).join("/") : "";
  const hostAndPath = host + pathSuffix;

  const isLocal = /^(localhost|127\.|10\.|172\.|192\.)/.test(hostAndPath);
  const protocol = isLocal ? "http" : "https";
  const url = `${protocol}://${hostAndPath}/.well-known/did.json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to resolve DID document at ${url}: ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

/**
 * Extracts the Ethereum address from the first secp256k1 key in a DID document
 * (JsonWebKey2020, crv: secp256k1).
 */
function issuerAddressFromDoc(doc: Record<string, unknown>): string {
  const vms = doc.verificationMethod as Record<string, unknown>[] | undefined;
  const vm = vms?.[0];
  if (!vm?.publicKeyJwk) throw new Error("No JWK in DID document");

  const jwk = vm.publicKeyJwk as { x: string; y: string };
  const x = b64urlDecode(jwk.x);
  const y = b64urlDecode(jwk.y);

  // Build uncompressed secp256k1 public key: 0x04 || x(32) || y(32)
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(x, 1);
  uncompressed.set(y, 33);

  return ethers.computeAddress(ethers.hexlify(uncompressed));
}

// ── signature verification ────────────────────────────────────────────────────

/**
 * Verifies an ES256K compact signature (r || s, 64 bytes) against the
 * sha256 digest of `signingInput`. Tries both recovery IDs (v=27 and v=28).
 */
function verifyEs256kSignature(
  signingInput: string,
  signatureB64u: string,
  expectedAddress: string
): boolean {
  const digest = createHash("sha256").update(signingInput).digest();
  const digestHex = ("0x" + Buffer.from(digest).toString("hex")) as `0x${string}`;

  const sigBytes = b64urlDecode(signatureB64u);
  if (sigBytes.length !== 64) throw new Error("Invalid ES256K signature length");

  const r = "0x" + Buffer.from(sigBytes.slice(0, 32)).toString("hex");
  const s = "0x" + Buffer.from(sigBytes.slice(32, 64)).toString("hex");

  for (const v of [27, 28]) {
    try {
      const sig = ethers.Signature.from({ r, s, v });
      const recovered = ethers.recoverAddress(digestHex, sig);
      if (recovered.toLowerCase() === expectedAddress.toLowerCase()) return true;
    } catch {
      // recovery failed for this v — try the other
    }
  }
  return false;
}

// ── disclosure reconstruction ─────────────────────────────────────────────────

/** Decodes SD-JWT disclosures and returns a flat map of claim name → value. */
function reconstructClaims(disclosures: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const encoded of disclosures) {
    if (!encoded) continue;
    try {
      const decoded = JSON.parse(b64urlDecode(encoded).toString("utf8")) as unknown[];
      if (Array.isArray(decoded) && decoded.length === 3) {
        result[decoded[1] as string] = decoded[2] as string;
      }
    } catch {
      // skip malformed disclosures
    }
  }
  return result;
}

// ── public API ────────────────────────────────────────────────────────────────

export interface VerifiedKycVc {
  sub: string;
  iss: string;
  jti: string;
  /** keccak256(jti) — matches VCStatusRegistry credentialId. */
  credentialId: string;
  claims: Record<string, string>;
}

/**
 * Verifies a KYC SD-JWT issued by the EduWallet gateway.
 *
 * Checks in order:
 *  1. JWT structure and expiry
 *  2. ES256K signature against the issuer's did:web document
 *  3. On-chain revocation via VCStatusRegistry
 *
 * @throws {Error} with a descriptive message on any check failure
 */
export async function verifyKycSdJwt(sdJwt: string): Promise<VerifiedKycVc> {
  const parts = sdJwt.split("~");
  const jwtPart = parts[0] ?? "";
  const disclosureParts = parts.slice(1).filter(Boolean);

  const segments = jwtPart.split(".");
  if (segments.length !== 3) throw new Error("Invalid JWT structure");

  const headerB64 = segments[0]!;
  const payloadB64 = segments[1]!;
  const sigB64 = segments[2]!;
  const payload = JSON.parse(
    b64urlDecode(payloadB64).toString("utf8")
  ) as Record<string, unknown>;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && (payload.exp as number) < now) {
    throw new Error("KYC VC has expired");
  }

  const iss = payload.iss as string;
  if (!iss) throw new Error("Missing iss claim");

  const doc = await resolveDidDocument(iss);
  const issuerAddress = issuerAddressFromDoc(doc);

  const signingInput = `${headerB64}.${payloadB64}`;
  if (!verifyEs256kSignature(signingInput, sigB64, issuerAddress)) {
    throw new Error("Invalid KYC VC signature");
  }

  const jti = payload.jti as string;
  if (!jti) throw new Error("Missing jti claim");

  const credentialId = ethers.keccak256(ethers.toUtf8Bytes(jti));
  if (await checkRevocation(credentialId)) {
    throw new Error("KYC VC has been revoked");
  }

  const sub = payload.sub as string;
  if (!sub) throw new Error("Missing sub claim");

  return { sub, iss, jti, credentialId, claims: reconstructClaims(disclosureParts) };
}

export { didKeyToAddress };

// ── Generic SD-JWT verifier ───────────────────────────────────────────────────

export interface SdJwtVerificationResult {
  valid: boolean;
  issuer: string;
  subject: string;
  credentialType: string;
  claims: Record<string, string>;
  credentialId: string;
  revoked: boolean;
  error?: string;
}

/**
 * Verifies any EduWallet SD-JWT (KYC, StudentStatus, AcademicResult).
 *
 * Returns a result object rather than throwing so callers can distinguish
 * validation failures from revoked-but-genuine credentials.
 * Only truly malformed input (unparseable JWT) causes a throw.
 */
export async function verifySdJwt(sdJwt: string): Promise<SdJwtVerificationResult> {
  const parts = sdJwt.split("~");
  const jwtPart = parts[0] ?? "";
  const disclosureParts = parts.slice(1).filter(Boolean);

  const segments = jwtPart.split(".");
  if (segments.length !== 3) {
    return { valid: false, issuer: "", subject: "", credentialType: "", claims: {}, credentialId: "", revoked: false, error: "Invalid JWT structure" };
  }

  const headerB64 = segments[0]!;
  const payloadB64 = segments[1]!;
  const sigB64 = segments[2]!;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as Record<string, unknown>;
  } catch {
    return { valid: false, issuer: "", subject: "", credentialType: "", claims: {}, credentialId: "", revoked: false, error: "Failed to parse JWT payload" };
  }

  const iss = payload.iss as string | undefined;
  const sub = payload.sub as string | undefined;
  if (!iss) return { valid: false, issuer: "", subject: sub ?? "", credentialType: "", claims: {}, credentialId: "", revoked: false, error: "Missing iss claim" };
  if (!sub) return { valid: false, issuer: iss, subject: "", credentialType: "", claims: {}, credentialId: "", revoked: false, error: "Missing sub claim" };

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && (payload.exp as number) < now) {
    return { valid: false, issuer: iss, subject: sub, credentialType: "", claims: {}, credentialId: "", revoked: false, error: "Credential has expired" };
  }

  let issuerAddress: string;
  try {
    const doc = await resolveDidDocument(iss);
    issuerAddress = issuerAddressFromDoc(doc);
  } catch (e) {
    return { valid: false, issuer: iss, subject: sub, credentialType: "", claims: {}, credentialId: "", revoked: false, error: `Failed to resolve issuer DID: ${e instanceof Error ? e.message : String(e)}` };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  if (!verifyEs256kSignature(signingInput, sigB64, issuerAddress)) {
    return { valid: false, issuer: iss, subject: sub, credentialType: "", claims: {}, credentialId: "", revoked: false, error: "Invalid signature" };
  }

  const jti = payload.jti as string | undefined;
  if (!jti) return { valid: false, issuer: iss, subject: sub, credentialType: "", claims: {}, credentialId: "", revoked: false, error: "Missing jti claim" };

  const credentialId = ethers.keccak256(ethers.toUtf8Bytes(jti));
  const revoked = await checkRevocation(credentialId);

  const vcEnvelope = payload.vc as { type?: string[] } | undefined;
  const types = vcEnvelope?.type ?? [];
  const credentialType = types.length > 1 ? (types[types.length - 1] ?? "UnknownCredential") : (types[0] ?? "UnknownCredential");

  return {
    valid: true,
    issuer: iss,
    subject: sub,
    credentialType,
    claims: reconstructClaims(disclosureParts),
    credentialId,
    revoked,
  };
}
