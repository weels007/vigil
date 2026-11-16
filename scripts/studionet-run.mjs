#!/usr/bin/env node
/**
 * Deploy Vigil to GenLayer Studionet and drive a real lifecycle with two wallets.
 *
 * Wallet sources, in order:
 *   1. VIGIL_TESTER1_PRIVATE_KEY / VIGIL_TESTER2_PRIVATE_KEY
 *   2. VIGIL_TESTER1_KEYSTORE + VIGIL_TESTER1_PASSWORD (inline JSON or a file path)
 *   3. ../wallet/<NAME>.json beside the repository, with <NAME>.password or .txt
 *   4. an ephemeral key (unfunded: the run records SKIP instead of pretending)
 *
 * The non-deterministic vault check only runs when ADJUDICATION is 1/true.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = process.cwd();
const CONTRACT_FILE = path.join(ROOT, 'contracts', 'vigil.py');
const RPC = 'https://studio.genlayer.com/api';
const EXPLORER = 'https://explorer-studio.genlayer.com';
const DEPOSIT = 10n ** 16n; // 0.01 GEN
const MIN_BALANCE = 5n * 10n ** 16n; // 0.05 GEN keeps a few writes comfortable
const ADJUDICATION = /^(1|true|yes)$/i.test(process.env.ADJUDICATION ?? '');

const results = [];
let contractAddress = '';
let failures = 0;

function record(step, status, detail) {
  results.push({ step, status, detail: String(detail ?? '') });
  console.log(`[${status}] ${step} — ${detail}`);
}

function check(step, ok, detail) {
  record(step, ok ? 'PASS' : 'FAIL', detail);
  if (!ok) failures += 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function formatGen(wei) {
  const whole = wei / 10n ** 18n;
  const cents = ((wei % 10n ** 18n) * 10000n) / 10n ** 18n;
  if (cents === 0n) return whole.toString();
  return `${whole}.${cents.toString().padStart(4, '0').replace(/0+$/, '')}`;
}

async function ethBalance(address) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? 'eth_getBalance failed');
  return BigInt(payload.result);
}

function readWalletFile(name) {
  const candidates = [
    `wallet/${name}.json`,
    `wallet/${name}.keystore`,
    `wallet/${name.toLowerCase()}.json`,
  ];
  for (const candidate of candidates) {
    const full = path.join(ROOT, '..', candidate);
    if (fs.existsSync(full)) {
      return { text: fs.readFileSync(full, 'utf8'), source: `../${candidate}` };
    }
  }
  return null;
}

function readWalletPassword(name) {
  const candidates = [`wallet/${name}.password`, `wallet/${name}.txt`, `wallet/${name.toLowerCase()}.password`];
  for (const candidate of candidates) {
    const full = path.join(ROOT, '..', candidate);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8').trim();
  }
  return null;
}

function decryptKeystore(keystore, password) {
  const section = keystore.crypto ?? keystore.Crypto;
  if (!section) throw new Error('keystore has no crypto section');
  const kdf = String(section.kdf ?? '').toLowerCase();
  const params = section.kdfparams ?? {};
  const salt = Buffer.from(params.salt ?? '', 'hex');
  const dklen = Number(params.dklen ?? 32);
  let derived;
  if (kdf === 'scrypt') {
    derived = crypto.scryptSync(Buffer.from(password), salt, dklen, {
      N: Number(params.n),
      r: Number(params.r),
      p: Number(params.p),
      maxmem: 512 * 1024 * 1024,
    });
  } else if (kdf === 'pbkdf2') {
    const prf = String(params.prf ?? 'hmac-sha256').toLowerCase();
    derived = crypto.pbkdf2Sync(
      Buffer.from(password),
      salt,
      Number(params.c),
      dklen,
      prf === 'hmac-sha512' ? 'sha512' : 'sha256',
    );
  } else {
    throw new Error(`unsupported keystore kdf: ${kdf || 'unknown'}`);
  }
  const cipher = String(section.cipher ?? '').toLowerCase();
  if (!cipher.startsWith('aes-')) throw new Error(`unsupported keystore cipher: ${cipher || 'unknown'}`);
  const iv = Buffer.from(section.cipherparams?.iv ?? '', 'hex');
  const payload = Buffer.from(section.ciphertext ?? '', 'hex');
  const decipher = crypto.createDecipheriv(cipher, derived.subarray(0, 16), iv);
  const key = Buffer.concat([decipher.update(payload), decipher.final()]);
  if (key.length !== 32) throw new Error('keystore did not hold a 32-byte private key');
  return `0x${key.toString('hex')}`;
}

function resolveWallet(name) {
  const direct = (process.env[`${name}_PRIVATE_KEY`] ?? '').trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(direct)) {
    return { key: direct, source: `${name}_PRIVATE_KEY` };
  }

  const inline = (process.env[`${name}_KEYSTORE`] ?? '').trim();
  const inlinePassword = process.env[`${name}_PASSWORD`] ?? '';
  let text = null;
  let source = '';
  if (inline) {
    if (inline.startsWith('{')) {
      text = inline;
      source = `${name}_KEYSTORE (inline)`;
    } else if (fs.existsSync(inline)) {
      text = fs.readFileSync(inline, 'utf8');
      source = inline;
    }
  }

  let password = inlinePassword;
  if (!text) {
    const file = readWalletFile(name);
    if (file) {
      text = file.text;
      source = file.source;
      password = password || readWalletPassword(name) || '';
    }
  }

  if (text && password) {
    try {
      return { key: decryptKeystore(JSON.parse(text), password), source };
    } catch (error) {
      throw new Error(`could not decrypt ${source}: ${error.message}`);
    }
  }

  return {
    key: `0x${crypto.randomBytes(32).toString('hex')}`,
    source: `${name} (ephemeral, unfunded)`,
  };
}

function makeClient(account) {
  return createClient({ chain: studionet, account });
}

async function wait(client, hash) {
  return client.waitForTransactionReceipt({
    hash,
    waitUntil: 'finalized',
    interval: 3000,
    retries: 400,
  });
}

async function writeRaw(client, functionName, args, value = 0n) {
  const payload = { address: contractAddress, functionName, args, value };
  let fees;
  try {
    const estimate = await client.estimateTransactionFeesForWrite(payload);
    if (estimate?.distribution) {
      fees = {
        distribution: estimate.distribution,
        ...(estimate.messageAllocations ? { messageAllocations: estimate.messageAllocations } : {}),
        feeValue: estimate.feeValue,
      };
    }
  } catch {
    fees = undefined;
  }
  const hash = await client.writeContract(fees ? { ...payload, fees } : payload);
  const receipt = await wait(client, hash);
  return { hash, receipt, ok: receipt?.txExecutionResultName === 'FINISHED_WITH_RETURN' };
}

async function readContract(functionName, args = []) {
  const client = makeClient(undefined);
  return client.readContract({
    address: contractAddress,
    functionName,
    args,
    transactionHashVariant: 'latest-nonfinal',
  });
}

async function readJson(functionName, args = []) {
  const raw = await readContract(functionName, args);
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readVault(id) {
  return readJson('get_vault_json', [id]);
}

function extractAddress(receipt) {
  const candidates = [
    receipt?.txDataDecoded?.contractAddress,
    receipt?.txDataDecoded?.contract_address,
    receipt?.data?.contract_address,
    receipt?.data?.contractAddress,
    receipt?.contract_address,
    receipt?.recipient,
    receipt?.to_address,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^0x[0-9a-fA-F]{40}$/.test(candidate)) return candidate;
  }
  return '';
}

async function deploy(client, code) {
  const hash = await client.deployContract({ code, args: [] });
  const receipt = await wait(client, hash);
  let address = extractAddress(receipt);
  if (!address) {
    try {
      const transaction = await client.getTransaction({ hash });
      address = extractAddress(transaction);
    } catch {
      address = '';
    }
  }
  return { hash, receipt, address };
}

function writeSummary() {
  const rows = results
    .map((row) => `| ${row.step} | ${row.status} | ${row.detail.replace(/\|/g, '\\|')} |`)
    .join('\n');
  const markdown = [
    '## Vigil — Studionet lifecycle',
    '',
    contractAddress
      ? `Contract: \`${contractAddress}\` — [explorer](${EXPLORER}/address/${contractAddress})`
      : 'Contract: not deployed in this run',
    `Adjudication run: ${ADJUDICATION ? 'yes' : 'no'} (set ADJUDICATION=1 or push with [adjudication])`,
    '',
    '| Step | Result | Detail |',
    '| --- | --- | --- |',
    rows,
    '',
    failures === 0 ? 'All recorded steps passed.' : `${failures} step(s) failed.`,
  ].join('\n');

  try {
    fs.writeFileSync(path.join(ROOT, 'studionet-run.json'), JSON.stringify({ contractAddress, results }, null, 2));
  } catch (error) {
    console.warn('could not write studionet-run.json:', error.message);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  if (process.env.GITHUB_ENV && contractAddress) {
    fs.appendFileSync(process.env.GITHUB_ENV, `CONTRACT_ADDRESS=${contractAddress}\n`);
  }
  console.log(markdown);
}

async function main() {
  const code = fs.readFileSync(CONTRACT_FILE, 'utf8');
  record('contract source', 'INFO', `${CONTRACT_FILE} (${code.length} bytes)`);

  const creatorWallet = resolveWallet('VIGIL_TESTER1');
  const beneficiaryWallet = resolveWallet('VIGIL_TESTER2');
  const creator = privateKeyToAccount(creatorWallet.key);
  const beneficiary = privateKeyToAccount(beneficiaryWallet.key);
  record('creator wallet', 'INFO', `${creator.address} via ${creatorWallet.source}`);
  record('beneficiary wallet', 'INFO', `${beneficiary.address} via ${beneficiaryWallet.source}`);

  const creatorClient = makeClient(creator);
  const beneficiaryClient = makeClient(beneficiary);

  const creatorBalance = await ethBalance(creator.address);
  const beneficiaryBalance = await ethBalance(beneficiary.address);
  record('creator balance', 'INFO', `${formatGen(creatorBalance)} GEN`);
  record('beneficiary balance', 'INFO', `${formatGen(beneficiaryBalance)} GEN`);
  const funded = creatorBalance >= MIN_BALANCE;

  if (!funded) {
    record(
      'wallet funding',
      'WARN',
      'the creator wallet holds less than 0.05 GEN; the contract can be deployed and read, but payable lifecycle steps will be skipped',
    );
  }

  const deployment = await deploy(creatorClient, code);
  if (!deployment.receipt || deployment.receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    record('deploy', 'FAIL', deployment.receipt?.txExecutionResultName ?? 'no receipt');
    failures += 1;
    return;
  }
  if (!deployment.address) {
    record('deploy', 'FAIL', 'the deployment receipt carried no contract address');
    failures += 1;
    return;
  }
  contractAddress = deployment.address;
  record('deploy', 'PASS', `${contractAddress} (tx ${deployment.hash})`);

  const owner = await readContract('get_owner');
  check('owner view', String(owner).toLowerCase() === creator.address.toLowerCase(), String(owner));

  const startCount = Number(await readContract('get_vault_count'));
  check('empty registry', startCount === 0, `get_vault_count = ${startCount}`);

  if (!funded) {
    for (const step of [
      'create_vault (cancel path)',
      'cancel_vault',
      'withdraw pull payment',
      'create_vault (refund path)',
      'refund after deadline',
      'guard rejects beneficiary == creator',
      'check_vault (LLM adjudication)',
    ]) {
      record(step, 'SKIP', 'creator wallet is unfunded; fund it from the Studio faucet and re-run');
    }
    return;
  }

  // 1. Create a vault that the creator will cancel.
  const cancelDeadline = nowSeconds() + 3 * 86400;
  const created = await writeRaw(creatorClient, 'create_vault', [
    beneficiary.address,
    'Studionet lifecycle: cancel and withdraw',
    'The GenLayer documentation describes Intelligent Contracts as Python contracts that can access the web and call LLMs.',
    'https://docs.genlayer.com/developers/intelligent-contracts/introduction',
    cancelDeadline,
  ], DEPOSIT);
  check('create_vault (cancel path)', created.ok, created.receipt?.txExecutionResultName ?? 'no receipt');

  const afterCreate = Number(await readContract('get_vault_count'));
  const cancelVaultId = afterCreate - 1;
  const cancelVault = await readVault(cancelVaultId);
  check('vault is ACTIVE', cancelVault?.state === 'ACTIVE', cancelVault?.state);
  check(
    'vault records the beneficiary',
    String(cancelVault?.beneficiary ?? '').toLowerCase() === beneficiary.address.toLowerCase(),
    cancelVault?.beneficiary,
  );
  check('vault records the deposit', cancelVault?.amount === String(DEPOSIT), cancelVault?.amount);

  // 2. Cancel as creator, then pull the credit.
  const cancelled = await writeRaw(creatorClient, 'cancel_vault', [cancelVaultId]);
  check('cancel_vault', cancelled.ok, cancelled.receipt?.txExecutionResultName ?? 'no receipt');

  const afterCancel = await readVault(cancelVaultId);
  check('vault is CANCELLED', afterCancel?.state === 'CANCELLED', afterCancel?.state);

  const creditAfterCancel = BigInt(await readContract('get_credit_of', [creator.address]));
  check('creator credit after cancel', creditAfterCancel === DEPOSIT, `${formatGen(creditAfterCancel)} GEN`);

  const withdrawn = await writeRaw(creatorClient, 'withdraw', []);
  check('withdraw pull payment', withdrawn.ok, withdrawn.receipt?.txExecutionResultName ?? 'no receipt');

  const creditAfterWithdraw = BigInt(await readContract('get_credit_of', [creator.address]));
  check('credit cleared after withdraw', creditAfterWithdraw === 0n, `${formatGen(creditAfterWithdraw)} GEN`);

  // 3. Deadline refund: a short vault, then wait it out.
  const refundDeadline = nowSeconds() + 75;
  const refundCreated = await writeRaw(creatorClient, 'create_vault', [
    beneficiary.address,
    'Studionet lifecycle: refund after the deadline',
    'The GenLayer documentation page mentions the word GenLayer.',
    'https://docs.genlayer.com/developers/networks',
    refundDeadline,
  ], DEPOSIT);
  check('create_vault (refund path)', refundCreated.ok, refundCreated.receipt?.txExecutionResultName ?? 'no receipt');

  const refundVaultId = Number(await readContract('get_vault_count')) - 1;
  record('waiting for the deadline', 'INFO', '80 seconds so the refund is genuinely late');
  await sleep(80000);

  const refundClient = beneficiaryBalance >= MIN_BALANCE ? beneficiaryClient : creatorClient;
  const refunded = await writeRaw(refundClient, 'refund_vault', [refundVaultId]);
  check('refund after deadline', refunded.ok, refunded.receipt?.txExecutionResultName ?? 'no receipt');

  const refundedVault = await readVault(refundVaultId);
  check('vault is REFUNDED', refundedVault?.state === 'REFUNDED', refundedVault?.state);

  const creatorCredit = BigInt(await readContract('get_credit_of', [creator.address]));
  check('creator credited by refund', creatorCredit === DEPOSIT, `${formatGen(creatorCredit)} GEN`);

  if (creatorCredit > 0n) {
    const sweep = await writeRaw(creatorClient, 'withdraw', []);
    check('withdraw refund credit', sweep.ok, sweep.receipt?.txExecutionResultName ?? 'no receipt');
  }

  // 4. Guard probe: the contract must reject a self-pay vault.
  const guard = await writeRaw(creatorClient, 'create_vault', [
    creator.address,
    'Guard probe',
    'This vault must never be created because the beneficiary is the creator.',
    'https://example.com/',
    nowSeconds() + 86400,
  ], 1n);
  check('guard rejects beneficiary == creator', !guard.ok, guard.receipt?.txExecutionResultName ?? 'no receipt');

  const totals = await readJson('get_totals');
  check('totals view', totals !== null && typeof totals.vault_count === 'number', JSON.stringify(totals));

  // 5. The real, non-deterministic adjudication (slow, opt-in).
  if (!ADJUDICATION) {
    record('check_vault (LLM adjudication)', 'SKIP', 'set ADJUDICATION=1 or push with [adjudication]');
    return;
  }

  const adjudicationDeadline = nowSeconds() + 7 * 86400;
  const adjudicationCreated = await writeRaw(creatorClient, 'create_vault', [
    beneficiary.address,
    'Studionet lifecycle: live adjudication',
    'The page describes Intelligent Contracts as Python contracts that can access the web and call LLMs.',
    'https://docs.genlayer.com/developers/intelligent-contracts/introduction',
    adjudicationDeadline,
  ], DEPOSIT);
  check(
    'create_vault (adjudication path)',
    adjudicationCreated.ok,
    adjudicationCreated.receipt?.txExecutionResultName ?? 'no receipt',
  );

  const adjudicationVaultId = Number(await readContract('get_vault_count')) - 1;
  const adjudicated = await writeRaw(creatorClient, 'check_vault', [adjudicationVaultId]);
  record('check_vault receipt', adjudicated.ok ? 'PASS' : 'FAIL', adjudicated.receipt?.txExecutionResultName ?? 'no receipt');
  if (!adjudicated.ok) failures += 1;

  const decided = await readVault(adjudicationVaultId);
  record('adjudication outcome', 'INFO', `${decided?.state} / ${decided?.last_outcome} / ${decided?.last_reason}`);
  check(
    'outcome is a known label',
    ['MET', 'NOT_MET', 'UNVERIFIABLE', 'INJECTION'].includes(String(decided?.last_outcome)),
    decided?.last_outcome,
  );
  check(
    'state matches the decision',
    decided?.last_outcome === 'MET' ? decided?.state === 'TRIGGERED' : decided?.state === 'ACTIVE',
    `${decided?.state} after ${decided?.last_outcome}`,
  );
  check('check log advanced', Number(decided?.checks ?? 0) >= 1, `${decided?.checks} checks`);
}

main()
  .catch((error) => {
    record('run', 'FAIL', error?.stack ?? String(error));
    failures += 1;
  })
  .finally(() => {
    if (contractAddress) {
      record('contract address', 'INFO', contractAddress);
    }
    writeSummary();
    process.exitCode = failures > 0 ? 1 : 0;
  });
