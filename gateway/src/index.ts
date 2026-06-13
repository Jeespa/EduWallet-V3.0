/**
 * EduWallet HTTP gateway entry point.
 *
 * This module sets up an Express server that exposes a small REST API
 * on top of the EduWallet smart contracts. It delegates all blockchain
 * interactions to `EduWalletClient`, so that browser and mobile clients
 * can use a simple JSON interface instead of embedding the SDK.
 */

import express from "express";
import cors from "cors";
import { ethers, JsonRpcProvider, Wallet, id } from "ethers";
import { EduWalletClient } from "./eduwalletClient";
import {
  GATEWAY_PORT,
  GATEWAY_DID_PRIVATE_KEY,
  GATEWAY_URL,
  GATEWAY_UNIVERSITY_PRIVATE_KEY,
  RPC_URL,
} from "./config";
import { buildDidDocument } from "./did/didDocument";
import { kycRouter } from "./routes/kyc";
import { vcRouter } from "./routes/vc";
import { studentRouter } from "./routes/student";
import { academicRouter } from "./routes/academic";
import { authRouter, verifyAndConsumeChallenge } from "./routes/auth";
import { AccountAbstraction, PackedUserOpJson } from "./AccountAbstraction";

const app = express();
const PORT = GATEWAY_PORT || 3000;

// Global middleware
app.use(cors());
app.use(express.json());

/**
 * Single shared instance of the EduWallet blockchain client.
 * All HTTP handlers use this object to talk to the contracts.
 */
const client = new EduWalletClient();

const provider = new JsonRpcProvider(RPC_URL);

// Role identifiers mirroring the Student contract.
const permRoleCodes = {
  read: id("READER_ROLE"),
  write: id("WRITER_ROLE"),
};

const STUDENT_PERM_ABI = [
  "function revokePermission(address university)",
  "function grantPermission(bytes32 permissionType, address university)",
];

/**
 * Encodes the calldata for a grant or revoke permission call on Student.sol.
 */
function buildPermCallData(
  action: "grant" | "revoke",
  universityAddress: string,
  permissionType?: "read" | "write"
): string {
  const iface = new ethers.Interface(STUDENT_PERM_ABI);
  if (action === "revoke") {
    return iface.encodeFunctionData("revokePermission", [universityAddress]);
  }
  const role =
    permissionType === "write" ? permRoleCodes.write : permRoleCodes.read;
  return iface.encodeFunctionData("grantPermission", [role, universityAddress]);
}

/**
 * Returns an AccountAbstraction instance backed by the gateway's own keypair.
 * The gateway pays outer-transaction gas; UserOp gas is covered by the Paymaster.
 */
function gatewayAa(): AccountAbstraction {
  const key = GATEWAY_UNIVERSITY_PRIVATE_KEY || GATEWAY_DID_PRIVATE_KEY;
  const wallet = new Wallet(key, provider);
  return new AccountAbstraction(provider, wallet);
}

/**
 * Simple health check endpoint for monitoring and local debugging.
 * Returns a JSON object with a status field and a service identifier.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "eduwallet-gateway" });
});

app.use("/kyc", kycRouter);

app.use("/vc", vcRouter);
app.use("/vc", studentRouter);
app.use("/vc", academicRouter);

/**
 * GET /.well-known/did.json
 *
 * Serves the gateway's W3C DID document for the did:web method.
 * Resolvers fetch this URL to obtain the gateway's public verification key,
 * which holders use to verify KYC credential signatures.
 */
app.get("/.well-known/did.json", (_req, res) => {
  const doc = buildDidDocument(GATEWAY_DID_PRIVATE_KEY, GATEWAY_URL);
  res.json(doc);
});

app.use("/auth", authRouter);

/**
 * GET /students/:studentSca/permissions
 *
 * Read-only permission view backed by on-chain view functions.                                              
 * No credentials required. 
 */
app.get("/students/:studentSca/permissions", async (req, res) => {
  try {
    const { studentSca } = req.params;
    if (!studentSca) {
      return res.status(400).json({ error: "studentSca is required" });
    }
    const payload = await client.getAllPermissionsReadOnly(studentSca);
    res.json(payload);
  } catch (err: any) {
    console.error("Failed to get read-only permissions", err);
    res.status(500).json({
      error: err?.message || "Failed to get permission information",
    });
  }
});

/**
 * POST /students/:studentSca/permissions/prepare
 *
 * Builds an unsigned packed UserOperation for a grant or revoke action and
 * returns it alongside the EIP-712 signing parameters. The mobile app signs
 * the packed op client-side and sends the result to /grant or /revoke.
 *
 * Request body:
 *   {
 *     "action": "grant" | "revoke",
 *     "universityAddress": "0x...",
 *     "type": "read" | "write"   // required when action = "grant"
 *   }
 *
 * Response body on success:
 *   { "packedUserOp": { ... }, "eip712": { "domain": { ... }, "types": { ... } } }
 */
app.post("/students/:studentSca/permissions/prepare", async (req, res) => {
  try {
    const { studentSca } = req.params;
    const { action, universityAddress, type } = req.body as {
      action?: string;
      universityAddress?: string;
      type?: string;
    };

    if (!studentSca) {
      return res.status(400).json({ error: "studentSca is required" });
    }
    if (action !== "grant" && action !== "revoke") {
      return res
        .status(400)
        .json({ error: "action must be 'grant' or 'revoke'" });
    }
    if (!universityAddress || !universityAddress.startsWith("0x")) {
      return res
        .status(400)
        .json({ error: "universityAddress is required" });
    }
    if (action === "grant" && type !== "read" && type !== "write") {
      return res
        .status(400)
        .json({ error: "type must be 'read' or 'write' for grant" });
    }

    const callData = buildPermCallData(
      action,
      universityAddress,
      type as "read" | "write" | undefined
    );
    const aa = gatewayAa();
    const packedUserOp = await aa.buildForClientSigning({
      sender: studentSca,
      target: studentSca,
      value: 0n,
      data: callData,
    });
    const eip712 = aa.getEip712Params();

    res.json({ packedUserOp, eip712 });
  } catch (err: any) {
    console.error("Failed to prepare permission op", err);
    res
      .status(500)
      .json({ error: err?.message || "Failed to prepare operation" });
  }
});

/**
 * POST /students/:studentSca/permissions/revoke
 *
 * Submits a student-signed UserOperation that revokes a university's permission.
 * The student authenticates via challenge-response and provides a pre-signed
 * packed UserOperation obtained from /permissions/prepare.
 *
 * Request body:
 *   {
 *     "did": "did:key:z6Mk...",
 *     "challenge": "<uuid from GET /auth/challenge>",
 *     "challengeSignature": "0x...",
 *     "signedUserOp": { ...packedUserOp..., "signature": "0x..." }
 *   }
 *
 * Response body on success:
 *   { "status": "ok" }
 */
app.post("/students/:studentSca/permissions/revoke", async (req, res) => {
  try {
    const { studentSca } = req.params;
    const { did, challenge, challengeSignature, signedUserOp } = req.body as {
      did?: string;
      challenge?: string;
      challengeSignature?: string;
      signedUserOp?: PackedUserOpJson & { signature: string };
    };

    if (!did || !challenge || !challengeSignature || !signedUserOp) {
      return res.status(400).json({
        error: "did, challenge, challengeSignature, and signedUserOp are required",
      });
    }

    if (!verifyAndConsumeChallenge(challenge, did, challengeSignature)) {
      return res.status(401).json({ error: "Invalid or expired challenge" });
    }

    if (signedUserOp.sender.toLowerCase() !== studentSca.toLowerCase()) {
      return res
        .status(400)
        .json({ error: "signedUserOp.sender does not match studentSca" });
    }

    const aa = gatewayAa();
    const tx = await aa.submitSignedPacked([
      signedUserOp as Required<PackedUserOpJson>,
    ]);
    await tx.wait();

    res.json({ status: "ok" });
  } catch (err: any) {
    console.error("Failed to revoke permission", err);
    res
      .status(500)
      .json({ error: err?.message || "Failed to revoke permission" });
  }
});

/**
 * POST /students/:studentSca/permissions/grant
 *
 * Submits a student-signed UserOperation that grants a university permission.
 * Same auth and body shape as /revoke.
 *
 * Response body on success:
 *   { "status": "ok" }
 */
app.post("/students/:studentSca/permissions/grant", async (req, res) => {
  try {
    const { studentSca } = req.params;
    const { did, challenge, challengeSignature, signedUserOp } = req.body as {
      did?: string;
      challenge?: string;
      challengeSignature?: string;
      signedUserOp?: PackedUserOpJson & { signature: string };
    };

    if (!did || !challenge || !challengeSignature || !signedUserOp) {
      return res.status(400).json({
        error: "did, challenge, challengeSignature, and signedUserOp are required",
      });
    }

    if (!verifyAndConsumeChallenge(challenge, did, challengeSignature)) {
      return res.status(401).json({ error: "Invalid or expired challenge" });
    }

    if (signedUserOp.sender.toLowerCase() !== studentSca.toLowerCase()) {
      return res
        .status(400)
        .json({ error: "signedUserOp.sender does not match studentSca" });
    }

    const aa = gatewayAa();
    const tx = await aa.submitSignedPacked([
      signedUserOp as Required<PackedUserOpJson>,
    ]);
    await tx.wait();

    res.json({ status: "ok" });
  } catch (err: any) {
    console.error("Failed to grant permission", err);
    res
      .status(500)
      .json({ error: err?.message || "Failed to grant permission" });
  }
});

/**
 * Starts the HTTP server on the configured port.
 */
app.listen(PORT, () => {
  console.log(`Gateway running on http://localhost:${PORT}`);
});
