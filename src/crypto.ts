/**
 * Field-Level Encryption (FLE)
 *
 * Ports geode-client-go crypto/cipher.go using node:crypto:
 *  - AES-256-GCM authenticated encryption (random 12-byte nonce, prepended).
 *  - HKDF-SHA256 derives separate encryption and HMAC keys from a >= 32-byte
 *    master key.
 *  - HMAC-SHA256 hex digest for deterministic searchable encryption.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const KEY_SIZE = 32; // AES-256
const NONCE_SIZE = 12; // GCM nonce
const TAG_SIZE = 16; // GCM auth tag

/** Holds derived encryption and HMAC keys for field-level encryption. */
export class GeodeCipher {
  private readonly encKey: Buffer;
  private readonly hmacKey: Buffer;

  /** @internal Use createCipher(). */
  constructor(masterKey: Uint8Array) {
    if (masterKey.length < KEY_SIZE) {
      throw new Error(
        `geode: crypto: master key must be at least ${KEY_SIZE} bytes, got ${masterKey.length}`
      );
    }
    this.encKey = deriveKey(masterKey, 'geode-encrypt');
    this.hmacKey = deriveKey(masterKey, 'geode-hmac');
  }

  /** Encrypt with AES-256-GCM, prepending a random nonce. */
  encrypt(plaintext: Uint8Array): Buffer {
    const nonce = randomBytes(NONCE_SIZE);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, nonce);
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // nonce || ciphertext || tag  (matches Go's Seal(nonce, ...) layout)
    return Buffer.concat([nonce, enc, tag]);
  }

  /** Decrypt a ciphertext produced by encrypt(). Throws on short input or auth failure. */
  decrypt(ciphertext: Uint8Array): Buffer {
    if (ciphertext.length < NONCE_SIZE + TAG_SIZE) {
      throw new Error('geode: crypto: ciphertext too short');
    }
    const buf = Buffer.from(ciphertext);
    const nonce = buf.subarray(0, NONCE_SIZE);
    const tag = buf.subarray(buf.length - TAG_SIZE);
    const data = buf.subarray(NONCE_SIZE, buf.length - TAG_SIZE);
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, nonce);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (err) {
      throw new Error(`geode: crypto: decrypt: ${(err as Error).message}`, { cause: err });
    }
  }

  /** Encrypt a string, returning a base64-encoded result. */
  encryptString(plaintext: string): string {
    return this.encrypt(Buffer.from(plaintext, 'utf8')).toString('base64');
  }

  /** Base64-decode and decrypt, returning the original string. */
  decryptString(encoded: string): string {
    const ct = Buffer.from(encoded, 'base64');
    return this.decrypt(ct).toString('utf8');
  }

  /**
   * Compute HMAC-SHA256 of `data` using the derived HMAC key, returning a
   * 64-char lowercase hex digest. Deterministic; use for equality lookups on
   * encrypted fields.
   */
  hmacHex(data: string): string {
    return createHmac('sha256', this.hmacKey).update(data, 'utf8').digest('hex');
  }
}

/** Derive a KEY_SIZE-byte key from masterKey via HKDF-SHA256 (no salt, info label). */
function deriveKey(masterKey: Uint8Array, info: string): Buffer {
  // hkdfSync(digest, ikm, salt, info, keylen) -> ArrayBuffer
  const out = hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(info, 'utf8'), KEY_SIZE);
  return Buffer.from(out);
}

/** Create a GeodeCipher from a master key (>= 32 bytes). */
export function createCipher(masterKey: Uint8Array): GeodeCipher {
  return new GeodeCipher(masterKey);
}
