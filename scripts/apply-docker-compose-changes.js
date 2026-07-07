// scripts/apply-docker-compose-changes.js
//
// ONE-OFF script that updates two things for the docker-compose setup:
//   1. README.md — replaces the raw `docker run` quickstart block with
//      `npm run db:up` + a table of the new db:* scripts, and adds
//      POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB to the env-vars table.
//   2. .env      — adds POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
//      (parsed from DATABASE_URL) so docker-compose's `env_file: .env` picks
//      them up. .env is gitignored, so this is a local-only change.
//
// Idempotent: re-running on an already-updated README is a no-op.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

const readmePath = path.join(ROOT, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');

let readmeTouched = 0;

// 1. Replace the Quickstart `docker run` block + the prisma migrate line with
//    `npm run db:up` + a table of the db:* scripts + `prisma db push`.
const oldDockerBlock = [
  '### 3. Start Postgres (Docker, dev-only)',
  '',
  '```bash',
  'docker run --name inventory-pg \\',
  '  -e POSTGRES_USER=postgres \\',
  '  -e POSTGRES_PASSWORD=postgres \\',
  '  -e POSTGRES_DB=inventory_dev \\',
  '  -p 5432:5432 -d postgres:16-alpine',
  '```',
  '',
  '### 4. Apply the schema',
  '',
  '```bash',
  'npx prisma migrate dev --name init',
  '# (coming soon) npx prisma db seed    # roles, permissions, demo tenant',
  '```',
].join('\n');

const newDockerBlock = [
  '### 3. Start Postgres (Docker, dev-only)',
  '',
  '```bash',
  'npm run db:up',
  '```',
  '',
  '> **First time only:** if you previously created the container with `docker run --name it-inventory-pg ...`, remove it first so Compose can claim the name: `docker rm -f it-inventory-pg` (your data in the `pgdata` named volume is untouched).',
  '',
  'Other DB scripts:',
  '',
  '| Command | What it does |',
  '|---|---|',
  '| `npm run db:up` | Start the Postgres container in the background |',
  '| `npm run db:down` | Stop the container (data in `pgdata` preserved) |',
  '| `npm run db:reset` | Stop, wipe the `pgdata` volume, restart, and re-apply the Prisma schema |',
  '| `npm run db:logs` | Tail the Postgres container logs |',
  '| `npm run db:psql` | Open a psql shell inside the container |',
  '',
  '### 4. Apply the schema',
  '',
  '```bash',
  'npx prisma db push     # apply prisma/schema.prisma to the dev DB',
  '# (coming soon) npx prisma db seed    # roles, permissions, demo tenant',
  '```',
].join('\n');

if (readme.includes(oldDockerBlock)) {
  readme = readme.replace(oldDockerBlock, newDockerBlock);
  readmeTouched++;
  console.log('README: replaced docker run block with db:up + scripts table');
} else if (readme.includes('npm run db:up')) {
  console.log('README: docker run block already replaced (skipping)');
} else {
  console.log('README: WARNING — docker run anchor not found, please update manually');
}

// 2. Add db:* scripts to the Scripts table (between `npm run serve` and the
//    first prisma command).
const oldScriptsAnchor = '| `npm run serve` | Alias for `npm start` |\n| `npx prisma format` | Auto-format `prisma/schema.prisma` |';
const newScriptsLine   = '| `npm run serve` | Alias for `npm start` |\n'
  + '| `npm run db:up` | Start the Postgres container |\n'
  + '| `npm run db:down` | Stop the Postgres container |\n'
  + '| `npm run db:reset` | Wipe the volume + restart + re-apply the Prisma schema |\n'
  + '| `npm run db:logs` | Tail Postgres logs |\n'
  + '| `npm run db:psql` | Open psql inside the container |\n'
  + '| `npx prisma format` | Auto-format `prisma/schema.prisma` |';

if (readme.includes(oldScriptsAnchor)) {
  readme = readme.replace(oldScriptsAnchor, newScriptsLine);
  readmeTouched++;
  console.log('README: added db:* scripts to Scripts table');
} else if (readme.includes('| `npm run db:up` |')) {
  console.log('README: Scripts table already has db:* rows (skipping)');
} else {
  console.log('README: WARNING — Scripts table anchor not found, please update manually');
}

// 3. Add POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB to the env-vars table.
const oldEnvAnchor = '| `DATABASE_URL` | ✅ | — | Postgres connection string |\n| `JWT_SECRET` | ✅ | — | 32+ char random string |';
const newEnvLine   = '| `DATABASE_URL` | ✅ | — | Postgres connection string the app uses |\n'
  + '| `POSTGRES_USER` | ✅ (compose) | `postgres` | Read by `docker-compose.yml` when starting the dev DB |\n'
  + '| `POSTGRES_PASSWORD` | ✅ (compose) | — | Must match the password in `DATABASE_URL` |\n'
  + '| `POSTGRES_DB` | ✅ (compose) | `inventory_dev` | Read by `docker-compose.yml` when creating the container |\n'
  + '| `JWT_SECRET` | ✅ | — | 32+ char random string |';

if (readme.includes(oldEnvAnchor)) {
  readme = readme.replace(oldEnvAnchor, newEnvLine);
  readmeTouched++;
  console.log('README: added POSTGRES_* rows to Environment variables table');
} else if (readme.includes('| `POSTGRES_USER` |')) {
  console.log('README: Env vars table already has POSTGRES_* rows (skipping)');
} else {
  console.log('README: WARNING — Env vars anchor not found, please update manually');
}

if (readmeTouched > 0) fs.writeFileSync(readmePath, readme);

// ---------------------------------------------------------------------------
// .env  (local-only, gitignored)
// ---------------------------------------------------------------------------

const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  console.log('.env: not found, skipping (run `cp .env.example .env` first)');
} else {
  let env = fs.readFileSync(envPath, 'utf8');
  // Parse the existing DATABASE_URL.
  // Accepts both quoted and unquoted forms, e.g.
  //   DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public"
  //   DATABASE_URL=postgresql://user:pass@host:5432/dbname
  const urlMatch = env.match(
    /^DATABASE_URL=["']?postgresql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?"'\s]+)/m
  );
  if (!urlMatch) {
    console.error('.env: could not parse DATABASE_URL — leaving it alone');
    process.exit(1);
  }
  const [, dbUser, dbPass, , , dbName] = urlMatch;

  const wanted = [
    ['POSTGRES_USER', dbUser],
    ['POSTGRES_PASSWORD', dbPass],
    ['POSTGRES_DB', dbName],
  ];

  let envChanged = false;
  for (const [key, value] of wanted) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(env)) {
      env = env.replace(re, `${key}=${value}`);
      console.log(`.env: updated ${key}`);
    } else {
      env += `\n${key}=${value}\n`;
      console.log(`.env: added ${key}=${value}`);
    }
    envChanged = true;
  }
  if (envChanged) fs.writeFileSync(envPath, env);
}

console.log('\nAll done.');
