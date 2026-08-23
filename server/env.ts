import 'dotenv/config';

/**
 * Centralised environment configuration with fail-fast validation.
 *
 * There are NO hard-coded fallback secrets anywhere in this project.
 * If a required value is missing (or obviously weak) in production the
 * process refuses to start instead of silently degrading.
 */

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;

/** Minimum acceptable JWT secret length (characters). */
const MIN_SECRET_LENGTH = 32;

/**
 * Secrets that must never be used. The first entry was a hard-coded
 * fallback in an earlier revision of this project and is therefore
 * considered public knowledge.
 */
const BANNED_SECRETS = new Set([
  'bhabhi-multiplayer-ultra-secure-jwt-token-key-2026',
  'secret',
  'changeme',
  'change-me',
  'jwt-secret',
  'your-secret-here',
  'development',
]);

function fail(message: string): never {
  console.error('\n[Bhabhi Config] FATAL CONFIGURATION ERROR');
  console.error(`[Bhabhi Config] ${message}\n`);
  process.exit(1);
}

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    fail(
      'JWT_SECRET is not set.\n' +
        'Set it in your .env file (local) or in your hosting provider dashboard (production).\n' +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }

  if (BANNED_SECRETS.has(secret.toLowerCase())) {
    fail(
      'JWT_SECRET is set to a known/default value that must never be used.\n' +
        'Generate a fresh random secret before starting the server.'
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    fail(
      `JWT_SECRET is too short (${secret.length} chars). At least ${MIN_SECRET_LENGTH} characters are required.\n` +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }

  return secret;
}

export const JWT_SECRET: string = resolveJwtSecret();

/** How long issued session tokens remain valid. */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Number of trusted reverse-proxy hops in front of the app.
 *
 * On Render the chain is:  client -> Cloudflare -> Render proxy -> app
 * giving  X-Forwarded-For: <client>, <cloudflare>, <render-internal>
 *
 * Express counts trusted hops from the RIGHT, so 3 resolves req.ip to the real
 * client. Counting from the right also makes this spoof-resistant: a client
 * that injects its own X-Forwarded-For only prepends entries on the left,
 * which are ignored.
 *
 * Getting this wrong is a security bug, not a cosmetic one — too low and the
 * rate limiter keys on a shared proxy IP, so every user behind that proxy
 * shares one bucket and a single abuser can lock out everyone else.
 */
export const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? (IS_PRODUCTION ? 3 : 0));

/**
 * PostgreSQL connection string.
 *
 * Required in production. In development its absence is tolerated so the
 * game engine can be exercised without a database, but this is announced
 * loudly and never happens silently in production.
 */
export const DATABASE_URL = process.env.DATABASE_URL?.trim() || '';

if (IS_PRODUCTION && !DATABASE_URL) {
  fail(
    'DATABASE_URL is not set. A PostgreSQL database (e.g. Neon) is required in production.\n' +
      'There is no in-memory fallback in production — persistent data would be silently lost.'
  );
}

/**
 * Allowed browser origins for CORS.
 *
 * CLIENT_URL accepts a single origin or a comma-separated list. Arbitrary
 * Origin headers are NEVER reflected back.
 */
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function resolveAllowedOrigins(): string[] {
  const configured = (process.env.CLIENT_URL || '')
    .split(',')
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (IS_PRODUCTION) {
    if (configured.length === 0) {
      fail(
        'CLIENT_URL is not set. In production the frontend origin must be declared explicitly.\n' +
          'Example: CLIENT_URL="https://your-app.vercel.app"'
      );
    }
    if (configured.some(o => o === '*')) {
      fail('CLIENT_URL must not be "*". Wildcard origins are not allowed with credentialed requests.');
    }
    return configured;
  }

  // Development: configured origins plus the usual local dev servers.
  return Array.from(new Set([...configured, ...DEV_ORIGINS]));
}

export const ALLOWED_ORIGINS: string[] = resolveAllowedOrigins();

/**
 * Shared CORS origin check used by both Express and Socket.IO.
 * Requests with no Origin header (curl, health checks, same-origin
 * navigations) are permitted; unknown browser origins are rejected.
 */
export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''));
}

export function logConfigSummary() {
  console.log('[Bhabhi Config] Environment:', NODE_ENV);
  console.log('[Bhabhi Config] Allowed origins:', ALLOWED_ORIGINS.join(', ') || '(none)');
  console.log('[Bhabhi Config] Database:', DATABASE_URL ? 'configured' : 'NOT configured (development only)');
  console.log('[Bhabhi Config] JWT secret: loaded from environment');
}
