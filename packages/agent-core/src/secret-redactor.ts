const REDACTED = '[REDACTED]';

// Only redacts env assignments where the key name suggests a secret
const ENV_ASSIGNMENT = /^((?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PAT|DSN|URL|PWD|PASS|API)[A-Z0-9_]*|DATABASE_URL|ANTHROPIC_API_KEY|TOKEN_ENCRYPTION_KEY)=)(\S+)$/gm;

// GitHub tokens
const GITHUB_PAT = /ghp_[A-Za-z0-9]{20,}/g;

// AWS
const AWS_ACCESS_KEY = /AKIA[0-9A-Z]{16}/g;

// Azure SAS token sig parameter
const AZURE_SAS_SIG = /([\?&]sig=)[^&\s"']*/gi;

// Azure connection string AccountKey
const AZURE_ACCOUNT_KEY = /(AccountKey=)[^;"\s]*/gi;
const GITHUB_FINE_GRAINED = /github_pat_[A-Za-z0-9_]{20,}/g;

// Anthropic API keys
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9\-_]{20,}/g;

// Bearer tokens in Authorization headers
const BEARER_TOKEN = /(Authorization:\s*Bearer\s+)\S+/gi;

// PEM private key blocks (RSA, EC, PKCS8, etc.)
const PEM_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;

// Phase 5 T02 — additional patterns

// Stripe live secret key (at least 20 alphanum chars after prefix)
const STRIPE_LIVE = /sk_live_[A-Za-z0-9]{20,}/g;

// JWT (3-part base64url: eyJ.eyJ.*)
// Requires both header and payload to start with eyJ to avoid false positives
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// npm auth token (exactly 36 alphanum chars after npm_)
const NPM_TOKEN = /npm_[A-Za-z0-9]{36}/g;

// SendGrid API key (SG. + 22 alphanum + . + 43 alphanum)
const SENDGRID_KEY = /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g;

// Twilio: SK or AC prefix + exactly 32 hex chars
const TWILIO = /(SK|AC)[0-9a-fA-F]{32}/g;

// GCP SA JSON private_key field: captures prefix and suffix to preserve JSON structure
const GCP_PRIVATE_KEY = /("private_key"\s*:\s*")(?:\\n|[^"])+(")/g;

export class SecretRedactor {
  redact(text: string): string {
    return text
      .replace(PEM_BLOCK, REDACTED)
      .replace(GCP_PRIVATE_KEY, `$1${REDACTED}$2`)
      .replace(BEARER_TOKEN, `$1${REDACTED}`)
      .replace(GITHUB_PAT, REDACTED)
      .replace(GITHUB_FINE_GRAINED, REDACTED)
      .replace(ANTHROPIC_KEY, REDACTED)
      .replace(AWS_ACCESS_KEY, REDACTED)
      .replace(AZURE_SAS_SIG, `$1${REDACTED}`)
      .replace(AZURE_ACCOUNT_KEY, `$1${REDACTED}`)
      .replace(STRIPE_LIVE, REDACTED)
      .replace(JWT, REDACTED)
      .replace(NPM_TOKEN, REDACTED)
      .replace(SENDGRID_KEY, REDACTED)
      .replace(TWILIO, REDACTED)
      .replace(ENV_ASSIGNMENT, `$1${REDACTED}`);
  }
}
