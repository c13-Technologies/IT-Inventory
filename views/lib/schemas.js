// views/lib/schemas.js
//
// Single source of truth for the field shape of every list-entity in the
// IT-inventory sidebar. server.js route handlers, mockData mutators, and
// views/partials/crud-form.ejs all read from this file.
//
// Shape (per field):
//   { key:'name',           label:'Name',        type:'text',       required:true }
//   { key:'email',          label:'Email',       type:'email' }
//   { key:'cost',           label:'Cost',        type:'number', step:'0.01' }
//   { key:'status',         label:'Status',      type:'select',     options:['ACTIVE','INACTIVE'], required:true }
//   { key:'parentId',       label:'Parent',      type:'select-fk',  source:'categories' }
//   { key:'description',    label:'Notes',       type:'textarea' }
//   { key:'purchaseDate',   label:'Purchase',    type:'date' }
//
// `source` on a select-fk is looked up at render time by server.js, which
// injects a `sources` object into the view ({ categories: [...], users: [...] }).

'use strict';

const schemas = {

  vendors: [
    { key: 'name',          label: 'Name',           type: 'text',    required: true },
    { key: 'contactPerson', label: 'Contact person', type: 'text' },
    { key: 'email',         label: 'Email',          type: 'email' },
    { key: 'phone',         label: 'Phone',          type: 'text' },
    { key: 'website',       label: 'Website',        type: 'text' },
    { key: 'address',       label: 'Address',        type: 'textarea' },
    { key: 'status',        label: 'Status',         type: 'select', options: ['ACTIVE', 'INACTIVE'], required: true },
  ],

  locations: [
    { key: 'name',     label: 'Name',     type: 'text', required: true },
    { key: 'type',     label: 'Type',     type: 'select', options: ['OFFICE', 'BUILDING', 'ROOM', 'DATACENTER', 'REMOTE'], required: true },
    { key: 'address',  label: 'Address',  type: 'textarea' },
    { key: 'parentId', label: 'Parent location', type: 'select-fk', source: 'locations' },
  ],

  categories: [
    { key: 'name',        label: 'Name',        type: 'text',     required: true },
    { key: 'type',        label: 'Type',        type: 'select',   options: ['HARDWARE', 'SOFTWARE', 'PERIPHERAL', 'ACCESSORY'], required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'parentId',    label: 'Parent',      type: 'select-fk', source: 'categories' },
  ],

  users: [
    { key: 'fullName',     label: 'Full name', type: 'text',         required: true },
    { key: 'email',        label: 'Email',     type: 'email',        required: true },
    { key: 'phone',        label: 'Phone',     type: 'text' },
    { key: 'role',         label: 'Role',      type: 'select',       options: ['IT_MANAGER','IT_SUPPORT','DEPARTMENT_HEAD','EMPLOYEE'], required: true },
    { key: 'departmentId', label: 'Department',type: 'select-fk',     source: 'departments' },
    { key: 'status',       label: 'Status',    type: 'select',       options: ['ACTIVE','DISABLED','PENDING'], required: true },
  ],

  assignments: [
    { key: 'assetId',          label: 'Asset',           type: 'select-fk', source: 'assets',     required: true },
    { key: 'userId',           label: 'Assigned to',     type: 'select-fk', source: 'users',      required: true },
    { key: 'assignedAt',       label: 'Assigned at',     type: 'date' },
    { key: 'expectedReturnAt', label: 'Expected return', type: 'date' },
    { key: 'returnedAt',       label: 'Returned at',     type: 'date', readonly: true },
    { key: 'notes',            label: 'Notes',           type: 'textarea' },
  ],

  maintenance: [
    { key: 'assetId',       label: 'Asset',     type: 'select-fk', source: 'assets',  required: true },
    { key: 'type',          label: 'Type',      type: 'select',    options: ['REPAIR','UPGRADE','INSPECTION','WARRANTY_CLAIM'], required: true },
    { key: 'vendorId',      label: 'Vendor',    type: 'select-fk', source: 'vendors' },
    { key: 'description',   label: 'Description',type: 'textarea', required: true },
    { key: 'cost',          label: 'Cost',      type: 'number',   step: '0.01' },
    { key: 'ticketNumber',  label: 'Ticket #',  type: 'text' },
    { key: 'performedAt',   label: 'Performed at', type: 'date' },
    { key: 'status',        label: 'Status',    type: 'select',    options: ['OPEN','IN_PROGRESS','COMPLETED','CLOSED'], required: true },
  ],

  licenses: [
    { key: 'name',        label: 'Name',         type: 'text', required: true },
    { key: 'vendorId',    label: 'Vendor',       type: 'select-fk', source: 'vendors' },
    { key: 'licenseKey',  label: 'License key',  type: 'text', required: true },
    { key: 'seatsTotal',  label: 'Total seats',  type: 'number', step: '1' },
    { key: 'cost',        label: 'Cost',         type: 'number', step: '0.01' },
    { key: 'purchaseDate',label: 'Purchase date',type: 'date' },
    { key: 'expiryDate',  label: 'Expiry date',  type: 'date' },
    { key: 'notes',       label: 'Notes',        type: 'textarea' },
  ],

  departments: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'code', label: 'Code', type: 'text', required: true },
    { key: 'headId', label: 'Department head', type: 'select-fk', source: 'users' },
  ],

  approvals: [
    { key: 'type',         label: 'Type',   type: 'select', options: ['ASSET_ASSIGN','ASSET_RETIRE','ASSET_DELETE','USER_DISABLE'], required: true },
    { key: 'entityType',   label: 'Entity',  type: 'text', required: true },
    { key: 'entityId',     label: 'Entity ID', type: 'text', required: true },
    { key: 'status',       label: 'Status',  type: 'select', options: ['PENDING','APPROVED','REJECTED','CANCELLED'], required: true },
    { key: 'rejectionReason', label: 'Rejection reason', type: 'textarea' },
  ],
};

module.exports = schemas;
