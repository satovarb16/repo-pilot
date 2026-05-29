import { describe, it, expect } from 'vitest';
import { isBlocklisted } from './blocklist.js';

describe('isBlocklisted', () => {
  it('blocks .env files', () => {
    expect(isBlocklisted('.env')).toBe(true);
    expect(isBlocklisted('.env.local')).toBe(true);
    expect(isBlocklisted('.env.production')).toBe(true);
  });

  it('blocks private key files', () => {
    expect(isBlocklisted('id_rsa')).toBe(true);
    expect(isBlocklisted('id_ed25519')).toBe(true);
    expect(isBlocklisted('id_dsa')).toBe(true);
  });

  it('blocks certificate and key extensions', () => {
    expect(isBlocklisted('server.pem')).toBe(true);
    expect(isBlocklisted('cert.key')).toBe(true);
    expect(isBlocklisted('keystore.p12')).toBe(true);
    expect(isBlocklisted('keystore.pfx')).toBe(true);
    expect(isBlocklisted('android.keystore')).toBe(true);
  });

  it('blocks known secrets files', () => {
    expect(isBlocklisted('secrets.json')).toBe(true);
    expect(isBlocklisted('credentials.json')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(isBlocklisted('index.ts')).toBe(false);
    expect(isBlocklisted('package.json')).toBe(false);
    expect(isBlocklisted('README.md')).toBe(false);
    expect(isBlocklisted('.eslintrc')).toBe(false);
  });

  it('checks only the basename, not the full path', () => {
    expect(isBlocklisted('/some/path/to/.env')).toBe(true);
    expect(isBlocklisted('/some/path/to/index.ts')).toBe(false);
  });
});
