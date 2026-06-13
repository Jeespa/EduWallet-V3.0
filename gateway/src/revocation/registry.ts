import { ethers } from "ethers";
import {
  RPC_URL,
  GATEWAY_DID_PRIVATE_KEY,
  GATEWAY_UNIVERSITY_PRIVATE_KEY,
  VC_STATUS_REGISTRY_ADDRESS,
} from "../config";
import { getUniversityWallet } from "../wallet";

const REGISTRY_ABI = [
  "function register(bytes32 credentialId) external",
  "function revoke(bytes32 credentialId) external",
  "function isRevoked(bytes32 credentialId) external view returns (bool)",
  "function issuerOf(bytes32 credentialId) external view returns (address)",
];

function getContract() {
  if (!VC_STATUS_REGISTRY_ADDRESS) return null;
  // Prefer the shared managed university wallet (avoids nonce conflicts under concurrency).
  // Fall back to a direct DID wallet when the university key is not configured.
  const signer = GATEWAY_UNIVERSITY_PRIVATE_KEY
    ? getUniversityWallet()
    : new ethers.Wallet(GATEWAY_DID_PRIVATE_KEY, new ethers.JsonRpcProvider(RPC_URL));
  return new ethers.Contract(VC_STATUS_REGISTRY_ADDRESS, REGISTRY_ABI, signer);
}

/**
 * Registers a newly issued credential on-chain.
 * Should be called immediately after issuance so the credential can be revoked later.
 */
export async function registerCredential(credentialId: string): Promise<void> {
  const contract = getContract() as any;
  if (!contract) return;
  const tx = await contract.register(credentialId);
  await tx.wait();
}

/** Revokes a credential on-chain. Only the original issuer may call this. */
export async function revokeCredential(credentialId: string): Promise<void> {
  const contract = getContract() as any;
  if (!contract) throw new Error("VCStatusRegistry is not configured");
  const tx = await contract.revoke(credentialId);
  await tx.wait();
}

/**
 * Returns true if the credential has been revoked.
 * Returns false if the registry is not configured (graceful degradation).
 */
export async function checkRevocation(credentialId: string): Promise<boolean> {
  const contract = getContract() as any;
  if (!contract) return false;
  return (await contract.isRevoked(credentialId)) as boolean;
}
