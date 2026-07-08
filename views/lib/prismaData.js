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
async function getAssets({ status, categoryId, locationId, vendorId, assignedOnly, search, page = 1, pageSize = 25 } = {}) {
  const tid = await tenantId();
  const where = { tenantId: tid };
  if (status)       where.status    = status;
  if (categoryId)   where.categoryId = categoryId;
  if (locationId)   where.locationId = locationId;
  if (vendorId)     where.vendorId   = vendorId;
  if (assignedOnly) where.assignments = { some: { returnedAt: null } };
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
  const asset = await prisma.asset.findUnique({
    where: { id },
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
      // Fetch existing row for audit 'before' snapshot
      const before = await prisma[model].findUnique({ where: { id } });
      const row = await prisma[model].update({ where: { id }, data });
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
      // Fetch existing row for audit trail before deleting
      const before = await prisma[model].findUnique({ where: { id } });
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

  // get<Name>ById(id) → row | null
  crudExports['get' + Name + 'ById'] = async function(id) {
    return prisma[model].findUnique({ where: { id } });
  };

  // list<Name>s() → rows[]
  crudExports['list' + Name + 's'] = async function() {
    const tid = await tenantId();
    return prisma[model].findMany({ where: { tenantId: tid } });
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

// Reports — no dedicated table, always empty
function getReports() {
  return [];
}

// ---------------------------------------------------------------------------
// Module exports — mirrors mockData.js exactly
// ---------------------------------------------------------------------------
module.exports = Object.assign({
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
  // PRO sidebar queries
  getLicenseSeats,
  getWarranties,
  getRoles,
  getAuditLogs,
  getReports,
  getNotifications,
  getWebhooks,
  // Constants
  AssetStatus: {
    IN_STOCK:  'IN_STOCK',
    ASSIGNED:  'ASSIGNED',
    IN_REPAIR: 'IN_REPAIR',
    RETIRED:   'RETIRED',
    LOST:      'LOST',
  },
}, crudExports);
