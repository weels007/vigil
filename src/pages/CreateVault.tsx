import { useState, type FormEvent } from 'react';

import { Notice } from '../components/States';
import { useActions } from '../lib/actions';
import { createVaultAction, fetchVaults } from '../lib/contract';
import { translateError } from '../lib/errors';
import { datetimeLocalValue, parseGen, toUnix } from '../lib/format';
import { HAS_CONTRACT, waitForOutcome } from '../lib/genlayer';
import { navigate } from '../lib/router';
import { useWallet } from '../lib/wallet';

type Tone = 'info' | 'warn' | 'error' | 'success';

interface UiNotice {
  tone: Tone;
  text: string;
}

const DAY = 86400;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === 'localhost' || host === '[::1]' || host === '::1') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

function initialDeadline(): string {
  return datetimeLocalValue(Math.floor(Date.now() / 1000) + 30 * DAY);
}

export function CreateVault() {
  const wallet = useWallet();
  const { run, isPending } = useActions();
  const [title, setTitle] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [condition, setCondition] = useState('');
  const [url, setUrl] = useState('');
  const [deadline, setDeadline] = useState(initialDeadline);
  const [amount, setAmount] = useState('0.01');
  const [notice, setNotice] = useState<UiNotice | null>(null);

  const busy = isPending('create');

  const validate = (): string | null => {
    if (title.trim().length === 0) return 'Give the vault a short title.';
    if (title.trim().length > 80) return 'Keep the title under 80 characters.';
    if (condition.trim().length === 0) return 'Write the condition the keeper should verify.';
    if (condition.trim().length > 500) return 'Keep the condition under 500 characters.';
    if (!/^0x[0-9a-fA-F]{40}$/.test(beneficiary.trim())) {
      return 'The beneficiary must be a 20-byte hex address (0x followed by 40 hex characters).';
    }
    if (/^0x0{40}$/i.test(beneficiary.trim())) {
      return 'The beneficiary cannot be the zero address.';
    }
    if (wallet.address && beneficiary.trim().toLowerCase() === wallet.address.toLowerCase()) {
      return 'The beneficiary must be a different address from yours.';
    }
    const trimmedUrl = url.trim();
    if (!/^https?:\/\//i.test(trimmedUrl)) return 'The URL must start with http:// or https://.';
    if (/\s/.test(trimmedUrl)) return 'The URL must not contain spaces.';
    if (trimmedUrl.length > 300) return 'Keep the URL under 300 characters.';
    let parsed: URL;
    try {
      parsed = new URL(trimmedUrl);
    } catch {
      return 'The URL must include a public host.';
    }
    if (!parsed.hostname) return 'The URL must include a public host.';
    if (isPrivateHost(parsed.hostname)) return 'The URL must point at a public host.';
    let deadlineUnix = 0;
    try {
      deadlineUnix = toUnix(deadline);
    } catch (error) {
      return (error as Error).message;
    }
    if (deadlineUnix <= Math.floor(Date.now() / 1000)) return 'Pick a deadline in the future.';
    try {
      const value = parseGen(amount);
      if (value <= 0n) return 'The deposit must be greater than zero.';
    } catch (error) {
      return (error as Error).message;
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!wallet.address) {
      setNotice({ tone: 'warn', text: 'Connect a wallet to open a vault.' });
      return;
    }
    const problem = validate();
    if (problem) {
      setNotice({ tone: 'error', text: problem });
      return;
    }

    const address = wallet.address;
    const cleanTitle = title.trim();
    const deadlineUnix = toUnix(deadline);
    setNotice(null);

    try {
      await run('create', async () => {
        const hash = await createVaultAction(address, {
          beneficiary: beneficiary.trim(),
          title: cleanTitle,
          condition: condition.trim(),
          url: url.trim(),
          deadline: deadlineUnix,
          value: parseGen(amount),
        });
        setNotice({
          tone: 'info',
          text: 'Vault submitted. Waiting for consensus before it appears on the ledger.',
        });
        await waitForOutcome(hash);
      });

      const page = await fetchVaults(0, 10);
      const created = page.vaults.find(
        (vault) => vault.title === cleanTitle && vault.creator.toLowerCase() === address.toLowerCase(),
      );
      setNotice({ tone: 'success', text: 'The vault is open. The keeper is watching.' });
      if (created) {
        navigate(`/vaults/${created.id}`);
      } else {
        navigate('/vaults');
      }
    } catch (error) {
      setNotice({ tone: 'error', text: translateError(error) });
    }
  };

  return (
    <div className="page">
      <header className="form-head">
        <p className="eyebrow">A new entry in the register</p>
        <h1 className="page-title">Open a vault</h1>
        <p className="lede">
          One condition, one page, one beneficiary. Write it so a stranger could check it at noon
          without asking you what you meant.
        </p>
      </header>

      {!HAS_CONTRACT ? (
        <Notice tone="warn">
          Vigil has no recorded contract address yet. The form is ready, but it cannot submit until
          the deployment step writes the address into the app.
        </Notice>
      ) : null}

      <form className="form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="form-grid">
          <label className="field">
            <span className="label">Title</span>
            <input
              type="text"
              value={title}
              maxLength={80}
              placeholder="Aurora ships its first release"
              onChange={(event) => setTitle(event.target.value)}
              required
            />
            <span className="hint">{title.length} / 80</span>
          </label>

          <label className="field">
            <span className="label">Beneficiary address</span>
            <input
              type="text"
              value={beneficiary}
              placeholder="0x…"
              spellCheck={false}
              onChange={(event) => setBeneficiary(event.target.value)}
              required
            />
            <span className="hint">The address that receives GEN when the condition is met.</span>
          </label>
        </div>

        <label className="field">
          <span className="label">Condition</span>
          <textarea
            value={condition}
            maxLength={500}
            rows={4}
            placeholder="The page announces that Project Aurora has shipped its first release."
            onChange={(event) => setCondition(event.target.value)}
            required
          />
          <span className="hint">{condition.length} / 500 · plain English, one verifiable claim</span>
        </label>

        <label className="field">
          <span className="label">Evidence URL</span>
          <input
            type="url"
            value={url}
            maxLength={300}
            placeholder="https://example.com/announcements"
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
          <span className="hint">Public http(s) page. The contract fetches it itself.</span>
        </label>

        <div className="form-grid">
          <label className="field">
            <span className="label">Deadline</span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              required
            />
            <span className="hint">After this moment anyone may refund the creator.</span>
          </label>

          <label className="field">
            <span className="label">Deposit (GEN)</span>
            <input
              type="text"
              value={amount}
              inputMode="decimal"
              placeholder="0.01"
              onChange={(event) => setAmount(event.target.value)}
              required
            />
            <span className="hint">Sent with create_vault and locked in the contract.</span>
          </label>
        </div>

        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

        <div className="form-foot">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !wallet.address || !HAS_CONTRACT}
          >
            {busy ? 'Opening the vault…' : 'Lock the deposit'}
          </button>
          {wallet.address ? (
            <span className="hint mono">acting as {wallet.address}</span>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => void wallet.connect()}>
              {wallet.connecting ? 'Connecting…' : 'Connect a wallet'}
            </button>
          )}
        </div>
      </form>

      <section className="form-notes">
        <h2 className="panel-title">What the contract will refuse</h2>
        <ul className="notes-list">
          <li>A title over 80 characters, or a condition over 500.</li>
          <li>Anything but a public http:// or https:// URL with a host.</li>
          <li>A beneficiary equal to the creator, or a deposit of zero.</li>
          <li>A deadline in the past.</li>
        </ul>
      </section>
    </div>
  );
}
