// scripts/verify-render.js
// Quick smoke test: start server, fetch / and a few other pages, verify
// every <script src="..."></script> tag in the rendered HTML is well-formed
// (i.e. the URL sits between proper <script src=" and "></script> tags on a
// single line, with no missing leading <script or trailing ></script>).
//
// Run: node scripts/verify-render.js

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 3014;
const serverPath = path.resolve(__dirname, '..', 'server.js');

function fetch(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

function findScriptLineIssues(html) {
  // For each line that contains "src=", check that:
  //  - the line starts with optional whitespace + '<script src="'
  //  - and ends with '"></script>' (optional trailing whitespace)
  const issues = [];
  const lines = html.split(/\n/);
  lines.forEach((line, i) => {
    if (!line.includes('src=')) return;
    const trimmed = line.trim();
    if (trimmed.startsWith('<script') && !/^<script\s+src="[^"]+"><\/script>\s*$/.test(trimmed)) {
      issues.push({ line: i + 1, text: line });
    }
  });
  return issues;
}

async function main() {
  console.log('Starting server on :' + PORT + ' ...');
  const srv = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let booted = false;
  srv.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('Clarity server running')) booted = true;
  });
  srv.stderr.on('data', d => process.stderr.write(d));

  // Wait for boot
  for (let i = 0; i < 30 && !booted; i++) await new Promise(r => setTimeout(r, 200));
  if (!booted) {
    srv.kill();
    throw new Error('Server did not boot');
  }
  console.log('Server up.\n');

  const pages = [
    '/index.html',
    '/apps-chat.html',
    '/auth-login.html',
    '/pages-404.html',
    '/nonexistent.html',
  ];

  let totalIssues = 0;
  for (const p of pages) {
    const res = await fetch(p);
    const issues = findScriptLineIssues(res.body);
    const wellFormed = (res.body.match(/<script src="[^"]+"><\/script>/g) || []).length;
    const totalSrc = (res.body.match(/src=/g) || []).length;
    const ejsMarkers = (res.body.match(/<%/g) || []).length;
    const appJs = res.body.includes('assets/js/app.js') ? 1 : 0;
    const status = res.status;
    const bytes = res.body.length;

    console.log(p.padEnd(30) + ' HTTP ' + status + '  ' + bytes + 'b  ' +
      'scripts=' + wellFormed + '/' + totalSrc + '  app.js=' + appJs + '  EJS-leaks=' + ejsMarkers +
      (issues.length ? '  MALFORMED=' + issues.length : ''));

    if (issues.length) {
      totalIssues += issues.length;
      issues.slice(0, 3).forEach(iss => console.log('   line ' + iss.line + ': ' + iss.text));
    }
  }

  srv.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 200));

  console.log('\n' + (totalIssues === 0 ? 'OK' : 'FAILED: ' + totalIssues + ' malformed script tag(s)'));
  process.exit(totalIssues === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('verify-render.js failed:', err);
  process.exit(2);
});
