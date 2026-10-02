import { LitElement, html, nothing, type ReactiveController } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { exportFileName, serializeDocument, summarize, type DocumentSummary } from '../core/transfer';
import { store, syncManager } from '../state/store-instance';
import type { SyncConfig } from '../state/sync-manager';
import { switchField, textField } from './fields';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** Re-renders the host on sync manager / service changes. */
class SyncController implements ReactiveController {
  #onChange = () => this.host.requestUpdate();
  constructor(private readonly host: LitElement) {
    host.addController(this);
  }
  hostConnected() {
    syncManager().addEventListener('change', this.#onChange);
    store().addEventListener('change', this.#onChange);
  }
  hostDisconnected() {
    syncManager().removeEventListener('change', this.#onChange);
    store().removeEventListener('change', this.#onChange);
  }
}

@customElement('sync-settings')
export class SyncSettings extends LitElement {
  #ctl = new SyncController(this);
  @state() private draft: SyncConfig = {
    provider: 'github',
    github: { owner: '', repo: '', branch: '', path: '3d-printing-calculator.json' },
    rememberToken: true,
    autoSync: true,
  };
  @state() private token = '';
  @state() private testResult: { ok: boolean; message: string } | null = null;
  @state() private busy = false;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    void this.#ctl;
    const m = syncManager();
    return html`
      <section class="card card-body">
        <h2 class="h5 mb-3">Sync</h2>
        ${m.config ? this.#connected() : this.#setup()}
      </section>
    `;
  }

  #setup() {
    const g = this.draft.github;
    const set = (mutate: (c: SyncConfig) => void) => {
      const next = structuredClone(this.draft);
      mutate(next);
      this.draft = next;
      this.testResult = null;
    };
    const complete = g.owner && g.repo && g.path && this.token;
    return html`
      <p class="text-body-secondary">
        Keep your data in a <strong>private GitHub repository you own</strong>: works in every browser, syncs between
        devices, and every save becomes a commit you can restore. The token stays on this device and is only sent to
        <code>api.github.com</code>.
      </p>
      <details class="mb-3 small">
        <summary>How to set it up (3 minutes)</summary>
        <ol class="mt-2 mb-0">
          <li>Create a new <strong>private</strong> repository on GitHub, e.g. <code>my-3dprint-data</code>. It can stay empty.</li>
          <li>Create a <a href=${TOKEN_URL} target="_blank" rel="noopener noreferrer">fine-grained token</a>: <em>Repository access</em> → only that repository; <em>Permissions</em> → Contents: Read and write.</li>
          <li>Enter owner, repository and token below, test, and connect. The first sync uploads the data of this browser.</li>
        </ol>
      </details>
      <div class="row">
        <div class="col-md-6">${textField('Owner (user or organization)', g.owner, (v) => set((c) => (c.github.owner = v)))}</div>
        <div class="col-md-6">${textField('Repository', g.repo, (v) => set((c) => (c.github.repo = v)))}</div>
        <div class="col-md-6">${textField('File path', g.path, (v) => set((c) => (c.github.path = v || '3d-printing-calculator.json')))}</div>
        <div class="col-md-6">${textField('Branch', g.branch, (v) => set((c) => (c.github.branch = v)), { placeholder: 'default branch' })}</div>
        <div class="col-12">
          <label class="form-label d-block mb-3"><span class="d-block mb-1">Token</span>
            <input class="form-control" type="password" autocomplete="off" .value=${this.token}
              @input=${(e: Event) => { this.token = (e.target as HTMLInputElement).value.trim(); this.testResult = null; }} />
          </label>
        </div>
        <div class="col-md-6">${switchField('Remember token on this device', this.draft.rememberToken, (v) => set((c) => (c.rememberToken = v)), { help: 'Off: asks again in every new browser session.' })}</div>
        <div class="col-md-6">${switchField('Sync automatically', this.draft.autoSync, (v) => set((c) => (c.autoSync = v)), { help: 'On start, when returning to the app, and 30 s after a change.' })}</div>
      </div>
      ${this.testResult ? html`<div class="alert ${this.testResult.ok ? 'alert-success' : 'alert-danger'}">${this.testResult.message}</div>` : nothing}
      <div class="d-flex gap-2">
        <button class="btn btn-outline-primary" ?disabled=${!complete || this.busy} @click=${this.#test}>Test connection</button>
        <button class="btn btn-primary" ?disabled=${!complete || this.busy || this.testResult?.ok === false} @click=${() => syncManager().connect(this.draft, this.token)}>Connect</button>
      </div>
    `;
  }

  #connected() {
    const m = syncManager();
    const c = m.config!;
    const s = m.service;
    const label = `${c.github.owner}/${c.github.repo}/${c.github.path}${c.github.branch ? ` @ ${c.github.branch}` : ''}`;
    return html`
      <p class="mb-2">Connected to <a href="https://github.com/${c.github.owner}/${c.github.repo}" target="_blank" rel="noopener noreferrer"><code>${label}</code></a></p>
      ${m.locked
        ? html`<div class="alert alert-warning">
            The token was only kept for the last session. Enter it again to sync.
            <div class="input-group mt-2">
              <input class="form-control" type="password" autocomplete="off" aria-label="Token" .value=${this.token} @input=${(e: Event) => (this.token = (e.target as HTMLInputElement).value.trim())} />
              <button class="btn btn-primary" ?disabled=${!this.token} @click=${() => m.unlock(this.token)}>Unlock</button>
            </div>
          </div>`
        : s
          ? html`
              <p class="mb-2">
                Status: <strong>${s.status}</strong>${s.lastSyncAt ? html` · last sync ${s.lastSyncAt.toLocaleTimeString()}` : nothing}
                ${s.hasLocalChanges && s.status !== 'syncing' ? html` · <span class="text-warning">unsynced changes</span>` : nothing}
              </p>
              ${s.error ? html`<div class="alert alert-danger">${s.error}</div>` : nothing}
              ${s.conflict ? this.#conflict(summarize(store().doc), summarize(s.conflict.remoteDoc)) : nothing}
            `
          : nothing}
      <div class="d-flex gap-2">
        ${s ? html`<button class="btn btn-primary" ?disabled=${s.status === 'syncing' || s.status === 'conflict'} @click=${() => void s.sync()}>Sync now</button>` : nothing}
        <button class="btn btn-outline-danger ms-auto" @click=${() => { if (confirm('Disconnect sync on this device? Data stays in this browser and in the repository.')) m.disconnect(); }}>Disconnect</button>
      </div>
    `;
  }

  #conflict(local: DocumentSummary, remote: DocumentSummary) {
    const s = syncManager().service!;
    const rows: [string, keyof DocumentSummary][] = [
      ['Quotes', 'quotes'], ['Filaments', 'filaments'], ['Purchases', 'purchases'], ['Printers', 'printers'], ['Customers', 'customers'],
    ];
    return html`
      <div class="alert alert-warning">
        <strong>Both this device and the repository changed since the last sync.</strong> Choose which version to keep;
        the other one is replaced. (Older versions stay available in the repository's commit history.)
        <table class="table table-sm w-auto my-2">
          <thead><tr><th></th><th class="text-end">This device</th><th class="text-end">Repository</th></tr></thead>
          <tbody>
            ${rows.map(([l, k]) => html`<tr><td>${l}</td><td class="text-end">${local[k]}</td><td class="text-end">${remote[k]}</td></tr>`)}
            <tr><td>Last change</td><td class="text-end">${new Date(local.updatedAt).toLocaleString()}</td><td class="text-end">${new Date(remote.updatedAt).toLocaleString()}</td></tr>
          </tbody>
        </table>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-sm btn-outline-secondary" @click=${this.#exportLocal}>Export this device's data first</button>
          <button class="btn btn-sm btn-warning" @click=${() => void s.resolve('mine')}>Keep this device (overwrite repository)</button>
          <button class="btn btn-sm btn-warning" @click=${() => void s.resolve('theirs')}>Use repository (replace this device)</button>
        </div>
      </div>
    `;
  }

  #test = async () => {
    this.busy = true;
    try {
      const r = await syncManager().test({ ...this.draft.github, token: this.token });
      if (!r.canWrite) this.testResult = { ok: false, message: 'The token can read but not write. Give it "Contents: Read and write".' };
      else if (!r.private) this.testResult = { ok: false, message: 'This repository is public: everyone could read your data. Use a private repository.' };
      else this.testResult = { ok: true, message: r.fileExists ? 'Connection works. The data file exists; the first sync compares it with this browser.' : 'Connection works. The data file will be created on the first sync.' };
    } catch (e) {
      this.testResult = { ok: false, message: e instanceof Error ? e.message : String(e) };
    } finally {
      this.busy = false;
    }
  };

  #exportLocal = () => {
    const url = URL.createObjectURL(new Blob([serializeDocument(store().doc)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: exportFileName() }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
