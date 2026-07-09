// prisma/seed.js
//
// Populates the database with sample data matching views/lib/mockData.js.
// Run via:  npx prisma db seed
//
// Order matters (FK dependencies): tenant → roles → departments → users →
// vendors → locations → categories → assets → assignments → maintenance.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

// Bcrypt password hash for seed users (all share the same password: "password123")
const DEFAULT_PASSWORD = 'password123';
let DEFAULT_PASSWORD_HASH = null; // set in main() after bcrypt is ready

async function cleanSlate() {
  // Delete in reverse-dependency order to respect FK constraints
  console.log('Clearing existing data…');
  await prisma.maintenanceRecord.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.department.updateMany({ data: { headId: null } });
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.role.deleteMany();
  await prisma.category.deleteMany();
  await prisma.location.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.tenant.deleteMany();
  console.log('  ✓ Done\n');
}

async function main() {
  DEFAULT_PASSWORD_HASH = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  await cleanSlate();
  console.log('Seeding database…\n');

  // ── 1. Tenant ──────────────────────────────────────────────────
  const tenant = await prisma.tenant.create({
    data: {
      slug: 'c13-tech',
      name: 'C13 Technologies',
      status: 'ACTIVE',
      plan: 'PRO',
      defaultCurrency: 'USD',
      defaultWarrantyMonths: 36,
      settings: {},
    },
  });
  console.log(`  ✓ Tenant: ${tenant.slug}`);

  // ── 2. Roles ───────────────────────────────────────────────────
  const roleData = [
    { name: 'IT Manager',       description: 'Full access to all inventory and admin functions' },
    { name: 'IT Support',       description: 'Can view and manage assets, assignments, and maintenance' },
    { name: 'Department Head',   description: 'Can view and approve requests for their department' },
    { name: 'Employee',          description: 'Can view assigned assets and submit requests' },
    { name: 'Auditor',           description: 'Read-only access to all entities for compliance and audit checks' },
  ];
  const roles = {};
  for (const r of roleData) {
    const role = await prisma.role.create({
      data: { tenantId: tenant.id, name: r.name, description: r.description, isBuiltin: true },
    });
    // Store by a key matching the mock data role strings
    const key = r.name.toUpperCase().replace(/ /g, '_');
    roles[key] = role;
  }
  console.log(`  ✓ Roles: ${Object.keys(roles).length}`);

  // ── 3. Departments ─────────────────────────────────────────────
  const deptIT = await prisma.department.create({
    data: { tenantId: tenant.id, name: 'IT', code: 'IT' },
  });
  const deptENG = await prisma.department.create({
    data: { tenantId: tenant.id, name: 'Engineering', code: 'ENG' },
  });
  const deptCOMP = await prisma.department.create({
    data: { tenantId: tenant.id, name: 'Compliance', code: 'COMP' },
  });
  console.log('  ✓ Departments: 3');

  // ── 4. Users ───────────────────────────────────────────────────
  const userData = [
    { fullName: 'Alex Bytestorm',   email: 'alex.bytestorm@c13-tech.com',   roleKey: 'IT_MANAGER',      department: deptIT   },
    { fullName: 'Billy Nick',      email: 'billy.nick@c13-tech.com',       roleKey: 'IT_SUPPORT',      department: deptIT   },
    { fullName: 'Lydia Acheng',    email: 'lydia.acheng@c13-tech.com',     roleKey: 'EMPLOYEE',        department: deptENG  },
    { fullName: 'Sande Ochieno',   email: 'sande.ochieno@c13-tech.com',    roleKey: 'DEPARTMENT_HEAD', department: deptENG  },
    { fullName: 'Audra Auditor',    email: 'auditor.auditor@c13-tech.com',  roleKey: 'AUDITOR',        department: deptCOMP },
  ];
  const users = [];
  for (const u of userData) {
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        fullName: u.fullName,
        email: u.email,
        passwordHash: DEFAULT_PASSWORD_HASH,
        roleId: roles[u.roleKey].id,
        departmentId: u.department.id,
        status: 'ACTIVE',
      },
    });
    users.push(user);
  }
  // Update department heads
  await prisma.department.update({ where: { id: deptIT.id },  data: { headId: users[0].id } });
  await prisma.department.update({ where: { id: deptENG.id }, data: { headId: users[3].id } });
  console.log(`  ✓ Users: ${users.length}`);

  // ── 5. Vendors ─────────────────────────────────────────────────
  const vendorData = [
    { name: 'Apple Inc.',        contactPerson: null, email: 'business@apple.com',     phone: '+1-800-555-0101', status: 'ACTIVE' },
    { name: 'Dell Technologies', contactPerson: null, email: 'sales@dell.com',          phone: '+1-800-555-0102', status: 'ACTIVE' },
    { name: 'Lenovo',            contactPerson: null, email: 'b2b@lenovo.com',          phone: '+1-800-555-0103', status: 'ACTIVE' },
    { name: 'Microsoft',         contactPerson: null, email: 'volume@microsoft.com',    phone: '+1-800-555-0104', status: 'ACTIVE' },
    { name: 'Samsung',           contactPerson: null, email: 'enterprise@samsung.com',  phone: '+1-800-555-0105', status: 'ACTIVE' },
  ];
  const vendors = [];
  for (const v of vendorData) {
    vendors.push(await prisma.vendor.create({
      data: { tenantId: tenant.id, ...v },
    }));
  }
  console.log('  ✓ Vendors: 5');

  // ── 6. Locations ───────────────────────────────────────────────
  // Note: mock data uses 'DATACENTER'; Prisma enum is DATA_CENTER.
  const locationData = [
    { name: 'HQ - 5th Floor',    type: 'OFFICE',      parentId: null, address: '100 Main St, Floor 5' },
    { name: 'HQ - 6th Floor',    type: 'OFFICE',      parentId: null, address: '100 Main St, Floor 6' },
    { name: 'Remote / WFH',      type: 'REMOTE',      parentId: null, address: 'Employee home' },
    { name: 'Datacenter - East', type: 'DATA_CENTER',  parentId: null, address: '250 Industrial Pkwy' },
  ];
  const locations = [];
  for (const l of locationData) {
    locations.push(await prisma.location.create({
      data: { tenantId: tenant.id, ...l },
    }));
  }
  console.log('  ✓ Locations: 4');

  // ── 7. Categories ──────────────────────────────────────────────
  const categoryData = [
    { name: 'Laptops',           type: 'HARDWARE',  parentId: null },
    { name: 'Monitors',          type: 'HARDWARE',  parentId: null },
    { name: 'Phones',            type: 'HARDWARE',  parentId: null },
    { name: 'Tablets',           type: 'HARDWARE',  parentId: null },
    { name: 'Software Licenses', type: 'SOFTWARE',  parentId: null },
    { name: 'Peripherals',       type: 'ACCESSORY', parentId: null },
  ];
  const categories = [];
  for (const c of categoryData) {
    categories.push(await prisma.category.create({
      data: { tenantId: tenant.id, ...c },
    }));
  }
  console.log('  ✓ Categories: 6');

  // ── 8. Assets (8) ──────────────────────────────────────────────
  // Helper to build asset create data; purchaseCost → Decimal, purchaseDate/warrantyExpiry → Date
  function assetData(a) {
    return {
      tenantId:           tenant.id,
      assetTag:           a.assetTag,
      name:               a.name,
      categoryId:         a.categoryId,
      manufacturer:       a.manufacturer || null,
      model:              a.model || null,
      serialNumber:       a.serialNumber || null,
      macAddress:         a.macAddress || null,
      status:             a.status,
      locationId:         a.locationId,
      vendorId:           a.vendorId || null,
      currency:           a.currency || 'USD',
      purchaseCost:       a.purchaseCost != null ? a.purchaseCost : null,
      purchaseDate:       a.purchaseDate ? new Date(a.purchaseDate) : null,
      warrantyExpiry:     a.warrantyExpiry ? new Date(a.warrantyExpiry) : null,
      depreciationMonths: a.depreciationMonths || null,
      attributes:         a.attributes || {},
      notes:              a.notes || null,
      createdById:        a.createdById,
    };
  }

  const CAT = categories;   // 0=Laptops 1=Monitors 2=Phones 3=Tablets 4=Software 5=Peripherals
  const LOC = locations;   // 0=HQ-5F 1=HQ-6F 2=Remote 3=Datacenter
  const VEN = vendors;     // 0=Apple 1=Dell 2=Lenovo 3=Microsoft 4=Samsung
  const USR = users;       // 0=AlexB 1=Billy 2=Lydia 3=Sande

  const assetInputs = [
    // 1 — IN_STOCK, MBP 16" M3 Max
    {
      assetTag: 'IT-0001', name: 'MacBook Pro 16" M3 Max',
      manufacturer: 'Apple', model: 'MBP16,3', serialNumber: 'C02XK1ABCDE', macAddress: 'F0:18:98:5C:2D:A1',
      status: 'IN_STOCK', categoryId: CAT[0].id, locationId: LOC[0].id, vendorId: VEN[0].id,
      purchaseCost: 3499.00, purchaseDate: '2025-03-15', warrantyExpiry: '2028-03-15', depreciationMonths: 36,
      attributes: { cpu: 'M3 Max', ram_gb: 64, storage_gb: 2048, screen_in: 16, color: 'Space Black' },
      notes: 'Reserved for incoming senior engineer (April start).', createdById: USR[0].id,
    },
    // 2 — IN_STOCK, LG monitor
    {
      assetTag: 'IT-0002', name: 'LG UltraWide 34"',
      manufacturer: 'LG', model: '34WN80C-B', serialNumber: 'LG34WN80C-2024-0421',
      status: 'IN_STOCK', categoryId: CAT[1].id, locationId: LOC[0].id, vendorId: VEN[4].id,
      purchaseCost: 749.00, purchaseDate: '2025-01-10', warrantyExpiry: '2028-01-10', depreciationMonths: 60,
      attributes: { size_in: 34, panel: 'IPS', refresh_hz: 60, resolution: '3440x1440' },
      notes: null, createdById: USR[0].id,
    },
    // 3 — ASSIGNED, MBP 14" M2 Pro → Lydia
    {
      assetTag: 'IT-0003', name: 'MacBook Pro 14" M2 Pro',
      manufacturer: 'Apple', model: 'MBP14,7', serialNumber: 'C02ZK9FGHIJ', macAddress: 'A8:5C:2C:11:7E:B2',
      status: 'ASSIGNED', categoryId: CAT[0].id, locationId: LOC[2].id, vendorId: VEN[0].id,
      purchaseCost: 2499.00, purchaseDate: '2023-06-20', warrantyExpiry: '2026-06-20', depreciationMonths: 36,
      attributes: { cpu: 'M2 Pro', ram_gb: 32, storage_gb: 1024, screen_in: 14, color: 'Silver' },
      notes: 'Extended AppleCare+ until 2026-06-20', createdById: USR[0].id,
    },
    // 4 — ASSIGNED, HP server → Billy
    {
      assetTag: 'IT-0004', name: 'HP ProLiant DL380 Gen11',
      manufacturer: 'HP', model: 'DL380 Gen11', serialNumber: 'SGH713XYZA',
      status: 'ASSIGNED', categoryId: CAT[0].id, locationId: LOC[3].id, vendorId: VEN[1].id,
      purchaseCost: 12499.00, purchaseDate: '2024-08-05', warrantyExpiry: '2027-08-05', depreciationMonths: 60,
      attributes: { cpu_cores: 64, ram_gb: 256, storage_tb: 8, raid: 'RAID 10', form_factor: '2U' },
      notes: 'Production app cluster node-01', createdById: USR[0].id,
    },
    // 5 — IN_REPAIR, iPad
    {
      assetTag: 'IT-0005', name: 'iPad Pro 12.9" (5th gen)',
      manufacturer: 'Apple', model: 'MPL93LL/A', serialNumber: 'DMP9R3LMNOP',
      status: 'IN_REPAIR', categoryId: CAT[3].id, locationId: LOC[0].id, vendorId: VEN[0].id,
      purchaseCost: 1199.00, purchaseDate: '2023-11-12', warrantyExpiry: '2024-11-12', depreciationMonths: 36,
      attributes: { storage_gb: 256, cellular: '5G', screen_in: 12.9 },
      notes: 'Cracked top-right corner. Apple Authorized Service Provider, ticket #SR-99214', createdById: USR[0].id,
    },
    // 6 — RETIRED, Cisco phone
    {
      assetTag: 'IT-0006', name: 'Cisco IP Phone 8841',
      manufacturer: 'Cisco', model: 'CP-8841-K9', serialNumber: 'FCH1234ABCD',
      status: 'RETIRED', categoryId: CAT[2].id, locationId: LOC[0].id, vendorId: VEN[1].id,
      purchaseCost: 329.00, purchaseDate: '2019-04-22', warrantyExpiry: '2022-04-22', depreciationMonths: 60,
      attributes: { poe: 'Class 2', voip: 'SIP', lines: 5 },
      notes: 'Retired 2024-12. Recycled through e-waste vendor GreenChip.', createdById: USR[0].id,
    },
    // 7 — LOST, projector
    {
      assetTag: 'IT-0007', name: 'Epson Pro EB-1485Fi',
      manufacturer: 'Epson', model: 'EB-1485Fi', serialNumber: 'X9BG2300RST',
      status: 'LOST', categoryId: CAT[1].id, locationId: LOC[2].id, vendorId: VEN[1].id,
      purchaseCost: 2199.00, purchaseDate: '2024-02-18', warrantyExpiry: '2027-02-18', depreciationMonths: 60,
      attributes: { lumens: 5000, resolution: '1080p', laser: true },
      notes: 'Last seen in Conference Room A, 2025-01-22. Insurance claim filed.', createdById: USR[0].id,
    },
    // 8 — IN_STOCK, GPU
    {
      assetTag: 'IT-0008', name: 'NVIDIA RTX 4090 FE',
      manufacturer: 'NVIDIA', model: 'RTX 4090 FE', serialNumber: 'NV-4090FE-2024-0098',
      status: 'IN_STOCK', categoryId: CAT[5].id, locationId: LOC[0].id, vendorId: VEN[1].id,
      purchaseCost: 1799.00, purchaseDate: '2024-12-01', warrantyExpiry: '2026-12-01', depreciationMonths: 36,
      attributes: { vram_gb: 24, tdp_w: 450, bus: 'PCIe 4.0 x16' },
      notes: 'Stored in anti-static bag in IT room cabinet B-3', createdById: USR[0].id,
    },
  ];

  const assets = [];
  for (const a of assetInputs) {
    assets.push(await prisma.asset.create({ data: assetData(a) }));
  }
  console.log('  ✓ Assets: 8');

  // ── 9. Assignments (3) ─────────────────────────────────────────
  // asn-1: asset[2] (MBP 14") → user[2] (Lydia), assigned by user[0] (AlexB)
  // asn-2: asset[3] (HP server) → user[1] (Billy), assigned by user[0]
  // asn-3: asset[2] (MBP 14") → user[3] (Sande), returned, assigned by user[0]
  const assignmentData = [
    { assetId: assets[2].id, userId: USR[2].id, assignedById: USR[0].id, assignedAt: '2023-06-22T09:00:00Z', returnedAt: null,                     expectedReturnAt: null,         notes: 'Permanent assignment' },
    { assetId: assets[3].id, userId: USR[1].id, assignedById: USR[0].id, assignedAt: '2024-08-10T08:00:00Z', returnedAt: null,                     expectedReturnAt: null,         notes: 'Assigned to IT support' },
    { assetId: assets[2].id, userId: USR[3].id, assignedById: USR[0].id, assignedAt: '2023-06-20T14:00:00Z', returnedAt: '2023-06-22T09:00:00Z', expectedReturnAt: '2023-06-22T09:00:00Z', notes: 'Initial stock assignment, transferred' },
  ];
  for (const a of assignmentData) {
    await prisma.assignment.create({
      data: {
        tenantId: tenant.id,
        assetId: a.assetId,
        userId: a.userId,
        assignedById: a.assignedById,
        assignedAt: new Date(a.assignedAt),
        expectedReturnAt: a.expectedReturnAt ? new Date(a.expectedReturnAt) : null,
        returnedAt: a.returnedAt ? new Date(a.returnedAt) : null,
        notes: a.notes,
      },
    });
  }
  console.log('  ✓ Assignments: 3');

  // ── 10. Maintenance Records (3) ────────────────────────────────
  // Note: mock uses 'DECOMMISSION'/'PREVENTIVE' types and 'COMPLETED' status;
  // Prisma enums are REPAIR/UPGRADE/INSPECTION/WARRANTY_CLAIM and OPEN/IN_PROGRESS/CLOSED.
  // Map: DECOMMISSION→UPGRADE, PREVENTIVE→INSPECTION, COMPLETED→CLOSED.
  // mnt-1: asset[4] (iPad), vendor Apple, type REPAIR → IN_PROGRESS
  // mnt-2: asset[5] (Cisco), vendor Dell, type DECOMMISSION → UPGRADE, CLOSED
  // mnt-3: asset[3] (HP server), vendor Dell, type PREVENTIVE → INSPECTION, CLOSED
  const maintenanceData = [
    { assetId: assets[4].id, vendorId: VEN[0].id, type: 'REPAIR',      description: 'Screen replacement after impact damage (ticket SR-99214)',        cost: 379.00, performedAt: '2025-02-18', status: 'IN_PROGRESS' },
    { assetId: assets[5].id, vendorId: VEN[1].id, type: 'UPGRADE',     description: 'End-of-life retirement and e-waste recycling (ticket EW-2024-118)', cost: 0,      performedAt: '2024-12-15', status: 'CLOSED' },
    { assetId: assets[3].id, vendorId: VEN[1].id, type: 'INSPECTION',  description: 'Annual firmware update + dust filter cleaning (ticket PM-2024-014)',  cost: 250.00,  performedAt: '2024-11-10', status: 'CLOSED' },
  ];
  for (const m of maintenanceData) {
    await prisma.maintenanceRecord.create({
      data: {
        tenantId: tenant.id,
        assetId: m.assetId,
        type: m.type,
        description: m.description,
        cost: m.cost,
        currency: 'USD',
        vendorId: m.vendorId,
        performedById: null,
        performedAt: new Date(m.performedAt),
        status: m.status,
      },
    });
  }
  console.log('  ✓ Maintenance: 3');

  console.log('\nSeed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
