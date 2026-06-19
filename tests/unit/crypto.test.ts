import { describe, it, expect } from 'vitest';
import { createCipher } from '../../src/crypto.js';

const testKey = Buffer.alloc(32, 'k');

describe('createCipher', () => {
  it('creates a cipher from a 32-byte key', () => {
    expect(createCipher(testKey)).toBeDefined();
  });

  it('throws for a short key', () => {
    expect(() => createCipher(Buffer.from('short'))).toThrow();
  });

  it('throws for an empty key', () => {
    expect(() => createCipher(Buffer.alloc(0))).toThrow();
  });
});

describe('encrypt/decrypt', () => {
  it('round-trips binary data', () => {
    const c = createCipher(testKey);
    const pt = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    const ct = c.encrypt(pt);
    expect(c.decrypt(ct).equals(pt)).toBe(true);
  });

  it('prepends a 12-byte nonce (ciphertext longer than plaintext)', () => {
    const c = createCipher(testKey);
    const pt = Buffer.from('hello');
    const ct = c.encrypt(pt);
    // nonce(12) + plaintext(5) + GCM tag(16) = 33
    expect(ct.length).toBe(12 + pt.length + 16);
  });

  it('produces different ciphertext each call (random nonce)', () => {
    const c = createCipher(testKey);
    const pt = Buffer.from('hello');
    expect(c.encrypt(pt).equals(c.encrypt(pt))).toBe(false);
  });

  it('throws when ciphertext is too short', () => {
    const c = createCipher(testKey);
    expect(() => c.decrypt(Buffer.alloc(5))).toThrow();
  });

  it('throws when authentication fails (tampered ciphertext)', () => {
    const c = createCipher(testKey);
    const ct = c.encrypt(Buffer.from('hello'));
    ct[ct.length - 1] ^= 0xff;
    expect(() => c.decrypt(ct)).toThrow();
  });
});

describe('encryptString/decryptString', () => {
  it('round-trips a string via base64', () => {
    const c = createCipher(testKey);
    const encoded = c.encryptString('hello, geode!');
    expect(c.decryptString(encoded)).toBe('hello, geode!');
  });

  it('throws on invalid base64 / corrupt input', () => {
    const c = createCipher(testKey);
    expect(() => c.decryptString('!!!not-valid!!!')).toThrow();
  });
});

describe('hmacHex', () => {
  it('returns a 64-char lowercase hex digest', () => {
    const c = createCipher(testKey);
    const h = c.hmacHex('user@example.com');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input and key', () => {
    const c = createCipher(testKey);
    expect(c.hmacHex('x')).toBe(c.hmacHex('x'));
  });

  it('differs for different inputs', () => {
    const c = createCipher(testKey);
    expect(c.hmacHex('a')).not.toBe(c.hmacHex('b'));
  });

  it('differs for different keys', () => {
    const c1 = createCipher(Buffer.alloc(32, 'k'));
    const c2 = createCipher(Buffer.alloc(32, 'j'));
    expect(c1.hmacHex('x')).not.toBe(c2.hmacHex('x'));
  });
});
