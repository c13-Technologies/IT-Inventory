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

// Dedicated user detail query — includes role, department, assigned assets,
// and audit history for the user detail page.
async function getUserDetail(id) {
  const user = await prisma.user.findUnique({
    where: { id },
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

// Permission namespace catalog — drives the role form layout AND documents
// the canonical 12 permission codes the system ships with. Mirrors the
// namespaces in server.js's PERMISSIONS const; if you add a new namespace
// here, add a matching entry in server.js's PERMISSIONS for the 4 builtins.
const PERMISSION_GROUPS = [
  { namespace: 'assets',         label: 'Assets',         description: 'Hardware, software, accessories — view and modify records.' },
  { namespace: 'lifecycle',      label: 'Lifecycle',      description: 'Assignments, maintenance, approvals, warranty.' },
  { namespace: 'directory',      label: 'Directory',      description: 'Users, vendors, locations, categories, departments.' },
  { namespace: 'inventory',      label: 'Inventory',      description: 'Software licenses and seat allocation.' },
  { namespace: 'admin',          label: 'Admin',          description: 'Roles, audit log, reports.' },
  { namespace: 'communications', label: 'Communications', description: 'Notifications and webhook subscriptions.' },
];

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
}

async function updateRole(id, input) {
  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing) return { success: false, errors: { _global: 'Role not found.' } };
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
      return await tx.role.findUnique({
        where: { id },
        include: { rolePermissions: { include: { permission: true } } },
      });
    });
    auditLog('role.update', 'role', id, existing, updated);
    return { success: true, data: updated };
  } catch (err) {
    if (err.code === 'P2002') {
      return { success: false, errors: { _global: 'A role with this name already exists in this tenant.' } };
    }
    throw err;
  }
}

async function deleteRole(id) {
  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing) return { success: false, errors: { _global: 'Role not found.' } };
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
