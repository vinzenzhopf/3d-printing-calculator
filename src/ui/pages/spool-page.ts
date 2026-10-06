import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AppDocument, Spool } from '../../core/model';
import { assignLabel, findSpool, isLabelCode, remainingG, resolveTare, spoolFromLabel, spoolKgOf, suggestKind, weighIn } from '../../core/stock';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { pickFilament } from '../filament-picker';
import { scanAndOpen } from '../qr-scanner';
import { cellNumber, cellSelect, cellText, switchField } from '../fields';
import { money, newId, num, today } from '../format';
import { SPOOL_STATUS, filamentLabel, kindOptions, tareText } from './filaments/labels';
import { ask } from '../dialogs';

/**
 * One spool, phone-first (`#/spool/<label or id>`). This is what the QR code on
 * a printed label opens: weigh, mark empty, move, see the history. An unknown
 * printed label code offers to put the label on a spool.
 */
@customElement('spool-page')
export class SpoolPage extends LitElement {
  /** Label code or spool id from the route. */
  @property() key = '';
  #store = new StoreController(this, store());
  @state() private grossG: number | null = null;
  @state() private isEmptySpool = false;
  @state() private saveAsPreset = true;
  @state() private saved = '';
  @state() private assignFilter = '';
  /** "New spool from label" form; filament, size and type are remembered for the next label. */
  @state() private newSpool: NewSpoolDraft = loadDraft();
  @state() private error = '';

  protected override createRenderRoot() {
    return this;
  }

  get #doc(): AppDocument {
    return this.#store.store.doc;
  }

  override render() {
    const spool = findSpool(this.#doc, this.key);
    return html`
      <div class="d-flex gap-2 mb-3">
        <a href="#/filaments/stock" class="btn btn-sm btn-outline-secondary">← Stock</a>
        <button class="btn btn-sm btn-outline-primary ms-auto" @click=${() => void scanAndOpen()}>📷 Scan next label</button>
      </div>
      ${spool
        ? this.#spool(spool)
        : isLabelCode(this.key)
          ? this.#unassigned(this.key.toUpperCase())
          : html`<div class="alert alert-warning">No spool "${this.key}".</div>`}
    `;
  }

  // --- Known spool ---------------------------------------------------------

  #spool(s: Spool) {
    const doc = this.#doc;
    const f = doc.filaments.find((x) => x.id === s.filamentId);
    const g = remainingG(s);
    const pct = g !== null && s.nominalG > 0 ? Math.max(0, Math.min(100, (g / s.nominalG) * 100)) : null;
    const set = (mutate: (x: Spool) => void) => void this.#store.store.update((d) => mutate(d.spools.find((x) => x.id === s.id)!));
    return html`
      <section class="card mb-3">
        <div class="card-body d-flex gap-3 align-items-center">
          <span class="rounded-circle border flex-shrink-0" style="width:3rem;height:3rem;background:${f?.colorHex || 'transparent'}"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold">${f ? filamentLabel(doc, f) : '?'}</div>
            <div class="small text-body-secondary">${s.label} · ${s.status}${s.location ? ` · ${s.location}` : ''}</div>
          </div>
        </div>
        <div class="card-body pt-0">
          ${g === null
            ? html`<div class="fs-4"><span class="badge text-bg-warning">not weighed yet</span></div>`
            : html`<div class="d-flex align-items-baseline gap-2"><span class="display-6 fw-semibold">${num(g)} g</span><span class="text-body-secondary">of ${num(s.nominalG)} g</span></div>
                <div class="progress mt-1" style="height: 8px" role="progressbar" aria-label="Remaining" aria-valuenow=${pct ?? 0} aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width: ${pct ?? 0}%"></div></div>`}
        </div>
      </section>
      ${s.status !== 'discarded' ? this.#weigh(s) : nothing}
      ${this.#details(s, set)}
      ${this.#history(s)}
    `;
  }

  #weigh(s: Spool) {
    const doc = this.#doc;
    const tare = resolveTare(doc, s);
    const preview = this.grossG !== null && !this.isEmptySpool ? weighIn(doc, s, this.grossG, today(), '') : null;
    return html`
      <section class="card card-body mb-3">
        <h2 class="h6">Weigh</h2>
        <label class="form-label mb-2">Scale reading incl. spool (g)
          <input class="form-control form-control-lg" type="number" inputmode="decimal" min="0" step="1"
            .value=${this.grossG === null ? '' : String(this.grossG)}
            @input=${(e: Event) => { const v = (e.target as HTMLInputElement).valueAsNumber; this.grossG = Number.isFinite(v) ? v : null; this.saved = ''; }} />
        </label>
        <div class="small mb-2">Empty spool: <strong>${tare.grams === null ? '?' : `${tare.grams} g`}</strong> (${tareText(tare)})</div>
        ${switchField('This is the empty spool', this.isEmptySpool, (v) => (this.isEmptySpool = v), { help: 'Marks it empty and stores the weight as its empty weight.' })}
        ${this.isEmptySpool && tare.kind ? switchField(`Also use as the weight of all "${tare.kind.name}" spools`, this.saveAsPreset, (v) => (this.saveAsPreset = v)) : nothing}
        ${preview ? html`<div class="fs-4 mb-2">→ <strong>${num(preview.netG)} g</strong> <span class="fs-6 text-body-secondary">(${preview.movement.grams >= 0 ? '+' : ''}${num(preview.movement.grams)} g)</span></div>` : nothing}
        <button class="btn btn-primary btn-lg w-100" ?disabled=${this.grossG === null} @click=${() => this.#saveWeighIn(s)}>Save</button>
        ${this.saved ? html`<div class="text-success mt-2">${this.saved}</div>` : nothing}
      </section>
    `;
  }

  async #saveWeighIn(s: Spool) {
    const gross = this.grossG;
    if (gross === null) return;
    const doc = this.#doc;
    const date = today();
    if (this.isEmptySpool) {
      const savePreset = this.saveAsPreset;
      await this.#store.store.update((d) => {
        const x = d.spools.find((y) => y.id === s.id)!;
        x.tareG = gross;
        x.status = 'empty';
        const left = remainingG(x);
        if (left) x.movements.push({ id: newId(), date, kind: 'weigh-in', grams: -left, grossG: gross, tareG: gross, note: 'Empty spool' });
        const kind = d.spoolKinds.find((k) => k.id === x.kindId);
        if (savePreset && kind) Object.assign(kind, { emptyG: gross, source: `measured ${date}` });
      });
      this.saved = 'Marked empty.';
    } else {
      const { movement, netG } = weighIn(doc, s, gross, date, newId());
      await this.#store.store.update((d) => {
        const x = d.spools.find((y) => y.id === s.id)!;
        x.movements.push(movement);
        if (x.status === 'sealed') x.status = 'open';
      });
      this.saved = `Saved: ${num(netG)} g left.`;
    }
    this.grossG = null;
    this.isEmptySpool = false;
  }

  #details(s: Spool, set: (mutate: (x: Spool) => void) => void) {
    const doc = this.#doc;
    const purchase = doc.purchases.find((p) => p.id === s.purchaseId);
    return html`
      <section class="card card-body mb-3">
        <h2 class="h6">Details</h2>
        <div class="row g-2">
          <div class="col-6"><label class="small d-block">Status${cellSelect(s.status, SPOOL_STATUS, (v) => set((x) => (x.status = v as Spool['status'])), true, 'Status')}</label></div>
          <div class="col-6"><label class="small d-block">Location${cellText(s.location, (v) => set((x) => (x.location = v || undefined)), { title: 'Location', placeholder: 'shelf, dry box…' })}</label></div>
          <div class="col-6"><label class="small d-block">Size (g)${cellNumber(s.nominalG, (v) => v && set((x) => (x.nominalG = v)), { min: 0, step: 1, title: 'Nominal grams' })}</label></div>
          <div class="col-6"><label class="small d-block">Empty spool${cellSelect(s.kindId ?? '', kindOptions(doc), (v) => set((x) => (v ? (x.kindId = v) : delete x.kindId)), true, 'Empty spool')}</label></div>
          <div class="col-6"><label class="small d-block">Own empty weight (g)${cellNumber(s.tareG ?? null, (v) => set((x) => (v === null ? delete x.tareG : (x.tareG = v))), { min: 0, allowEmpty: true, title: 'Own empty weight' })}</label></div>
          <div class="col-6"><label class="small d-block">Correct stock by (g)${cellNumber(null, (v) => { if (v) set((x) => x.movements.push({ id: newId(), date: today(), kind: 'adjust', grams: v, note: 'Manual correction' })); }, { allowEmpty: true, title: 'Correction in grams' })}</label></div>
          <div class="col-12"><label class="small d-block">Label${cellText(s.label, (v) => this.#relabel(s, v), { title: 'Label', placeholder: 'e.g. L0042' })}</label>
            <div class="form-text">Scan a new printed label to replace it, or type the code here.</div></div>
        </div>
        ${purchase ? html`<div class="small text-body-secondary mt-2">Bought ${purchase.date}${purchase.store ? ` at ${purchase.store}` : ''}, ${money(purchase.totalPrice / purchase.totalKg, doc.settings.currency)}/kg</div>` : nothing}
        ${this.error ? html`<div class="alert alert-danger mt-2 mb-0">${this.error}</div>` : nothing}
      </section>
    `;
  }

  #relabel(s: Spool, code: string) {
    if (!code) return;
    try {
      void this.#store.store.update((d) => assignLabel(d, s.id, code));
      this.error = '';
      location.hash = `#/spool/${encodeURIComponent(code.toUpperCase())}`;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  #history(s: Spool) {
    let running = 0;
    const rows = s.movements.map((m) => ({ m, after: (running += m.grams) })).reverse();
    return html`
      <details class="card card-body mb-3">
        <summary class="h6 mb-0">History (${s.movements.length})</summary>
        <ul class="list-unstyled small mt-2 mb-0">
          ${rows.length === 0 ? html`<li class="text-body-secondary">No entries: stock unknown.</li>` : nothing}
          ${rows.map(({ m, after }) => html`<li class="d-flex gap-2 border-bottom py-1">
            <span class="text-nowrap">${m.date}</span><span class="me-auto">${m.kind}${m.note ? ` · ${m.note}` : ''}</span>
            <span class="text-nowrap">${m.grams >= 0 ? '+' : ''}${num(m.grams)} g</span><span class="text-nowrap text-body-secondary">→ ${num(after)} g</span>
          </li>`)}
        </ul>
        <button class="btn btn-sm btn-outline-danger mt-3 align-self-start" @click=${() => this.#delete(s)}>Delete spool</button>
      </details>
    `;
  }

  async #delete(s: Spool) {
    if (!(await ask(`Delete spool ${s.label} and its history?`, { ok: 'Delete', danger: true }))) return;
    void this.#store.store.update((d) => (d.spools = d.spools.filter((x) => x.id !== s.id)));
    location.hash = '#/filaments/stock';
  }

  // --- Printed label that is not on a spool yet ------------------------------

  #unassigned(code: string) {
    const doc = this.#doc;
    const q = this.assignFilter.toLowerCase();
    const label = (s: Spool) => {
      const f = doc.filaments.find((x) => x.id === s.filamentId);
      return f ? filamentLabel(doc, f) : '?';
    };
    // Spools without a printed label first.
    const candidates = doc.spools
      .filter((s) => s.status !== 'discarded' && s.status !== 'empty')
      .filter((s) => !q || `${s.label} ${label(s)} ${s.location ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(isLabelCode(a.label)) - Number(isLabelCode(b.label)) || label(a).localeCompare(label(b)));
    const ns = this.newSpool;
    const tare = ns.filamentId ? resolveTare(doc, { kindId: ns.kindId || undefined }) : null;
    const purchases = doc.purchases.filter((p) => p.filamentId === ns.filamentId).sort((a, b) => b.date.localeCompare(a.date));
    const set = (patch: Partial<NewSpoolDraft>) => (this.newSpool = { ...this.newSpool, ...patch });
    return html`
      <section class="card card-body mb-3">
        <h1 class="h4 mb-1">Label ${code}</h1>
        <p class="mb-0 text-body-secondary">Not on a spool yet. Set up the spool you stuck it on.</p>
      </section>
      <section class="card card-body mb-3">
        <h2 class="h6">New spool</h2>
        <div class="mb-2">${pickFilament(ns.filamentId, (v) => set({ filamentId: v, purchaseId: '', kindId: suggestKind(doc, v) ?? '' }))}</div>
        ${switchField('Sealed / unopened (full weight, no weighing)', ns.sealed, (v) => set({ sealed: v }))}
        ${ns.sealed
          ? nothing
          : html`<label class="form-label d-block mb-2">Scale reading incl. spool (g)
              <input class="form-control form-control-lg" type="number" inputmode="decimal" min="0" step="1" .value=${ns.grossG === null ? '' : String(ns.grossG)}
                @input=${(e: Event) => { const v = (e.target as HTMLInputElement).valueAsNumber; set({ grossG: Number.isFinite(v) ? v : null }); }} />
              <span class="form-text d-block">${tare && tare.grams !== null
                ? html`Empty spool ${tare.grams} g (${tareText(tare)})${ns.grossG !== null ? html` → <strong>${num(Math.max(ns.grossG - tare.grams, 0))} g</strong> filament` : nothing}`
                : ns.filamentId ? 'Choose the empty spool below.' : 'Choose the filament first.'} Leave empty to weigh later.</span>
            </label>`}
        <div class="row g-2 mb-2">
          <div class="col-6"><label class="small d-block">Size (g)${cellNumber(ns.nominalG, (v) => set({ nominalG: v ?? 1000 }), { min: 0, step: 1, title: 'Nominal grams' })}</label></div>
          <div class="col-6"><label class="small d-block">Empty spool${cellSelect(ns.kindId, kindOptions(doc), (v) => set({ kindId: v }), true, 'Empty spool')}</label></div>
          ${purchases.length
            ? html`<div class="col-12"><label class="small d-block">From purchase (optional)${cellSelect(ns.purchaseId, [{ value: '', label: '–' }, ...purchases.map((p) => ({ value: p.id, label: `${p.date}${p.store ? ` · ${p.store}` : ''} · ${num(p.totalKg, 2)} kg · ${money(p.totalPrice / p.totalKg, doc.settings.currency)}/kg` }))], (v) => { const p = doc.purchases.find((x) => x.id === v); set({ purchaseId: v, kindId: suggestKind(doc, ns.filamentId, v || undefined) ?? '', ...(p ? { nominalG: Math.round(spoolKgOf(p) * 1000) } : {}) }); }, true, 'Purchase')}</label></div>`
            : nothing}
        </div>
        <button class="btn btn-primary btn-lg w-100" ?disabled=${!ns.filamentId} @click=${() => this.#createWithLabel(code)}>Save spool ${code}</button>
      </section>
      ${candidates.length
        ? html`<details class="card card-body mb-3" ?open=${candidates.some((s) => !isLabelCode(s.label))}>
            <summary class="h6 mb-0">…or put it on a spool that is already in the app (${candidates.length})</summary>
            <input class="form-control my-2" type="search" placeholder="Filter (color, brand, location)…" aria-label="Filter spools"
              .value=${this.assignFilter} @input=${(e: Event) => (this.assignFilter = (e.target as HTMLInputElement).value)} />
            <div class="list-group">
              ${candidates.map((s) => {
                const f = doc.filaments.find((x) => x.id === s.filamentId);
                const g = remainingG(s);
                return html`<button class="list-group-item list-group-item-action d-flex gap-2 align-items-center" @click=${() => this.#assign(s.id, code)}>
                  <span class="rounded-circle border flex-shrink-0" style="width:1.25rem;height:1.25rem;background:${f?.colorHex || 'transparent'}"></span>
                  <span class="me-auto text-start">${label(s)}<div class="small text-body-secondary">${s.label}${s.location ? ` · ${s.location}` : ''}</div></span>
                  <span class="small text-nowrap">${g === null ? '?' : `${num(g)} g`}</span>
                </button>`;
              })}
            </div>
          </details>`
        : nothing}
      ${this.error ? html`<div class="alert alert-danger">${this.error}</div>` : nothing}
    `;
  }

  async #assign(spoolId: string, code: string) {
    try {
      await this.#store.store.update((d) => assignLabel(d, spoolId, code));
      this.error = '';
      this.requestUpdate();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async #createWithLabel(code: string) {
    const ns = this.newSpool;
    try {
      await this.#store.store.update((d) => {
        d.spools.push(spoolFromLabel(d, { code, filamentId: ns.filamentId, nominalG: ns.nominalG, kindId: ns.kindId || undefined, sealed: ns.sealed, grossG: ns.grossG, purchaseId: ns.purchaseId || undefined, date: today() }, newId));
      });
      saveDraft(ns);
      // Next label starts with the same filament/size/type, but a fresh reading.
      this.newSpool = { ...ns, sealed: false, grossG: null, purchaseId: '' };
      this.saved = `Spool ${code} saved. Scan the next label to continue.`;
      this.error = '';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

interface NewSpoolDraft {
  filamentId: string;
  nominalG: number;
  kindId: string;
  sealed: boolean;
  grossG: number | null;
  purchaseId: string;
}

const DRAFT_KEY = '3dpc.newSpoolDraft';

function loadDraft(): NewSpoolDraft {
  const fallback: NewSpoolDraft = { filamentId: '', nominalG: 1000, kindId: '', sealed: false, grossG: null, purchaseId: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<NewSpoolDraft> | null;
    return { ...fallback, ...saved, sealed: false, grossG: null, purchaseId: '' };
  } catch {
    return fallback;
  }
}

function saveDraft(d: NewSpoolDraft): void {
  try {
    // Not "sealed": booking an opened spool as full by accident would be wrong.
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ filamentId: d.filamentId, nominalG: d.nominalG, kindId: d.kindId }));
  } catch {
    // storage blocked: just no defaults next time
  }
}
