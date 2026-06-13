// app/lib/api.ts
import type {
  AllPermissionsForStudent,
} from "../types";

/**
 * Base URL for the EduWallet HTTP gateway as seen from the mobile app.
 * Read from Expo config, with a localhost fallback for development.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_GATEWAY_BASE_URL ?? "http://localhost:3000";

// --- student status helper ----------------------------------------

/**
 * Request a StudentStatus Verifiable Credential from the gateway.
 *
 * The gateway verifies the KYC VC, deploys the student's smart account
 * on-chain (if not already deployed), and issues a StudentStatus SD-JWT.
 *
 * @param kycVc        Full KYC SD-JWT including all disclosures
 * @param ownerAddress Student EOA address
 */
export async function requestStudentStatus(
  kycVc: string,
  ownerAddress: string
): Promise<{ studentStatusVc: string; studentSca: string; credentialId: string }> {
  const response = await fetch(`${API_BASE_URL}/vc/student-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kycVc, ownerAddress }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{
    studentStatusVc: string;
    studentSca: string;
    credentialId: string;
  }>;
}

// --- VC verification helper ---------------------------------------

export interface VcVerificationResult {
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
 * Verifies an SD-JWT credential via the gateway.
 *
 * Checks signature, expiry, issuer DID resolution, and on-chain revocation.
 * A valid but revoked credential returns `{ valid: true, revoked: true }`.
 */
export async function verifyVc(sdJwtPresentation: string): Promise<VcVerificationResult> {
  const response = await fetch(`${API_BASE_URL}/vc/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdJwtPresentation }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Verification request failed: ${response.status}`);
  }
  return response.json() as Promise<VcVerificationResult>;
}

// --- academic results helper --------------------------------------

/**
 * Polls the gateway for academic result VCs issued to a student.
 *
 * The university calls POST /vc/academic-result to issue a VC; it is stored
 * server-side until the student's app fetches it here. Repeated calls return
 * the full list (VCs are not cleared after delivery).
 *
 * @param studentDid — Student's did:key identifier
 */
export async function fetchAcademicVcs(
  studentDid: string
): Promise<{ vcs: string[] }> {
  const encoded = encodeURIComponent(studentDid);
  const response = await fetch(`${API_BASE_URL}/vc/academic-results/${encoded}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ vcs: string[] }>;
}

// --- keypair auth helpers -----------------------------------------

/**
 * Fetch a one-time challenge nonce from the gateway.
 * The caller should sign this with their wallet private key and send it
 * back via `loginWithDid`.
 */
export async function getChallenge(): Promise<{ challenge: string; expiresAt: number }> {
  const response = await fetch(`${API_BASE_URL}/auth/challenge`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Challenge request failed: ${response.status}`);
  }
  return response.json() as Promise<{ challenge: string; expiresAt: number }>;
}

/**
 * Authenticate against the gateway using a did:key keypair signature.
 *
 * The caller must:
 *  1. Fetch a challenge via `getChallenge()`
 *  2. Sign it with `WalletContext.signMessage(challenge)`
 *  3. Pass the DID, signature, challenge, and optionally their SCA here
 *
 * @returns The student's SCA address (echoed back from the request)
 */
export async function loginWithDid(
  did: string,
  signature: string,
  challenge: string,
  scaAddress?: string
): Promise<{ studentSca: string | null }> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ did, signature, challenge, scaAddress }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Login failed: ${response.status}`);
  }
  return response.json() as Promise<{ studentSca: string | null }>;
}

// --- read-only permissions helper ---------------------------------

/**
 * Fetch all university permissions for a student SCA without credentials.
 * Uses the gateway's read-only endpoint backed by on-chain view functions.
 *
 * @param studentSca - Student smart contract account address
 */
export async function getPermissionsReadOnly(
  studentSca: string
): Promise<AllPermissionsForStudent> {
  const encoded = encodeURIComponent(studentSca);
  const response = await fetch(`${API_BASE_URL}/students/${encoded}/permissions`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<AllPermissionsForStudent>;
}

// --- permissions helpers ------------------------------------------

export interface PackedUserOpJson {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: string;
  gasFees: string;
  paymasterAndData: string;
  signature?: string;
}

export interface PreparePermissionOpResult {
  packedUserOp: PackedUserOpJson;
  eip712: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    types: {
      PackedUserOperation: Array<{ name: string; type: string }>;
    };
  };
}

/**
 * Asks the gateway to build an unsigned packed UserOperation for a grant or
 * revoke action. The caller must sign the result and pass it to
 * `executePermissionOp`.
 */
export async function preparePermissionOp(
  studentSca: string,
  action: "grant" | "revoke",
  universityAddress: string,
  type?: "read" | "write"
): Promise<PreparePermissionOpResult> {
  const response = await fetch(
    `${API_BASE_URL}/students/${encodeURIComponent(studentSca)}/permissions/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, universityAddress, type }),
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Prepare failed: ${response.status}`);
  }
  return response.json() as Promise<PreparePermissionOpResult>;
}

/**
 * Submits a student-signed permission UserOperation to the gateway.
 *
 * The caller must:
 *  1. Call `preparePermissionOp` to get the packed UserOp and EIP-712 params.
 *  2. Sign the packed UserOp with `WalletContext.signTypedData`.
 *  3. Fetch a challenge via `getChallenge` and sign it with `WalletContext.signMessage`.
 *  4. Pass everything here.
 */
export async function executePermissionOp(
  studentSca: string,
  action: "grant" | "revoke",
  params: {
    did: string;
    challenge: string;
    challengeSignature: string;
    signedUserOp: PackedUserOpJson & { signature: string };
  }
): Promise<void> {
  const endpoint =
    action === "revoke" ? "revoke" : "grant";
  const response = await fetch(
    `${API_BASE_URL}/students/${encodeURIComponent(studentSca)}/permissions/${endpoint}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: params.did,
        challenge: params.challenge,
        challengeSignature: params.challengeSignature,
        signedUserOp: params.signedUserOp,
      }),
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Permission op failed: ${response.status}`);
  }
}
