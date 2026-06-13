import { ethers } from "ethers";
import { GATEWAY_UNIVERSITY_PRIVATE_KEY, RPC_URL } from "./config";

let _wallet: ethers.NonceManager | null = null;

/**
 * Returns a singleton NonceManager-wrapped university wallet.
 * All gateway code that sends transactions from the university EOA must go
 * through this function so nonces are allocated sequentially even under
 * concurrent requests.
 */
export function getUniversityWallet(): ethers.NonceManager {
  if (_wallet !== null) return _wallet;
  if (!GATEWAY_UNIVERSITY_PRIVATE_KEY) {
    throw new Error("GATEWAY_UNIVERSITY_PRIVATE_KEY is not configured");
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const base = new ethers.Wallet(GATEWAY_UNIVERSITY_PRIVATE_KEY, provider);
  _wallet = new ethers.NonceManager(base);
  return _wallet;
}
