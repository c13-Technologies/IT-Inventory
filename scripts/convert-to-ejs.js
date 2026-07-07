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
//   views/pages/<name>.ejs  (one per *.html)
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

function between(html, startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  if (s === -1) return null;
  const e = html.indexOf(endMarker, s);
  if (e === -1) return null;
  return html.substring(s, e + endMarker.length);
}

// Return the full text of the line containing <script src="URL"></script>.
// Critical: this preserves the leading '<script src="' AND the trailing
// '"></script>' of the matched line. The previous version used
// html.indexOf(url) which found the URL mid-line and dropped both edges.
function getScriptLineText(html, url) {
  const idx = html.indexOf(url);
  if (idx < 0) return null;
  // Walk back to the start of the line that contains this URL.
  const lineStart = html.lastIndexOf('\n', idx) + 1;
  if (html.substring(lineStart, idx).indexOf('<script') < 0) return null;
  // Walk forward through </script> and the trailing newline.
  const closeIdx = html.indexOf('</script>', idx);
  if (closeIdx < 0) return null;
  const lineEndIdx = html.indexOf('\n', closeIdx);
  const end = lineEndIdx >= 0 ? lineEndIdx : html.length;
  return html.substring(lineStart, end);
}

// Return { text, start, end } of the line containing <script src="URL"></script>.
function findScriptLine(html, url) {
  const idx = html.indexOf(url);
  if (idx < 0) return null;
  const lineStart = html.lastIndexOf('\n', idx) + 1;
  if (html.substring(lineStart, idx).indexOf('<script') < 0) return null;
  const closeIdx = html.indexOf('</script>', idx);
  if (closeIdx < 0) return null;
  const lineEndIdx = html.indexOf('\n', closeIdx);
  const end = lineEndIdx >= 0 ? lineEndIdx : html.length;
  return { text: html.substring(lineStart, end), start: lineStart, end };
}

// ---------------- step 1: partials from index.html ----------------

function buildPartials() {
  const indexHtml = read('index.html');

  // head.ejs — DOCTYPE .. </head>, with <title> replaced by an EJS var
  const headSrc = between(indexHtml, '<!doctype html>', '</head>');
  if (!headSrc) throw new Error('Could not extract head from index.html');
  const headEjs = headSrc.replace(
    /<title>[^<]+<\/title>/,
    '<title><%= title %> | Minia - Minimal Admin & Dashboard Template</title>'
  );
  write('views/partials/head.ejs', headEjs);

  // topbar.ejs — entire <header id="page-topbar">...</header>
  const topbarEjs = between(indexHtml, '<header id="page-topbar">', '</header>');
  if (!topbarEjs) throw new Error('Could not extract topbar from index.html');
  write('views/partials/topbar.ejs', topbarEjs);

  // sidebar.ejs — <div class="vertical-menu"> ... up to the "Left Sidebar End" comment
  const sidebarStart = indexHtml.indexOf('<div class="vertical-menu">');
  const sidebarEnd = indexHtml.indexOf('<!-- Left Sidebar End -->');
  if (sidebarStart < 0 || sidebarEnd < 0) {
    throw new Error('Could not extract sidebar from index.html');
  }
  write('views/partials/sidebar.ejs', indexHtml.substring(sidebarStart, sidebarEnd).trim() + '\n');

  // footer.ejs — <footer class="footer"> ... </footer>
  const footerEjs = between(indexHtml, '<footer class="footer">', '</footer>');
  if (!footerEjs) throw new Error('Could not extract footer from index.html');
  write('views/partials/footer.ejs', footerEjs);

  // scripts.ejs — common libs (jquery .. pace) + app.js, with a
  // `pageScripts` slot in between for per-page extras. Use getScriptLineText
  // so each line is captured WHOLE (with its leading <script src=" and
  // trailing ></script> intact).
  const commonLines = COMMON_LIBS
    .map(lib => getScriptLineText(indexHtml, lib))
    .filter(Boolean);
  if (commonLines.length !== COMMON_LIBS.length) {
    const missing = COMMON_LIBS.filter(lib => !getScriptLineText(indexHtml, lib));
    throw new Error('Missing common libs in index.html: ' + missing.join(', '));
  }
  // commonBlock already has the original 4-space indentation on each line.
  const commonBlock = commonLines.join('\n') + '\n';

  const scriptsEjs =
    '\n' + commonBlock + '\n' +
    '<% if (typeof pageScripts !== "undefined" && pageScripts && pageScripts.length) { %>\n' +
    '<% pageScripts.forEach(function (s) { %>\n' +
    '    <script src="<%= s %>"></script>\n' +
    '<% }); %>\n' +
    '<% } %>\n' +
    '\n' +
    '    <script src="assets/js/app.js"></script>\n';
  write('views/partials/scripts.ejs', scriptsEjs);

  // scripts-auth.ejs — same common libs, no app.js (auth pages don't need it)
  const scriptsAuthEjs =
    '\n' + commonBlock + '\n' +
    '<% if (typeof pageScripts !== "undefined" && pageScripts && pageScripts.length) { %>\n' +
    '<% pageScripts.forEach(function (s) { %>\n' +
    '    <script src="<%= s %>"></script>\n' +
    '<% }); %>\n' +
    '<% } %>\n';
  write('views/partials/scripts-auth.ejs', scriptsAuthEjs);
}

// ---------------- step 2: convert every *.html ----------------

function pageScriptsFor(html) {
  return listScriptSrcs(html).filter(s => !COMMON_LIB_SET.has(s) && s !== APP_JS);
}

function convertMainLayout(html, title) {
  let out = html;

  out = out.replace(
    /<!doctype html>[\s\S]*?<\/head>/i,
    `<%- include('../partials/head', { title: ${JSON.stringify(title)} }) %>`
  );

  out = out.replace(
    /<header id="page-topbar">[\s\S]*?<\/header>/,
    `<%- include('../partials/topbar') %>`
  );

  out = out.replace(
    /<div class="vertical-menu">[\s\S]*?<!-- Left Sidebar End -->/,
    `<%- include('../partials/sidebar') %>\n        <!-- Left Sidebar End -->`
  );

  out = out.replace(
    /<footer class="footer">[\s\S]*?<\/footer>/,
    `<%- include('../partials/footer') %>`
  );

  // scripts: replace from the start of the jquery.min.js LINE through the
  // end of the app.js LINE (inclusive) with a single include. Using
  // findScriptLine avoids the off-by-tag bug from the previous version.
  const firstLine = findScriptLine(out, COMMON_LIBS[0]);
  const appJsLine = findScriptLine(out, APP_JS);
  if (firstLine && appJsLine && appJsLine.start > firstLine.start) {
    const before = out.substring(0, firstLine.start);
    const after = out.substring(appJsLine.end);
    const pageScripts = pageScriptsFor(html);
    out = before +
      `<%- include('../partials/scripts', { pageScripts: ${JSON.stringify(pageScripts)} }) %>\n` +
      after;
  }

  return out;
}

function convertAuthLayout(html, title) {
  let out = html;

  out = out.replace(
    /<!doctype html>[\s\S]*?<\/head>/i,
    `<%- include('../partials/head', { title: ${JSON.stringify(title)} }) %>`
  );

  // scripts: replace from the start of the jquery.min.js LINE through the
  // end of the pace.min.js LINE (inclusive) with a single include. No app.js.
  const firstLine = findScriptLine(out, COMMON_LIBS[0]);
  const lastLine = findScriptLine(out, COMMON_LIBS[COMMON_LIBS.length - 1]);
  if (firstLine && lastLine && lastLine.start > firstLine.start) {
    const before = out.substring(0, firstLine.start);
    const after = out.substring(lastLine.end);
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
  console.log('Layouts: ' + JSON.stringify(summary.reduce((acc, r) => (acc[r.layout] = (acc[r.layout] || 0) + 1, acc), {})));
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

  console.log('\nDone. Next: delete the now-redundant root *.html files, then `npm start`.');
})();
