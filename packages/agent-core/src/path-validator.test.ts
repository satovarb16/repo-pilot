import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PathValidator, PathValidationError } from './path-validator.js';

describe('PathValidator', () => {
  const repoRoot = path.join(path.sep === '\\' ? 'C:\\tmp' : '/tmp', 'repo-pilot', 'clones', 'my-repo');
  const validator = new PathValidator(repoRoot);

  describe('validate()', () => {
    it('accepts a path inside the repo root', () => {
      expect(() => validator.validate('src/index.ts')).not.toThrow();
    });

    it('returns the resolved absolute path', () => {
      const result = validator.validate('src/index.ts');
      expect(result).toBe(path.join(repoRoot, 'src', 'index.ts'));
    });

    it('accepts a nested path inside the repo root', () => {
      expect(() => validator.validate('packages/agent-core/src/index.ts')).not.toThrow();
    });

    it('rejects a path traversal with ../', () => {
      expect(() => validator.validate('../../etc/passwd')).toThrow(PathValidationError);
    });

    it('rejects a path that resolves outside the repo root', () => {
      expect(() => validator.validate('../other-repo/secret.ts')).toThrow(PathValidationError);
    });

    it('rejects an absolute path outside the repo root', () => {
      const outsidePath = path.sep === '\\' ? 'C:\\Windows\\System32' : '/etc/passwd';
      expect(() => validator.validate(outsidePath)).toThrow(PathValidationError);
    });

    it('rejects an absolute path to a sensitive directory', () => {
      const sensitivePath = path.sep === '\\' ? 'C:\\Users\\Administrator\\.ssh\\id_rsa' : '/root/.ssh/id_rsa';
      expect(() => validator.validate(sensitivePath)).toThrow(PathValidationError);
    });

    it('accepts an absolute path that is inside the repo root', () => {
      expect(() =>
        validator.validate(path.join(repoRoot, 'src', 'index.ts'))
      ).not.toThrow();
    });

    it('rejects an empty path', () => {
      expect(() => validator.validate('')).toThrow(PathValidationError);
    });

    it('rejects a path targeting the repo root itself', () => {
      expect(() => validator.validate('.')).toThrow(PathValidationError);
    });
  });

  describe('PathValidationError', () => {
    it('is an instance of Error', () => {
      const err = new PathValidationError('bad path', '/bad');
      expect(err).toBeInstanceOf(Error);
    });

    it('exposes the attempted path', () => {
      const err = new PathValidationError('bad path', '/bad');
      expect(err.attemptedPath).toBe('/bad');
    });
  });
});
