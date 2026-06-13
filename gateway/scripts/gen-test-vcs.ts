/**
 * Generates test SD-JWT VCs for manual testing.
 * Run with: npx ts-node scripts/gen-test-vcs.ts
 */

import { issueKycSdJwt, issueAcademicResultSdJwt } from "../src/vc/sdJwt";

const PRIVATE_KEY =
  process.env.GATEWAY_DID_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const GATEWAY_BASE = process.env.GATEWAY_URL || "http://localhost:3000";

const TEST_DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const TEST_SCA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

async function main() {
  // Fetch the live DID document so the vc's iss claim exactly matches what
  // the running gateway will check during verification.
  const didDocResponse = await fetch(`${GATEWAY_BASE}/.well-known/did.json`);
  if (!didDocResponse.ok) throw new Error(`Cannot reach gateway at ${GATEWAY_BASE}`);
  const liveDoc = await didDocResponse.json() as { id: string };
  const issuerDid = liveDoc.id;

  const { sdJwt: kycVc, credentialId: kycId } = issueKycSdJwt(
    { sub: TEST_DID, name: "Test Student", birthdate: "1998-05-15" },
    issuerDid,
    PRIVATE_KEY
  );

  const { sdJwt: academicVc, credentialId: academicId } = issueAcademicResultSdJwt(
    {
      sub: TEST_DID,
      studentSca: TEST_SCA,
      courseCode: "TMA4100",
      courseName: "Distributed Systems",
      grade: "B",
      ects: "10",
      date: "2025-06-01",
      degreeProgramme: "Master in Computer Engineering",
      universityName: "NTNU",
    },
    issuerDid,
    PRIVATE_KEY
  );

  console.log(JSON.stringify({ kycVc, kycId, academicVc, academicId }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
