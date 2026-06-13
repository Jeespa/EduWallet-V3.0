/**
 * Student Status VC route
 *
 * POST /vc/student-status
 *   Verifies a KYC VC, deploys the student's smart account (if needed),
 *   and issues a StudentStatus SD-JWT Verifiable Credential.
 */

import { Router } from "express";
import { ethers } from "ethers";
import { AccountAbstraction } from "../AccountAbstraction";
import { verifyKycSdJwt, didKeyToAddress } from "../vc/verifier";
import { issueStudentStatusSdJwt } from "../vc/sdJwt";
import { registerCredential } from "../revocation/registry";
import {
  GATEWAY_DID_PRIVATE_KEY,
  GATEWAY_URL,
  GATEWAY_UNIVERSITY_PRIVATE_KEY,
  GATEWAY_UNIVERSITY_SCA,
  STUDENT_DEPLOYER_ADDRESS,
  STUDENTS_REGISTER_ADDRESS,
  ENTRY_POINT_ADDRESS,
  RPC_URL,
} from "../config";
import { buildDidDocument } from "../did/didDocument";
import { STUDENTS_REGISTER_ABI } from "../contracts/studentsRegisterContract";
import { getUniversityName } from "../utils/university";
import { getUniversityWallet } from "../wallet";

/** Minimal ABI for StudentDeployer.computeAddress (read-only, no deployment). */
const STUDENT_DEPLOYER_ABI = [
  "function computeAddress(address _university, address _student, bytes32 _didKeyHash, address _entryPoint) external view returns (address)",
];


export const studentRouter = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the Ethereum address derived from GATEWAY_UNIVERSITY_PRIVATE_KEY.
 * Used as the beneficiary of handleOps to reclaim any unspent gas.
 */
function universityEoaAddress(): string {
  return new ethers.Wallet(GATEWAY_UNIVERSITY_PRIVATE_KEY).address;
}

/**
 * Computes the counterfactual student SCA address by calling
 * StudentDeployer.computeAddress on-chain.
 */
async function computeStudentSca(
  provider: ethers.Provider,
  studentAddress: string,
  didKeyHash: string
): Promise<string> {
  const deployer = new ethers.Contract(
    STUDENT_DEPLOYER_ADDRESS,
    STUDENT_DEPLOYER_ABI,
    provider
  );
  return (deployer as any).computeAddress(
    GATEWAY_UNIVERSITY_SCA,
    studentAddress,
    didKeyHash,
    ENTRY_POINT_ADDRESS
  ) as Promise<string>;
}

// ── POST /vc/student-status ───────────────────────────────────────────────────

/**
 * Issues a StudentStatus Verifiable Credential.
 *
 * Request body:
 *   kycVc        — Full KYC SD-JWT (all disclosures included)
 *   ownerAddress — Student's EOA address (0x-prefixed)
 *
 * Response on success (200):
 *   { studentStatusVc, studentSca, credentialId }
 *
 * The endpoint:
 *  1. Verifies the KYC VC (signature + revocation)
 *  2. Confirms ownerAddress matches the did:key in the VC's `sub` claim
 *  3. Registers the student in StudentsRegister via a university SCA UserOp
 *     (if not already registered)
 *  4. Issues a StudentStatus SD-JWT VC
 *  5. Registers the new credential on-chain (fire-and-forget)
 */
studentRouter.post("/student-status", async (req, res) => {
  const { kycVc, ownerAddress } = req.body as {
    kycVc?: string;
    ownerAddress?: string;
  };

  if (!kycVc || !ownerAddress) {
    return res.status(400).json({ error: "kycVc and ownerAddress are required" });
  }
  if (!ownerAddress.startsWith("0x")) {
    return res.status(400).json({ error: "ownerAddress must be 0x-prefixed" });
  }
  if (!GATEWAY_UNIVERSITY_PRIVATE_KEY || !GATEWAY_UNIVERSITY_SCA) {
    return res
      .status(503)
      .json({ error: "University wallet not configured on this gateway" });
  }
  if (!STUDENT_DEPLOYER_ADDRESS) {
    return res
      .status(503)
      .json({ error: "STUDENT_DEPLOYER_ADDRESS not configured on this gateway" });
  }

  try {
    // ── 1. Verify KYC VC ─────────────────────────────────────────────────────
    const verified = await verifyKycSdJwt(kycVc);

    // ── 2. Verify ownership ───────────────────────────────────────────────────
    // The did:key in `sub` is derived from the student's EOA public key.
    // If ownerAddress matches the address derived from that key, the presenter
    // owns the private key — no separate signature challenge needed.
    const expectedAddress = didKeyToAddress(verified.sub);
    if (expectedAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      return res
        .status(403)
        .json({ error: "ownerAddress does not match the VC subject (did:key)" });
    }

    const didKeyHash = ethers.keccak256(ethers.toUtf8Bytes(verified.sub));
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    // ── 3. Compute counterfactual SCA ─────────────────────────────────────────
    const studentSca = await computeStudentSca(provider, ownerAddress, didKeyHash);

    // ── 4. Deploy if not yet registered ──────────────────────────────────────
    const existingCode = await provider.getCode(studentSca);
    if (existingCode === "0x") {
      const iface = new ethers.Interface(STUDENTS_REGISTER_ABI);
      const registerData = iface.encodeFunctionData("registerStudent", [
        ownerAddress,
        didKeyHash,
      ]);

      const uniWallet = getUniversityWallet();
      const aa = new AccountAbstraction(provider, uniWallet);

      const userOp = await aa.createUserOp({
        sender: GATEWAY_UNIVERSITY_SCA,
        target: STUDENTS_REGISTER_ADDRESS,
        value: 0n,
        data: registerData,
      });

      const tx = await aa.executeUserOps([userOp], universityEoaAddress());
      await tx.wait();
    }

    // ── 5. Issue StudentStatus VC ─────────────────────────────────────────────
    const issuerDoc = buildDidDocument(GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL);
    const issuerDid = issuerDoc.id as string;

    const universityName = await getUniversityName(provider);
    const today = new Date().toISOString().split("T")[0] ?? "";
    const { sdJwt: studentStatusVc, credentialId } = issueStudentStatusSdJwt(
      {
        sub: verified.sub,
        studentSca,
        universityName,
        enrollmentDate: today,
      },
      issuerDid,
      GATEWAY_DID_PRIVATE_KEY
    );

    // ── 6. Register credential on-chain (fire-and-forget) ────────────────────
    registerCredential(credentialId).catch((err: unknown) =>
      console.error("Failed to register StudentStatus VC on-chain:", err)
    );

    res.json({ studentStatusVc, studentSca, credentialId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("Error in POST /vc/student-status:", err);

    const clientErrors = [
      "Invalid KYC VC signature",
      "KYC VC has expired",
      "KYC VC has been revoked",
      "does not match",
      "Missing",
    ];
    const isClientError = clientErrors.some((s) => msg.includes(s));
    res.status(isClientError ? 400 : 500).json({ error: msg });
  }
});
