#!/usr/bin/env node
/**
 * One-time setup script for the IT Inventory GitHub repo.
 *
 * Enables Issues and creates the 5 starter labels:
 *   bug, enhancement, documentation, good first issue, question
 *
 * Usage:
 *   1. Create a Personal Access Token (PAT) at https://github.com/settings/tokens
 *      - For fine-grained tokens, grant: Repository > Issues (Read & Write)
 *        and Administration (Read & Write) on this repo
 *      - For classic tokens, scope: `repo`
 *   2. Set the env vars:
 *      export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
 *      export GITHUB_REPO=c13-Technologies/IT-Inventory   # optional, this is the default
 *   3. Run from the project root:
 *      node scripts/setup-github-labels.js
 *
 * Safe to re-run — labels are upserted (created or updated), never duplicated.
 * Idempotent: running it twice produces the same end state.
 */

'use strict';

const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || 'c13-Technologies/IT-Inventory';

// Match GitHub's default label colors. See:
// https://github.com/github/feedback/discussions/13807
const LABELS = [
  { name: 'bug',               color: 'd73a4a', description: "Something isn't working" },
  { name: 'enhancement',       color: 'a2eeef', description: 'New feature or request' },
  { name: 'documentation',     color: '0075ca', description: 'Improvements or additions to documentation' },
  { name: 'good first issue',  color: '7057ff', description: 'Good for newcomers' },
  { name: 'question',          color: 'd876e3', description: 'Further information is requested' },
  { name: 'duplicate',         color: 'cfd3d7', description: 'This issue or pull request already exists' },
  { name: 'wontfix',           color: 'ffffff', description: 'This will not be worked on' },
  { name: 'help wanted',       color: '008672', description: 'Extra attention is needed' },
];

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'IT-Inventory-setup',
  'X-GitHub-Api-Version': '2022-11-28',
};

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          ...HEADERS,
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          const status = res.statusCode;
          if (status >= 200 && status < 300) {
            resolve({ status, body: chunks ? JSON.parse(chunks) : null });
          } else {
            const err = new Error(`HTTP ${status} on ${method} ${path}: ${chunks}`);
            err.status = status;
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function enableIssues() {
  const { body: repo } = await api('GET', `/repos/${REPO}`);
  if (repo.has_issues) {
    console.log(`✓ Issues already enabled on ${REPO}`);
  } else {
    await api('PATCH', `/repos/${REPO}`, { has_issues: true });
    console.log(`✓ Enabled Issues on ${REPO}`);
  }
}

async function upsertLabel(label) {
  try {
    await api('POST', `/repos/${REPO}/labels`, label);
    console.log(`✓ created  ${label.name.padEnd(20)} #${label.color}`);
  } catch (e) {
    if (e.status === 422) {
      // Label already exists — update it (color, description) instead.
      await api('PATCH', `/repos/${REPO}/labels/${encodeURIComponent(label.name)}`, {
        color: label.color,
        description: label.description,
      });
      console.log(`~ updated  ${label.name.padEnd(20)} #${label.color}`);
    } else {
      throw e;
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.error('Error: GITHUB_TOKEN env var is required.\n');
    console.error('Steps:');
    console.error('  1. Create a PAT at https://github.com/settings/tokens');
    console.error('     - Fine-grained: grant "Issues: Read & Write" + "Administration: Read & Write"');
    console.error('     - Classic: scope `repo`');
    console.error('  2. export GITHUB_TOKEN=ghp_xxxxxxxxxxxx');
    console.error('  3. node scripts/setup-github-labels.js');
    process.exit(1);
  }

  console.log(`\nSetting up ${REPO}\n${'─'.repeat(40)}`);

  try {
    await enableIssues();
  } catch (e) {
    console.error('\n× Failed to enable Issues.');
    console.error('  Check that your PAT has admin access to this repo.');
    console.error('  Details:', e.message);
    process.exit(1);
  }

  console.log('\nLabels:');
  for (const label of LABELS) {
    try {
      await upsertLabel(label);
    } catch (e) {
      console.error(`× ${label.name}: ${e.message}`);
    }
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log('Done. Visit https://github.com/' + REPO + '/issues to verify.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
