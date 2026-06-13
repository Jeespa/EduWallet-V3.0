import { ethers } from "ethers";
import { GATEWAY_UNIVERSITY_SCA, GATEWAY_UNIVERSITY_NAME } from "../config";

const UNIVERSITY_ABI = [
  "function getUniversityInfo() external view returns (tuple(string name, string country, string shortName) info)",
];

let cachedUniversityName: string | null = null;

/**
 * Returns the university name stored in the University SCA contract.
 * Result is cached after the first successful call.
 * Falls back to GATEWAY_UNIVERSITY_NAME env var if the on-chain call fails.
 */
export async function getUniversityName(provider: ethers.Provider): Promise<string> {
  if (cachedUniversityName !== null) return cachedUniversityName;
  try {
    const uni = new ethers.Contract(GATEWAY_UNIVERSITY_SCA, UNIVERSITY_ABI, provider);
    const info = await (uni as any).getUniversityInfo();
    cachedUniversityName = info.name as string;
    return cachedUniversityName;
  } catch {
    return GATEWAY_UNIVERSITY_NAME;
  }
}
