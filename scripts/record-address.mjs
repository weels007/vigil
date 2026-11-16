#!/usr/bin/env node
/**
 * Record a deployed Vigil address in every place the product promises it.
 *
 * Usage: node scripts/record-address.mjs 0xabc...
 */

import fs from 'node:fs';
import path from 'node:path';

const address = (process.argv[2] ?? '').trim();

if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
  console.error('record-address: expected a 20-byte hex address, got:', address || '(nothing)');
  process.exit(1);
}

const ROOT = process.cwd();
const EXPLORER = `https://explorer-studio.genlayer.com/address/${address}`;
const changed = [];

function update(relative, transform) {
  const full = path.join(ROOT, relative);
  if (!fs.existsSync(full)) {
    console.warn(`record-address: ${relative} is missing, skipped`);
    return;
  }
  const before = fs.readFileSync(full, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(full, after);
    changed.push(relative);
  }
}

update('src/lib/genlayer.ts', (text) =>
  text.replace(
    /export const CONTRACT_ADDRESS = '[^']*';/,
    `export const CONTRACT_ADDRESS = '${address}';`,
  ),
);

update('README.md', (text) =>
  text.replace(
    /^Live contract:.*$/m,
    `Live contract: \`${address}\` on GenLayer Studionet — [explorer](${EXPLORER})`,
  ),
);

update('SUBMISSION.md', (text) =>
  text.replace(/^Contract \(Studionet\):.*$/m, `Contract (Studionet): [${address}](${EXPLORER})`),
);

console.log(
  changed.length > 0
    ? `Recorded ${address} in ${changed.join(', ')}`
    : `Address ${address} was already recorded everywhere.`,
);
