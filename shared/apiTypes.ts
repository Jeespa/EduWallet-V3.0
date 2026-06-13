// shared/apiTypes.ts

/**
 * Shared TypeScript types for the EduWallet HTTP API.
 *
 * These interfaces are imported by:
 *  - The gateway (to shape responses)
 *  - The browser extension
 *  - The mobile app
 *
 * Keeping them in one place prevents the clients from drifting apart
 * and makes it clear what JSON shape the gateway guarantees.
 */

// ---------- University / course result ----------

/**
 * Basic metadata about a university.
 * This is stored off-chain in the University contract and returned
 * as part of course results and permission views.
 */
export interface UniversityInfo {
  /** Full university name, e.g. "Norwegian University of Science and Technology". */
  name: string;
  /** Country where the university is located. */
  country: string;
  /** Short label used in the UI, e.g. "NTNU". */
  shortName: string;
}

/**
 * Single course result as exposed through the HTTP API.
 * This corresponds to one element in the student's on-chain results array.
 */
export interface CourseResult {
  /** Human readable course name. */
  name: string;
  /** Course code as used by the university (e.g. "TDT4100"). */
  code: string;
  /** Degree programme or track this course belongs to. */
  degreeCourse: string;
  /** Number of ECTS credits for the course (already normalised, e.g. 7.5). */
  ects: number;
  /** Optional final grade, if the course has been evaluated. */
  grade?: string;
  /** Optional evaluation date in ISO format (YYYY-MM-DD). */
  evaluationDate?: string;
  /** University that owns the course and issued the result. */
  university: {
    name: string;
    country: string;
    shortName: string;
  };
  /**
   * Optional link to a certificate or diploma.
   * Typically an IPFS gateway URL constructed from a content identifier.
   */
  certificate?: string;
}

// ---------- Login / student ----------

/**
 * Student profile and results returned from the gateway.
 * This is a cleaned-up version of the on-chain StudentInfo struct.
 */
export interface StudentPayload {
  name: string;
  surname: string;
  /** Date of birth in ISO format (YYYY-MM-DD). */
  birthDate: string;
  birthPlace: string;
  country: string;
  /** All known course results for this student. */
  results: CourseResult[];
}

// ---------- Credentials response ----------

/**
 * Single entry in the multi-university permissions list.
 * Each entry corresponds to one university and its roles
 * on the student's smart account.
 */
export interface UniversityPermissionEntry {
  /** On-chain smart account address for the university. */
  universityAddress: string;

  /** True if the university currently has read permission. */
  read: boolean;
  /** True if the university currently has write permission. */
  write: boolean;

  /** True if the university has requested read access but it is not granted yet. */
  readRequested: boolean;
  /** True if the university has requested write access but it is not granted yet. */
  writeRequested: boolean;

  /** Optional metadata – filled when the gateway can resolve UniversityInfo. */
  universityName?: string;
  universityCountry?: string;
  universityShortName?: string;
}

/**
 * Complete permission view for a single student:
 * the student's smart account and all universities that are
 * involved in permission roles.
 */
export interface AllPermissionsForStudent {
  /** Student smart contract account (SCA) address. */
  studentSca: string;
  /** One entry per university that has any role on this account. */
  permissions: UniversityPermissionEntry[];
}

/**
 * Response from POST /auth/login.
 *
 * In addition to basic student information, the gateway may also attach
 * a snapshot of all permissions (`allPermissions`) so that clients can
 * render the multi-university view immediately after login.
 */
export interface CredentialsResponse {
  /** Student identifier used for password-based login. */
  id: string;
  /** Smart contract account address for this student. */
  studentSca: string;
  /** Student profile and course results. */
  student: StudentPayload;
  /** Optional multi-university permissions snapshot. */
  allPermissions?: AllPermissionsForStudent;
}

// ---------- Permissions ----------

/**
 * Per-university permission status as returned by permission
 * mutation endpoints such as `/permissions/revoke` and
 * `/permissions/grant` (if they choose to return a full state).
 *
 * Frontends mostly use the richer `AllPermissionsForStudent` view,
 * but this type is kept to document the “single university” shape.
 */
export interface PermissionStatus {
  studentSca: string;
  universitySmartAccount: string;
  universityName: string;
  universityCountry: string;
  universityShortName: string;
  read: boolean;
  write: boolean;
  readRequested: boolean;
  writeRequested: boolean;
}

// ---------- Auth ----------

/**
 * Response from POST /auth/login (keypair challenge-response).
 *
 * Contains the student's smart contract account address as derived from
 * the scaAddress the client sent with the login request. The gateway does
 * not look up the SCA — the client already has it in its StudentStatus VC.
 */
export interface StudentAuthResponse {
  /** Student smart contract account address, or null if not provided. */
  studentSca: string | null;
}

/**
 * One-time challenge issued by GET /auth/challenge.
 * The client signs `challenge` with the did:key private key and sends
 * both back in the POST /auth/login body.
 */
export interface AuthChallenge {
  challenge: string;
  /** Unix timestamp (ms) after which the challenge is no longer valid. */
  expiresAt: number;
}

// ---------- SSI wallet ----------

/**
 * Local identity wallet created on the student's device.
 * Returned after wallet creation so UI can display the DID to the user.
 *
 * The private key itself is never included here — it lives only in SecureStore.
 */
export interface WalletInfo {
  /** Student's decentralised identifier, e.g. "did:key:zQ3sh..." */
  did: string;
  /** EOA address derived from the same keypair (for future ERC-4337 use). */
  ownerAddress: string;
}

// ---------- Error response ----------

/**
 * Standard error payload used by the gateway.
 * All endpoints should return this shape on non-2xx responses so
 * clients can show a human readable message.
 */
export interface ErrorResponse {
  /** Short error message suitable for display in the UI. */
  error: string;
  /** Optional extra details for logs or debugging. */
  details?: string;
}
