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

async function waitForTx(client, hash, attempts = 200) {
  let last = null;
  let lastError = '';
  let lastStatus = '';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const tx = await client.getTransaction({ hash });
      if (tx) {
        last = tx;
        const status = String(tx.statusName ?? tx.status ?? '');
        if (status !== lastStatus) {
          lastStatus = status;
          console.log(`[INFO] transaction ${hash} status ${status || 'unknown'}`);
          console.log(
            `[INFO] shape recipient=${tx.recipient ?? tx.to_address ?? '-'} decoded=${JSON.stringify(
              tx.txDataDecoded ?? null,
            )} dataKeys=${tx.data ? Object.keys(tx.data).join(',') : '-'}`,
          );
        }
        if (tx.txExecutionResultName) return tx;
        if (['FINALIZED', 'UNDETERMINED', 'CANCELED'].includes(status)) return tx;
        if (typeof tx.txExecutionResult === 'number' && tx.txExecutionResult > 0) return tx;
      }
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await sleep(3000);
  }
  if (last) {
    record('transaction wait', 'WARN', `${hash} settled at status ${lastStatus || 'unknown'}`);
    return last;
  }
  throw new Error(`timed out waiting for ${hash}: ${lastError || lastStatus || 'no state'}`);
}

function txSucceeded(receipt) {
  if (!receipt) return false;
  if (receipt.txExecutionResultName) {
    return receipt.txExecutionResultName === 'FINISHED_WITH_RETURN';
  }
  const status = String(receipt.statusName ?? '');
  return status === 'ACCEPTED' || status === 'FINALIZED';
}

async function writeRaw(client, functionName, args, value = 0n, attempts = 200) {
  const hash = await client.writeContract({ address: contractAddress, functionName, args, value });
  const receipt = await waitForTx(client, hash, attempts);
  return { hash, receipt, ok: txSucceeded(receipt) };
}

async function faucet(client, address) {
  let last = 0n;
  for (const amount of [10 ** 18, 10 ** 17]) {
    try {
      await client.request({ method: 'sim_fundAccount', params: [address, amount] });
    } catch (error) {
      record('faucet', 'WARN', `${address}: ${error?.message ?? error}`);
      return last;
    }
    await sleep(2000);
    last = await ethBalance(address);
    if (last >= MIN_BALANCE) {
      record('faucet', 'INFO', `funded ${address} with ${formatGen(last)} GEN`);
      return last;
    }
  }
  record('faucet', 'WARN', `the faucet left ${address} with ${formatGen(last)} GEN`);
  return last;
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
    receipt?.data?.to_address,
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
  record('deploy transaction', 'INFO', String(hash));
  const receipt = await waitForTx(client, hash, 120);
  let address = extractAddress(receipt);
  if (!address) {
    try {
      const transaction = await client.getTransaction({ hash });
      address = extractAddress(transaction);
      record('deploy receipt shape', 'INFO', JSON.stringify(transaction).slice(0, 600));
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
  record('chain', 'INFO', `${creatorClient.chain?.name ?? 'unknown'} (id ${creatorClient.chain?.id ?? '?'})`);

  let creatorBalance = await ethBalance(creator.address);
  let beneficiaryBalance = await ethBalance(beneficiary.address);
  if (creatorBalance < MIN_BALANCE) {
    creatorBalance = await faucet(creatorClient, creator.address);
    beneficiaryBalance = await faucet(beneficiaryClient, beneficiary.address);
  }
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

  let deployment;
  try {
    deployment = await deploy(creatorClient, code);
  } catch (error) {
    record('deploy', 'FAIL', error?.message ?? String(error));
    failures += 1;
    return;
  }
  if (!deployment.receipt) {
    record('deploy', 'FAIL', 'the deployment produced no transaction receipt');
    failures += 1;
    return;
  }
  if (!deployment.address) {
    record('deploy', 'FAIL', 'the deployment receipt carried no contract address');
    failures += 1;
    return;
  }
  const deployExecution = deployment.receipt.txExecutionResultName;
  if (deployExecution && deployExecution !== 'FINISHED_WITH_RETURN') {
    record('deploy', 'FAIL', `execution ${deployExecution}`);
    failures += 1;
    return;
  }
  contractAddress = deployment.address;
  record(
    'deploy',
    'PASS',
    `${contractAddress} at ${deployment.receipt.statusName ?? 'finalized'} (tx ${deployment.hash})`,
  );

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
  const beforeGuard = Number(await readContract('get_vault_count'));
  const guard = await writeRaw(creatorClient, 'create_vault', [
    creator.address,
    'Guard probe',
    'This vault must never be created because the beneficiary is the creator.',
    'https://example.com/',
    nowSeconds() + 86400,
  ], 1n);
  const afterGuard = Number(await readContract('get_vault_count'));
  check(
    'guard rejects beneficiary == creator',
    afterGuard === beforeGuard,
    `${beforeGuard} vaults before, ${afterGuard} after (tx ${guard.hash})`,
  );

  const totals = await readJson('get_totals');
  check('totals view', totals !== null && typeof totals.vault_count === 'number', JSON.stringify(totals));

  // 5. The real, non-deterministic adjudication (slow, opt-in).
  if (!ADJUDICATION) {
    record('check_vault (LLM adjudication)', 'SKIP', 'set ADJUDICATION=1 or push with [adjudication]');
    return;
  }

  if (beneficiaryBalance < MIN_BALANCE) {
    beneficiaryBalance = await faucet(beneficiaryClient, beneficiary.address);
  }

  // 5a. A condition the page plainly satisfies must settle and credit the beneficiary.
  const settlementDeadline = nowSeconds() + 7 * 86400;
  const settlementCreated = await writeRaw(creatorClient, 'create_vault', [
    beneficiary.address,
    'Studionet lifecycle: live settlement',
    "The page contains the word 'domain'.",
    'https://example.com/',
    settlementDeadline,
  ], DEPOSIT);
  check(
    'create_vault (settlement path)',
    settlementCreated.ok,
    settlementCreated.receipt?.txExecutionResultName ?? 'no receipt',
  );

  const settlementVaultId = Number(await readContract('get_vault_count')) - 1;
  const settledCheck = await writeRaw(creatorClient, 'check_vault', [settlementVaultId], 0n, 400);
  check(
    'check_vault (settlement path)',
    settledCheck.ok,
    settledCheck.receipt?.txExecutionResultName ?? 'no receipt',
  );

  const settledVault = await readVault(settlementVaultId);
  record(
    'adjudication verdict (settle)',
    'INFO',
    `${settledVault?.state} / ${settledVault?.last_outcome} / ${settledVault?.last_reason}`,
  );
  check(
    'the true condition meets and triggers',
    settledVault?.state === 'TRIGGERED' &&
      settledVault?.last_outcome === 'MET' &&
      settledVault?.last_met === true,
    `${settledVault?.state} after ${settledVault?.last_outcome}`,
  );
  check(
    'the adjudicator reported no injection',
    settledVault?.last_injection === false,
    String(settledVault?.last_injection),
  );

  const beneficiaryCredit = BigInt(await readContract('get_credit_of', [beneficiary.address]));
  check('settlement credits the beneficiary', beneficiaryCredit === DEPOSIT, `${formatGen(beneficiaryCredit)} GEN`);

  // 5b. A condition the page plainly does not meet must leave the vault ACTIVE.
  const negativeDeadline = nowSeconds() + 7 * 86400;
  const negativeCreated = await writeRaw(creatorClient, 'create_vault', [
    beneficiary.address,
    'Studionet lifecycle: live no-settle',
    'The page announces that Project Aurora has shipped its first release.',
    'https://example.com/',
    negativeDeadline,
  ], DEPOSIT);
  check(
    'create_vault (no-settle path)',
    negativeCreated.ok,
    negativeCreated.receipt?.txExecutionResultName ?? 'no receipt',
  );

  const negativeVaultId = Number(await readContract('get_vault_count')) - 1;
  const negativeCheck = await writeRaw(creatorClient, 'check_vault', [negativeVaultId], 0n, 400);
  check(
    'check_vault (no-settle path)',
    negativeCheck.ok,
    negativeCheck.receipt?.txExecutionResultName ?? 'no receipt',
  );

  const negativeVault = await readVault(negativeVaultId);
  record(
    'adjudication verdict (no-settle)',
    'INFO',
    `${negativeVault?.state} / ${negativeVault?.last_outcome} / ${negativeVault?.last_reason}`,
  );
  const beneficiaryCreditAfterNegative = BigInt(
    await readContract('get_credit_of', [beneficiary.address]),
  );
  check(
    'the false condition never settles',
    negativeVault?.state === 'ACTIVE' && negativeVault?.last_outcome !== 'MET',
    `${negativeVault?.state} after ${negativeVault?.last_outcome}`,
  );
  check(
    'no credit moves on a no-settle',
    beneficiaryCreditAfterNegative === beneficiaryCredit,
    `${formatGen(beneficiaryCreditAfterNegative)} GEN`,
  );

  // 5c. The beneficiary pulls the settlement credit.
  const beneficiaryWithdraw = await writeRaw(beneficiaryClient, 'withdraw', []);
  check(
    'beneficiary withdraws the settlement',
    beneficiaryWithdraw.ok,
    beneficiaryWithdraw.receipt?.txExecutionResultName ?? 'no receipt',
  );
  const beneficiaryCreditAfterWithdraw = BigInt(
    await readContract('get_credit_of', [beneficiary.address]),
  );
  check(
    'beneficiary credit clears after withdraw',
    beneficiaryCreditAfterWithdraw === 0n,
    `${formatGen(beneficiaryCreditAfterWithdraw)} GEN`,
  );
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
