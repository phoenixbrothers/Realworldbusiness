/**
 * World service: the only code path that mutates persisted simulation state.
 *
 *   load → structuredClone → engine.applyAction → invariants → atomic write
 *
 * - Writes use optimistic concurrency (version column); a concurrent change
 *   returns 409 instead of silently overwriting.
 * - A client-supplied idempotency key makes retries safe: a repeated key
 *   returns the originally recorded outcome without re-applying.
 * - Accepted actions get a sequence number; replaying them from the stored
 *   creation parameters must reproduce the persisted state exactly.
 */
import crypto from 'node:crypto';
import type { DB } from './db';
import { audit, tx } from './db';
import type { Action, WorldState } from '../engine/index';
import { DomainError, applyAction, createWorld, worldInvariants } from '../engine/index';
import type { CreateWorldInput } from '../engine/simulation';

export type Role = 'owner' | 'manager' | 'analyst';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Cached {
  version: number;
  state: WorldState;
}

export class WorldService {
  private cache = new Map<string, Cached>();
  constructor(private db: DB) {}

  role(worldId: string, userId: string): Role | null {
    const r = this.db.prepare('SELECT role FROM world_members WHERE world_id = ? AND user_id = ?').get(worldId, userId) as { role: Role } | undefined;
    return r?.role ?? null;
  }

  requireRole(worldId: string, userId: string, allowed: Role[]): Role {
    const exists = this.db.prepare('SELECT 1 FROM worlds WHERE id = ?').get(worldId);
    const role = this.role(worldId, userId);
    // do not reveal whether a world exists to non-members
    if (!exists || !role) throw new HttpError(404, 'World not found', 'NOT_FOUND');
    if (!allowed.includes(role)) throw new HttpError(403, `Your role (${role}) cannot perform this operation`, 'FORBIDDEN');
    return role;
  }

  list(userId: string) {
    return this.db
      .prepare('SELECT w.id, w.name, w.tick, w.is_demo, w.created_at, w.updated_at, m.role, w.state FROM worlds w JOIN world_members m ON m.world_id = w.id WHERE m.user_id = ? ORDER BY w.updated_at DESC')
      .all(userId)
      .map((r: any) => {
        const st = this.load(r.id);
        return { id: r.id, name: r.name, tick: r.tick, isDemo: !!r.is_demo, role: r.role, createdAt: r.created_at, updatedAt: r.updated_at, companies: st.companies.map((c) => ({ id: c.id, name: c.name, industry: c.industry, lifecycle: c.lifecycle })), startYear: st.startYear, startMonth: st.startMonth };
      });
  }

  load(worldId: string): WorldState {
    const row = this.db.prepare('SELECT state, version FROM worlds WHERE id = ?').get(worldId) as { state: string; version: number } | undefined;
    if (!row) throw new HttpError(404, 'World not found', 'NOT_FOUND');
    const c = this.cache.get(worldId);
    if (c && c.version === row.version) return c.state;
    const state = JSON.parse(row.state) as WorldState;
    this.cache.set(worldId, { version: row.version, state });
    return state;
  }

  version(worldId: string): number {
    const row = this.db.prepare('SELECT version FROM worlds WHERE id = ?').get(worldId) as { version: number } | undefined;
    if (!row) throw new HttpError(404, 'World not found', 'NOT_FOUND');
    return row.version;
  }

  create(userId: string, params: Omit<CreateWorldInput, 'id'>, isDemo = false): WorldState {
    const id = `wld_${crypto.randomUUID().slice(0, 12)}`;
    const full: CreateWorldInput = { ...params, id };
    const world = createWorld(full);
    const now = new Date().toISOString();
    tx(this.db, () => {
      this.db.prepare('INSERT INTO worlds (id, name, owner_id, seed, create_params, ruleset, tick, state, version, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)').run(id, world.name, userId, world.seed, JSON.stringify(full), world.ruleset, world.tick, JSON.stringify(world), isDemo ? 1 : 0, now, now);
      this.db.prepare('INSERT INTO world_members (world_id, user_id, role, added_at) VALUES (?, ?, ?, ?)').run(id, userId, 'owner', now);
    });
    audit(this.db, 'world.created', { userId, worldId: id, detail: { seed: world.seed, isDemo } });
    return world;
  }

  delete(worldId: string, userId: string, confirmName: string): void {
    this.requireRole(worldId, userId, ['owner']);
    const w = this.load(worldId);
    if (confirmName !== w.name) throw new HttpError(422, 'Type the world name exactly to confirm deletion', 'CONFIRMATION_REQUIRED');
    this.db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId);
    this.cache.delete(worldId);
    audit(this.db, 'world.deleted', { userId, worldId, detail: { name: w.name } });
  }

  execute(worldId: string, userId: string, action: Action, idempotencyKey?: string, expectedVersion?: number) {
    this.requireRole(worldId, userId, action.type === 'dismiss_alert' || action.type === 'restore_alert' ? ['owner', 'manager', 'analyst'] : ['owner', 'manager']);
    if (idempotencyKey) {
      const prior = this.db.prepare('SELECT * FROM world_actions WHERE world_id = ? AND idempotency_key = ?').get(worldId, idempotencyKey) as any;
      if (prior) {
        return { replayed: true, status: prior.status as 'accepted' | 'rejected', actionId: prior.id, effects: JSON.parse(prior.effects), error: prior.error, code: prior.error_code, data: undefined, version: this.version(worldId) };
      }
    }
    const current = this.load(worldId);
    const version = this.version(worldId);
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw new HttpError(409, 'The world changed since you loaded it. Review the latest state and try again.', 'VERSION_CONFLICT', { version });
    }
    const lastSeq = (this.db.prepare('SELECT MAX(seq) AS s FROM world_actions WHERE world_id = ?').get(worldId) as { s: number | null }).s ?? 0;
    const seq = lastSeq + 1;
    const actionId = `${worldId}:${seq}`;
    const working = structuredClone(current);
    const now = new Date().toISOString();
    const recordRejected = (code: string, message: string) => {
      const id = `${worldId}:r:${crypto.randomUUID().slice(0, 8)}`;
      this.db.prepare('INSERT INTO world_actions (id, world_id, seq, user_id, type, company_id, payload, status, error_code, error, effects, tick_before, tick_after, idempotency_key, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, worldId, userId, action.type, action.companyId ?? null, JSON.stringify(action.payload ?? {}), 'rejected', code, message, '[]', current.tick, current.tick, idempotencyKey ?? null, now);
      return id;
    };
    let result;
    try {
      result = applyAction(working, action, { actionId });
    } catch (e) {
      if (e instanceof DomainError) {
        const id = recordRejected(e.code, e.message);
        throw new HttpError(422, e.message, e.code, { actionId: id });
      }
      throw e;
    }
    const inv = worldInvariants(working);
    if (!inv.ok) {
      const msg = `Rejected: the change would break accounting/operational invariants (${inv.failures.map((f) => f.check.label).join('; ')})`;
      recordRejected('INVARIANT_VIOLATION', msg);
      console.error('[invariant]', worldId, action.type, inv.failures);
      throw new HttpError(500, msg, 'INVARIANT_VIOLATION');
    }
    tx(this.db, () => {
      const r = this.db.prepare('UPDATE worlds SET state = ?, tick = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(JSON.stringify(working), working.tick, now, worldId, version);
      if (Number(r.changes) !== 1) throw new HttpError(409, 'The world was changed by another request. Reload and try again.', 'VERSION_CONFLICT');
      this.db.prepare('INSERT INTO world_actions (id, world_id, seq, user_id, type, company_id, payload, status, error_code, error, effects, tick_before, tick_after, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)').run(actionId, worldId, seq, userId, action.type, action.companyId ?? null, JSON.stringify(action.payload ?? {}), 'accepted', JSON.stringify(result.effects), current.tick, working.tick, idempotencyKey ?? null, now);
    });
    this.cache.set(worldId, { version: version + 1, state: working });
    return { replayed: false, status: 'accepted' as const, actionId, effects: result.effects, data: result.data, version: version + 1 };
  }

  actions(worldId: string, opts: { limit: number; offset: number; status?: string }) {
    const where = opts.status ? 'AND a.status = ?' : '';
    const args: (string | number)[] = [worldId];
    if (opts.status) args.push(opts.status);
    const rows = this.db.prepare(`SELECT a.*, u.name AS user_name FROM world_actions a LEFT JOIN users u ON u.id = a.user_id WHERE a.world_id = ? ${where} ORDER BY a.created_at DESC, a.seq DESC LIMIT ? OFFSET ?`).all(...args, opts.limit, opts.offset) as any[];
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM world_actions a WHERE a.world_id = ? ${where}`).get(...args) as { n: number }).n;
    return { total, rows: rows.map((r) => ({ id: r.id, seq: r.seq, type: r.type, companyId: r.company_id, user: r.user_name, status: r.status, errorCode: r.error_code, error: r.error, effects: JSON.parse(r.effects), payload: JSON.parse(r.payload), tickBefore: r.tick_before, tickAfter: r.tick_after, createdAt: r.created_at })) };
  }

  /** re-run all accepted actions from the creation parameters and compare */
  verifyReplay(worldId: string) {
    const row = this.db.prepare('SELECT create_params FROM worlds WHERE id = ?').get(worldId) as { create_params: string };
    const params = JSON.parse(row.create_params) as CreateWorldInput;
    const replay = createWorld(params);
    const actions = this.db.prepare("SELECT id, type, company_id, payload FROM world_actions WHERE world_id = ? AND status = 'accepted' ORDER BY seq").all(worldId) as any[];
    const started = Date.now();
    for (const a of actions) applyAction(replay, { type: a.type, companyId: a.company_id ?? undefined, payload: JSON.parse(a.payload) }, { actionId: a.id });
    const stored = this.load(worldId);
    const h = (s: unknown) => crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
    const a = h(replay);
    const b = h(stored);
    return { actions: actions.length, match: a === b, replayHash: a.slice(0, 16), storedHash: b.slice(0, 16), ms: Date.now() - started, tick: stored.tick };
  }

  members(worldId: string) {
    return this.db.prepare('SELECT u.id, u.name, u.email, m.role, m.added_at FROM world_members m JOIN users u ON u.id = m.user_id WHERE m.world_id = ? ORDER BY m.added_at').all(worldId);
  }

  addMember(worldId: string, actorId: string, email: string, role: Role) {
    this.requireRole(worldId, actorId, ['owner']);
    if (role === 'owner') throw new HttpError(422, 'A world has exactly one owner', 'VALIDATION');
    const u = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase()) as { id: string } | undefined;
    if (!u) throw new HttpError(404, 'No user with that email. They must register first.', 'USER_NOT_FOUND');
    this.db.prepare('INSERT INTO world_members (world_id, user_id, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(world_id, user_id) DO UPDATE SET role = excluded.role').run(worldId, u.id, role, new Date().toISOString());
    audit(this.db, 'member.upserted', { userId: actorId, worldId, detail: { member: u.id, role } });
  }

  removeMember(worldId: string, actorId: string, memberId: string) {
    this.requireRole(worldId, actorId, ['owner']);
    if (memberId === actorId) throw new HttpError(422, 'The owner cannot be removed', 'VALIDATION');
    this.db.prepare("DELETE FROM world_members WHERE world_id = ? AND user_id = ? AND role != 'owner'").run(worldId, memberId);
    audit(this.db, 'member.removed', { userId: actorId, worldId, detail: { member: memberId } });
  }
}
