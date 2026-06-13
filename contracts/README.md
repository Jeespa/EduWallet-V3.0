# Contracts

Solidity smart contracts for the EduWallet system. Originally written by Diego Da Giau (master's thesis, Politecnico di Torino / NTNU). Extended with `VCStatusRegistry` and modifications to `Student.sol` and `StudentDeployer.sol` to support the SSI layer.

---

## Contracts

### Core Registry

| Contract | Description |
|----------|-------------|
| `StudentsRegister.sol` | Central registry. Maps student addresses to their `Student` SCA and university addresses to their `University` SCA. Entry point for SCA discovery. |
| `StudentDeployer.sol` | CREATE2 factory for `Student` accounts. Takes `(university, owner, didKeyHash, entryPoint)`. Salt is `keccak256(ownerAddress)` — deployed address is computable before deployment. |
| `UniversityDeployer.sol` | CREATE2 factory for `University` accounts. |

### Smart Contract Accounts

| Contract | Description |
|----------|-------------|
| `Student.sol` | Per-student ERC-4337 smart account. Stores `bytes32 didKeyHash` (SSI identity binding). Holds academic `Result` structs. Manages university permissions. No personal data stored on-chain. |
| `University.sol` | Per-university ERC-4337 smart account. Stores enrolled students and their results. |

### ERC-4337 Infrastructure

| Contract | Description |
|----------|-------------|
| `EntryPoint.sol` | ERC-4337 EntryPoint (OpenZeppelin). Validates and executes UserOperations. |
| `Paymaster.sol` | Gas sponsor. Pays for all UserOperation gas — students pay nothing. |
| `SmartAccount.sol` | Base ERC-4337 account implementation shared by Student and University. Validates EIP-712 signatures over UserOperations. |

### SSI Layer

| Contract | Description |
|----------|-------------|
| `VCStatusRegistry.sol` | On-chain credential revocation registry. Stores `keccak256(jti)` hashes. Functions: `register(credentialId)`, `revoke(credentialId)`, `isRevoked(credentialId) → bool`. Only the issuer (gateway) may register or revoke. |

---

## Key Design Decisions

**No personal data on-chain.** `Student.sol` stores only a `bytes32 didKeyHash` — the keccak256 hash of the student's `did:key` string. Names, dates of birth, and national IDs are kept off-chain in SD-JWT Verifiable Credentials.

**Counterfactual deployment.** A student's SCA address is computed before it is deployed (CREATE2 with `keccak256(ownerAddress)` as salt). The gateway uses this address in all UserOperations; if the account does not yet exist, it passes `initCode` in the first UserOperation to trigger deployment on first use.

**Gas sponsorship.** The Paymaster sponsors all gas. Students do not need ETH to interact with the system.

---

## Deployment

Deploy via the CLI from the repo root:

```bash
npm run cli
```

This runs Hardhat Ignition and prints all deployed addresses. Copy them into `gateway/.env`.

To deploy manually:

```bash
npx hardhat node
npx hardhat ignition deploy ignition/modules/EduWalletModule.ts --network localhost
```

---

## Gas Costs (Hardhat local, measured)

| Operation | Gas |
|-----------|-----|
| `StudentDeployer.deploy` | 2,537,540 |
| `Student` account deployment (total) | 2,715,473 |
| `VCStatusRegistry` deployment | 203,099 |
| `VCStatusRegistry.register` | 45,762 |
| `VCStatusRegistry.revoke` | 47,742 |
| `Student.enroll` (avg) | 293,177 |
| `Student.grantPermission` | 117,063 |
| `Student.revokePermission` | 40,152 |

Run benchmarks:

```bash
REPORT_GAS=true npx hardhat test --network localhost
```

---

## Testing

```bash
npx hardhat test
```

Tests cover deployment, enrollment, result recording, permission management, and revocation. The gas reporter prints per-function costs when `REPORT_GAS=true`.
