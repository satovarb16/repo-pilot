import path from 'node:path';

const BLOCKED_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^id_dsa$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /^secrets\.json$/,
  /^credentials\.json$/,
];

export function isBlocklisted(filePath: string): boolean {
  const base = path.basename(filePath);
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(base));
}
