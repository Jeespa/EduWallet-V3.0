/**
 * Academic Result VC routes
 *
 * POST /vc/academic-result
 *   University-authenticated endpoint. Issues an AcademicResult SD-JWT VC,
 *   writes enroll + evaluate on-chain via University SCA UserOp (fire-and-forget),
 *   and stores the VC in an in-memory map for student polling.
 *
 * GET /vc/academic-results/:studentDid
 *   Returns all pending academic result VCs for a given student DID.
 *   The student app polls this after the university triggers issuance.
 */

import { Router } from "express";
import { ethers } from "ethers";
import { AccountAbstraction } from "../AccountAbstraction";
import { issueAcademicResultSdJwt } from "../vc/sdJwt";
import { registerCredential } from "../revocation/registry";
import {
  GATEWAY_DID_PRIVATE_KEY,
  GATEWAY_URL,
  GATEWAY_UNIVERSITY_PRIVATE_KEY,
  GATEWAY_UNIVERSITY_SCA,
  ENTRY_POINT_ADDRESS,
  RPC_URL,
} from "../config";
import { buildDidDocument } from "../did/didDocument";
import { getUniversityName } from "../utils/university";
import { getUniversityWallet } from "../wallet";

const STUDENT_ABI = [
  "function enroll((string code, string name, string degreeCourse, uint16 ects)[] _enrollments) external",
  "function evaluate((string code, string grade, uint256 date, string certificateHash)[] _evaluations) external",
];

export const academicRouter = Router();

// In-memory store: studentDid → list of issued academic VC SD-JWTs
// Persists for the lifetime of the gateway process; students poll to retrieve.
const pendingVcs = new Map<string, string[]>();

function universityEoaAddress(): string {
  return new ethers.Wallet(GATEWAY_UNIVERSITY_PRIVATE_KEY).address;
}

// ── POST /vc/academic-result ──────────────────────────────────────────────────

/**
 * Issues an AcademicResult SD-JWT VC for a student.
 *
 * Authentication: `Authorization: Bearer <university-eoa-address>`
 * The gateway verifies the address matches its configured university wallet.
 *
 * Request body:
 *   studentDid     — Student's did:key identifier
 *   studentSca     — Student's on-chain smart account address
 *   courseCode     — e.g. "TMA4100"
 *   courseName     — e.g. "Distributed Systems"
 *   grade          — e.g. "B"
 *   ects           — e.g. "6"
 *   date           — ISO date string (YYYY-MM-DD) of the evaluation
 *   degreeProgramme — e.g. "Master in Computer Engineering"
 *
 * Response (200):
 *   { academicResultVc, credentialId }
 */
academicRouter.post("/academic-result", async (req, res) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization: Bearer <university-eoa-address> required" });
  }
  const bearer = auth.slice("Bearer ".length).trim();

  if (!GATEWAY_UNIVERSITY_PRIVATE_KEY) {
    return res.status(503).json({ error: "University wallet not configured on this gateway" });
  }
  if (bearer.toLowerCase() !== universityEoaAddress().toLowerCase()) {
    return res.status(403).json({ error: "Unauthorized: bearer does not match university EOA" });
  }

  // ── Input validation ───────────────────────────────────────────────────────
  const {
    studentDid,
    studentSca,
    courseCode,
    courseName,
    grade,
    ects,
    date,
    degreeProgramme,
  } = req.body as {
    studentDid?: string;
    studentSca?: string;
    courseCode?: string;
    courseName?: string;
    grade?: string;
    ects?: string;
    date?: string;
    degreeProgramme?: string;
  };

  if (!studentDid || !studentSca || !courseCode || !courseName || !grade || !ects || !date || !degreeProgramme) {
    return res.status(400).json({
      error: "Missing required fields: studentDid, studentSca, courseCode, courseName, grade, ects, date, degreeProgramme",
    });
  }

  try {
    // ── Issue SD-JWT ───────────────────────────────────────────────────────
    const issuerDoc = buildDidDocument(GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL);
    const issuerDid = issuerDoc.id as string;

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const universityName = await getUniversityName(provider);

    const { sdJwt: academicResultVc, credentialId } = issueAcademicResultSdJwt(
      {
        sub: studentDid,
        studentSca,
        courseCode,
        courseName,
        grade,
        ects,
        date,
        degreeProgramme,
        universityName,
      },
      issuerDid,
      GATEWAY_DID_PRIVATE_KEY
    );

    // ── Store for student polling ─────────────────────────────────────────
    const existing = pendingVcs.get(studentDid) ?? [];
    pendingVcs.set(studentDid, [...existing, academicResultVc]);

    // ── On-chain writes (fire-and-forget) ─────────────────────────────────
    // 1. Register VC in VCStatusRegistry
    // 2. Enroll the student in the course on their Student.sol
    // 3. Record the grade evaluation on their Student.sol
    void (async () => {
      try {
        await registerCredential(credentialId);
      } catch (err) {
        console.error("Failed to register AcademicResult VC on-chain:", err);
      }

      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const uniWallet = getUniversityWallet();
        const aa = new AccountAbstraction(provider, uniWallet);
        const iface = new ethers.Interface(STUDENT_ABI);

        // enroll: ects on-chain is stored as (value × 100) to avoid decimals
        const ectsUint16 = Math.round(parseFloat(ects) * 100);
        const enrollData = iface.encodeFunctionData("enroll", [
          [{ code: courseCode, name: courseName, degreeCourse: degreeProgramme, ects: ectsUint16 }],
        ]);
        const enrollOp = await aa.createUserOp({
          sender: GATEWAY_UNIVERSITY_SCA,
          target: studentSca,
          value: 0n,
          data: enrollData,
        });
        const enrollTx = await aa.executeUserOps([enrollOp], universityEoaAddress());
        await enrollTx.wait();

        // evaluate: date as unix timestamp
        const dateTs = Math.floor(new Date(date).getTime() / 1000);
        const evaluateData = iface.encodeFunctionData("evaluate", [
          [{ code: courseCode, grade, date: dateTs, certificateHash: "" }],
        ]);
        const evalOp = await aa.createUserOp({
          sender: GATEWAY_UNIVERSITY_SCA,
          target: studentSca,
          value: 0n,
          data: evaluateData,
        });
        const evalTx = await aa.executeUserOps([evalOp], universityEoaAddress());
        await evalTx.wait();

        console.log(`AcademicResult VC written on-chain for student SCA ${studentSca}`);
      } catch (err) {
        console.error("Failed to write AcademicResult to Student.sol:", err);
      }
    })();

    res.json({ academicResultVc, credentialId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("Error in POST /vc/academic-result:", err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /vc/academic-results/:studentDid ──────────────────────────────────────

/**
 * Returns all pending academic result VCs for a student.
 *
 * The student app polls this endpoint after the university triggers issuance
 * via POST /vc/academic-result. VCs are returned as an array of SD-JWT strings.
 * Repeated calls return the same list (VCs are not cleared after delivery).
 */
academicRouter.get("/academic-results/:studentDid", (req, res) => {
  const { studentDid } = req.params;
  const vcs = pendingVcs.get(studentDid ?? "") ?? [];
  res.json({ vcs });
});
