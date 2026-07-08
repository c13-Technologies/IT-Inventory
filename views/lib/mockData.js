// views/lib/mockData.js
//
// Mock data for the IT Inventory UI. Returns objects shaped exactly like
// Prisma will return in Phase 6, so the route handlers can swap from
// `mockData.getAssets(...)` to `prisma.asset.findMany(...)` with NO changes
// to the EJS templates.
//
// Phase 6 swap: every function in this file maps 1:1 to a Prisma call.
//   getAssets   -> prisma.asset.findMany({ include: { category, vendor, ... }})
//   getAssetById-> prisma.asset.findUnique({ where: { id }, include: { ... }})
//   getXxx()    -> prisma.xxx.findMany()

'use strict';

// ---------------------------------------------------------------------------
// Cuid-style IDs (placeholder; Phase 6 will use real prisma cuid())
// ---------------------------------------------------------------------------
// Dev-only ID generator. Phase 6 will replace this with Prisma's cuid/uuid,
// at which point IDs will be stable across server restarts.
let _idCounter = 0;
const id = (prefix, n) => `${prefix}_${String(n).padStart(6, '0')}_${String(_idCounter++).padStart(6, '0')}`;

// ---------------------------------------------------------------------------
// Dropdown sources
// ---------------------------------------------------------------------------

const categories = [
  { id: id('cat', 1), name: 'Laptops',          type: 'HARDWARE',  parentId: null },
  { id: id('cat', 2), name: 'Monitors',         type: 'HARDWARE',  parentId: null },
  { id: id('cat', 3), name: 'Phones',           type: 'HARDWARE',  parentId: null },
  { id: id('cat', 4), name: 'Tablets',          type: 'HARDWARE',  parentId: null },
  { id: id('cat', 5), name: 'Software Licenses',type: 'SOFTWARE',  parentId: null },
  { id: id('cat', 6), name: 'Peripherals',      type: 'ACCESSORY', parentId: null },
];

const vendors = [
  { id: id('ven', 1), name: 'Apple Inc.',         status: 'ACTIVE', email: 'business@apple.com',  phone: '+1-800-555-0101' },
  { id: id('ven', 2), name: 'Dell Technologies',  status: 'ACTIVE', email: 'sales@dell.com',       phone: '+1-800-555-0102' },
  { id: id('ven', 3), name: 'Lenovo',             status: 'ACTIVE', email: 'b2b@lenovo.com',       phone: '+1-800-555-0103' },
  { id: id('ven', 4), name: 'Microsoft',          status: 'ACTIVE', email: 'volume@microsoft.com', phone: '+1-800-555-0104' },
  { id: id('ven', 5), name: 'Samsung',            status: 'ACTIVE', email: 'enterprise@samsung.com', phone: '+1-800-555-0105' },
];

const locations = [
  { id: id('loc', 1), name: 'HQ - 5th Floor',     type: 'OFFICE',     parentId: null,           address: '100 Main St, Floor 5' },
  { id: id('loc', 2), name: 'HQ - 6th Floor',     type: 'OFFICE',     parentId: null,           address: '100 Main St, Floor 6' },
  { id: id('loc', 3), name: 'Remote / WFH',       type: 'REMOTE',     parentId: null,           address: 'Employee home' },
  { id: id('loc', 4), name: 'Datacenter - East',  type: 'DATACENTER', parentId: null,           address: '250 Industrial Pkwy' },
];

const users = [
  { id: id('usr', 1), fullName: 'Alex Bytestorm', email: 'alex.bytestorm@c13-tech.com', role: 'IT_MANAGER',     departmentId: 'dept_it' },
  { id: id('usr', 2), fullName: 'Billy Nick',    email: 'billy.nick@c13-tech.com',       role: 'IT_SUPPORT',     departmentId: 'dept_it' },
  { id: id('usr', 3), fullName: 'Lydia Acheng',  email: 'lydia.acheng@c13-tech.com',     role: 'EMPLOYEE',       departmentId: 'dept_eng' },
  { id: id('usr', 4), fullName: 'Sande Ochieno', email: 'sande.ochieno@c13-tech.com',    role: 'DEPARTMENT_HEAD',departmentId: 'dept_eng' },
];

// ---------------------------------------------------------------------------
// 8 sample assets spanning all 5 AssetStatus values
// ---------------------------------------------------------------------------

const assets = [
  // 1. IN_STOCK — laptop in IT room
  {
    id: id('ast', 1),
    assetTag: 'IT-0001',
    name: 'MacBook Pro 16" M3 Max',
    description: 'Standard issue developer laptop, top spec',
    status: 'IN_STOCK',
    condition: 'NEW',
    manufacturer: 'Apple',
    model: 'MBP16,3',
    serialNumber: 'C02XK1ABCDE',
    macAddress: 'F0:18:98:5C:2D:A1',
    purchaseDate: '2025-03-15',
    purchaseCost: 3499.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2025-0312',
    warrantyExpiresAt: '2028-03-15',
    depreciationMonths: 36,
    notes: 'Reserved for incoming senior engineer (April start).',
    attributes: { cpu: 'M3 Max', ram_gb: 64, storage_gb: 2048, screen_in: 16, color: 'Space Black' },
    categoryId: categories[0].id,
    locationId: locations[0].id,
    vendorId: vendors[0].id,
    assignedToId: null,
    createdById: users[0].id,
    createdAt: '2025-03-15T10:00:00Z',
    updatedAt: '2025-03-15T10:00:00Z',
    version: 0,
  },
  // 2. IN_STOCK — monitor
  {
    id: id('ast', 2),
    assetTag: 'IT-0002',
    name: 'LG UltraWide 34"',
    description: '34-inch curved productivity monitor',
    status: 'IN_STOCK',
    condition: 'NEW',
    manufacturer: 'LG',
    model: '34WN80C-B',
    serialNumber: 'LG34WN80C-2024-0421',
    purchaseDate: '2025-01-10',
    purchaseCost: 749.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2025-0089',
    warrantyExpiresAt: '2028-01-10',
    depreciationMonths: 60,
    notes: '',
    attributes: { size_in: 34, panel: 'IPS', refresh_hz: 60, resolution: '3440x1440' },
    categoryId: categories[1].id,
    locationId: locations[0].id,
    vendorId: vendors[4].id,
    assignedToId: null,
    createdById: users[0].id,
    createdAt: '2025-01-10T09:30:00Z',
    updatedAt: '2025-01-10T09:30:00Z',
    version: 0,
  },
  // 3. ASSIGNED — MacBook to remote employee
  {
    id: id('ast', 3),
    assetTag: 'IT-0003',
    name: 'MacBook Pro 14" M2 Pro',
    description: 'Senior dev laptop, 2-year-old',
    status: 'ASSIGNED',
    condition: 'GOOD',
    manufacturer: 'Apple',
    model: 'MBP14,7',
    serialNumber: 'C02ZK9FGHIJ',
    macAddress: 'A8:5C:2C:11:7E:B2',
    purchaseDate: '2023-06-20',
    purchaseCost: 2499.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2023-1145',
    warrantyExpiresAt: '2026-06-20',
    depreciationMonths: 36,
    notes: 'Extended AppleCare+ until 2026-06-20',
    attributes: { cpu: 'M2 Pro', ram_gb: 32, storage_gb: 1024, screen_in: 14, color: 'Silver' },
    categoryId: categories[0].id,
    locationId: locations[2].id, // Remote
    vendorId: vendors[0].id,
    assignedToId: users[2].id,   // Lydia
    createdById: users[0].id,
    createdAt: '2023-06-20T14:15:00Z',
    updatedAt: '2024-09-01T11:20:00Z',
    version: 1,
  },
  // 4. ASSIGNED — server in datacenter
  {
    id: id('ast', 4),
    assetTag: 'IT-0004',
    name: 'HP ProLiant DL380 Gen11',
    description: 'Primary app server, production',
    status: 'ASSIGNED',
    condition: 'GOOD',
    manufacturer: 'HP',
    model: 'DL380 Gen11',
    serialNumber: 'SGH713XYZA',
    purchaseDate: '2024-08-05',
    purchaseCost: 12499.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2024-0722',
    warrantyExpiresAt: '2027-08-05',
    depreciationMonths: 60,
    notes: 'Production app cluster node-01',
    attributes: { cpu_cores: 64, ram_gb: 256, storage_tb: 8, raid: 'RAID 10', form_factor: '2U' },
    categoryId: categories[0].id,  // Server under "Laptops" would be wrong; will move to "Hardware" later
    locationId: locations[3].id,    // Datacenter
    vendorId: vendors[1].id,        // Dell (close enough for mock)
    assignedToId: users[1].id,      // Billy (support owns it)
    createdById: users[0].id,
    createdAt: '2024-08-05T16:00:00Z',
    updatedAt: '2024-08-05T16:00:00Z',
    version: 0,
  },
  // 5. IN_REPAIR — tablet with cracked screen
  {
    id: id('ast', 5),
    assetTag: 'IT-0005',
    name: 'iPad Pro 12.9" (5th gen)',
    description: 'Field sales tablet, screen needs replacement',
    status: 'IN_REPAIR',
    condition: 'DAMAGED',
    manufacturer: 'Apple',
    model: 'MPL93LL/A',
    serialNumber: 'DMP9R3LMNOP',
    macAddress: '',
    purchaseDate: '2023-11-12',
    purchaseCost: 1199.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2023-2087',
    warrantyExpiresAt: '2024-11-12',
    depreciationMonths: 36,
    notes: 'Cracked top-right corner. Apple Authorized Service Provider, ticket #SR-99214',
    attributes: { storage_gb: 256, cellular: '5G', screen_in: 12.9 },
    categoryId: categories[3].id, // Tablets
    locationId: locations[0].id,   // IT room (sent to repair)
    vendorId: vendors[0].id,
    assignedToId: null,
    createdById: users[0].id,
    createdAt: '2023-11-12T10:00:00Z',
    updatedAt: '2025-02-18T13:45:00Z',
    version: 2,
  },
  // 6. RETIRED — old desk phone
  {
    id: id('ast', 6),
    assetTag: 'IT-0006',
    name: 'Cisco IP Phone 8841',
    description: 'Retired desk phone, replaced by softphone',
    status: 'RETIRED',
    condition: 'FAIR',
    manufacturer: 'Cisco',
    model: 'CP-8841-K9',
    serialNumber: 'FCH1234ABCD',
    purchaseDate: '2019-04-22',
    purchaseCost: 329.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2019-0312',
    warrantyExpiresAt: '2022-04-22',
    depreciationMonths: 60,
    notes: 'Retired 2024-12. Recycled through e-waste vendor GreenChip.',
    attributes: { poe: 'Class 2', voip: 'SIP', lines: 5 },
    categoryId: categories[2].id, // Phones
    locationId: locations[0].id,
    vendorId: vendors[1].id,
    assignedToId: null,
    createdById: users[0].id,
    createdAt: '2019-04-22T11:00:00Z',
    updatedAt: '2024-12-15T09:00:00Z',
    version: 3,
  },
  // 7. LOST — projector
  {
    id: id('ast', 7),
    assetTag: 'IT-0007',
    name: 'Epson Pro EB-1485Fi',
    description: 'Conference room projector',
    status: 'LOST',
    condition: 'NEW',
    manufacturer: 'Epson',
    model: 'EB-1485Fi',
    serialNumber: 'X9BG2300RST',
    purchaseDate: '2024-02-18',
    purchaseCost: 2199.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2024-0156',
    warrantyExpiresAt: '2027-02-18',
    depreciationMonths: 60,
    notes: 'Last seen in Conference Room A, 2025-01-22. Insurance claim filed.',
    attributes: { lumens: 5000, resolution: '1080p', laser: true },
    categoryId: categories[1].id, // Monitors (closest category)
    locationId: locations[2].id,   // Last known: remote branch
    vendorId: vendors[1].id,
    assignedToId: null,
    createdById: users[0].id,
    createdAt: '2024-02-18T15:00:00Z',
    updatedAt: '2025-01-22T17:30:00Z',
    version: 1,
  },
  // 8. IN_STOCK — GPU (spare for IT room)
  {
    id: id('ast', 8),
    assetTag: 'IT-0008',
    name: 'NVIDIA RTX 4090 FE',
    description: 'Spare GPU for ML workstation loaner pool',
    status: 'IN_STOCK',
    condition: 'NEW',
    manufacturer: 'NVIDIA',
    model: 'RTX 4090 FE',
    serialNumber: 'NV-4090FE-2024-0098',
    purchaseDate: '2024-12-01',
    purchaseCost: 1799.00,
    purchaseCurrency: 'USD',
    purchaseOrderNumber: 'PO-2024-1044',
    warrantyExpiresAt: '2026-12-01',
    depreciationMonths: 36,
    notes: 'Stored in anti-static bag in IT room cabinet B-3',
    attributes: { vram_gb: 24, tdp_w: 450, bus: 'PCIe 4.0 x16' },
    categoryId: categories[5].id, // Peripherals (closest for "spare parts")
    locationId: locations[0].id,
    vendorId: vendors[1].id,
    assignedToId: null,
    createdById: users[0].id,
    createdAt: '2024-12-01T10:00:00Z',
    updatedAt: '2024-12-01T10:00:00Z',
    version: 0,
  },
];

// ---------------------------------------------------------------------------
// Related records (for the detail page's "Assignments" and "Maintenance" tabs)
// ---------------------------------------------------------------------------

const assignments = [
  { id: id('asn', 1), assetId: assets[2].id, userId: users[2].id, assignedAt: '2023-06-22T09:00:00Z', returnedAt: null,                         expectedReturnAt: null,         notes: 'Permanent assignment' },
  { id: id('asn', 2), assetId: assets[3].id, userId: users[1].id, assignedAt: '2024-08-10T08:00:00Z', returnedAt: null,                         expectedReturnAt: null,         notes: 'Assigned to IT support' },
  // Historical
  { id: id('asn', 3), assetId: assets[2].id, userId: users[3].id, assignedAt: '2023-06-20T14:00:00Z', returnedAt: '2023-06-22T09:00:00Z', expectedReturnAt: '2023-06-22T09:00:00Z', notes: 'Initial stock assignment, transferred' },
];

const maintenance = [
  { id: id('mnt', 1), assetId: assets[4].id, vendorId: vendors[0].id, type: 'REPAIR',         description: 'Screen replacement after impact damage',           cost: 379.00, currency: 'USD', startedAt: '2025-02-18T13:00:00Z', completedAt: null,                              ticketNumber: 'SR-99214', status: 'IN_PROGRESS' },
  { id: id('mnt', 2), assetId: assets[5].id, vendorId: vendors[1].id, type: 'DECOMMISSION',   description: 'End-of-life retirement and e-waste recycling',    cost: 0,     currency: 'USD', startedAt: '2024-12-15T09:00:00Z', completedAt: '2024-12-22T15:00:00Z',         ticketNumber: 'EW-2024-118', status: 'COMPLETED' },
  { id: id('mnt', 3), assetId: assets[3].id, vendorId: vendors[1].id, type: 'PREVENTIVE',     description: 'Annual firmware update + dust filter cleaning',  cost: 250.00, currency: 'USD', startedAt: '2024-11-10T08:00:00Z', completedAt: '2024-11-10T12:00:00Z',         ticketNumber: 'PM-2024-014', status: 'COMPLETED' },
];

// Empty collections — schemas exist but no seed data. CRUD endpoints will
// populate these. Modules that want richer defaults can add them later.
const licenses   = [];
const departments = [];
const approvals  = [];

// ---------------------------------------------------------------------------
// Helpers (denormalize for the UI)
// ---------------------------------------------------------------------------

const byId = (arr) => (x) => arr.find((r) => r.id === x);
const byIds = {
  category:   byId(categories),
  vendor:     byId(vendors),
  location:   byId(locations),
  user:       byId(users),
  assignment: byId(assignments),
  asset:      byId(assets),
};

function denormalizeAsset(a) {
  if (!a) return null;
  return {
    ...a,
    category:    byIds.category(a.categoryId),
    vendor:      byIds.vendor(a.vendorId),
    location:    byIds.location(a.locationId),
    assignedTo:  a.assignedToId ? byIds.user(a.assignedToId) : null,
    createdBy:   byIds.user(a.createdById),
  };
}

function denormalizeAssignment(a) {
  return { ...a, user: byIds.user(a.userId), asset: byIds.category(a.assetId) ? { id: a.assetId } : null };
}

function denormalizeMaintenance(m) {
  return { ...m, vendor: byIds.vendor(m.vendorId) };
}

// ---------------------------------------------------------------------------
// Public API (what the route handlers call)
// ---------------------------------------------------------------------------

function getAssets({ status, categoryId, locationId, vendorId, assignedOnly, search, page = 1, pageSize = 25 } = {}) {
  let rows = assets.slice();
  if (status)         rows = rows.filter((a) => a.status === status);
  if (categoryId)     rows = rows.filter((a) => a.categoryId === categoryId);
  if (locationId)     rows = rows.filter((a) => a.locationId === locationId);
  if (vendorId)       rows = rows.filter((a) => a.vendorId === vendorId);
  if (assignedOnly)   rows = rows.filter((a) => a.assignedToId != null);
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.assetTag.toLowerCase().includes(q) ||
      (a.serialNumber || '').toLowerCase().includes(q)
    );
  }
  const total = rows.length;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize).map(denormalizeAsset);
  return { rows: pageRows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

function getAssetById(id) {
  return denormalizeAsset(assets.find((a) => a.id === id));
}

function getAssignmentsForAsset(assetId) {
  return assignments
    .filter((a) => a.assetId === assetId)
    .map((a) => ({ ...a, user: byIds.user(a.userId) }))
    .sort((a, b) => (b.assignedAt || '').localeCompare(a.assignedAt || ''));
}

function getMaintenanceForAsset(assetId) {
  return maintenance
    .filter((m) => m.assetId === assetId)
    .map(denormalizeMaintenance)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

// ----------------------------------------------------------------------
// Global list accessors (added for the new sidebar nav — see views/partials/sidebar.ejs).
// getAssignmentsForAsset / getMaintenanceForAsset remain for the asset-detail page.
// ----------------------------------------------------------------------
function getAssignments() {
  return assignments
    .slice()
    .map((a) => ({ ...a, user: byIds.user(a.userId), asset: byIds.asset(a.assetId) }))
    .sort((a, b) => (b.assignedAt || '').localeCompare(a.assignedAt || ''));
}

function getMaintenance() {
  return maintenance
    .slice()
    .map(denormalizeMaintenance)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

// ----------------------------------------------------------------------
// CRUD factory: schema-driven create/update/delete for the 9 sidebar
// nav modules. server.js route handlers call e.g. mockData.createVendor(input);
// mutators share validation, FK-aware delete protection, and id generation.
// We build a single exports object so the mutators are NOT lost to a
// final `module.exports = {...}` reassignment.
// ----------------------------------------------------------------------
const schemas = require('./schemas');

const CRUD_REGISTRY = {
  vendors:     { arr: vendors,      name: 'Vendor' },
  locations:   { arr: locations,    name: 'Location' },
  categories:  { arr: categories,   name: 'Category' },
  users:       { arr: users,        name: 'User' },
  assignments: { arr: assignments,  name: 'Assignment' },
  maintenance: { arr: maintenance,  name: 'Maintenance' },
  licenses:    { arr: licenses,     name: 'License' },
  departments: { arr: departments,  name: 'Department' },
  approvals:   { arr: approvals,    name: 'Approval' },
};

// FK references that would block a delete of the targeted entity.
// Keyed by the SLUG being deleted; each entry holds a predicate(id) and
// a human-readable label that becomes the error message.
const FK_DELETE_BLOCKERS = {
  categories:  [id => assets.some(a => a.categoryId === id),  'still assigned to one or more assets'],
  vendors:     [id => assets.some(a => a.vendorId === id) || maintenance.some(m => m.vendorId === id), 'still referenced by assets or maintenance records'],
  locations:   [id => assets.some(a => a.locationId === id),  'still holding one or more assets'],
  users:       [id => assets.some(a => a.assignedToId === id) || assignments.some(a => a.userId === id), 'still assigned to assets or holding assignments'],
};

const crudExports = {};
for (const slug of Object.keys(CRUD_REGISTRY)) {
  const { arr, name } = CRUD_REGISTRY[slug];
  const schema = (schemas[slug]) || [];

  function validateFor(_slug, _arr, input) {
    const errors = {};
    const sch = (schemas[_slug]) || [];
    sch.forEach(f => {
      if (!f.required) return;
      const v = input ? input[f.key] : undefined;
      if (v === undefined || v === '' || v === null) errors[f.key] = `${f.label} is required`;
    });
    return errors;
  }
  // Capture slug + arr per-iteration so the closures reference the right values.
  const validate = (input) => validateFor(slug, arr, input);

  crudExports['create' + name] = function(input) {
    const errors = validate(input || {});
    if (Object.keys(errors).length) return { success: false, errors };
    const newRow = {
      id: id(slug.slice(0, 3), arr.length + 1),
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 0,
    };
    arr.push(newRow);
    return { success: true, data: newRow };
  };

  crudExports['update' + name] = function(idVal, patch) {
    const row = arr.find(r => r.id === idVal);
    if (!row) return { success: false, errors: { _global: 'Not found' } };
    const errors = validate(patch || {});
    if (Object.keys(errors).length) return { success: false, errors };
    Object.assign(row, patch, { updatedAt: new Date().toISOString(), version: (row.version || 0) + 1 });
    return { success: true, data: row };
  };

  crudExports['delete' + name] = function(idVal) {
    const idx = arr.findIndex(r => r.id === idVal);
    if (idx === -1) return { success: false, errors: { _global: 'Not found' } };
    const blocker = FK_DELETE_BLOCKERS[slug];
    if (blocker) {
      const [check, label] = blocker;
      if (check(idVal)) {
        return { success: false, errors: { _global: 'Cannot delete: ' + label + '.' } };
      }
    }
    arr.splice(idx, 1);
    return { success: true };
  };

  crudExports['get' + name + 'ById'] = function(idVal) {
    return arr.find(r => r.id === idVal) || null;
  };

  crudExports['list' + name + 's'] = function() {
    return arr.slice();
  };

  // Per-slug listing getter aliases (matches what server.js getSources() expects).
  if (!crudExports['get' + name + 's']) {
    crudExports['get' + name + 's'] = function() { return arr.slice(); };
  }
}

module.exports = Object.assign({}, {
  // Assets
  getAssets,
  getAssetById,
  getAssignmentsForAsset,
  getMaintenanceForAsset,
  // Global list views
  getAssignments,
  getMaintenance,
  // Dropdowns / directory
  getCategories: () => categories,
  getVendors:    () => vendors,
  getLocations:  () => locations,
  getUsers:      () => users,
  // Constants
  AssetStatus: {
    IN_STOCK:  'IN_STOCK',
    ASSIGNED:  'ASSIGNED',
    IN_REPAIR: 'IN_REPAIR',
    RETIRED:   'RETIRED',
    LOST:      'LOST',
  },
}, crudExports);
