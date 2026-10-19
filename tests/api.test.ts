import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb } from '../server/db';
import { createApp } from '../server/app';

const db = openDb(':memory:');
const { app } = createApp({ db });

async function signUp(email: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/register').send({ email, name: 'Tester', password: 'correct-horse-1' });
  expect(r.status).toBe(201);
  return agent;
}

describe('auth', () => {
  it('registers, rejects bad passwords, logs out', async () => {
    const a = await signUp('a@example.com');
    expect((await a.get('/api/me')).body.user.email).toBe('a@example.com');
    const bad = await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'nope' });
    expect(bad.status).toBe(401);
    await a.post('/api/auth/logout').send({});
    expect((await a.get('/api/me')).status).toBe(401);
    const dup = await request(app).post('/api/auth/register').send({ email: 'A@example.com', name: 'Xavier', password: 'correct-horse-1' });
    expect(dup.status).toBe(409);
  });

  it('requires a session for world APIs and JSON for mutations', async () => {
    expect((await request(app).get('/api/worlds')).status).toBe(401);
    const a = await signUp('b@example.com');
    const r = await a.post('/api/worlds').set('Content-Type', 'text/plain').send('name=x');
    expect(r.status).toBe(415);
  });

  it('blocks cross-origin mutations', async () => {
    const a = await signUp('csrf@example.com');
    const r = await a.post('/api/worlds').set('Origin', 'https://evil.example').send({ name: 'Nope' });
    expect(r.status).toBe(403);
  });
});

describe('worlds, actions and persistence', () => {
  let owner: ReturnType<typeof request.agent>;
  let worldId = '';
  let companyId = '';
  beforeAll(async () => {
    owner = await signUp('owner@example.com');
    const r = await owner.post('/api/worlds').send({ name: 'API world', seed: 99 });
    worldId = r.body.worldId;
  });

  const act = (type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => owner.post(`/api/worlds/${worldId}/actions`).send({ type, companyId, payload, ...extra });

  it('creates a company through the action pipeline and persists it', async () => {
    const r = await act('create_company', { name: 'Persisted Co', brand: 'Pers', industry: 'food', city: 'Coimbatore', strategy: 'focus', founderName: 'F', founderCapital: 10_00_00_000 * 100, openingLoan: 0, factoryMode: 'lease', warehouseMode: 'lease', rndLab: false, products: ['koozh_classic'] });
    expect(r.status).toBe(201);
    companyId = r.body.data.companyId;
    // a brand-new app instance on the same database sees the same company (survives restart/refresh)
    const { app: app2 } = createApp({ db });
    const login = request.agent(app2);
    await login.post('/api/auth/login').send({ email: 'owner@example.com', password: 'correct-horse-1' });
    const v = await login.get(`/api/worlds/${worldId}/view?companyId=${companyId}`);
    expect(v.status).toBe(200);
    expect(v.body.company.name).toBe('Persisted Co');
    expect(v.body.company.computed.kpis.length).toBeGreaterThan(4);
  });

  it('rejects domain-invalid actions with 422 and records them in the audit log', async () => {
    const r = await act('set_production_plan', { lineId: 'LINE-99999', plannedUnits: 10 });
    expect(r.status).toBe(422);
    const audit = await owner.get(`/api/worlds/${worldId}/audit?status=rejected`);
    expect(audit.body.rows.some((x: any) => x.type === 'set_production_plan')).toBe(true);
  });

  it('validates request shape', async () => {
    const r = await owner.post(`/api/worlds/${worldId}/actions`).send({ type: 'drop_tables', payload: {} });
    expect(r.status).toBe(400);
  });

  it('idempotency keys prevent double application', async () => {
    const key = 'po-retry-0001';
    const r1 = await act('place_po', { supplierId: 's_madurai', materialId: 'millet', qty: 1000 }, { idempotencyKey: key });
    const r2 = await act('place_po', { supplierId: 's_madurai', materialId: 'millet', qty: 1000 }, { idempotencyKey: key });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBe(true);
    const v = await owner.get(`/api/worlds/${worldId}/view?companyId=${companyId}`);
    expect(v.body.company.purchaseOrders.length).toBe(1);
  });

  it('stale versions and stale advances are rejected', async () => {
    const v = await owner.get(`/api/worlds/${worldId}/view?companyId=${companyId}`);
    const stale = await act('set_overtime', { enabled: true }, { expectedVersion: v.body.version - 1 });
    expect(stale.status).toBe(409);
    const adv = await act('advance_month', { expectedTick: 0 });
    expect(adv.status).toBe(201);
    const again = await act('advance_month', { expectedTick: 0 });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('STALE_TICK');
  });

  it('serves statements that reconcile and a ledger traceable to sources', async () => {
    const s = await owner.get(`/api/worlds/${worldId}/companies/${companyId}/statements?from=0&to=0`);
    expect(s.body.balance.balanced).toBe(true);
    expect(s.body.cashFlow.reconciles).toBe(true);
    expect(s.body.invariants.every((c: any) => c.ok)).toBe(true);
    const l = await owner.get(`/api/worlds/${worldId}/companies/${companyId}/ledger?account=1000`);
    expect(l.body.total).toBeGreaterThan(0);
    const csv = await owner.get(`/api/worlds/${worldId}/companies/${companyId}/ledger?format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const k = await owner.get(`/api/worlds/${worldId}/companies/${companyId}/kpi/cash`);
    expect(k.body.records.length).toBeGreaterThan(0);
  });

  it('replay verification reproduces persisted state', async () => {
    const r = await owner.post(`/api/worlds/${worldId}/verify-replay`).send({});
    expect(r.body.match).toBe(true);
  });

  it('forecast and scenario endpoints label their outputs', async () => {
    const f = await owner.get(`/api/worlds/${worldId}/companies/${companyId}/forecast?months=2`);
    expect(f.body.dataType).toBe('forecast');
    const s = await owner.post(`/api/worlds/${worldId}/companies/${companyId}/scenario`).send({ months: 2, changes: { priceChangePct: 5 } });
    expect(s.body.scenario.dataType).toBe('scenario');
  });

  it('enforces roles server-side: analysts read, cannot act; strangers see nothing', async () => {
    const analyst = await signUp('analyst@example.com');
    const stranger = await signUp('stranger@example.com');
    expect((await stranger.get(`/api/worlds/${worldId}/view`)).status).toBe(404);
    const add = await owner.post(`/api/worlds/${worldId}/members`).send({ email: 'analyst@example.com', role: 'analyst' });
    expect(add.status).toBe(201);
    expect((await analyst.get(`/api/worlds/${worldId}/view`)).status).toBe(200);
    const r = await analyst.post(`/api/worlds/${worldId}/actions`).send({ type: 'set_overtime', companyId, payload: { enabled: true } });
    expect(r.status).toBe(403);
    const del = await analyst.delete(`/api/worlds/${worldId}`).send({ confirmName: 'API world' });
    expect(del.status).toBe(403);
    const addByAnalyst = await analyst.post(`/api/worlds/${worldId}/members`).send({ email: 'stranger@example.com', role: 'manager' });
    expect(addByAnalyst.status).toBe(403);
  });

  it('deleting a world requires typed confirmation', async () => {
    expect((await owner.delete(`/api/worlds/${worldId}`).send({ confirmName: 'wrong' })).status).toBe(422);
    expect((await owner.delete(`/api/worlds/${worldId}`).send({ confirmName: 'API world' })).status).toBe(200);
    expect((await owner.get(`/api/worlds/${worldId}/view`)).status).toBe(404);
  });

  it('builds a demo world through the action pipeline', async () => {
    const r = await owner.post('/api/worlds').send({ name: 'Demo', demo: true });
    expect(r.status).toBe(201);
    const v = await owner.get(`/api/worlds/${r.body.worldId}/view`);
    expect(v.body.world.tick).toBe(2);
    expect(v.body.company.isDemo).toBe(true);
    expect(v.body.company.history.length).toBe(2);
    const rep = await owner.post(`/api/worlds/${r.body.worldId}/verify-replay`).send({});
    expect(rep.body.match).toBe(true);
  });
});
