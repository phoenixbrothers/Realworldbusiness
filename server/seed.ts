/** Creates a demo account with a pre-played demo world (clearly labelled DEMO). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db';
import { authenticate, registerUser } from './auth';
import { WorldService } from './worlds';
import { createDemoWorld } from './demo';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb(process.env.DATABASE_PATH ?? path.join(here, '..', 'data', 'realworld.sqlite'));
const email = 'demo@realworld.local';
const password = 'demo-password-2027';
const user = authenticate(db, email, password) ?? registerUser(db, { email, name: 'Demo Player', password });
const r = createDemoWorld(new WorldService(db), user.id);
console.log(`Demo account: ${email} / ${password}`);
console.log(`Demo world ${r.worldId}, company ${r.companyId}`);
