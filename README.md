# IT Inventory (Clarity)

> Multi-tenant IT asset inventory management system for organizations.
> Built on the [Minia](https://themesbrand.com/minia/) admin template, rebranded as **Clarity** for c13-tech inventory management.

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Postgres](https://img.shields.io/badge/postgres-16-blue)

Track the full lifecycle of every laptop, monitor, phone, license, and peripheral in your org — from procurement to retirement — with role-based access control, audit logging, and a flexible JSONB schema for asset-specific specs.

## Features

### Implemented

- **Asset inventory** — create, view, edit, and filter assets with pagination, search, and status/category/location/vendor filters
- **Directory management** — vendors, locations, categories, users, and departments with full CRUD via modals
- **Lifecycle tracking** — assignments (check-out/check-in with history) and maintenance records (repair, upgrade, inspection)
- **Inventory modules** — software licenses and license seat tracking
- **PRO pages** — warranty tracking (active/expiring/expired derived from asset dates), roles & permissions viewer, audit log, notifications stub, webhooks stub
- **Authentication** — bcrypt password hashing, express-session with 24h expiry, session fixation prevention, login redirect back to intended page
- **Role-based access control (RBAC)** — 4 roles × 12 permissions: IT Manager (full), IT Support (assets+lifecycle write, directory read), Department Head (read-only), Employee (assets+lifecycle read)
- **Audit logging** — automatic before/after snapshots on every create, update, and delete across all 9 CRUD entities
- **Profile page** — view account details, change password with validation
- **Last-login tracking** — `lastLoginAt` updated on every successful login
- **Split-panel login page** — Clarity auth layout with testimonial carousel, password visibility toggle, demo account badges
- **RBAC-aware sidebar** — menu sections conditionally shown/hidden based on user permissions
- **User-aware topbar** — shows logged-in user name, role, profile link, and sign-out
- **Seed data** — 32 real-world records: 1 tenant, 4 roles, 2 departments, 4 users, 5 vendors, 4 locations, 6 categories, 8 assets, 3 assignments, 3 maintenance records

### Planned

- Multi-tenant onboarding (signup flow, tenant CRUD)
- Approval workflow for asset assign / retire / delete
- Email + Slack/Teams notifications
- QR / barcode label generation per asset
- CSV import / export for bulk operations
- Reports — assets by status/location/category, depreciation, utilization

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js ≥ 18 |
| Web framework | Express 4 |
| Database | PostgreSQL 16 (Docker) |
| ORM | Prisma 5 |
| Auth | bcrypt + express-session |
| Templating | EJS partials (head, topbar, sidebar, footer, scripts) |
| Frontend | jQuery + Bootstrap 5 (Clarity template — Minia fork) |
| Charts | ApexCharts, Sparklines, jVectorMap |

## Project structure

```
.
├── server.js                  # Express app — all routes, auth, RBAC, CRUD
├── package.json
├── .env                       # local secrets (gitignored)
├── .env.example               # template for new contributors
├── docker-compose.yml         # PostgreSQL 16 container
├── prisma/
│   ├── schema.prisma          # 22 models, 14 enums, multi-tenant
│   ├── migrations/            # baseline init migration
│   └── seed.js                # 32 sample records with bcrypt passwords
├── views/
│   ├── partials/              # head, topbar, sidebar, footer, scripts, breadcrumb, modals, data-table, empty-state
│   ├── pages/                 # one EJS per page (30+ pages)
│   │   ├── auth-login.ejs     # split-panel login with testimonial carousel
│   │   ├── profile.ejs        # user profile + change password
│   │   ├── assets/            # index, detail, edit, new, qr
│   │   ├── vendors/           # index, detail, edit, new
│   │   ├── (locations, categories, users, assignments, maintenance, licenses, departments, approvals, license-seats, warranty, roles, audit-log, reports, notifications, webhooks)
│   │   └── index.ejs          # dashboard
│   └── lib/
│       ├── prismaData.js      # async Prisma data layer (drop-in for mockData)
│       ├── mockData.js        # original in-memory mock data (kept for reference)
│       └── schemas.js         # field shapes for all CRUD entities
├── assets/                    # Clarity static assets (CSS, JS, images, fonts, libs)
├── docs/
│   └── erd.md                 # Mermaid ERD — source of truth for the schema
├── scripts/                   # dev utility scripts
└── ref/                       # reference HTML from original Minia template (kept for diffing / template updates)
```

## Quickstart

### Prerequisites

- **Node.js ≥ 18**
- **Docker** (for PostgreSQL) or a running Postgres 16 instance

### 1. Clone & install

```bash
git clone https://github.com/c13-Technologies/IT-Inventory.git
cd IT-Inventory
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# edit .env with your database URL and secrets
```

### 3. Start Postgres

```bash
npm run db:up        # starts PostgreSQL 16 in Docker
```

### 4. Apply schema & seed

```bash
npx prisma db push   # creates all 22 tables
npm run db:seed      # populates with 32 sample records
```

### 5. Run

```bash
npm start            # http://127.0.0.1:3000
```

## Demo accounts

All accounts use password: `password123`

| Name | Email | Role |
|---|---|---|
| Alex Bytestorm | alex.bytestorm@c13-tech.com | IT Manager |
| Billy Nick | billy.nick@c13-tech.com | IT Support |
| Lydia Acheng | lydia.acheng@c13-tech.com | Employee |
| Sande Ochieno | sande.ochieno@c13-tech.com | Department Head |

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm run db:up` | Start Postgres container |
| `npm run db:down` | Stop Postgres container |
| `npm run db:reset` | Wipe + restart + re-apply schema |
| `npm run db:seed` | Seed the database with sample data |
| `npm run db:logs` | Tail Postgres logs |
| `npm run db:psql` | Open psql inside the container |
| `npx prisma studio` | Visual DB browser at http://localhost:5555 |

## RBAC — permissions matrix

| Permission | IT Manager | IT Support | Dept Head | Employee |
|---|---|---|---|---|
| assets:read | ✓ | ✓ | ✓ | ✓ |
| assets:write | ✓ | ✓ | — | — |
| lifecycle:read | ✓ | ✓ | ✓ | ✓ |
| lifecycle:write | ✓ | ✓ | — | — |
| directory:read | ✓ | ✓ | ✓ | — |
| directory:write | ✓ | — | — | — |
| inventory:read | ✓ | ✓ | — | — |
| inventory:write | ✓ | — | — | — |
| admin:read | ✓ | ✓ | — | — |
| admin:write | ✓ | — | — | — |
| communications:read | ✓ | ✓ | — | — |
| communications:write | ✓ | — | — | — |

## Architecture

Key design decisions:

- **Multi-tenant** — shared DB with `tenant_id` on every tenant-scoped table; tenant resolved from session at login
- **Session auth** — express-session with memory store (swap to Redis/DB for production); session regenerated on login and password change
- **RBAC middleware** — `can(permission)` factory returns 403 on forbidden access; applied to all 30+ routes + CRUD loop
- **Audit logging** — fire-and-forget writes to `audit_log` with before/after JSONB snapshots on every mutating operation
- **Prisma ORM** — type-safe queries, lazy connection pooling, migration tracking
- **EJS server-rendered** — sidebar, topbar, and page content rendered server-side with permission-aware conditionals
- **Soft delete via status enums** — `AssetStatus.RETIRED`, `UserStatus.DISABLED`, etc.
- **Decimal(12,2) money** with currency snapshot on every cost field
- **JSONB for flexibility** — `assets.attributes`, `tenants.settings`, `audit_log.before/after`

## License

MIT

## Acknowledgments

- UI based on the [Minia](https://themesbrand.com/minia/) admin template by Themesbrand, rebranded as **Clarity**
- Charts by [ApexCharts](https://apexcharts.com/)
- Icons by [Boxicons](https://boxicons.com/), [Font Awesome](https://fontawesome.com/), and [Material Design Icons](https://materialdesignicons.com/)
- Map by [jVectorMap](https://jvectormap.com/)
