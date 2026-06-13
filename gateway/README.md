# Gateway

Node.js / Express HTTP server. Acts as the bridge between the mobile wallet and the Ethereum contracts.

Originally created by Jesper Rauan Goksør. The SSI layer (BankID KYC, SD-JWT credentials, revocation, challenge-response auth) was added subsequently.

---

## Responsibilities

- Serves the gateway's **did:web** DID document
- Runs the **BankID KYC** flow via Signicat OIDC
- Issues **SD-JWT Verifiable Credentials** (KYC, student status, academic results)
- Verifies SD-JWT presentations
- Manages **on-chain revocation** via `VCStatusRegistry`
- Executes **ERC-4337 UserOperations** on behalf of students (they never touch the blockchain directly)
- Stores the mock university data for the demo

---

## Setup

```bash
cd gateway
npm install
cp .env.example .env   # then fill in values
npm run dev
```

The gateway uses `ts-node-dev` — no compile step. It restarts automatically on file changes.

---

## Environment Variables

All variables are read at startup from `gateway/.env`. See `src/config.ts` for the authoritative list.

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default 3000) |
| `RPC_URL` | Ethereum JSON-RPC — `http://127.0.0.1:8545` for local Hardhat |
| `CHAIN_ID` | `31337` for local Hardhat |
| `STUDENTS_REGISTER_ADDRESS` | Deployed `StudentsRegister` contract address |
| `ENTRY_POINT_ADDRESS` | ERC-4337 `EntryPoint` address |
| `PAYMASTER_ADDRESS` | `Paymaster` address |
| `VC_STATUS_REGISTRY_ADDRESS` | `VCStatusRegistry` address |
| `STUDENT_DEPLOYER_ADDRESS` | `StudentDeployer` (CREATE2 factory) address |
| `GATEWAY_UNIVERSITY_PRIVATE_KEY` | EOA private key for the gateway's university role |
| `GATEWAY_UNIVERSITY_SCA` | Smart Contract Account address for the university |
| `GATEWAY_URL` | Public URL of this gateway (used in DID documents and KYC redirects) |
| `GATEWAY_DID_PRIVATE_KEY` | secp256k1 private key — the gateway's signing identity |
| `SIGNICAT_CLIENT_ID` | Signicat preprod OAuth client ID |
| `SIGNICAT_CLIENT_SECRET` | Signicat preprod OAuth client secret |
| `SIGNICAT_ISSUER` | Signicat OIDC issuer URL |

Example `.env` for local development:

```
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337

STUDENTS_REGISTER_ADDRESS=0x...
ENTRY_POINT_ADDRESS=0x...
PAYMASTER_ADDRESS=0x...
VC_STATUS_REGISTRY_ADDRESS=0x...
STUDENT_DEPLOYER_ADDRESS=0x...

GATEWAY_UNIVERSITY_PRIVATE_KEY=0x...
GATEWAY_UNIVERSITY_SCA=0x...

GATEWAY_URL=http://localhost:3000
GATEWAY_DID_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

SIGNICAT_CLIENT_ID=your-client-id
SIGNICAT_CLIENT_SECRET=your-client-secret
SIGNICAT_ISSUER=https://preprod.signicat.com/oidc
```

`GATEWAY_DID_PRIVATE_KEY` above is Hardhat account #0 — a publicly known dev key. Replace before any non-local deployment.

---

## API Reference

### Health and Identity

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check — returns `{ status: "ok" }` |
| `GET` | `/.well-known/did.json` | Gateway's did:web DID document |

Verify:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/.well-known/did.json
```

### Authentication

Authentication uses a challenge-response protocol. The student fetches a nonce, signs it with their device key (Ethereum personal sign), and submits the signature. No passwords.

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/auth/challenge` | — | `{ challenge: string, expiresAt: number }` |
| `POST` | `/auth/login` | `{ did, signature, challenge, scaAddress? }` | `{ studentSca: string \| null }` |

`studentSca` is `null` if the student's Smart Contract Account has not yet been deployed on-chain.

### KYC (BankID via Signicat)

The KYC flow uses the OAuth 2.0 authorisation code flow. The mobile app opens the returned URL in an in-app browser; Signicat handles BankID, then redirects to `/kyc/callback`, which redirects to the app via deep link.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/kyc/authorize?did=&app_redirect=` | Returns `{ authorizationUrl }` |
| `GET` | `/kyc/callback?code=&state=` | Exchanges code, issues KYC SD-JWT, redirects to `eduwalletmobile://kyc-complete?vc=...` |

### Verifiable Credentials — Issuance

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| `POST` | `/vc/student-status` | — | `{ kycVc, ownerAddress }` | `{ studentStatusVc, studentSca, credentialId }` |
| `POST` | `/vc/academic-result` | Bearer (university EOA) | Course record | `{ academicResultVc, credentialId }` |
| `GET` | `/vc/academic-results/:studentDid` | — | — | `{ vcs: string[] }` |

`POST /vc/student-status` verifies the KYC SD-JWT, checks the `ownerAddress` binding, deploys the student's SCA if needed (counterfactual via `initCode`), and issues a StudentStatus SD-JWT.

### Verifiable Credentials — Verification and Revocation

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| `GET` | `/vc/status/:credentialId` | — | — | `{ revoked: boolean }` |
| `POST` | `/vc/revoke` | Bearer (issuer DID) | `{ credentialId }` | `{ success: boolean }` |
| `POST` | `/vc/verify` | — | `{ sdJwtPresentation }` | Verification result with disclosed claims |

### Student Permissions

| Method | Path | Body |
|--------|------|------|
| `POST` | `/students/:studentSca/permissions/grant` | `{ universityAddress, userOpSignature }` |
| `POST` | `/students/:studentSca/permissions/revoke` | `{ universityAddress, userOpSignature }` |

---

## Source Structure

```
src/
├── config.ts                   Reads and validates all env vars
├── app.ts                      Express setup and route mounting
├── AccountAbstraction.ts       UserOperation builder and submitter
├── did/
│   └── document.ts             Generates did:web DID document from config
├── oidc/
│   └── signicat.ts             Signicat OIDC client (auth URL, code exchange)
├── vc/
│   ├── sdJwt.ts                Custom SD-JWT implementation (ES256K)
│   └── verifier.ts             SD-JWT verification (signature + revocation)
├── revocation/
│   └── registry.ts             VCStatusRegistry wrapper
└── routes/
    ├── auth.ts                 /auth/*
    ├── kyc.ts                  /kyc/*
    ├── vc.ts                   /vc/status, /vc/revoke, /vc/verify
    ├── student.ts              /vc/student-status
    ├── academic.ts             /vc/academic-result, /vc/academic-results
    └── permissions.ts          /students/:sca/permissions/*
```

---

## SD-JWT Format

The gateway uses a custom SD-JWT implementation (not a third-party library) for precise control over the ES256K signing algorithm. All credentials follow the IETF SD-JWT draft:

```
<header.payload.signature>~<disclosure1>~<disclosure2>~
```

Each disclosure is base64url-encoded `[salt, claimName, claimValue]`. The JWT payload contains the SHA-256 hashes of all disclosures in the `_sd` array.

---

## BankID Note

The KYC flow requires a Signicat preprod account. Without Signicat credentials, all other endpoints (auth, VC issuance, revocation, verification) work normally — only `GET /kyc/authorize` will fail.

The ID token signature from Signicat is **not verified** in this prototype. Production use requires JWKS verification against Signicat's published keys.
