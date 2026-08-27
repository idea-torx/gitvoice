const PASSWORD_ITERATIONS = 100_000;
const LEGACY_PASSWORD_ITERATIONS = 120_000;
const PORTAL_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface PortalTokenPayload {
  clientId: string;
  exp: number;
}

export { hashPortalPassword as hashAdminPassword, verifyPortalPassword as verifyAdminPassword };

export async function issueAdminToken(secret: string): Promise<string> {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ purpose: "admin", exp: Date.now() + ADMIN_TOKEN_TTL_MS })));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifyAdminToken(token: string, secret: string): Promise<{ exp: number } | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload, secret);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as { purpose?: string; exp?: number };
    if (parsed.purpose !== "admin" || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { exp: parsed.exp };
  } catch {
    return null;
  }
}

export function generateRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `GV-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

export async function hashPortalPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await derivePassword(password, saltBytes, PASSWORD_ITERATIONS);
  return { hash: bytesToBase64Url(hashBytes), salt: `${PASSWORD_ITERATIONS}.${bytesToBase64Url(saltBytes)}` };
}

export async function verifyPortalPassword(password: string, hash: string, salt: string): Promise<boolean> {
  if (!password || !hash || !salt) return false;
  try {
    const parsed = parsePasswordSalt(salt);
    const derived = await derivePassword(password, parsed.salt, parsed.iterations);
    return constantTimeEqual(bytesToBase64Url(derived), hash);
  } catch {
    return false;
  }
}

export function isPortalPasswordCompatible(hash: string, salt: string): boolean {
  const [iterationValue, encodedSalt] = salt.split(".", 2);
  return Boolean(hash && encodedSalt && /^\d+$/.test(iterationValue) && Number(iterationValue) <= PASSWORD_ITERATIONS);
}

export async function issuePortalToken(clientId: string, secret: string): Promise<string> {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ clientId, exp: Date.now() + PORTAL_TOKEN_TTL_MS })));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifyPortalToken(token: string, secret: string): Promise<PortalTokenPayload | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload, secret);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as Partial<PortalTokenPayload>;
    if (typeof parsed.clientId !== "string" || !parsed.clientId || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { clientId: parsed.clientId, exp: parsed.exp };
  } catch {
    return null;
  }
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

function parsePasswordSalt(value: string): { iterations: number; salt: Uint8Array } {
  const [iterationValue, encodedSalt] = value.split(".", 2);
  if (encodedSalt && /^\d+$/.test(iterationValue)) {
    return { iterations: Math.min(Number(iterationValue), PASSWORD_ITERATIONS), salt: base64UrlToBytes(encodedSalt) };
  }
  return { iterations: LEGACY_PASSWORD_ITERATIONS, salt: base64UrlToBytes(value) };
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

/** Matches the CLI's 29-day token cache, so a machine credential never expires mid-run. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * Session tokens carry no claims: the row in `sessions` is the source of truth, which is what
 * makes them revocable. 256 bits of entropy means there is nothing to brute force.
 */
export function generateSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Plain SHA-256 is right here — the input is already random, so there is no dictionary to slow down. */
export async function hashSessionToken(token: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}
