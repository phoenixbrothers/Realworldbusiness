/**
 * Email + password authentication with server-side sessions.
 *  - Passwords: scrypt with per-user random salt (N=16384, r=8, p=1).
 *  - Sessions: 32-byte random token in an httpOnly SameSite=Lax cookie;
 *    only its SHA-256 hash is stored, so a database leak does not expose live sessions.
 *  - Login attempts are rate-limited per email + IP.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DB } from './db';
import { audit } from './db';

export const SESSION_COOKIE = 'rw_session';

export interface User {
  id: string;
  email: string;
  name: string;
  preferences: Record<string, unknown>;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: string, ttlHours: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, Date.now() + ttlHours * 3600_000, new Date().toISOString());
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return token;
}

export function destroySession(db: DB, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function userFromToken(db: DB, token: string | undefined): User | null {
  if (!token) return null;
  const row = db.prepare('SELECT u.id, u.email, u.name, u.preferences, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha256(token)) as
    | { id: string; email: string; name: string; preferences: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email, name: row.name, preferences: JSON.parse(row.preferences) };
}

export function registerUser(db: DB, input: { email: string; name: string; password: string }): User {
  const email = input.email.trim().toLowerCase();
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) throw Object.assign(new Error('An account with this email already exists'), { status: 409, code: 'EMAIL_TAKEN' });
  const id = `usr_${crypto.randomUUID()}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash, preferences, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, email, input.name.trim(), hashPassword(input.password), JSON.stringify({ theme: 'dark', reducedMotion: false, enable3d: true }), new Date().toISOString());
  audit(db, 'user.registered', { userId: id });
  return { id, email, name: input.name.trim(), preferences: { theme: 'dark', reducedMotion: false, enable3d: true } };
}

const attempts = new Map<string, { count: number; reset: number }>();

export function checkLoginRate(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { count: 1, reset: now + 15 * 60_000 });
    return true;
  }
  a.count += 1;
  return a.count <= 10;
}

export function resetLoginRate(key: string): void {
  attempts.delete(key);
}

export function authenticate(db: DB, email: string, password: string): User | null {
  const row = db.prepare('SELECT id, email, name, password_hash, preferences FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
    | { id: string; email: string; name: string; password_hash: string; preferences: string }
    | undefined;
  if (!row) {
    // equalize timing for unknown accounts
    verifyPassword(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64'));
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name, preferences: JSON.parse(row.preferences) };
}

export function sessionMiddleware(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = userFromToken(db, req.cookies?.[SESSION_COOKIE]);
    if (user) req.user = user;
    next();
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
    return;
  }
  next();
}
