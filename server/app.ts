/**
 * REST API. All state changes go through POST /api/worlds/:id/actions,
 * which is validated (zod shape + engine domain rules), authorized by world
 * role, and persisted atomically by WorldService.
 */
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import type { DB } from './db';
import { audit } from './db';
import { SESSION_COOKIE, authenticate, checkLoginRate, createSession, destroySession, hashPassword, registerUser, requireUser, resetLoginRate, sessionMiddleware, verifyPassword } from './auth';
import { HttpError, WorldService } from './worlds';
import { catalog, worldView } from './view';
import { createDemoWorld } from './demo';
import {
  ACCOUNTS,
  ACTION_TYPES,
  accountActivity,
  advancePreview,
  balanceSheet,
  cashFlowStatement,
  companyInvariants,
  estimateSetup,
  getCompany,
  incomeStatement,
  kpiDetail,
  landedQuote,
  planFeasibility,
  previewTransaction,
  project,
  search,
  tickLabel,
  trialBalance,
  varianceBridge,
  MATERIALS,
  SUPPLIERS,
  DomainError,
} from '../engine/index';
import type { Company, WorldState } from '../engine/index';

export interface AppConfig {
  db: DB;
  sessionTtlHours?: number;
  cookieSecure?: boolean;
  staticDir?: string;
}

const asyncRoute = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = fn(req, res);
    if (r instanceof Promise) r.catch(next);
  } catch (e) {
    next(e);
  }
};

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_REQUEST', r.error.issues);
  return r.data;
}

const money = z.number().int().nonnegative().max(1e15);
const ActionBody = z.object({
  type: z.enum(ACTION_TYPES),
  companyId: z.string().max(40).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(100).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // neutralize spreadsheet formula injection
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function createApp(cfg: AppConfig) {
  const { db } = cfg;
  const ttl = cfg.sessionTtlHours ?? 72;
  const service = new WorldService(db);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware(db));
  // CSRF defence: state-changing API calls must be JSON and, if an Origin is sent, same-origin
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE' });
      const origin = req.get('origin');
      if (origin) {
        const host = req.get('x-forwarded-host') ?? req.get('host');
        try {
          if (new URL(origin).host !== host) return res.status(403).json({ error: 'Cross-origin request blocked', code: 'CSRF' });
        } catch {
          return res.status(403).json({ error: 'Invalid origin', code: 'CSRF' });
        }
      }
    }
    next();
  });

  const setCookie = (res: Response, token: string) => res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: !!cfg.cookieSecure, maxAge: ttl * 3600_000, path: '/' });

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.get('/api/catalog', (_req, res) => res.json(catalog()));

  // ------------------------------------------------------------ auth
  app.post('/api/auth/register', asyncRoute((req, res) => {
    const body = parse(z.object({ email: z.string().email().max(200), name: z.string().trim().min(2).max(80), password: z.string().min(8).max(200) }), req.body);
    const user = registerUser(db, body);
    setCookie(res, createSession(db, user.id, ttl));
    res.status(201).json({ user });
  }));
  app.post('/api/auth/login', asyncRoute((req, res) => {
    const body = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
    const key = `${body.email.toLowerCase()}|${req.ip}`;
    if (!checkLoginRate(key)) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.', 'RATE_LIMITED');
    const user = authenticate(db, body.email, body.password);
    if (!user) {
      audit(db, 'auth.failed', { detail: { email: body.email.toLowerCase() } });
      throw new HttpError(401, 'Email or password is incorrect', 'INVALID_CREDENTIALS');
    }
    resetLoginRate(key);
    audit(db, 'auth.login', { userId: user.id });
    setCookie(res, createSession(db, user.id, ttl));
    res.json({ user });
  }));
  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in', code: 'UNAUTHENTICATED' });
    res.json({ user: req.user });
  });
  app.patch('/api/me', requireUser, asyncRoute((req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), preferences: z.object({ theme: z.enum(['dark', 'light']).optional(), reducedMotion: z.boolean().optional(), enable3d: z.boolean().optional(), compactTables: z.boolean().optional() }).optional() }), req.body);
    const u = req.user!;
    const prefs = { ...u.preferences, ...(body.preferences ?? {}) };
    db.prepare('UPDATE users SET name = ?, preferences = ? WHERE id = ?').run(body.name ?? u.name, JSON.stringify(prefs), u.id);
    res.json({ user: { ...u, name: body.name ?? u.name, preferences: prefs } });
  }));
  app.post('/api/me/password', requireUser, asyncRoute((req, res) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(8).max(200) }), req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!verifyPassword(body.current, row.password_hash)) throw new HttpError(422, 'Current password is incorrect', 'INVALID_CREDENTIALS');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.next), req.user!.id);
    // revoke other sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user!.id);
    setCookie(res, createSession(db, req.user!.id, ttl));
    audit(db, 'auth.password_changed', { userId: req.user!.id });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ worlds
  app.get('/api/worlds', requireUser, (req, res) => res.json({ worlds: service.list(req.user!.id) }));
  app.post('/api/worlds', requireUser, asyncRoute((req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(2).max(60), seed: z.number().int().min(1).max(2 ** 31 - 1).optional(), demo: z.boolean().optional(), industry: z.enum(['electronics', 'ev', 'food']).optional(), scriptedEvents: z.boolean().optional(), eventFrequency: z.enum(['low', 'normal', 'high']).optional(), startYear: z.number().int().min(2020).max(2100).optional() }), req.body);
    if (body.demo) {
      const r = createDemoWorld(service, req.user!.id, body.industry ?? 'electronics');
      return res.status(201).json(r);
    }
    const w = service.create(req.user!.id, { name: body.name, seed: body.seed ?? Math.floor(Math.random() * 2 ** 31), scriptedEvents: body.scriptedEvents ?? true, eventFrequency: body.eventFrequency ?? 'normal', startYear: body.startYear });
    res.status(201).json({ worldId: w.id });
  }));
  app.delete('/api/worlds/:id', requireUser, asyncRoute((req, res) => {
    const body = parse(z.object({ confirmName: z.string() }), req.body);
    service.delete(String(req.params.id), req.user!.id, body.confirmName);
    res.json({ ok: true });
  }));

  const ctx = (req: Request, roles: ('owner' | 'manager' | 'analyst')[] = ['owner', 'manager', 'analyst']) => {
    const worldId = String(req.params.id);
    const role = service.requireRole(worldId, req.user!.id, roles);
    const world = service.load(worldId);
    return { worldId, role, world };
  };
  const companyOf = (world: WorldState, id: unknown): Company => {
    try {
      return getCompany(world, String(id));
    } catch {
      throw new HttpError(404, 'Company not found', 'NOT_FOUND');
    }
  };
  const tickRange = (req: Request, world: WorldState, company: Company) => {
    const last = Math.max(company.foundedTick, world.tick - 1);
    const from = req.query.from !== undefined ? Number(req.query.from) : last;
    const to = req.query.to !== undefined ? Number(req.query.to) : last;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || from < 0) throw new HttpError(400, 'Invalid period', 'BAD_REQUEST');
    return { from, to: Math.min(to, world.tick) };
  };

  app.get('/api/worlds/:id/view', requireUser, asyncRoute((req, res) => {
    const { worldId, role, world } = ctx(req);
    res.json(worldView(world, req.query.companyId ? String(req.query.companyId) : undefined, role, service.version(worldId)));
  }));

  app.post('/api/worlds/:id/actions', requireUser, asyncRoute((req, res) => {
    const worldId = String(req.params.id);
    const body = parse(ActionBody, req.body);
    const r = service.execute(worldId, req.user!.id, { type: body.type, companyId: body.companyId, payload: body.payload }, body.idempotencyKey, body.expectedVersion);
    res.status(r.replayed ? 200 : 201).json(r);
  }));

  app.get('/api/worlds/:id/companies/:cid/advance-preview', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    res.json(advancePreview(world, companyOf(world, req.params.cid)));
  }));

  app.get('/api/worlds/:id/companies/:cid/statements', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    const { from, to } = tickRange(req, world, c);
    res.json({ from, to, fromLabel: tickLabel(world, from), toLabel: tickLabel(world, to), income: incomeStatement(c, from, to), balance: balanceSheet(c, to), cashFlow: cashFlowStatement(c, from, to), trialBalance: trialBalance(c, to), invariants: companyInvariants(c) });
  }));

  app.get('/api/worlds/:id/companies/:cid/ledger', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    const q = String(req.query.q ?? '').toLowerCase();
    const account = req.query.account ? String(req.query.account) : '';
    const source = req.query.source ? String(req.query.source) : '';
    const from = req.query.from !== undefined ? Number(req.query.from) : 0;
    const to = req.query.to !== undefined ? Number(req.query.to) : world.tick;
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    if (account && !ACCOUNTS[account]) throw new HttpError(400, 'Unknown account', 'BAD_REQUEST');
    let entries = c.journal.filter((e) => e.tick >= from && e.tick <= to);
    if (account) entries = entries.filter((e) => e.lines.some((l) => l.account === account));
    if (source) entries = entries.filter((e) => e.source.type === source || e.source.id === source);
    if (q) entries = entries.filter((e) => e.id.toLowerCase().includes(q) || e.memo.toLowerCase().includes(q) || e.source.id.toLowerCase().includes(q));
    entries = [...entries].reverse();
    if (req.query.format === 'csv') {
      res.type('text/csv').attachment(`ledger-${c.id}.csv`);
      return res.send(toCsv(entries.flatMap((e) => e.lines.map((l) => ({ entry: e.id, month: tickLabel(world, e.tick), memo: e.memo, source: `${e.source.type}:${e.source.id}`, account: l.account, account_name: ACCOUNTS[l.account].name, debit_inr: (l.debit / 100).toFixed(2), credit_inr: (l.credit / 100).toFixed(2), status: e.status })))));
    }
    res.json({ total: entries.length, entries: entries.slice(offset, offset + limit).map((e) => ({ ...e, monthLabel: tickLabel(world, e.tick) })) });
  }));

  app.get('/api/worlds/:id/companies/:cid/account/:code', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    const code = String(req.params.code);
    if (!ACCOUNTS[code]) throw new HttpError(404, 'Unknown account', 'NOT_FOUND');
    const rows = accountActivity(c, code).reverse().slice(0, 300).map((r) => ({ entryId: r.entry.id, month: tickLabel(world, r.entry.tick), memo: r.entry.memo, debit: r.debit, credit: r.credit, source: r.entry.source }));
    res.json({ account: ACCOUNTS[code], rows });
  }));

  app.get('/api/worlds/:id/companies/:cid/kpi/:key', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const d = kpiDetail(world, companyOf(world, req.params.cid), String(req.params.key));
    if (!d) throw new HttpError(404, 'Unknown KPI', 'NOT_FOUND');
    res.json(d);
  }));

  app.get('/api/worlds/:id/companies/:cid/variance', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    const to = req.query.to !== undefined ? Number(req.query.to) : world.tick - 1;
    res.json({ bridge: varianceBridge(world, c, to) });
  }));

  app.get('/api/worlds/:id/companies/:cid/movements', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    let rows = [...c.movements].reverse();
    if (req.query.item) rows = rows.filter((m) => m.itemId === req.query.item);
    if (req.query.kind) rows = rows.filter((m) => m.kind === req.query.kind);
    const limit = Math.min(300, Number(req.query.limit ?? 100));
    const mapped = rows.map((m) => ({ ...m, month: tickLabel(world, m.tick), itemName: m.kind === 'raw' ? MATERIALS[m.itemId]?.name : c.products.find((p) => p.id === m.itemId)?.name }));
    if (req.query.format === 'csv') {
      res.type('text/csv').attachment(`inventory-movements-${c.id}.csv`);
      return res.send(toCsv(mapped.map((m) => ({ id: m.id, month: m.month, kind: m.kind, item: m.itemName, qty: m.qty, value_inr: (m.value / 100).toFixed(2), reason: m.reason, ref: m.refId }))));
    }
    res.json({ total: mapped.length, rows: mapped.slice(0, limit) });
  }));

  app.get('/api/worlds/:id/companies/:cid/forecast', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const months = Math.min(12, Math.max(1, Number(req.query.months ?? 6)));
    res.json(project(world, String(req.params.cid), months));
  }));

  const ScenarioBody = z.object({
    months: z.number().int().min(1).max(12).default(6),
    changes: z.object({
      priceChangePct: z.number().min(-50).max(100).optional(),
      marketingExtra: money.optional(),
      productionChangePct: z.number().min(-100).max(100).optional(),
      tariffShock: z.object({ country: z.enum(['CN', 'US', 'DE', 'AE', 'VN']), add: z.number().min(-0.3).max(0.5) }).optional(),
      energyShortage: z.boolean().optional(),
      demandShockPct: z.number().min(-60).max(60).optional(),
      rupeeShockPct: z.number().min(-30).max(30).optional(),
      portStrikeRoute: z.enum(['CN-CHE', 'VN-CHE', 'DE-MUM', 'US-MUM', 'AE-MUM']).optional(),
    }),
  });
  app.post('/api/worlds/:id/companies/:cid/scenario', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    companyOf(world, req.params.cid);
    const body = parse(ScenarioBody, req.body);
    const baseline = project(world, String(req.params.cid), body.months);
    const scenario = project(world, String(req.params.cid), body.months, body.changes);
    res.json({ baseline, scenario });
  }));

  app.post('/api/worlds/:id/companies/:cid/plan-preview', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    const body = parse(z.object({ lineId: z.string(), plannedUnits: z.number().int().min(0).max(10_000_000), productId: z.string().nullable().optional(), overtime: z.boolean().optional() }), req.body);
    const before = planFeasibility(world, c);
    let w = world;
    let cc = c;
    if (body.overtime !== undefined && body.overtime !== c.overtime) {
      w = structuredClone(world);
      cc = getCompany(w, c.id);
      cc.overtime = body.overtime;
    }
    const order = (x: { lineId: string }[]) => [...x].sort((a, b) => c.lines.findIndex((l) => l.id === a.lineId) - c.lines.findIndex((l) => l.id === b.lineId));
    const after = order(planFeasibility(w, cc, { [body.lineId]: { plannedUnits: body.plannedUnits, productId: body.productId } }, true, body.lineId)) as typeof before;
    res.json({ before, after });
  }));

  app.post('/api/worlds/:id/companies/:cid/quote', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    const body = parse(z.object({ supplierId: z.string(), materialId: z.string(), qty: z.number().int().positive().max(100_000_000), expedited: z.boolean().optional() }), req.body);
    if (!SUPPLIERS[body.supplierId] || !SUPPLIERS[body.supplierId].materials.includes(body.materialId)) throw new HttpError(400, 'Supplier does not offer this material', 'BAD_REQUEST');
    res.json(landedQuote(world, c, body.supplierId, body.materialId, body.qty, body.expedited));
  }));

  app.post('/api/worlds/:id/companies/:cid/transaction-preview', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const c = companyOf(world, req.params.cid);
    const body = parse(z.object({ kind: z.enum(['equity_round', 'term_loan', 'loan_prepayment', 'facility_build', 'facility_upgrade', 'deposit_open', 'deposit_withdraw']), terms: z.record(z.string(), z.union([z.string(), z.number()])) }), req.body);
    try {
      res.json({ ok: true, ...previewTransaction(world, c, body.kind, body.terms) });
    } catch (e) {
      if (e instanceof DomainError) return res.json({ ok: false, error: e.message, code: e.code });
      throw e;
    }
  }));

  app.post('/api/worlds/:id/setup-estimate', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const b = req.body ?? {};
    try {
      res.json({ ok: true, estimate: estimateSetup(world, { ...b, founderCapital: Number(b.founderCapital ?? 0), openingLoan: Number(b.openingLoan ?? 0), products: Array.isArray(b.products) ? b.products : [] }) });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  }));

  app.get('/api/worlds/:id/search', requireUser, asyncRoute((req, res) => {
    const { world } = ctx(req);
    const company = req.query.companyId ? world.companies.find((c) => c.id === req.query.companyId) ?? null : null;
    res.json({ results: search(world, company, String(req.query.q ?? '').slice(0, 80)) });
  }));

  app.get('/api/worlds/:id/audit', requireUser, asyncRoute((req, res) => {
    const { worldId } = ctx(req);
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    res.json(service.actions(worldId, { limit, offset, status: req.query.status ? String(req.query.status) : undefined }));
  }));

  app.post('/api/worlds/:id/verify-replay', requireUser, asyncRoute((req, res) => {
    const { worldId } = ctx(req);
    res.json(service.verifyReplay(worldId));
  }));

  app.get('/api/worlds/:id/members', requireUser, asyncRoute((req, res) => {
    const { worldId } = ctx(req);
    res.json({ members: service.members(worldId) });
  }));
  app.post('/api/worlds/:id/members', requireUser, asyncRoute((req, res) => {
    const body = parse(z.object({ email: z.string().email(), role: z.enum(['manager', 'analyst']) }), req.body);
    service.addMember(String(req.params.id), req.user!.id, body.email, body.role);
    res.status(201).json({ members: service.members(String(req.params.id)) });
  }));
  app.delete('/api/worlds/:id/members/:uid', requireUser, asyncRoute((req, res) => {
    service.removeMember(String(req.params.id), req.user!.id, String(req.params.uid));
    res.json({ members: service.members(String(req.params.id)) });
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

  if (cfg.staticDir && fs.existsSync(cfg.staticDir)) {
    app.use(express.static(cfg.staticDir, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(cfg.staticDir!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    const e = err as { status?: number; code?: string; message?: string; type?: string };
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON', code: 'BAD_REQUEST' });
    if (e?.status && e.status < 500) return res.status(e.status).json({ error: e.message, code: e.code ?? 'ERROR' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
  });

  return { app, service };
}
