import { createHash, randomBytes, randomUUID } from "crypto";
import { ethers } from "ethers";

function b64url(buf: Uint8Array | Buffer): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function sha256b64url(data: string): string {
  return b64url(createHash("sha256").update(data).digest());
}

interface Disclosure {
  encoded: string; // base64url([salt, claimName, claimValue])
  hash: string;    // sha256(encoded) in base64url — placed in _sd
}

function makeDisclosure(claimName: string, claimValue: string): Disclosure {
  const salt = b64url(randomBytes(16));
  const encoded = b64url(
    Buffer.from(JSON.stringify([salt, claimName, claimValue]))
  );
  return { encoded, hash: sha256b64url(encoded) };
}

/**
 * Signs a JWT payload with ES256K (secp256k1).
 *
 * Signature format per RFC 7518 §3.4: r || s as 64 bytes, base64url.
 * ethers v6 produces low-S normalised signatures as required.
 */
function signEs256k(
  payload: Record<string, unknown>,
  privateKeyHex: string,
  keyId: string
): string {
  const header = { alg: "ES256K", typ: "vc+sd-jwt", kid: keyId };
  const hdr = b64url(Buffer.from(JSON.stringify(header)));
  const pay = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${hdr}.${pay}`;

  const digest = createHash("sha256").update(signingInput).digest();
  const signingKey = new ethers.SigningKey(privateKeyHex);
  const sig = signingKey.sign(digest);

  // r and s are each 32 bytes; zero-pad to guarantee full length
  const r = ethers.getBytes(ethers.zeroPadValue(sig.r, 32));
  const s = ethers.getBytes(ethers.zeroPadValue(sig.s, 32));
  const compact = new Uint8Array(64);
  compact.set(r, 0);
  compact.set(s, 32);

  return `${signingInput}.${b64url(compact)}`;
}

// ── KYC VC ────────────────────────────────────────────────────────────────────

export interface KycClaims {
  /** Student's did:key identifier — becomes the VC subject. */
  sub: string;
  name: string;
  birthdate: string;
  /** Norwegian national identity number (personnummer), if provided by BankID. */
  nationalId?: string;
}

export interface IssuedKycSdJwt {
  /** Full SD-JWT string: `<jwt>~<disclosure1>~…~` */
  sdJwt: string;
  /** keccak256(jti) — pass this to `registerCredential()` after issuance. */
  credentialId: string;
}

/**
 * Issues a KYC SD-JWT Verifiable Credential.
 *
 * Every claim is wrapped in an individual disclosure so the holder can
 * present only what a verifier needs. The jti UUID allows the credential
 * to be registered and revoked on-chain via VCStatusRegistry.
 */
export function issueKycSdJwt(
  claims: KycClaims,
  issuerDid: string,
  privateKeyHex: string
): IssuedKycSdJwt {
  const disclosures: Disclosure[] = [
    makeDisclosure("name", claims.name),
    makeDisclosure("birthdate", claims.birthdate),
  ];
  if (claims.nationalId) {
    disclosures.push(makeDisclosure("nationalId", claims.nationalId));
  }

  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();

  const payload: Record<string, unknown> = {
    iss: issuerDid,
    sub: claims.sub,
    jti,
    iat: now,
    exp: now + 365 * 24 * 60 * 60,
    _sd_alg: "sha-256",
    _sd: disclosures.map((d) => d.hash),
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "KYCCredential"],
    },
  };

  const keyId = `${issuerDid}#key-1`;
  const jwt = signEs256k(payload, privateKeyHex, keyId);
  const sdJwt = jwt + "~" + disclosures.map((d) => d.encoded).join("~") + "~";
  const credentialId = ethers.keccak256(ethers.toUtf8Bytes(jti));

  return { sdJwt, credentialId };
}

// ── StudentStatus VC ──────────────────────────────────────────────────────────

export interface StudentStatusClaims {
  /** Student's did:key — becomes the VC subject. */
  sub: string;
  /** Smart account address — not selectively disclosable (always revealed). */
  studentSca: string;
  universityName: string;
  /** ISO date string (YYYY-MM-DD). */
  enrollmentDate: string;
}

export interface IssuedStudentStatusSdJwt {
  sdJwt: string;
  credentialId: string;
}

/**
 * Issues a StudentStatus SD-JWT Verifiable Credential.
 *
 * `studentSca` is placed directly in the JWT payload so verifiers can resolve
 * the on-chain account without requesting a disclosure.
 */
export function issueStudentStatusSdJwt(
  claims: StudentStatusClaims,
  issuerDid: string,
  privateKeyHex: string
): IssuedStudentStatusSdJwt {
  const disclosures: Disclosure[] = [
    makeDisclosure("universityName", claims.universityName),
    makeDisclosure("enrollmentDate", claims.enrollmentDate),
  ];

  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();

  const payload: Record<string, unknown> = {
    iss: issuerDid,
    sub: claims.sub,
    jti,
    iat: now,
    exp: now + 5 * 365 * 24 * 60 * 60,
    studentSca: claims.studentSca,
    _sd_alg: "sha-256",
    _sd: disclosures.map((d) => d.hash),
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "StudentStatusCredential"],
    },
  };

  const keyId = `${issuerDid}#key-1`;
  const jwt = signEs256k(payload, privateKeyHex, keyId);
  const sdJwt = jwt + "~" + disclosures.map((d) => d.encoded).join("~") + "~";
  const credentialId = ethers.keccak256(ethers.toUtf8Bytes(jti));

  return { sdJwt, credentialId };
}

// ── AcademicResult VC ─────────────────────────────────────────────────────────

export interface AcademicResultClaims {
  /** Student's did:key — becomes the VC subject. */
  sub: string;
  /** Smart account address — not selectively disclosable. */
  studentSca: string;
  courseCode: string;
  courseName: string;
  grade: string;
  /** ECTS as a human-readable string, e.g. "10". */
  ects: string;
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  degreeProgramme: string;
  universityName: string;
}

export interface IssuedAcademicResultSdJwt {
  sdJwt: string;
  credentialId: string;
}

/**
 * Issues an AcademicResult SD-JWT Verifiable Credential.
 *
 * All course-specific claims are individually selectively disclosable so
 * the holder can present a minimal subset to different verifiers.
 */
export function issueAcademicResultSdJwt(
  claims: AcademicResultClaims,
  issuerDid: string,
  privateKeyHex: string
): IssuedAcademicResultSdJwt {
  const disclosures: Disclosure[] = [
    makeDisclosure("courseCode", claims.courseCode),
    makeDisclosure("courseName", claims.courseName),
    makeDisclosure("grade", claims.grade),
    makeDisclosure("ects", claims.ects),
    makeDisclosure("date", claims.date),
    makeDisclosure("degreeProgramme", claims.degreeProgramme),
    makeDisclosure("universityName", claims.universityName),
  ];

  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();

  const payload: Record<string, unknown> = {
    iss: issuerDid,
    sub: claims.sub,
    jti,
    iat: now,
    exp: now + 10 * 365 * 24 * 60 * 60,
    studentSca: claims.studentSca,
    _sd_alg: "sha-256",
    _sd: disclosures.map((d) => d.hash),
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "AcademicResultCredential"],
    },
  };

  const keyId = `${issuerDid}#key-1`;
  const jwt = signEs256k(payload, privateKeyHex, keyId);
  const sdJwt = jwt + "~" + disclosures.map((d) => d.encoded).join("~") + "~";
  const credentialId = ethers.keccak256(ethers.toUtf8Bytes(jti));

  return { sdJwt, credentialId };
}
