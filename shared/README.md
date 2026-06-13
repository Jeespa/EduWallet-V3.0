# Shared

TypeScript types and HTTP client shared between the gateway and the mobile app. Consumed as an npm workspace package (`"shared": "*"`).

---

## Contents

### API Types

Types for all gateway request and response shapes:

| Type | Description |
|------|-------------|
| `ChallengeResponse` | `GET /auth/challenge` response: `{ challenge, expiresAt }` |
| `LoginRequest` | `POST /auth/login` body: `{ did, signature, challenge, scaAddress? }` |
| `LoginResponse` | `POST /auth/login` response: `{ studentSca: string \| null }` |
| `KycAuthorizeResponse` | `GET /kyc/authorize` response: `{ authorizationUrl }` |
| `StudentStatusRequest` | `POST /vc/student-status` body: `{ kycVc, ownerAddress }` |
| `StudentStatusResponse` | Response: `{ studentStatusVc, studentSca, credentialId }` |
| `AcademicResultRequest` | `POST /vc/academic-result` body: full course record |
| `AcademicResultResponse` | Response: `{ academicResultVc, credentialId }` |
| `AcademicResultsResponse` | `GET /vc/academic-results/:did` response: `{ vcs: string[] }` |
| `VerifyRequest` | `POST /vc/verify` body: `{ sdJwtPresentation }` |
| `VerifyResponse` | Full verification result with disclosed claims |
| `CredentialStatusResponse` | `GET /vc/status/:id` response: `{ revoked: boolean }` |
| `RevokeRequest` | `POST /vc/revoke` body: `{ credentialId }` |
| `GrantPermissionRequest` | `/students/:sca/permissions/grant` body |
| `RevokePermissionRequest` | `/students/:sca/permissions/revoke` body |

### SD-JWT Payload Types

| Type | Description |
|------|-------------|
| `SdJwtPayload` | Base JWT payload: `iss`, `sub`, `iat`, `exp`, `jti`, `_sd` |
| `KycCredentialClaims` | Selectively disclosable: `given_name`, `family_name`, `birthdate` |
| `StudentStatusClaims` | `studentDid`, `studentSca`, `universityAddress` |
| `AcademicResultClaims` | `studentDid`, `courseName`, `courseCode`, `grade`, `credits`, `date` |

### HTTP Client

Typed `fetch` wrapper for all gateway endpoints. Used by the mobile app.

```typescript
import { GatewayClient } from 'shared';

const client = new GatewayClient(process.env.EXPO_PUBLIC_GATEWAY_BASE_URL);
const { challenge } = await client.getChallenge();
```

---

## Usage

```json
{
  "dependencies": {
    "shared": "*"
  }
}
```

No build step needed — the package is consumed directly as TypeScript via the workspace.
