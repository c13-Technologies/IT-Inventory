// scripts/convert-to-ejs.js
//
// ONE-OFF conversion: extract shared sections from index.html into 6 EJS
// partials, then convert every *.html page in the project root into an
// EJS view that includes those partials.
//
// Run:  node scripts/convert-to-ejs.js
//
// Output:
//   views/partials/{head,topbar,sidebar,footer,scripts,scripts-auth}.ejs
//   views/pages/<name>.ejs  (one per *.html, minus this script's own dir)
//   views/titles.json       (page-name -> human title, used by server.js)
//
// Safe to delete this file after a successful run.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const PARTIALS_DIR = path.join(ROOT, 'views', 'partials');
const PAGES_DIR = path.join(ROOT, 'views', 'pages');
const TITLES_PATH = path.join(ROOT, 'views', 'titles.json');

const COMMON_LIBS = [
  'assets/libs/jquery/jquery.min.js',
  'assets/libs/bootstrap/js/bootstrap.bundle.min.js',
  'assets/libs/metismenu/metisMenu.min.js',
  'assets/libs/simplebar/simplebar.min.js',
  'assets/libs/node-waves/waves.min.js',
  'assets/libs/feather-icons/feather.min.js',
  'assets/libs/pace-js/pace.min.js',
];
const COMMON_LIB_SET = new Set(COMMON_LIBS);
const APP_JS = 'assets/js/app.js';

const SUFFIX_RE = /\s*\|\s*Minia.*$/i;

// ---------------- helpers ----------------

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function write(rel, body) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return 'Page';
  return m[1].replace(SUFFIX_RE, '').trim();
}

function detectLayout(html) {
  if (html.includes('id="page-topbar"') || html.includes('class="vertical-menu"')) {
    return 'main';
  }
  if (html.includes('class="auth-page"') || html.includes('auth-page d-flex')) {
    return 'auth';
  }
  return 'error';
}

function listScriptSrcs(html) {
  const re = /<script\s+src="([^"]+)"\s*>\s*<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// Extract a substring bounded by two literal markers, returning null if either
// marker is missing.
function between(html, startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  if (s === -1) return null;
  const e = html.indexOf(endMarker, s);
  if (e === -1) return null;
  return html.substring(s, e + endMarker.length);
}

// ---------------- step 1: partials from index.html ----------------

function buildPartials() {
  const indexHtml = read('index.html');

  // head.ejs  — DOCTYPE .. </head>, with <title> replaced by an EJS var
  const headSrc = indexHtml.substring(
    indexHtml.indexOf('<!doctype html>'),
    indexHtml.indexOf('</head>') + '</head>'.length
  );
  const headEjs = headSrc.replace(
    /<title>[^<]+<\/title>/,
    '<title><%= title %> | Minia - Minimal Admin & Dashboard Template</title>'
  );
  write('views/partials/head.ejs', headEjs);

  // topbar.ejs  — entire <header id="page-topbar">...</header>
  const topbarEjs = between(indexHtml, '<header id="page-topbar">', '</header>');
  if (!topbarEjs) throw new Error('Could not extract topbar from index.html');
  write('views/partials/topbar.ejs', topbarEjs);

  // sidebar.ejs  — <div class="vertical-menu"> ... up to the "Left Sidebar End" comment
  const sidebarStart = indexHtml.indexOf('<div class="vertical-menu">');
  const sidebarEnd = indexHtml.indexOf('<!-- Left Sidebar End -->');
  if (sidebarStart < 0 || sidebarEnd < 0) {
    throw new Error('Could not extract sidebar from index.html');
  }
  write('views/partials/sidebar.ejs', indexHtml.substring(sidebarStart, sidebarEnd).trim() + '\n');

  // footer.ejs  — <footer class="footer"> ... </footer>
  const footerEjs = between(indexHtml, '<footer class="footer">', '</footer>');
  if (!footerEjs) throw new Error('Could not extract footer from index.html');
  write('views/partials/footer.ejs', footerEjs);

  // scripts.ejs  — common libs (jquery .. pace) + app.js, with a
  // `pageScripts` slot in between for per-page extras.
  const firstLibIdx = indexHtml.indexOf(COMMON_LIBS[0]);
  const appJsLineEnd = indexHtml.indexOf('\n', indexHtml.indexOf(APP_JS)) + 1;
  if (firstLibIdx < 0 || appJsLineEnd < 0) {
    throw new Error('Could not extract scripts block from index.html');
  }
  const commonBlock = indexHtml.substring(firstLibIdx, appJsLineEnd).trimEnd();

  // Split out the "pace.min.js" line as the end of the common libs.
  const lastLibIdx = commonBlock.lastIndexOf('pace.min.js');
  const commonOnly = commonBlock.substring(0, lastLibIdx + 'pace.min.js'.length);

  const scriptsEjs =
    '\n' + indent(commonOnly, 4) + '\n' +
    '\n' +
    '<% if (typeof pageScripts !== "undefined" && pageScripts && pageScripts.length) { %>\n' +
    '<% pageScripts.forEach(function (s) { %>\n' +
    '    <script src="<%= s %>"></script>\n' +
    '<% }); %>\n' +
    '<% } %>\n' +
    '\n' +
    '    <script src="assets/js/app.js"></script>\n';
  write('views/partials/scripts.ejs', scriptsEjs);

  // scripts-auth.ejs  — same common libs, no app.js (auth pages don't need it)
  const scriptsAuthEjs =
    '\n' + indent(commonOnly, 4) + '\n' +
    '\n' +
    '<% if (typeof pageScripts !== "undefined" && pageScripts && pageScripts.length) { %>\n' +
    '<% pageScripts.forEach(function (s) { %>\n' +
    '    <script src="<%= s %>"></script>\n' +
    '<% }); %>\n' +
    '<% } %>\n';
  write('views/partials/scripts-auth.ejs', scriptsAuthEjs);
}

function indent(block, spaces) {
  const pad = ' '.repeat(spaces);
  return block.split('\n').map(l => l.length ? pad + l : l).join('\n');
}

// ---------------- step 2: convert every *.html ----------------

function pageScriptsFor(html) {
  return listScriptSrcs(html).filter(s => !COMMON_LIB_SET.has(s) && s !== APP_JS);
}

function convertMainLayout(html, title) {
  let out = html;

  // head
  out = out.replace(
    /<!doctype html>[\s\S]*?<\/head>/i,
    `<%- include('../partials/head', { title: ${JSON.stringify(title)} }) %>`
  );

  // topbar
  out = out.replace(
    /<header id="page-topbar">[\s\S]*?<\/header>/,
    `<%- include('../partials/topbar') %>`
  );

  // sidebar (from the opening <div class="vertical-menu"> up to the
  // "Left Sidebar End" comment that follows the closing </div>).
  out = out.replace(
    /<div class="vertical-menu">[\s\S]*?<!-- Left Sidebar End -->/,
    `<%- include('../partials/sidebar') %>\n        <!-- Left Sidebar End -->`
  );

  // footer
  out = out.replace(
    /<footer class="footer">[\s\S]*?<\/footer>/,
    `<%- include('../partials/footer') %>`
  );

  // scripts: replace the first <script> through the app.js line with a single
  // include that injects the page-specific extras via the pageScripts variable.
  const firstLibIdx = out.indexOf(COMMON_LIBS[0]);
  const appJsLineEnd = out.indexOf('\n', out.indexOf(APP_JS)) + 1;
  if (firstLibIdx > -1 && appJsLineEnd > 0) {
    const before = out.substring(0, firstLibIdx);
    const after = out.substring(appJsLineEnd);
    const pageScripts = pageScriptsFor(html);
    out = before +
      `<%- include('../partials/scripts', { pageScripts: ${JSON.stringify(pageScripts)} }) %>\n` +
      after;
  }

  return out;
}

function convertAuthLayout(html, title) {
  let out = html;

  // head
  out = out.replace(
    /<!doctype html>[\s\S]*?<\/head>/i,
    `<%- include('../partials/head', { title: ${JSON.stringify(title)} }) %>`
  );

  // scripts: from the first common lib through the last (pace.min.js) line.
  const firstLibIdx = out.indexOf(COMMON_LIBS[0]);
  const lastLibName = COMMON_LIBS[COMMON_LIBS.length - 1];
  const lastLibEnd = out.indexOf('\n', out.indexOf(lastLibName)) + 1;
  if (firstLibIdx > -1 && lastLibEnd > 0) {
    const before = out.substring(0, firstLibIdx);
    const after = out.substring(lastLibEnd);
    const pageScripts = pageScriptsFor(html);
    out = before +
      `<%- include('../partials/scripts-auth', { pageScripts: ${JSON.stringify(pageScripts)} }) %>\n` +
      after;
  }

  return out;
}

function convertAll() {
  const files = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    .sort();

  fs.mkdirSync(PAGES_DIR, { recursive: true });

  const titles = {};
  const summary = [];

  for (const file of files) {
    const html = read(file);
    const title = extractTitle(html);
    const layout = detectLayout(html);
    const pageScripts = pageScriptsFor(html);

    const ejs = (layout === 'main')
      ? convertMainLayout(html, title)
      : convertAuthLayout(html, title);

    const ejsName = file.replace(/\.html$/, '.ejs');
    write(path.join('views', 'pages', ejsName), ejs);

    const stem = file.replace(/\.html$/, '');
    titles[stem] = title;
    summary.push({ file, ejs: ejsName, layout, title, pageScripts: pageScripts.length });
  }

  fs.writeFileSync(TITLES_PATH, JSON.stringify(titles, null, 2) + '\n');

  console.log('\n--- Conversion summary ---');
  console.log('Layouts: ' + summary.reduce((acc, r) => (acc[r.layout] = (acc[r.layout] || 0) + 1, acc), {}));
  console.log('Total pages: ' + summary.length);
  for (const r of summary) {
    console.log(
      '  ' + r.file.padEnd(34) + ' -> views/pages/' + r.ejs.padEnd(28) +
      ' [' + r.layout + ']' + (r.pageScripts ? ' (' + r.pageScripts + ' page scripts)' : '')
    );
  }
  console.log('\nTitles map written to views/titles.json (' + Object.keys(titles).length + ' entries)');
}

// ---------------- main ----------------

(function main() {
  console.log('Step 1: building 6 partials from index.html ...');
  buildPartials();
  console.log('  head.ejs, topbar.ejs, sidebar.ejs, footer.ejs, scripts.ejs, scripts-auth.ejs');

  console.log('\nStep 2: converting every *.html to views/pages/*.ejs ...');
  convertAll();

  console.log('\nDone. Next: update server.js to mount EJS, then `npm start` and curl /index.html.');
})();
