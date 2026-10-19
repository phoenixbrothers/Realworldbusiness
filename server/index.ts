import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4100);
const db = openDb(process.env.DATABASE_PATH ?? path.join(here, '..', 'data', 'realworld.sqlite'));
const { app } = createApp({
  db,
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 72),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  staticDir: process.env.NODE_ENV === 'production' ? path.join(here, '..', 'dist') : undefined,
});
app.listen(port, () => console.log(`REALWORLD API listening on http://localhost:${port}`));
