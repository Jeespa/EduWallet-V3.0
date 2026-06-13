import "dotenv/config";

/**
 * Reads a required environment variable and throws a descriptive error
 * if it is missing. Centralising this logic keeps configuration checks
 * consistent across the gateway.
 *
 * @param name - Name of the environment variable
 * @returns The non-empty value of the variable
 * @throws {Error} If the variable is not set
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in environment`);
  return v;
}

/**
 * Port used by the HTTP gateway.
 * Defaults to 3000 to match the original prototype when PORT is unset.
 */
export const GATEWAY_PORT = Number(process.env.PORT ?? "3000");

/**
 * JSON-RPC endpoint for the Ethereum node backing EduWallet.
 * Typically points at a local Hardhat/Anvil instance in development.
 */
export const RPC_URL = required("RPC_URL");

/**
 * Address of the StudentsRegister contract.
 * This registry is used to look up student and university smart accounts.
 */
export const STUDENTS_REGISTER_ADDRESS = required("STUDENTS_REGISTER_ADDRESS");

/**
 * Address of the ERC-4337 EntryPoint contract.
 * All user operations are ultimately routed through this contract.
 */
export const ENTRY_POINT_ADDRESS = required("ENTRY_POINT_ADDRESS");

/**
 * Address of the Paymaster contract used by the account abstraction flow.
 * In the current prototype this paymaster sponsors gas for student-initiated
 * permission changes.
 */
export const PAYMASTER_ADDRESS = required("PAYMASTER_ADDRESS");

/**
 * Chain identifier for the Ethereum network used by EduWallet.
 * Defaults to 31337, which is the common ID for local development chains.
 */
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? "31337");

/**
 * Public base URL of this gateway instance.
 * Used to construct the did:web identifier served at /.well-known/did.json.
 * Defaults to http://localhost:<PORT> for local development.
 */
export const GATEWAY_URL =
  process.env.GATEWAY_URL ?? `http://localhost:${GATEWAY_PORT}`;

/**
 * Secp256k1 private key used to sign KYC verifiable credentials and to
 * build the gateway's did:web DID document. Must be a 0x-prefixed 32-byte hex string.
 */
export const GATEWAY_DID_PRIVATE_KEY = required("GATEWAY_DID_PRIVATE_KEY");

// ---------------------------------------------------------------------------
// Signicat OIDC
// ---------------------------------------------------------------------------

/**
 * OAuth 2.0 client ID registered in the Signicat developer portal.
 * Obtain from https://developer.signicat.com after creating a sandbox app.
 */
export const SIGNICAT_CLIENT_ID = required("SIGNICAT_CLIENT_ID");

/**
 * Client secret paired with SIGNICAT_CLIENT_ID.
 */
export const SIGNICAT_CLIENT_SECRET = required("SIGNICAT_CLIENT_SECRET");

/**
 * Base URL of the Signicat OIDC issuer.
 * Defaults to the Signicat preprod (sandbox) environment.
 */
export const SIGNICAT_ISSUER =
  process.env.SIGNICAT_ISSUER ?? "https://preprod.signicat.com/oidc";

// ---------------------------------------------------------------------------
// VC Status Registry
// ---------------------------------------------------------------------------

/**
 * Address of the VCStatusRegistry contract.
 * Optional: if unset the gateway starts without on-chain revocation support.
 * Set this after deploying the contract via `npx hardhat run scripts/deploy.ts`.
 */
export const VC_STATUS_REGISTRY_ADDRESS =
  process.env.VC_STATUS_REGISTRY_ADDRESS ?? "";

// ---------------------------------------------------------------------------
// Student Deployment
// ---------------------------------------------------------------------------

/**
 * Secp256k1 private key of the registered university EOA.
 * Used to sign ERC-4337 user operations that register new students.
 * Must correspond to a university account registered in StudentsRegister.
 */
export const GATEWAY_UNIVERSITY_PRIVATE_KEY =
  process.env.GATEWAY_UNIVERSITY_PRIVATE_KEY ?? "";

/**
 * Address of the university's deployed smart contract account (SCA).
 * This is the address that `StudentsRegister.universitiesAccounts` maps to true.
 * Set this after running `subscribeUniversity` via the CLI.
 */
export const GATEWAY_UNIVERSITY_SCA =
  process.env.GATEWAY_UNIVERSITY_SCA ?? "";

/**
 * Address of the StudentDeployer contract.
 * Used to compute counterfactual student SCA addresses before deployment.
 * Set this after running the initial deployment via the CLI.
 */
export const STUDENT_DEPLOYER_ADDRESS =
  process.env.STUDENT_DEPLOYER_ADDRESS ?? "";

/**
 * Human-readable name of the university operating this gateway instance.
 * Included as a claim in issued StudentStatus and AcademicResult VCs.
 * Defaults to "Unknown University" if not set.
 */
export const GATEWAY_UNIVERSITY_NAME =
  process.env.GATEWAY_UNIVERSITY_NAME ?? "Unknown University";
