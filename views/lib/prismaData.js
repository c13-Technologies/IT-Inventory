// views/lib/prismaData.js
//
// Drop-in async replacement for mockData.js. All functions have the same
// signatures and return shapes as mockData, but read/write from the real
// Postgres database via Prisma instead of in-memory arrays.
//
// Usage in server.js: replace `const mockData = require('./views/lib/mockData')`
// with `const prismaData = require('./views/lib/prismaData')`, then add `await`
// to all calls.  No other changes needed — views and routes are unchanged.

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const schemas = require('./schemas');
// Single source of truth for the role form's checkbox taxonomy.
// Imported with rename so the rest of this file (and the views that
// read prismaData.PERMISSION_GROUPS) keeps its existing API surface.
// To add a new namespace: append to GROUPS in views/lib/permissions.js
// + add the matching code(s) to CODES in the same module.
const { GROUPS: PERMISSION_GROUPS } = require('./permissions');

// ---------------------------------------------------------------------------
// Tenant resolution — from Express session (set at login). Falls back to
// hardcoded seed tenant for dev convenience when session is not available.
// ---------------------------------------------------------------------------
const TENANT_SLUG = 'c13-tech';
let _fallbackTid = null;
let _currentReq = null;

async function _fallbackTenantId() {
  if (!_fallbackTid) {
    const t = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!t) throw new Error('Tenant not found. Run `npm run db:seed` first.');
    _fallbackTid = t.id;
  }
  return _fallbackTid;
}

// Set the current request context so tenantId() can read the session
function setRequest(req) { _currentReq = req; }

async function tenantId() {
  // Use session tenantId if available
  if (_currentReq && _currentReq.session && _currentReq.session.tenantId) {
    return _currentReq.session.tenantId;
  }
  // Fallback to seed tenant
  return _fallbackTenantId();
}

// ---------------------------------------------------------------------------
// Shared include objects for denormalization
// ---------------------------------------------------------------------------
const assetInclude = {
  category:   true,
  vendor:     true,
  location:   true,
  createdBy:  true,
  assignments: {
    where: { returnedAt: null },
    include: { user: true },
    take: 1,
  },
};

const assignmentInclude = {
  user:  true,
  asset: { include: { category: true } },
};

const maintenanceInclude = {
  vendor:      true,
  performedBy: true,
};

// ---------------------------------------------------------------------------
// Denormalization helpers (mirror mockData.js's denormalizeAsset etc.)
// ---------------------------------------------------------------------------
function denormalizeAsset(a) {
  if (!a) return null;
  return {
    ...a,
    category:   a.category   || null,
    vendor:     a.vendor     || null,
    location:   a.location   || null,
    createdBy:  a.createdBy  || null,
    assignedTo: (a.assignments && a.assignments[0]) ? a.assignments[0].user : null,
    // Remove the raw Prisma relation arrays so they don't leak into views
    assignments: undefined,
  };
}

function denormalizeAssignment(a) {
  if (!a) return null;
  return {
    ...a,
    user:  a.user  || null,
    asset: a.asset || null,
  };
}

function denormalizeMaintenance(m) {
  if (!m) return null;
  return {
    ...m,
    vendor:      m.vendor      || null,
    performedBy: m.performedBy || null,
    // Aliases for backward compat with mockData field names
    startedAt:   m.performedAt,
    completedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Pre-validation (reuses schemas.js — identical to mockData.js)
// ---------------------------------------------------------------------------
function validate(slug, input) {
  const errors = {};
  const sch = schemas[slug] || [];
  sch.forEach(f => {
    if (!f.required) return;
    const v = input ? input[f.key] : undefined;
    if (v === undefined || v === '' || v === null) {
      errors[f.key] = `${f.label} is required`;
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// FK violation → human-readable error messages (used by delete)
// ---------------------------------------------------------------------------
const FK_ERROR_MESSAGES = {
  categories:  'still assigned to one or more assets',
  vendors:     'still referenced by assets or maintenance records',
  locations:   'still holding one or more assets',
  users:       'still assigned to assets or holding assignments',
};

// ---------------------------------------------------------------------------
// Public API — query functions
// ---------------------------------------------------------------------------

// Assets (with filtering + pagination)
async function getAssets({ status, categoryId, locationId, vendorId, assignedOnly, assignedUserId, search, page = 1, pageSize = 25 } = {}) {
  const tid = await tenantId();
  const where = { tenantId: tid };
  if (status)       where.status    = status;
  if (categoryId)   where.categoryId = categoryId;
  if (locationId)   where.locationId = locationId;
  if (vendorId)     where.vendorId   = vendorId;
  // Per-user scope: assets with an ACTIVE assignment to `assignedUserId`.
  // Takes precedence over `assignedOnly` (any active assignment) since this
  // is a stricter filter. Used for the EMPLOYEE/DEPARTMENT_HEAD landing
  // page (auto-scoped server-side in server.js's /assets GET route).
  if (assignedUserId) {
    where.assignments = { some: { userId: assignedUserId, returnedAt: null } };
  } else if (assignedOnly) {
    where.assignments = { some: { returnedAt: null } };
  }
  if (search) {
    where.OR = [
      { name:         { contains: search, mode: 'insensitive' } },
      { assetTag:     { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
    ];
  }
  const skip = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({ where, include: assetInclude, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.asset.count({ where }),
  ]);
  return {
    rows: rows.map(denormalizeAsset),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function getAssetById(id) {
  // SECURITY: tenant-scoped findFirst (NOT findUnique) so a cross-
  // tenant asset row returns null. The previous findUnique had no
  // tenantId filter and was the data-layer half of the same over-
  // disclosure surface that the /assets/:id route-level assignedTo
  // guard mitigates. After this fix, a request for a foreign-tenant
  // asset cuid lands in the `if (!asset)` branch in server.js's
  // /assets/:id handlers and 404s via the final fallback - so neither
  // detail/edit/qr nor /api/* callers can leak cross-tenant asset data.
  const tid = await tenantId();
  const asset = await prisma.asset.findFirst({
    where: { id, tenantId: tid },
    include: {
      ...assetInclude,
      assignments: { include: { user: true }, orderBy: { assignedAt: 'desc' } },
      maintenance: { include: { vendor: true }, orderBy: { performedAt: 'desc' } },
    },
  });
  if (!asset) return null;
  const result = denormalizeAsset(asset);
  // Override assignments with the full history (not only active)
  result.assignments = (asset.assignments || []).map(denormalizeAssignment);
  result.maintenance = (asset.maintenance || []).map(denormalizeMaintenance);
  return result;
}

// Related records for asset detail pages
async function getAssignmentsForAsset(assetId) {
  const rows = await prisma.assignment.findMany({
    where: { assetId },
    include: { user: true },
    orderBy: { assignedAt: 'desc' },
  });
  return rows.map(denormalizeAssignment);
}

async function getMaintenanceForAsset(assetId) {
  const rows = await prisma.maintenanceRecord.findMany({
    where: { assetId },
    include: { vendor: true },
    orderBy: { performedAt: 'desc' },
  });
  return rows.map(denormalizeMaintenance);
}

// Global list views
async function getAssignments() {
  const tid = await tenantId();
  const rows = await prisma.assignment.findMany({
    where: { tenantId: tid },
    include: assignmentInclude,
    orderBy: { assignedAt: 'desc' },
  });
  return rows.map(denormalizeAssignment);
}

async function getMaintenance() {
  const tid = await tenantId();
  const rows = await prisma.maintenanceRecord.findMany({
    where: { tenantId: tid },
    include: maintenanceInclude,
    orderBy: { performedAt: 'desc' },
  });
  return rows.map(denormalizeMaintenance);
}

// Dropdown sources (directory data)
async function getCategories() {
  const tid = await tenantId();
  return prisma.category.findMany({ where: { tenantId: tid }, orderBy: { name: 'asc' } });
}

async function getVendors() {
  const tid = await tenantId();
  return prisma.vendor.findMany({ where: { tenantId: tid }, orderBy: { name: 'asc' } });
}

async function getLocations() {
  const tid = await tenantId();
  return prisma.location.findMany({ where: { tenantId: tid }, orderBy: { name: 'asc' } });
}

async function getUsers() {
  const tid = await tenantId();
  const users = await prisma.user.findMany({
    where: { tenantId: tid },
    include: { role: true, department: true },
    orderBy: { fullName: 'asc' },
  });
  // Denormalize role string and department to match mockData shape
  return users.map(u => ({
    ...u,
    role: u.role ? u.role.name.toUpperCase().replace(/ /g, '_') : null,
    department: u.department || null,
  }));
}

// ---------------------------------------------------------------------------
// Audit logging — fire-and-forget writes to the auditLog table.
// Reads userId, tenantId, ip, and userAgent from the current request context.
// ---------------------------------------------------------------------------
function auditLog(action, entityType, entityId, before, after) {
  const req = _currentReq;
  if (!req) return;
  const userId = req.session ? req.session.userId : null;
  const tid = req.session ? req.session.tenantId : null;
  if (!userId || !tid) return;
  prisma.auditLog.create({
    data: {
      tenantId: tid,
      userId,
      action,
      entityType,
      entityId,
      before: before ? (typeof before === 'object' ? before : {}) : undefined,
      after: after ? (typeof after === 'object' ? after : {}) : undefined,
      ip: req.ip || null,
      userAgent: req.get ? (req.get('user-agent') || null) : null,
    },
  }).catch(err => console.error('Audit log write failed:', err.message)); // fire-and-forget, never crash the request
}

// ---------------------------------------------------------------------------
// CRUD mutators — one set per entity (vendors, locations, categories, users,
// assignments, maintenance, licenses, departments, approvals)
// The registry below generates create/update/delete/getById/list functions
// for each slug, matching the mockData.js CRUD factory.
// ---------------------------------------------------------------------------
const CRUD_SLUGS = [
  { slug: 'vendors',     model: 'vendor',            name: 'Vendor' },
  { slug: 'locations',   model: 'location',          name: 'Location' },
  { slug: 'categories',  model: 'category',          name: 'Category' },
  { slug: 'users',       model: 'user',              name: 'User' },
  { slug: 'assignments', model: 'assignment',        name: 'Assignment' },
  { slug: 'maintenance', model: 'maintenanceRecord', name: 'Maintenance' },
  { slug: 'licenses',    model: 'softwareLicense',   name: 'License' },
  { slug: 'departments', model: 'department',        name: 'Department' },
  { slug: 'approvals',   model: 'approvalRequest',   name: 'Approval' },
];

const crudExports = {};

for (const { slug, model, name } of CRUD_SLUGS) {
  const Name = name;

  // create<Name>(input) → { success, data } | { success: false, errors }
  crudExports['create' + Name] = async function(input) {
    const errors = validate(slug, input || {});
    if (Object.keys(errors).length) return { success: false, errors };
    try {
      const data = { ...(input || {}) };
      // Strip _modal and any other non-schema fields so Prisma doesn't reject them
      delete data._modal;
      // Inject tenantId for tenant-scoped models
      if (model !== 'approvalRequest') {
        data.tenantId = await tenantId();
      } else {
        data.tenantId = await tenantId();
      }
      // Handle date fields — convert string dates to Date objects
      for (const f of (schemas[slug] || [])) {
        if ((f.type === 'date') && data[f.key] && typeof data[f.key] === 'string') {
          data[f.key] = new Date(data[f.key]);
        }
      }
      // Handle number fields — convert strings to numbers
      for (const f of (schemas[slug] || [])) {
        if (f.type === 'number' && data[f.key] !== undefined && data[f.key] !== '' && data[f.key] !== null) {
          data[f.key] = Number(data[f.key]);
        }
      }
      // Resolve role string → roleId for users (schema has role as select, Prisma has roleId FK)
      if (slug === 'users' && data.role) {
        const roleName = String(data.role).replace(/_/g, ' ');
        const role = await prisma.role.findFirst({ where: { tenantId: await tenantId(), name: roleName } });
        if (role) { data.roleId = role.id; }
        delete data.role;
      }
      const row = await prisma[model].create({ data });
      auditLog(model + '.create', model, row.id, null, row);
      return { success: true, data: row };
    } catch (err) {
      if (err.code === 'P2002') {
        return { success: false, errors: { _global: 'A record with this value already exists.' } };
      }
      throw err;
    }
  };

  // update<Name>(id, patch) → { success, data } | { success: false, errors }
  crudExports['update' + Name] = async function(id, patch) {
    const errors = validate(slug, patch || {});
    if (Object.keys(errors).length) return { success: false, errors };
    try {
      const data = { ...(patch || {}) };
      delete data._modal;
      for (const f of (schemas[slug] || [])) {
        if ((f.type === 'date') && data[f.key] && typeof data[f.key] === 'string') {
          data[f.key] = new Date(data[f.key]);
        }
        if (f.type === 'number' && data[f.key] !== undefined && data[f.key] !== '' && data[f.key] !== null) {
          data[f.key] = Number(data[f.key]);
        }
      }
      // Resolve role string → roleId for users
      if (slug === 'users' && data.role) {
        const roleName = String(data.role).replace(/_/g, ' ');
        const role = await prisma.role.findFirst({ where: { tenantId: await tenantId(), name: roleName } });
        if (role) { data.roleId = role.id; }
        delete data.role;
      }
      // Fetch existing row for audit 'before' snapshot, scoped to this
      // tenant so a write-capable role in tenant A cannot mutate a
      // foreign tenant's row by guessing the cuid. We use findFirst
      // (not the compound `{ id, tenantId }` unique predicate) because
      // Prisma's `update`/`delete` only accept a `WhereUniqueInput`
      // (the @id / @unique fields). id is the only unique field on
      // every CRUD entity, so the pre-check + single-row update is the
      // correct shape. The subsequent update is then safe to use the
      // global { id } key.
      //
      // On a tenant-block we ALSO write a '*.tenant-blocked' audit row
      // so an admin reviewing /audit-log can see the probing attempt;
      // the user-facing error stays identical to a true "not found"
      // so attackers cannot distinguish foreign-tenant from missing.
      const tid = await tenantId();
      const before = await prisma[model].findFirst({ where: { id, tenantId: tid } });
      if (!before) {
        auditLog(model + '.update.tenant-blocked', model, id, null, { requestedTenantId: tid });
        return { success: false, errors: { _global: 'Record not found.' } };
      }
      const row = await prisma[model].update({ where: { id }, data });
      // SESSION-INVALIDATION: if the user's roleId changed, bump their
      // permVersion so the per-session requireFreshPerms middleware
      // forces them to re-login with the new perm set on their next
      // request. The before.roleId !== row.roleId guard skips the
      // no-op case where the form re-submits the same role (Prisma's
      // update() still bumps updatedAt on a no-op write, so a naive
      // "data.roleId is set" check would cause false-positive
      // re-logins). See also updateRole() in the role CRUD block
      // below for the parallel bump applied to all users in a role
      // when a role's perms change — a future maintainer adding a
      // new roleId-mutating slug should follow both call sites.
      if (slug === 'users' && data.roleId && before.roleId !== row.roleId) {
        await prisma.user.update({
          where: { id: row.id },
          data: { permVersion: { increment: 1 } },
        });
        // PERM-BUMPS: write a dedicated audit row with action
        // 'user.role-change' so the /perm-bumps page can render
        // "admin X moved user Y from role A to role B" without
        // having to post-filter the generic 'user.update' stream
        // for roleId diffs. invalidatedCount is hard-coded to 1
        // (only the affected user's session is invalidated). The
        // audit log also records the admin's userId (from the
        // request session via the auditLog() helper below) as the
        // 'who triggered it' field.
        auditLog('user.role-change', 'user', row.id,
          { roleId: before.roleId },
          { roleId: row.roleId, permVersion: row.permVersion + 1, invalidatedCount: 1, affectedUserId: row.id, affectedUserName: row.fullName, affectedUserEmail: row.email });
      }
      auditLog(model + '.update', model, row.id, before, row);
      return { success: true, data: row };
    } catch (err) {
      if (err.code === 'P2025') {
        return { success: false, errors: { _global: 'Record not found.' } };
      }
      if (err.code === 'P2002') {
        return { success: false, errors: { _global: 'A record with this value already exists.' } };
      }
      throw err;
    }
  };

  // delete<Name>(id) → { success } | { success: false, errors }
  crudExports['delete' + Name] = async function(id) {
    try {
      // Fetch existing row for audit trail before deleting, scoped to
      // this tenant so a write-capable role cannot delete a foreign
      // tenant's row by guessing the cuid. Same findFirst pattern as
      // update<Name> above (Prisma's `delete` only accepts
      // WhereUniqueInput which is { id } here).
      //
      // Same audit-log treatment as update<Name>: a '*.tenant-blocked'
      // row gets written so the probing attempt is visible in /audit-log.
      const tid = await tenantId();
      const before = await prisma[model].findFirst({ where: { id, tenantId: tid } });
      if (!before) {
        auditLog(model + '.delete.tenant-blocked', model, id, null, { requestedTenantId: tid });
        return { success: false, errors: { _global: 'Record not found.' } };
      }
      await prisma[model].delete({ where: { id } });
      auditLog(model + '.delete', model, id, before, null);
      return { success: true };
    } catch (err) {
      if (err.code === 'P2025') {
        return { success: false, errors: { _global: 'Record not found.' } };
      }
      if (err.code === 'P2003' || err.code === 'P2014') {
        const msg = FK_ERROR_MESSAGES[slug] || 'still referenced by other records';
        return { success: false, errors: { _global: 'Cannot delete: ' + msg + '.' } };
      }
      throw err;
    }
  };

  // get<Name>ById(id) → row | null.
  // SECURITY: tenant-scoped findFirst (NOT findUnique) so a row from
  // another tenant returns null instead of leaking across boundaries
  // when a low-perm user guesses a cuid from the URL. The unique-id
  // lookup is preserved by the { id, tenantId: tid } compound predicate.
  // All 9 CRUD entities are tenant-scoped (vendor/location/category/
  // user/assignment/maintenance/license/department/approvalRequest),
  // so this one fix covers every /<slug>/:id detail handler in the
  // CRUD loop below. getRoleById (already correct) is intentionally
  // NOT part of this factory - it has its own tenant-scoped findFirst.
  crudExports['get' + Name + 'ById'] = async function(id) {
    const tid = await tenantId();
    return prisma[model].findFirst({ where: { id, tenantId: tid } });
  };

  // list<Name>s() → rows[]
  crudExports['list' + Name + 's'] = async function() {
    const tid = await tenantId();
    return prisma[model].findMany({ where: { tenantId: tid } });
  };
}

// Dedicated user detail query — includes role, department, assigned assets,
// and audit history for the user detail page.
async function getUserDetail(id) {
  // SECURITY: tenant-scoped findFirst (NOT findUnique) so a logged-in
  // directory:read user in one tenant can't browse a foreign tenant's
  // user profile by guessing the cuid. /users/:id goes through THIS
  // manual handler (registered above the CRUD loop), so it never hits
  // the auto-CRUD getUserById above - it needs its OWN tenant filter.
  const tid = await tenantId();
  const user = await prisma.user.findFirst({
    where: { id, tenantId: tid },
    include: {
      role: true,
      department: true,
    },
  });
  if (!user) return null;
  // Fetch active assignments (not returned) and audit log in parallel
  const [activeAssignments, auditLogs] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId: id, returnedAt: null },
      include: { asset: true },
      orderBy: { assignedAt: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: { userId: id, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  return {
    ...user,
    role: user.role ? user.role.name.toUpperCase().replace(/ /g, '_') : null,
    department: user.department || null,
    activeAssignments,
    auditLogs,
  };
}

// Also add per-slug get<Name>s aliases (used by server.js's getSources())
for (const { slug, model, name } of CRUD_SLUGS) {
  if (slug === 'maintenance' || slug === 'assignments') continue; // handled above
  const Name = name;
  if (!crudExports['get' + Name + 's']) {
    crudExports['get' + Name + 's'] = crudExports['list' + Name + 's'];
  }
}

// Special: flat asset list for source dropdowns (getSources needs a flat array)
async function getAssetsFlat() {
  const result = await getAssets({ pageSize: 1000 });
  return result.rows;
}

// ---------------------------------------------------------------------------
// PRO sidebar page queries — license seats, warranty (derived from assets),
// roles, audit log, notifications, webhooks.
// ---------------------------------------------------------------------------

// License seats with denormalized license/asset/user names
async function getLicenseSeats() {
  const tid = await tenantId();
  const seats = await prisma.licenseSeat.findMany({
    where: { tenantId: tid },
    include: { license: true, asset: true, user: true },
    orderBy: { assignedAt: 'desc' },
  });
  return seats.map(s => ({
    ...s,
    licenseName: s.license ? s.license.name : null,
    assetName:   s.asset ? (s.asset.assetTag + ' — ' + s.asset.name) : null,
    userName:    s.user ? s.user.fullName : null,
  }));
}

// Warranty tracking — derived from assets that have a warranty expiry date
async function getWarranties() {
  const tid = await tenantId();
  const now = new Date();
  const soon = new Date();
  soon.setMonth(soon.getMonth() + 3); // expiring within 3 months
  const assets = await prisma.asset.findMany({
    where: { tenantId: tid, warrantyExpiry: { not: null } },
    include: { vendor: true },
    orderBy: { warrantyExpiry: 'asc' },
  });
  return assets.map(a => {
    const expiry = new Date(a.warrantyExpiry);
    const status = expiry < now ? 'EXPIRED' : expiry < soon ? 'EXPIRING' : 'ACTIVE';
    return {
      ...a,
      assetName:  a.assetTag + ' — ' + a.name,
      vendorName: a.vendor ? a.vendor.name : null,
      expiryDate: a.warrantyExpiry,
      status,
    };
  });
}

// Roles (from seed — IT Manager, IT Support, Department Head, Employee)
async function getRoles() {
  const tid = await tenantId();
  const roles = await prisma.role.findMany({
    where: { tenantId: tid },
    include: { _count: { select: { users: true, rolePermissions: true } } },
    orderBy: { name: 'asc' },
  });
  return roles.map(r => ({
    ...r,
    userCount:       r._count.users,
    permissionCount: r._count.rolePermissions,
  }));
}

// Audit log — append-only, denormalizes user name for the view
async function getAuditLogs() {
  const tid = await tenantId();
  const logs = await prisma.auditLog.findMany({
    where: { tenantId: tid },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });
  return logs.map(l => ({
    ...l,
    userName: l.user ? l.user.fullName : null,
  }));
}

// Perm-bumps feed for /perm-bumps page. Returns the most recent
// session-invalidation events (role.update + user.role-change) so
// admins can answer "who got logged out at 14:32 when the Auditor
// role was edited?" Two event types:
//
//   1. action = 'role.update' with after.invalidatedCount > 0
//      (written by prismaData.updateRole when a role's perm set
//      changes — invalidates N users where N = users currently
//      mapped to the role at edit time)
//
//   2. action = 'user.role-change'
//      (written by the auto-CRUD updateUser hook when an admin
//      moves a single user to a different role — invalidates 1
//      user: the one being moved)
//
// Excludes role.update events with invalidatedCount = 0 (e.g. a
// builtin with no users, or a brand-new custom role before any
// users are assigned) since those don't represent an actual
// session-invalidation event.
//
// We over-fetch by 3x and post-filter in JS because Prisma's
// JSON-path "gt: 0" filter on after->invalidatedCount is awkward
// to express and not worth the complexity for the expected low
// volume of role.update events. (If perm-bumps ever becomes a
// high-traffic page, swap to a SQL raw query with jsonb_path_ops.)
async function getPermBumps({ limit = 50 } = {}) {
  const tid = await tenantId();
  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId: tid,
      action: { in: ['role.update', 'user.role-change'] },
    },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    take: limit * 3,
  });
  return rows
    .filter(r => {
      if (r.action === 'user.role-change') return true;
      // role.update — only show if at least 1 user was invalidated
      return r.after && (r.after.invalidatedCount || 0) > 0;
    })
    .slice(0, limit)
    .map(r => ({
      id:            r.id,
      createdAt:     r.createdAt,
      action:        r.action,
      entityType:    r.entityType,
      entityId:      r.entityId,
      // Admin who triggered the change (the user in the audit row
      // is the session userId = the admin doing the edit). For
      // user.role-change rows, the affected user is in after.affectedUser*.
      triggeredByName:  r.user ? r.user.fullName : 'System',
      triggeredByEmail: r.user ? r.user.email : null,
      // After JSON: role.update has { invalidatedCount, roleName };
      // user.role-change has { invalidatedCount, affectedUserId,
      // affectedUserName, affectedUserEmail, roleId (new) }.
      invalidatedCount: (r.after && r.after.invalidatedCount) || 0,
      roleName:         r.after ? r.after.roleName : null,
      affectedUserId:       r.after ? r.after.affectedUserId : null,
      affectedUserName:     r.after ? r.after.affectedUserName : null,
      affectedUserEmail:    r.after ? r.after.affectedUserEmail : null,
      oldRoleId:            (r.action === 'user.role-change' && r.before) ? r.before.roleId : null,
      newRoleId:            (r.action === 'user.role-change' && r.after)  ? r.after.roleId  : null,
    }));
}

// Affected-users lookup for the /perm-bumps drill-down modal.
// Given a roleId (from the audit row's entityId for role.update events),
// returns:
//   - role: { id, name }            (so the modal can show which role)
//   - users: [{ id, fullName, email, lastLoginAt, permVersion }, ...]
//     sorted alphabetically by fullName.
//
// SECURITY: tenant-scoped findFirst on the role so a user in tenant A
// cannot probe or list users from a foreign tenant's role by guessing
// the cuid. The subsequent user.findMany is also tenant-scoped via the
// same tid (NOT just roleId), so a returning-findFirst pattern is
// unnecessary — the (roleId, tenantId) compound predicate on User
// already enforces tenant isolation when combined with the role check.
//
// IMPORTANT: this returns the CURRENT set of users mapped to the role.
// The audit row's invalidatedCount captured the count at edit-time,
// so the two numbers may diverge if users have been reassigned away
// from (or into) the role since the bump event was recorded. The
// modal UI surfaces this distinction (see the "as of now" note
// rendered in views/pages/perm-bumps/index.ejs).
async function getAffectedUsers(roleId) {
  const tid = await tenantId();
  const role = await prisma.role.findFirst({
    where: { id: roleId, tenantId: tid },
    select: { id: true, name: true },
  });
  if (!role) return null;
  const users = await prisma.user.findMany({
    where: { roleId: roleId, tenantId: tid },
    select: { id: true, fullName: true, email: true, lastLoginAt: true, permVersion: true },
    orderBy: { fullName: 'asc' },
  });
  return { role, users };
}

// CSV-export column maps, keyed by the view's URL slug. Each value is
// the ordered array of `{ label, get }` columns that the streaming
// export endpoint serializes + writes to the response. Live route
// AND verifier pull from this map so renaming a column = one edit
// here. To add a new export surface (e.g. '/assets/export.csv'):
//   1. Define a new const ARRAY_OF_COLUMNS in this file.
//   2. Add `'your-slug': YOUR_ARRAY` to CSV_COLUMNS_BY_VIEW below.
//   3. In server.js: declare the limit + wire a thin route that
//      fetches rows + calls streamCsvExport({ filePrefix, columns,
//      rows, limit, auditAction, auditEntityType }).
// No other code needs to change.
//
// Snake_case labels (spreadsheet-friendly). Per-column accessor reads
// the denormalized field off the row object that the matching
// getXxxForExport() function returns (NOT the on-screen feed's
// view shape — here we keep the related JSON spread across
// "before" / "after" so compliance reviewers can rebuild the
// original audit-event payload from the raw JSON).
//
// Perm-bumps columns mirror the on-screen table PLUS the raw before
// / after JSON. Accessor reads from r.after when present (so
// roleName / invalidatedCount / affectedUser* all surface even on
// rows where the after JSON is missing — those cells come back
// empty).
//
// Audit-log columns are intentionally minimal — no perm-bumps-only
// fields like `affected_role_name` / `invalidated_count`, since
// those would be empty for non-perm-bump rows. We DO include `ip`
// and `user_agent` because /audit-log is the compliance catch-all
// (the two fields that distinguish manual admin actions from
// automated ones — useful when reconstructing an incident
// timeline).
const PERM_BUMPS_EXPORT_COLUMNS = [
  { label: 'created_at',           get: r => r.createdAt },
  { label: 'action',               get: r => r.action },
  { label: 'triggered_by_name',    get: r => r.triggeredByName },
  { label: 'triggered_by_email',   get: r => r.triggeredByEmail },
  { label: 'affected_role_name',   get: r => (r.after && r.after.roleName)            || null },
  { label: 'affected_user_name',   get: r => (r.after && r.after.affectedUserName)   || null },
  { label: 'affected_user_email',  get: r => (r.after && r.after.affectedUserEmail)  || null },
  { label: 'invalidated_count',    get: r => (r.after && r.after.invalidatedCount)   || 0 },
  { label: 'entity_type',          get: r => r.entityType },
  { label: 'entity_id',            get: r => r.entityId },
  { label: 'before',               get: r => r.before },
  { label: 'after',                get: r => r.after  },
];

const AUDIT_LOG_EXPORT_COLUMNS = [
  { label: 'created_at',  get: r => r.createdAt },
  { label: 'user_name',   get: r => r.userName },
  { label: 'user_email',  get: r => r.userEmail },
  { label: 'action',      get: r => r.action },
  { label: 'entity_type', get: r => r.entityType },
  { label: 'entity_id',   get: r => r.entityId },
  { label: 'ip',          get: r => r.ip },
  { label: 'user_agent',  get: r => r.userAgent },
  { label: 'before',      get: r => r.before },
  { label: 'after',       get: r => r.after  },
];

// Single source of truth keyed by view slug. Each value is an
// ALIAS BY REFERENCE, NOT a copy — `'perm-bumps'` and
// PERM_BUMPS_EXPORT_COLUMNS point at the same Array. rename a
// column = one edit at the const, both consumers pick it up.
//
// IMPORTANT — DO NOT MUTATE. Calling `CSV_COLUMNS_BY_VIEW[k].push(x)`
// or `CVS_COLUMNS_BY_VIEW[k].splice(...)` would mutate the dedicated
// const simultaneously (they're the same Array). Treat these as
// read-only. To add a new export surface: define a new
// `*_EXPORT_COLUMNS` const above, add a key here, then add a thin
// route thunk in server.js that calls streamCsvExport().
const CSV_COLUMNS_BY_VIEW = {
  'perm-bumps': PERM_BUMPS_EXPORT_COLUMNS,
  'audit-log':  AUDIT_LOG_EXPORT_COLUMNS,
};

// Perm-bumps export query for the streaming /api/perm-bumps/export.csv
// endpoint on /perm-bumps. Returns the most recent role.update +
// user.role-change events (NO post-filter — see below) plus the raw
// before / after JSON, joined with the admin who triggered the event.
//
// Differences from getPermBumps (the on-screen feed):
//   1. NO `invalidatedCount > 0` post-filter. Compliance reviews need
//      to see EVERY role edit, including those on a brand-new custom
//      role that invalidated 0 users because no users were attached
//      at edit time. Without them, an auditor could not answer "show
//      me every role configuration change last quarter".
//   2. Returns raw `before` + `after` as the actual JSON objects
//      (caller JSON.stringifies at serialization time, which lets
//      the CSV-escape function handle the resulting nested quotes).
//   3. Higher default limit (1000) for the export vs 50 for the page.
//      The 1000 is the spec'd maximum; callers can pass smaller.
//
// SECURITY: tenant-scoped via tenantId() so a foreign tenant admin's
// CSV export cannot leak rows from another tenant. No additional
// gate here — the gate is at the route (admin:read).
async function getPermBumpsForExport({ limit = 1000 } = {}) {
  const tid = await tenantId();
  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId: tid,
      action: { in: ['role.update', 'user.role-change'] },
    },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    // Fetch up to `limit`; not over-fetched (export vs page): one
    // findMany with `take: limit` is sufficient because we DO NOT
    // post-filter (page filters out `invalidatedCount: 0` rows).
    take: limit,
  });
  // Return raw rows including before + after JSON. The route layer
  // is responsible for the CSV serialization + RFC 4180 escape so the
  // streaming write-back can be kept dumb (one row in, one CSV line
  // out).
  return rows.map(r => ({
    id:               r.id,
    createdAt:        r.createdAt,
    action:           r.action,
    entityType:       r.entityType,
    entityId:         r.entityId,
    triggeredByName:  r.user ? r.user.fullName : 'System',
    triggeredByEmail: r.user ? r.user.email : null,
    // The `after` and `before` columns are JSON-typed in Postgres
    // (Prisma returns them as JS objects). The route will JSON.stringify
    // before CSV-escaping so a nested JSON value with internal quotes
    // gets the RFC 4180 double-double-quote treatment (e.g. a key like
    // `{"qux": "a\"b"}` → ...,"{\"qux\":\"a\"\"b\"}",...).
    before:           r.before,
    after:            r.after,
  }));
}

// Audit-log export query for the streaming /api/audit-log/export.csv
// endpoint on /audit-log. Returns the most recent tenant-scoped rows
// from the audit log + the raw before / after JSON + the user join
// (fullName + email denormalized) + ip + userAgent so a compliance
// reviewer can identify the source.
//
// Differences from getAuditLogs (the on-screen feed): NO client-side
// post-filter — every audit row is included (the page's search
// filtering happens in server.js AFTER the DB fetch, so the export
// matches the DB state, not the user's current search). Defaults to
// a higher limit (5000) than perm-bumps (1000) because /audit-log is
// the catch-all compliance view ("last quarter's activity" can be
// many more rows than recent permission bumps). 5000 still streams
// cleanly through Node's TCP send buffer (~16KB chunks).
//
// SECURITY: tenant-scoped via tenantId() so a foreign tenant admin's
// CSV export cannot leak rows from another tenant. No additional
// gate here — the gate is at the route (admin:read).
async function getAuditLogsForExport({ limit = 5000 } = {}) {
  const tid = await tenantId();
  const rows = await prisma.auditLog.findMany({
    where: { tenantId: tid },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(r => ({
    id:        r.id,
    createdAt: r.createdAt,
    // The audit row's `userId` field is the session userId (the admin
    // doing the action). We denormalize user.fullName + user.email
    // here so the CSV has the same shape the on-screen /audit-log
    // page does NOT (it only renders userName). Including email
    // here gives compliance a way to map audit events back to a
    // specific person when a fullName collides with another user's
    // (e.g. two "John Smith"s).
    userName:  r.user ? r.user.fullName : 'System',
    userEmail: r.user ? r.user.email : null,
    action:    r.action,
    entityType: r.entityType,
    entityId:   r.entityId,
    // ip + userAgent are the two request-context fields the
    // auditLog() helper writes (server.js's loginGuard + every
    // CRUD POST captures them). Useful when reconstructing "was
    // this action taken from a recognised office IP or a hotel
    // WiFi while the laptop was on holiday?".
    ip:        r.ip,
    userAgent: r.userAgent,
    // Raw JSON columns — same shape the audit page renders as the
    // expandable JSON blob.
    before:    r.before,
    after:     r.after,
  }));
}

// CSV escape (RFC 4180). Exported so the verifier can round-trip
// tricky inputs (JSON containing internal quotes / commas / CR-LF)
// through the same function the route uses.
// Behavior:
//   - null / undefined → empty string (the canonical CSV "missing
//     field" representation; tools like Excel + pandas interpret
//     trailing commas as null).
//   - Date → ISO string via toISOString() FIRST (before the object-
//     stringify branch) so the resulting plain string doesn't get
//     surrounded by literal JSON quotes (JSON.stringify(new Date())
//     returns '"2026-07-10T14:32:08.123Z"' — which would then get
//     wrapped + inner-`"` doubled by the escape, producing
//     `"""2026-07-10T14:32:08.123Z"""` and an awkward Excel parse).
//   - other objects (Prisma JSON columns come back as JS objects or
//     null) → JSON.stringify for a stable string representation.
//   - otherwise → String(value).
//   - If the resulting string contains `"`, `,`, `\n`, or `\r`,
//     wrap in `"..."` and double any internal `"` to `""` per
//     RFC 4180 §2.5/2.6/2.7.
//   - Strings WITHOUT those special chars are emitted bare (no
//     unnecessary quoting — keeps the CSV compact + readable).
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Recurse with the ISO string — the recursive call handles the
    // escape logic so we don't duplicate the regex + wrapping here.
    return csvEscape(value.toISOString());
  }
  if (typeof value === 'object') {
    // Prisma JSON columns come back as objects or null. JSON.stringify
    // gives RFC 8259; special chars inside following values are handled
    // by the recursive call's escape pass.
    return csvEscape(JSON.stringify(value));
  }
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Notifications
async function getNotifications() {
  const tid = await tenantId();
  return prisma.notification.findMany({
    where: { tenantId: tid },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });
}

// Webhooks
async function getWebhooks() {
  const tid = await tenantId();
  return prisma.webhookSubscription.findMany({
    where: { tenantId: tid },
    orderBy: { createdAt: 'desc' },
  });
}

// ===========================================================================
// Role CRUD — backing logic for views/pages/roles/{new,edit,detail}.ejs.
//
// Not part of the generic CRUD_SLUGS loop because:
//   1. Roles have a M:N junction (RolePermission) that the generic loop
//      doesn't generate — explicit transaction handling is required so the
//      metadata and permission set never get out of sync.
//   2. Builtin roles (`isBuiltin: true`) have write-protection rules that
//      the generic loop can't enforce (no name rename, no delete, but
//      description + permissions are still mutable).
//   3. The form UI uses a grouped permissions picker (not crud-form.ejs).
// ===========================================================================

// Permission namespace catalog — driven by views/lib/permissions.js
// (imported above as `const { GROUPS: PERMISSION_GROUPS } = ...`).
// Keeping the alias here means the rest of this file and the views
// that read prismaData.PERMISSION_GROUPS keep their existing API.

async function getPermissions() {
  return prisma.permission.findMany({ orderBy: { code: 'asc' } });
}

// Single role lookup with relations denormalized for the detail / edit views.
// Returns permissionCodes (string[]) so the edit form's checkboxes can be
// pre-checked without re-mapping through the junction table.
// Tenant-scoped: a role from another tenant is treated as 'not found' so
// admins can't probe or mutate cross-tenant roles via direct URL.
async function getRoleById(id) {
  const tid = await tenantId();
  const role = await prisma.role.findFirst({
    where: { id, tenantId: tid },
    include: {
      users: { select: { id: true, fullName: true, email: true, status: true }, orderBy: { fullName: 'asc' } },
      rolePermissions: { include: { permission: true } },
      _count: { select: { users: true, rolePermissions: true } },
    },
  });
  if (!role) return null;
  return {
    ...role,
    permissionCodes: role.rolePermissions.map(rp => rp.permission.code),
    userCount:       role._count.users,
    permissionCount: role._count.rolePermissions,
  };
}

async function createRole(input) {
  const errors = {};
  const name = input && input.name ? String(input.name).trim() : '';
  if (!name) errors.name = 'Name is required';
  if (Object.keys(errors).length) return { success: false, errors };
  try {
    const tid = await tenantId();
    const codes = parsePermissionCodes(input);
    const perms = codes.length
      ? await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } })
      : [];
    const role = await prisma.role.create({
      data: {
        tenantId: tid,
        name,
        description: (input.description && String(input.description).trim()) || null,
        isBuiltin: false, // UI-created roles are never builtin
        rolePermissions: {
          create: perms.map(p => ({ permissionId: p.id })),
        },
      },
      include: { rolePermissions: { include: { permission: true } } },
    });
    auditLog('role.create', 'role', role.id, null, role);
    return { success: true, data: role };
  } catch (err) {
    if (err.code === 'P2002') {
      return { success: false, errors: { _global: 'A role with this name already exists in this tenant.' } };
    }
    throw err;
  }
}async function updateRole(id, input) {
    // SECURITY: tenant-scoped findFirst (NOT findUnique) so a write-
    // capable role in one tenant cannot mutate a foreign tenant's role
    // by guessing the cuid. Built-in global roles (tenantId=NULL) are
    // excluded by the tenantId predicate - they remain unreachable from
    // tenant-side code paths by virtue of filtering out, not by the
    // downstream isBuiltin branch. The isBuiltin branch below still
    // runs for any tenant-scoped builtin (tenantId != NULL, isBuiltin=true)
    // and continues to block name mutation.
    //
    // On a tenant-block we also write a 'role.update.tenant-blocked'
    // audit row so the probing attempt is visible in /audit-log; the
    // user-facing error stays identical to "Role not found" so an
    // attacker cannot distinguish foreign-tenant from missing.
    const tid = await tenantId();
    const existing = await prisma.role.findFirst({ where: { id, tenantId: tid } });
    if (!existing) {
        auditLog('role.update.tenant-blocked', 'role', id, null, { requestedTenantId: tid });
        return { success: false, errors: { _global: 'Role not found.' } };
    }
    // Builtins: name is NOT mutable (so the hardcoded PERMISSIONS const in
    // server.js can keep its IT_MANAGER/IT_SUPPORT/DEPARTMENT_HEAD/EMPLOYEE
    // keys stable across the system). Description is always editable.
  const errors = {};
  let name = existing.name;
  if (!existing.isBuiltin) {
    name = input && input.name ? String(input.name).trim() : '';
    if (!name) errors.name = 'Name is required';
  }
  if (Object.keys(errors).length) return { success: false, errors };
  try {
    const codes = parsePermissionCodes(input);
    const perms = codes.length
      ? await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } })
      : [];
    const updated = await prisma.$transaction(async (tx) => {
      const data = {
        description: (input.description !== undefined)
          ? ((input.description && String(input.description).trim()) || null)
          : existing.description,
      };
      if (!existing.isBuiltin) data.name = name;
      await tx.role.update({ where: { id }, data });
      // Replace the role's permission set atomically. Using delete+create
      // instead of `connectOrCreate` because the same permissionId may be
      // toggled off and on in the same request — and we want the final set
      // to mirror the form exactly.
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (perms.length) {
        await tx.rolePermission.createMany({
          data: perms.map(p => ({ roleId: id, permissionId: p.id })),
        });
      }
      // SESSION-INVALIDATION: bump permVersion for every user currently
      // mapped to this role. This is the trigger for the
      // requireFreshPerms middleware in server.js to destroy the user's
      // session on their next request and force a re-login with the
      // new perm set. Done INSIDE the transaction so the role update,
      // the junction-table rewrite, and the permVersion bump are
      // atomic — a crash mid-flight can't leave the role updated
      // while users keep stale sessions (or vice versa). The fetch
      // before the increment lets us capture the new value to return
      // to the caller (the route handler) for logging / debugging.
      // BENIGN RACE: two concurrent updateRole calls against the same
      // role can both compute the same new permVersion, making the
      // second updateMany a no-op. End-state is still correct (any
      // pre-edit permVersion is invalidated exactly once). Locking
      // would be overkill — the next reader should NOT "fix" this
      // with a row-level lock; the current behavior is the intended
      // one.
      const usersInRole = await tx.user.findMany({
        where: { roleId: id },
        select: { permVersion: true },
      });
      const newPermVersion = usersInRole.length
        ? Math.max(...usersInRole.map(u => u.permVersion)) + 1
        : 1;
      if (usersInRole.length) {
        await tx.user.updateMany({
          where: { roleId: id },
          data: { permVersion: newPermVersion },
        });
      }
      const fresh = await tx.role.findUnique({
        where: { id },
        include: { rolePermissions: { include: { permission: true } } },
      });
      // Surface invalidatedCount + role name in the tx return so the
      // outer caller (and the audit log write below) know how many
      // users were bumped and which role was affected. Used by the
      // /perm-bumps page to render the "role edit invalidated N
      // users" row.
      return { role: fresh, permVersion: newPermVersion, invalidatedCount: usersInRole.length, roleName: fresh.name };
    });
    // PERM-BUMPS: the invalidatedCount + role name in the after JSON
    // is what /perm-bumps queries to render its rows. We pass a
    // spread of the role + 2 extra fields; the auditLog helper
    // stores the whole object as JSONB so the extra fields are
    // queryable via Prisma's JSON path filters (see getPermBumps).
    auditLog('role.update', 'role', id, existing, { ...updated.role, invalidatedCount: updated.invalidatedCount, roleName: updated.roleName });
    return { success: true, data: updated.role, permVersion: updated.permVersion, invalidatedCount: updated.invalidatedCount };
  } catch (err) {
    if (err.code === 'P2002') {
      return { success: false, errors: { _global: 'A role with this name already exists in this tenant.' } };
    }
    throw err;
  }
}async function deleteRole(id) {
    // SECURITY: tenant-scoped findFirst (NOT findUnique) so a write-
    // capable role in one tenant cannot delete a foreign tenant's role
    // by guessing the cuid. Built-in global roles (tenantId=NULL) are
    // excluded by the predicate - same shape as updateRole above.
    //
    // On a tenant-block we also write a 'role.delete.tenant-blocked'
    // audit row so the probing attempt is visible in /audit-log; the
    // user-facing error stays identical to "Role not found" so an
    // attacker cannot distinguish foreign-tenant from missing.
    const tid = await tenantId();
    const existing = await prisma.role.findFirst({ where: { id, tenantId: tid } });
    if (!existing) {
        auditLog('role.delete.tenant-blocked', 'role', id, null, { requestedTenantId: tid });
        return { success: false, errors: { _global: 'Role not found.' } };
    }
    if (existing.isBuiltin) {
        return { success: false, errors: { _global: 'Cannot delete a built-in role. Contact a system administrator if removal is required.' } };
  }
  try {
    // onDelete: Restrict on User.roleId means deleting a role that still
    // has users attached will throw P2003 / P2014 — caught below.
    await prisma.role.delete({ where: { id } });
    auditLog('role.delete', 'role', id, existing, null);
    return { success: true };
  } catch (err) {
    if (err.code === 'P2003' || err.code === 'P2014') {
      return { success: false, errors: { _global: 'Cannot delete: one or more users still hold this role. Reassign their role first.' } };
    }
    throw err;
  }
}

// Express urlencoded parser (with extended:true / qs) collects repeated
// form fields like `name="permissions[]"` into an array. This helper handles
// both arrays and comma-separated strings for flexibility (e.g. JSON POSTs).
function parsePermissionCodes(input) {
  if (!input) return [];
  const raw = input.permissions !== undefined ? input.permissions : input.permissionCodes;
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

// Reports — no dedicated table, always empty
function getReports() {
  return [];
}

// ---------------------------------------------------------------------------
// Module exports — mirrors mockData.js exactly
// ---------------------------------------------------------------------------
module.exports = Object.assign({}, crudExports, {
  // Tenant / request context
  setRequest,
  // Assets (query)
  getAssets,
  getAssetsFlat,
  getAssetById,
  getAssignmentsForAsset,
  getMaintenanceForAsset,
  // Global list views
  getAssignments,
  getMaintenance,
  // Dropdowns / directory
  getCategories,
  getVendors,
  getLocations,
  getUsers,
  getUserDetail,
  // PRO sidebar queries
  getLicenseSeats,
  getWarranties,
  getRoles,
  getAuditLogs,
  getPermBumps,
  getPermBumpsForExport,
  // CSV-export column maps (exposed so the route AND the verifier
  // share one source of truth for column order + label + accessor.
  // Renaming a column is a one-line edit; both the live export and
  // the round-trip test pick it up automatically. Adding a new
  // export surface = define a new *_EXPORT_COLUMNS const + register
  // it in CSV_COLUMNS_BY_VIEW + wire a thin route in server.js.
  PERM_BUMPS_EXPORT_COLUMNS,
  AUDIT_LOG_EXPORT_COLUMNS,
  CSV_COLUMNS_BY_VIEW,
  getAuditLogsForExport,
  getAffectedUsers,
  csvEscape,
  getReports,
  getNotifications,
  getWebhooks,
  // Role CRUD (dedicated — see the block above; not in the auto-CRUD loop)
  createRole,
  updateRole,
  deleteRole,
  getRoleById,
  getPermissions,
  parsePermissionCodes,
  PERMISSION_GROUPS,
  // Constants
  AssetStatus: {
    IN_STOCK:  'IN_STOCK',
    ASSIGNED:  'ASSIGNED',
    IN_REPAIR: 'IN_REPAIR',
    RETIRED:   'RETIRED',
    LOST:      'LOST',
  },
});
