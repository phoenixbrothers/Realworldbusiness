# REALWORLD Business Simulation Platform

A full-stack business simulation. You build and run companies in a simulated Indian economy connected to China, Vietnam, the UAE, Germany and the United States. Every number comes from one deterministic simulation engine, every rupee is posted to a double-entry ledger, and every world event is traced through exposure to its operational and financial consequences.

> Lives in `realworld/` so the existing Amma Koozh Kadai website at the repository root is untouched.

## Quick start

Requirements: **Node.js ≥ 22.13**. The app uses the built-in `node:sqlite`, so there is no native build step and no external database.

```bash
cd realworld
npm install
npm run dev          # API on :4100 + Vite on :5173 (proxying /api)
# open http://localhost:5173, register, then "Explore a demo" or "New world"
```

Production:

```bash
npm run build        # client → dist/
npm start            # serves API + dist on $API_PORT (default 4100)
```

Optional demo account: `npm run seed` creates `demo@realworld.local` / `demo-password-2027` with a pre-played demo world. These are **local development credentials only**.

### Checks

| Command | What it runs |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over engine, server, client and tests |
| `npm run lint` | ESLint (typescript-eslint, react-hooks) |
| `npm test` | Vitest: engine + API suites |
| `npm run build` | Vite production build |
| `npm run check` | all of the above |
| `BASE_URL=http://localhost:4100 npm run test:e2e [screenshotDir]` | Browser flows via `playwright-core` against a running server (uses `/opt/pw-browsers` Chromium or `PW_CHROMIUM`) |

### Environment variables (`.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `API_PORT` | `4100` | API / production server port |
| `WEB_PORT` | `5173` | Vite dev server port |
| `DATABASE_PATH` | `./data/realworld.sqlite` | SQLite file (created and migrated on start) |
| `SESSION_TTL_HOURS` | `72` | Session lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |

No external services or API keys are required. All economic and geopolitical data is **simulated** and labelled as such in the UI.

## Architecture

```
engine/    Pure, deterministic TypeScript domain + simulation engine (no I/O)
server/    Express API, SQLite persistence, auth, authorization, view models
client/    React 19 + Vite UI, design system, React Three Fiber campus, Recharts
tests/     Vitest engine & API suites, Playwright e2e flow
```

- **The engine is the single source of truth.** The UI only submits *proposed actions* (`POST /api/worlds/:id/actions`). The server loads the world and applies the action to a copy through `engine/actions.ts`, then runs **invariant checks** (`engine/invariants.ts`). It persists only if every check passes.
- **Persistence:** SQLite with versioned migrations (`server/db.ts`):
  - the `worlds` table holds the authoritative state as JSON, with an optimistic-lock `version`;
  - `world_actions` is an append-only command log (accepted and rejected) used for the audit trail and replay;
  - `world_members` holds per-world roles;
  - `users` and `sessions` hold accounts and hashed session tokens;
  - `audit_log` records security events.
- **Idempotency and concurrency:**
  - A client idempotency key returns the original outcome instead of re-applying.
  - `expectedVersion` rejects stale writes with 409.
  - `advance_month` requires the expected tick, so a duplicate advance is impossible.
- **Deterministic replay:** a seeded PRNG lives inside the state and all IDs are counter-based. Settings → "Verify deterministic replay" rebuilds the world from its seed and ordered actions and compares hashes (acceptance SIM-04).

### Simulation engine (engine/)

| Module | Responsibility |
|---|---|
| `ledger.ts` | Chart of accounts, balanced posting (integer paise, no duplicates, cash ≥ 0), reversals, income statement, balance sheet, direct cash flow |
| `inventory.ts` | Perpetual moving-average inventory tracked as total value, so the sub-ledger equals GL 1200/1210 exactly |
| `production.ts` | Feasibility bounded by machine capacity × condition, labor hours, factory energy and materials; absorption costing; scrap; wear |
| `procurement.ts` | Qualified suppliers, landed cost (FX, duty, freight), capacity, arrivals with route delays, reliability, export bans, expediting, cancellation |
| `market.ts` | Multinomial-logit market clearing across player products, competitor agents and export markets; stock limits, spillover, sales posting |
| `finance.ts` | Payroll (production labor → cost pool), facility costs, depreciation, payables priority, overdraft, loans, covenants, deposits, tax with loss carry-forward, valuation estimate, transaction review & execution |
| `workforce.ts`, `rnd.ts`, `marketing.ts` | Hiring with time-to-fill and ramp, attrition and morale, training; stage-gated R&D with seeded gate reviews; campaigns with diminishing returns |
| `economy.ts`, `events.ts`, `competitors.ts` | Mean-reverting macro and commodity indices; event templates with explicit effects; company-specific exposure and causal chains; rule-based competitors |
| `simulation.ts` | `createWorld`, `advanceMonth` (the documented processing order) |
| `selectors.ts`, `forecast.ts` | KPIs with definitions, sources and data types; alerts; advance preflight; variance bridge; search; forecasts and scenarios that run the real engine non-stochastically on a compacted copy |

Invariants checked after **every** accepted action:
- Every journal entry is balanced and none is duplicated.
- Trial balance and balance sheet balance.
- Cash is never negative.
- The production cost pool is cleared.
- Inventory equals the sum of movements and equals the GL.
- AP, accruals, tax and levies equal open items.
- AR equals open invoices.
- Loans, overdraft, deposits, PP&E and CIP equal their registers.

### Key decisions (the SRS PDF was not provided; the UI/UX plan references it)

- **Stack:** the plan suggests Next.js, FastAPI and PostgreSQL. I used Vite + React + Express + SQLite in TypeScript end to end. One language, zero external services, and the engine is shared by tests, server and type definitions. The data layer is isolated in `server/db.ts` and `server/worlds.ts` so it can move to PostgreSQL.
- **Time:** discrete monthly ticks, advanced only by explicit, confirmed user action. The world is "paused" between advances. Simulation time is never tied to the wall clock.
- **Money:** integer paise everywhere. Rates are applied with one rounding step, and allocations always sum exactly.
- **Accounting:** retained earnings equal cumulative net income (income accounts are not closed). Production uses normal-capacity absorption costing; unused conversion cost is expensed as idle-capacity cost. GST and surcharge/cess are out of scope; corporate tax is a flat 25% approximation.
- **Initial scope:**
  - India as the home market, plus five trade partners;
  - three industries (electronics, electric mobility, food and beverage);
  - single-player companies sharing a world with simulated competitor agents.

  Multiplayer, acquisitions, joint ventures and AI advisers are later scope per the plan's roadmap and are **not implemented**.
- **3D:** React Three Fiber, lazy-loaded with `frameloop="demand"`. It falls back to an SVG isometric campus when WebGL is unavailable, disabled in settings, or fails to render. Every hotspot also exists as a keyboard-accessible button.

## Security

- scrypt password hashing.
- Random 32-byte session tokens; only their SHA-256 hash is stored. httpOnly SameSite=Lax cookies.
- Login rate-limiting and password change revokes other sessions.
- Role-based authorization on every world endpoint, server-side: owner, manager, analyst (read-only). Non-members get 404.
- CSRF defence: JSON-only mutations plus an Origin check.
- zod validation of request shapes, plus domain validation in the engine.
- CSV exports neutralize formula injection.
- Security headers (nosniff, frame deny, referrer policy).

## Known limitations

- The SRS document itself was not available. Requirements were derived from the UI/UX plan and its SRS cross-references.
- Real-world data feeds are not connected. All indicators are simulated calibration values and are labelled as such.
- World state is stored as one JSON document per world. That is fine for single-player worlds of a few simulated years. Very long worlds will grow the document and make replay verification slower (it re-runs every action).
- Login rate-limiting is in-memory (per process).
- The 3D campus is procedural low-poly geometry rather than high-fidelity art assets.
- No i18n; the UI is English with Indian number formatting.
