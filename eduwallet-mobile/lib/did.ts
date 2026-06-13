/**
 * DID utilities for the mobile wallet.
 *
 * Kept dependency-free beyond ethers so it runs in Hermes (React Native).
 * Mirrors sdk/src/did.ts — both derive did:key the same way.
 */

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// secp256k1-pub multicodec varint prefix (0xe7 0x01)
const SECP256K1_PUB_PREFIX = new Uint8Array([0xe7, 0x01]);

function base58Encode(bytes: Uint8Array): string {
  let leading = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leading++;
  }
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return (
    "1".repeat(leading) +
    digits
      .reverse()
      .map((d) => BASE58_ALPHABET[d])
      .join("")
  );
}

/**
 * Derives a did:key from a secp256k1 compressed public key hex string.
 *
 * @param compressedPublicKeyHex - 0x-prefixed 33-byte hex (from ethers wallet.signingKey.compressedPublicKey)
 * @returns did:key string, e.g. "did:key:zQ3sh..."
 */
export function deriveDidKey(compressedPublicKeyHex: string): string {
  // Strip 0x and decode hex → bytes
  const hex = compressedPublicKeyHex.startsWith("0x")
    ? compressedPublicKeyHex.slice(2)
    : compressedPublicKeyHex;
  const pubBytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < pubBytes.length; i++) {
    pubBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  const prefixed = new Uint8Array(SECP256K1_PUB_PREFIX.length + pubBytes.length);
  prefixed.set(SECP256K1_PUB_PREFIX, 0);
  prefixed.set(pubBytes, SECP256K1_PUB_PREFIX.length);

  return "did:key:z" + base58Encode(prefixed);
}
