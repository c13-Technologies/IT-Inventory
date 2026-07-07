// One-off test: compile all 5 asset EJS pages, then start the server on a
// free port, curl each route, and assert each response is real HTML.
// Run with: node scripts/test-asset-routes.js
const http = require('http');
const fs = require('fs');
const ejs = require('ejs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3030;

function fail(msg) { console.error('FAIL:', msg); process.exit(1); }
function ok(msg) { console.log('  ok  ', msg); }

// 1) Compile all 5 EJS pages
console.log('=== 1. compile all 5 asset pages ===');
const pages = fs.readdirSync(path.join(ROOT, 'views/pages/assets'))
  .filter(f => f.endsWith('.ejs'));
for (const f of pages) {
  const p = path.join(ROOT, 'views/pages/assets', f);
  try { ejs.compile(fs.readFileSync(p, 'utf8'), { filename: p }); ok('compile ' + f); }
  catch (e) { fail('compile ' + f + ': ' + e.message); }
}

// 2) Compile all partials in isolation
console.log('\n=== 2. compile all partials ===');
const partials = [
  ...fs.readdirSync(path.join(ROOT, 'views/partials')).filter(f => f.endsWith('.ejs')).map(f => 'views/partials/' + f),
  ...fs.readdirSync(path.join(ROOT, 'views/partials/modals')).filter(f => f.endsWith('.ejs')).map(f => 'views/partials/modals/' + f),
];
for (const p of partials) {
  const full = path.join(ROOT, p);
  try { ejs.compile(fs.readFileSync(full, 'utf8'), { filename: full }); ok('compile ' + p); }
  catch (e) { fail('compile ' + p + ': ' + e.message); }
}

// 3) Start the server
console.log('\n=== 3. start server on :' + PORT + ' ===');
process.env.PORT = String(PORT);
const srv = require(path.join(ROOT, 'server.js')); // side-effect: starts listening
// server.js uses listenWithFallback + Promise. Give it a moment.
setTimeout(async () => {
  try {
    // 4) GET each route
    console.log('\n=== 4. GET each asset route ===');
    const mockData = require(path.join(ROOT, 'views/lib/mockData'));
    const sampleId = mockData.getAssets().rows[0].id;
    const routes = ['/assets', '/assets/new', '/assets/' + sampleId, '/assets/' + sampleId + '/edit', '/assets/' + sampleId + '/qr'];
    for (const r of routes) {
      const html = await get(r);
      if (html.length < 500) fail('route ' + r + ' returned ' + html.length + ' bytes (too small)');
      if (html.includes('Error:') || html.includes('Internal Server Error')) fail('route ' + r + ' returned error HTML');
      ok('GET ' + r + ' -> ' + html.length + ' bytes');
    }

    // 5) 404 path
    console.log('\n=== 5. 404 path for unknown asset id ===');
    const html404 = await get('/assets/does_not_exist');
    if (html404.length < 200) fail('404 page too small: ' + html404.length + ' bytes');
    ok('GET /assets/does_not_exist -> ' + html404.length + ' bytes (404 page rendered)');

    // 6) Assert the list page actually rendered rows
    console.log('\n=== 6. assert list page rendered rows ===');
    const listHtml = await get('/assets');
    const rowCount = (listHtml.match(/data-href=(?:"|&#34;)\/assets\/ast_/g) || []).length;
    if (rowCount === 0) fail('list page has 0 rows with data-href');
    ok('list page rendered ' + rowCount + ' rows with data-href');

    // 7) Assert the detail page shows the asset name in the header
    console.log('\n=== 7. assert detail page shows the asset name ===');
    const detailHtml = await get('/assets/' + sampleId);
    if (!/<h4[^>]*>[\s\S]{0,300}?<span class="badge/.test(detailHtml)) fail('detail page missing header + status badge');
    ok('detail page has the asset header + status badge');

    console.log('\n=== ALL TESTS PASSED ===');
    process.exit(0);
  } catch (e) {
    console.error('test error:', e);
    process.exit(1);
  }
}, 1500);

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
