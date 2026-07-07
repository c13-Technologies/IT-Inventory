// scripts/wait-for-pg.js
//
// Polls `docker compose exec -T db pg_isready` once a second for up to 30s.
// Used by `npm run db:reset` so we don't run `prisma db push` before the
// container is actually accepting connections. Also runnable on its own via
// `npm run db:wait` (added separately if useful).
//
// Exits 0 on first success, 1 if it never becomes ready.

'use strict';

const { execSync } = require('child_process');

const MAX_SECONDS = Number(process.env.DB_WAIT_TIMEOUT) || 30;
const USER = process.env.POSTGRES_USER || 'postgres';

let i = 0;
function tryOnce() {
  i++;
  try {
    execSync(`docker compose exec -T db pg_isready -U ${USER} -q`, { stdio: 'ignore' });
    console.log(`postgres ready after ${i}s`);
    process.exit(0);
  } catch (err) {
    if (i >= MAX_SECONDS) {
      console.error(`postgres did not become ready within ${MAX_SECONDS}s`);
      console.error('hint: run `npm run db:logs` to see what is going on');
      process.exit(1);
    }
    setTimeout(tryOnce, 1000);
  }
}
tryOnce();
