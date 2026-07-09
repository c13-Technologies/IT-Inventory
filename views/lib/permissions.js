// views/lib/permissions.js
//
// Single source of truth for the permission taxonomy + the 5 builtin
// role's permission sets. Consumed by:
//   - prisma/seed.js: BUILTINS for the role_permissions junction
//     createMany; CODES for the Permission upsert
//   - server.js: buildBuiltinKeyMap() for the pre-migration session
//     fallback (transformed to UPPERCASE_UNDERSCORE keys so they
//     match the session's userRole field set by POST /login's
//     `user.role.name.toUpperCase().replace(/ /g, '_')` transform)
//   - views/lib/prismaData.js: GROUPS for the role form's checkbox
//     taxonomy (new.ejs + edit.ejs iterate this to render one
//     card per namespace with Read + Write checkboxes)
//
// Adding a new permission code:
//   1. Add the code to CODES
//   2. Add a matching group entry to GROUPS (namespace must match
//      the code's prefix, e.g. 'assets:read' -> namespace 'assets')
//   3. Optionally add the code to one or more BUILTINS role arrays
// Then re-run `npx prisma db seed` to materialize the changes in
// the Permission + role_permissions tables.

'use strict';

// 13 canonical permission codes. Mirrors the 6 namespaces below +
// the standalone dashboard:read perm.
const CODES = [
  'assets:read', 'assets:write',
  'lifecycle:read', 'lifecycle:write',
  'directory:read', 'directory:write',
  'inventory:read', 'inventory:write',
  'admin:read', 'admin:write',
  'communications:read', 'communications:write',
  'dashboard:read',
];

// 5 builtin role -> permission map. Keys are human-readable (matches
// Role.name in the DB). server.js transforms these to
// UPPERCASE_UNDERSCORE format on lookup via buildBuiltinKeyMap() so
// they match the session's userRole field.
const BUILTINS = {
  'IT Manager': [
    'assets:read', 'assets:write',
    'lifecycle:read', 'lifecycle:write',
    'directory:read', 'directory:write',
    'inventory:read', 'inventory:write',
    'dashboard:read',
    'admin:read', 'admin:write',
    'communications:read', 'communications:write',
  ],
  'IT Support': [
    'assets:read', 'assets:write',
    'lifecycle:read', 'lifecycle:write',
    'directory:read',
    'inventory:read',
    'dashboard:read',
    'admin:read',
    'communications:read',
  ],
  'Department Head': [
    'assets:read',
    'lifecycle:read',
    'lifecycle:write',  // promoted so DEPT_HEAD can approve asset requests
    'directory:read',
  ],
  'Employee': [
    'assets:read',
    'lifecycle:read',
  ],
  'Auditor': [
    'assets:read',
    'lifecycle:read',
    'directory:read',
    'inventory:read',
    'admin:read',
    'communications:read',
    'dashboard:read',
  ],
};

// Namespace catalog for the role form's checkbox layout. Drives
// new.ejs + edit.ejs via prismaData.PERMISSION_GROUPS. The
// `dashboard` group has a no-op Write checkbox today (no
// dashboard:write code exists) -- flagged in a followup to either
// add the perm or omit the Write checkbox for read-only groups.
const GROUPS = [
  { namespace: 'assets',         label: 'Assets',         description: 'Hardware, software, accessories — view and modify records.' },
  { namespace: 'lifecycle',      label: 'Lifecycle',      description: 'Assignments, maintenance, approvals, warranty.' },
  { namespace: 'directory',      label: 'Directory',      description: 'Users, vendors, locations, categories, departments.' },
  { namespace: 'inventory',      label: 'Inventory',      description: 'Software licenses and seat allocation.' },
  { namespace: 'admin',          label: 'Admin',          description: 'Roles, audit log, reports.' },
  { namespace: 'communications', label: 'Communications', description: 'Notifications and webhook subscriptions.' },
  { namespace: 'dashboard',      label: 'Dashboard',      description: 'Read-only access to tenant-aggregate dashboard metrics (total assets, users, vendors, status counts, 7-day trends, recent activity).' },
];

// Build the UPPERCASE_UNDERSCORE-keyed map for server.js's
// pre-migration session fallback. Mirrors the
// `user.role.name.toUpperCase().replace(/ /g, '_')` transform that
// POST /login uses to populate req.session.userRole, so the key
// shape matches what can(perm) looks up.
function buildBuiltinKeyMap() {
  const out = {};
  for (const [name, codes] of Object.entries(BUILTINS)) {
    out[name.toUpperCase().replace(/ /g, '_')] = codes;
  }
  return out;
}

module.exports = { CODES, BUILTINS, GROUPS, buildBuiltinKeyMap };
