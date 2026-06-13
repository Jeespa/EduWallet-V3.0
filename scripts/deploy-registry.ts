/**
 * Deploys VCStatusRegistry to the local Hardhat node.
 * Run with: npx hardhat run scripts/deploy-registry.ts --network localhost
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying VCStatusRegistry with:", deployer.address);

  const Factory = await ethers.getContractFactory("VCStatusRegistry");
  const registry = await Factory.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("VCStatusRegistry deployed to:", address);
  console.log("\nAdd to gateway/.env:");
  console.log(`VC_STATUS_REGISTRY_ADDRESS=${address}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
