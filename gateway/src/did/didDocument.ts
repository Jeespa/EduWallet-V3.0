import { ethers } from "ethers";

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Converts a gateway base URL to its did:web identifier.
 *
 * Rules (did:web spec):
 *  - Strip protocol prefix (http:// or https://)
 *  - Encode ":" as "%3A" (for port numbers)
 *  - Encode path segments with ":" separator
 *
 * Examples:
 *   http://localhost:3000  →  did:web:localhost%3A3000
 *   https://gateway.example.com  →  did:web:gateway.example.com
 */
function gatewayUrlToDid(gatewayUrl: string): string {
  const host = gatewayUrl.replace(/^https?:\/\//, "");
  const encoded = host.replace(/:/g, "%3A").replace(/\//g, ":");
  return `did:web:${encoded}`;
}

/**
 * Builds a W3C DID document for the gateway's did:web identity.
 *
 * The document exposes the gateway's secp256k1 signing key as a
 * JsonWebKey2020 verification method used for asserting credentials.
 *
 * @param privateKeyHex  0x-prefixed 32-byte hex private key (from GATEWAY_DID_PRIVATE_KEY)
 * @param gatewayUrl     Public base URL of this gateway, e.g. "http://localhost:3000"
 */
export function buildDidDocument(
  privateKeyHex: string,
  gatewayUrl: string
): Record<string, unknown> {
  const signingKey = new ethers.SigningKey(privateKeyHex);

  // ethers gives the uncompressed public key: 04 || x(32) || y(32)
  const pubBytes = ethers.getBytes(signingKey.publicKey);
  const x = pubBytes.slice(1, 33);
  const y = pubBytes.slice(33, 65);

  const did = gatewayUrlToDid(gatewayUrl);
  const keyId = `${did}#key-1`;

  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/jws-2020/v1",
    ],
    id: did,
    verificationMethod: [
      {
        id: keyId,
        type: "JsonWebKey2020",
        controller: did,
        publicKeyJwk: {
          kty: "EC",
          crv: "secp256k1",
          x: base64url(x),
          y: base64url(y),
        },
      },
    ],
    assertionMethod: [keyId],
    authentication: [keyId],
  };
}
