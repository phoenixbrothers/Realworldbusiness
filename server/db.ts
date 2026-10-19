/**
 * SQLite persistence (Node's built-in node:sqlite, no native build step).
 * Migrations are versioned and applied in order on startup.
 *
 * Tables
 *  users          accounts (scrypt password hashes)
 *  sessions       hashed session tokens with expiry
 *  worlds         authoritative world state (JSON) + optimistic-lock version
 *  world_members  per-world role: owner | manager | analyst
 *  world_actions  append-only command log (accepted and rejected) used for audit and deterministic replay
 *  audit_log      security-relevant events (logins, membership changes, deletions)
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        preferences TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE TABLE worlds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id),
        seed INTEGER NOT NULL,
        create_params TEXT NOT NULL,
        ruleset TEXT NOT NULL,
        tick INTEGER NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE world_members (
        world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner','manager','analyst')),
        added_at TEXT NOT NULL,
        PRIMARY KEY (world_id, user_id)
      );
      CREATE TABLE world_actions (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
        seq INTEGER,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        company_id TEXT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted','rejected')),
        error_code TEXT,
        error TEXT,
        effects TEXT NOT NULL DEFAULT '[]',
        tick_before INTEGER NOT NULL,
        tick_after INTEGER NOT NULL,
        idempotency_key TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_actions_seq ON world_actions(world_id, seq) WHERE seq IS NOT NULL;
      CREATE UNIQUE INDEX idx_actions_idem ON world_actions(world_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX idx_actions_world ON world_actions(world_id, created_at);
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        world_id TEXT,
        event TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `,
  },
];

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DB): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  const current = row.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return MIGRATIONS[MIGRATIONS.length - 1].version;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db: DB, event: string, opts: { userId?: string | null; worldId?: string | null; detail?: unknown } = {}): void {
  db.prepare('INSERT INTO audit_log (user_id, world_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(opts.userId ?? null, opts.worldId ?? null, event, JSON.stringify(opts.detail ?? {}), new Date().toISOString());
}
