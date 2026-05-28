import path from 'node:path';

export class PathValidationError extends Error {
  readonly attemptedPath: string;

  constructor(message: string, attemptedPath: string) {
    super(message);
    this.name = 'PathValidationError';
    this.attemptedPath = attemptedPath;
  }
}

export class PathValidator {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    // Normalize once so comparisons are consistent
    this.repoRoot = path.resolve(repoRoot);
  }

  /**
   * Resolves `filePath` relative to repoRoot and verifies it stays inside.
   * Returns the absolute path on success, throws PathValidationError otherwise.
   */
  validate(filePath: string): string {
    if (!filePath) {
      throw new PathValidationError('Path must not be empty', filePath);
    }

    const resolved = path.resolve(this.repoRoot, filePath);

    // Must be strictly inside repoRoot, not equal to it
    const relative = path.relative(this.repoRoot, resolved);
    const escapes =
      relative === '' ||
      relative.startsWith('..') ||
      path.isAbsolute(relative);

    if (escapes) {
      throw new PathValidationError(
        `Path "${filePath}" resolves outside the repository root`,
        resolved,
      );
    }

    return resolved;
  }
}
