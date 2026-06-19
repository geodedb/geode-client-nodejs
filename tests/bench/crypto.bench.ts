import { describe, bench } from 'vitest';
import { createCipher } from '../../src/crypto.js';

const cipher = createCipher(Buffer.alloc(32, 'k'));
const small = Buffer.from('user@example.com');
const large = Buffer.alloc(4096, 0x61);
const encodedSmall = cipher.encryptString('user@example.com');

describe('Crypto FLE Benchmarks', () => {
  bench('encrypt 16B', () => {
    cipher.encrypt(small);
  });

  bench('encrypt 4KB', () => {
    cipher.encrypt(large);
  });

  bench('encryptString', () => {
    cipher.encryptString('user@example.com');
  });

  bench('decryptString', () => {
    cipher.decryptString(encodedSmall);
  });

  bench('hmacHex', () => {
    cipher.hmacHex('user@example.com');
  });
});
