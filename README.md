# EduWallet

A blockchain-based academic credential system. Universities issue course results as on-chain records; students manage and share those records through a mobile wallet.

---

## Background

The smart contracts were originally written by Diego Da Giau as part of his master's thesis. The gateway and mobile app were subsequently added by Jesper Rauan Goksør as a project extension. The mobile app has since been largely replaced and the gateway substantially modified to add an SSI layer: BankID identity verification, SD-JWT Verifiable Credentials, on-chain revocation, and device-side keypair authentication.

---

## Architecture

```
Mobile App (Expo / React Native)
        |
        | HTTPS REST
        v
    Gateway (Node.js / Express)
        ├── did:web identity   GET /.well-known/did.json
        ├── BankID KYC         GET /kyc/authorize, GET /kyc/callback
        ├── Auth               GET /auth/challenge, POST /auth/login
        ├── VC issuance        POST /vc/student-status, POST /vc/academic-result
        ├── VC verification    POST /vc/verify
        ├── Revocation         GET /vc/status/:id, POST /vc/revoke
        └── Student SCA        GET/POST /students/...
        |
        | ethers v6 · ERC-4337 UserOperations
        v
    Ethereum node (Hardhat in dev)
        ├── VCStatusRegistry     on-chain credential revocation
        ├── Student.sol          per-student smart account + academic records
        ├── StudentsRegister     student/university account registry
        ├── StudentDeployer      CREATE2 counterfactual deployment
        ├── University.sol
        ├── UniversityDeployer
        ├── Paymaster            sponsors all gas — students pay nothing
        └── EntryPoint           ERC-4337
```

Students never interact with the blockchain directly. All on-chain actions are submitted by the gateway as ERC-4337 UserOperations. For operations that require student authorisation (permission grant/revoke), the student signs the UserOperation with their device key and the gateway submits it.

---

## Project Structure

```
EduWallet/
├── contracts/              Solidity smart contracts
├── gateway/                Node.js / Express HTTP server
│   └── src/
│       ├── did/            did:web DID document
│       ├── oidc/           Signicat BankID OIDC integration
│       ├── vc/             SD-JWT issuance and verification
│       ├── revocation/     VCStatusRegistry wrapper
│       ├── routes/         Express route handlers
│       └── AccountAbstraction.ts
├── sdk/                    Shared TypeScript utilities (DID, ERC-4337)
├── shared/                 Shared API types and HTTP client
├── eduwallet-mobile/       Expo / React Native student wallet
├── browser-extension/      Browser extension (not updated for SSI layer)
├── cli/                    University-side deploy + inspect CLI
├── test/                   Hardhat tests and gas benchmarks
└── hardhat.config.ts
```

---

## Prerequisites

- **Node.js 20 LTS** (Node 24 has Hardhat compatibility issues)
- **npm**
- Android Studio + emulator, or a physical device, for the mobile app
- A Signicat preprod account for BankID testing (all other flows work without it)

---

## Installation

```bash
# 1. Root (Hardhat + tooling)
npm install

# 2. Per-component dependencies
npm run deps:all

# 3. Compile contracts + build SDK and CLI
npx hardhat compile
npm run build-sdk
npm run build-cli
```

The gateway runs via `ts-node-dev` — no build step needed.

---

## Running the System

### 1. Local blockchain

```bash
npx hardhat node
```

Starts on `http://127.0.0.1:8545`. Leave running.

### 2. Deploy contracts

```bash
npm run cli
```

Prints all deployed addresses. Copy them into `gateway/.env`.

### 3. Gateway

```bash
cd gateway && npm run dev
```

Starts on `http://localhost:3000`.

```bash
curl http://localhost:3000/health
curl http://localhost:3000/.well-known/did.json
```

### 4. Mobile app

```bash
cd eduwallet-mobile && npx expo start
```

Set the gateway URL in `eduwallet-mobile/.env`:

| Target | `EXPO_PUBLIC_GATEWAY_BASE_URL` |
|--------|-------------------------------|
| Android emulator | `http://10.0.2.2:3000` |
| iOS simulator | `http://127.0.0.1:3000` |
| Physical device | `http://<your-LAN-ip>:3000` |

---

## Environment Variables

### `gateway/.env`

```env
# Ethereum
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337

# Contract addresses — copy from CLI deploy output
STUDENTS_REGISTER_ADDRESS=0x...
ENTRY_POINT_ADDRESS=0x...
PAYMASTER_ADDRESS=0x...
VC_STATUS_REGISTRY_ADDRESS=0x...
STUDENT_DEPLOYER_ADDRESS=0x...

# University wallet — copy from CLI deploy output
GATEWAY_UNIVERSITY_PRIVATE_KEY=0x...
GATEWAY_UNIVERSITY_SCA=0x...

# Gateway identity
GATEWAY_URL=http://localhost:3000
GATEWAY_DID_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Signicat BankID (required only for the KYC flow)
SIGNICAT_CLIENT_ID=your-client-id
SIGNICAT_CLIENT_SECRET=your-client-secret
SIGNICAT_ISSUER=https://preprod.signicat.com/oidc
```

`GATEWAY_DID_PRIVATE_KEY` above is Hardhat account #0 — a publicly known dev key. Replace before any non-local deployment.

---

## Benchmarks

```bash
# Gas costs (requires running hardhat node)
REPORT_GAS=true npx hardhat test test/gas-benchmarks.ts --network localhost

# SD-JWT performance (requires gateway running)
cd gateway && npx ts-node scripts/bench-sdjwt.ts

# End-to-end flow timing (requires gateway + hardhat node)
cd gateway && npx ts-node scripts/bench-e2e.ts
```

---

## Component READMEs

| Component | README |
|-----------|--------|
| `contracts/` | [contracts/README.md](contracts/README.md) |
| `gateway/` | [gateway/README.md](gateway/README.md) |
| `eduwallet-mobile/` | [eduwallet-mobile/README.md](eduwallet-mobile/README.md) |
| `shared/` | [shared/README.md](shared/README.md) |
