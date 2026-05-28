import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export class EncryptionService {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new EncryptionError(
        'TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
      );
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Layout: iv (12) | authTag (16) | ciphertext
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    try {
      const buf = Buffer.from(ciphertext, 'base64');
      if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
        throw new EncryptionError('Ciphertext is too short to be valid');
      }
      const iv = buf.subarray(0, IV_BYTES);
      const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
      const encrypted = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch (err) {
      if (err instanceof EncryptionError) throw err;
      throw new EncryptionError('Failed to decrypt: ciphertext may be tampered or invalid');
    }
  }
}
