# EduWallet Mobile

Expo / React Native student wallet. Lets students create a self-sovereign identity, complete BankID identity verification, receive and store Verifiable Credentials, and share selective disclosures with verifiers.

Originally scaffolded by Jesper Rauan Goksør. Most screens and all SSI flows have since been replaced.

> Built with Expo / React Native. Developed and tested on Android. iOS is supported in principle via Expo Go or a standalone build but has not been validated.

---

## Setup

**Prerequisites:**
- Node.js 20 LTS
- Android Studio (for emulator) or a physical device

```bash
cd eduwallet-mobile
npm install
cp .env.example .env  # set EXPO_PUBLIC_GATEWAY_BASE_URL
npx expo start
```

In the Expo CLI: press `a` for Android emulator, `i` for iOS simulator, or scan the QR code with Expo Go.

### Gateway URL

| Target | `EXPO_PUBLIC_GATEWAY_BASE_URL` |
|--------|-------------------------------|
| Android emulator | `http://10.0.2.2:3000` |
| iOS simulator | `http://127.0.0.1:3000` |
| Physical device | `http://<your-LAN-ip>:3000` |

`localhost` on the emulator/device refers to the device itself, not the development machine.

---

## Screens

### Create Wallet

Generates a secp256k1 keypair using `ethers.Wallet.createRandom()`. Derives the student's `did:key` identifier from the compressed public key (secp256k1 multicodec prefix + base58btc encoding). Stores the private key in Expo SecureStore (hardware-backed on supported devices). Shows the DID to the student.

On subsequent launches the wallet is restored from storage and the app proceeds directly past this screen.

### KYC

Opens the Signicat BankID authorisation URL in an in-app browser (`expo-web-browser`). After the student completes BankID, the gateway issues a KYC SD-JWT and returns it via deep link (`eduwalletmobile://kyc-complete?vc=...`). The credential is stored in Expo SecureStore.

### Credentials

Lists all stored Verifiable Credentials. Tapping a credential shows its decoded claims (selectively disclosed fields).

### Student Status

Submits the KYC VC to the gateway to activate the student's on-chain account (deploys the SCA counterfactually if it does not yet exist) and receive a StudentStatus VC.

### Academic Results

Fetches and displays academic result VCs issued by the university via `GET /vc/academic-results/:studentDid`.

### Share VC

Constructs a selective disclosure presentation from stored credentials. The student chooses which claims to disclose. The resulting SD-JWT presentation string can be shown as a QR code or copied to clipboard.

### Request Status

Calls `GET /vc/status/:credentialId` to check whether a credential has been revoked.

### Permissions

Shows granted university permissions. Builds a UserOperation for `grantPermission` or `revokePermission`, signs it with EIP-712 typed-data signing using the device key, and sends the signed UserOperation to the gateway for submission.

---

## Key Design Decisions

**Private key never enters React state.** The private key is written to `expo-secure-store` and read back only when signing. The wallet context holds only the DID and owner address (non-sensitive).

**Authentication.** Every authenticated gateway request uses the challenge-response protocol: fetch a nonce from `GET /auth/challenge`, sign it with `eth_sign` (personal sign), submit to `POST /auth/login`. No passwords.

**Deep link handling.** The app registers the `eduwalletmobile://` scheme. The KYC callback uses `eduwalletmobile://kyc-complete?vc=<sd-jwt>` to return the credential after the BankID redirect chain.

**Standalone DID derivation.** Base58btc encoding is implemented inline without external dependencies so it runs in Hermes (the default React Native JS engine) without polyfills.

---

## Source Structure

```
app/
├── _layout.tsx                 Root layout: WalletProvider + redirect guard
├── create-wallet.tsx           Wallet creation onboarding
├── kyc.tsx                     BankID KYC flow
├── credentials.tsx             Credential list
├── student-status.tsx          SCA activation + StudentStatus VC
├── academic-results.tsx        Academic result VCs
├── share-vc.tsx                Selective disclosure presentation
├── request-status.tsx          Credential revocation check
└── permissions.tsx             University permission management
context/
├── WalletContext.tsx            DID + keypair state
└── CredentialsContext.tsx       Stored VC state
lib/
├── did.ts                      deriveDidKey() (standalone, no Node deps)
└── api.ts                      HTTP wrapper for the gateway
```

---

## Deep Link Registration

`app.json`:
```json
{
  "expo": {
    "scheme": "eduwalletmobile"
  }
}
```

The `eduwalletmobile://kyc-complete` deep link is triggered by the gateway's `/kyc/callback` after BankID authentication completes.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `ethers` | Keypair generation, signing, ABI encoding |
| `expo-secure-store` | Hardware-backed private key storage |
| `expo-web-browser` | In-app browser for BankID OIDC |
| `@react-native-async-storage/async-storage` | Persistent DID and address storage |
