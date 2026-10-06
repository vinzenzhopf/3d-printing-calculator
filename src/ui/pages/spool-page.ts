import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AppDocument, Spool, SpoolType } from '../../core/model';
import { assignLabel, findSpool, isLabelCode, remainingG, resolveTare, weighIn } from '../../core/stock';
import { StoreController } from '../../state/app-store';
import { store } from '../../state/store-instance';
import { pickFilament } from '../filament-picker';
import { cellNumber, cellSelect, cellText, switchField } from '../fields';
import { money, newId, num, today } from '../format';
import { SPOOL_STATUS, SPOOL_TYPES, TARE_SOURCE, filamentLabel, lineLabel } from './filaments/labels';

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
  @state() private newSpool = { filamentId: '', spoolType: 'plastic' as SpoolType, nominalG: 1000 };
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
      <a href="#/filaments/stock" class="btn btn-sm btn-outline-secondary mb-3">← Stock</a>
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
    const line = doc.productLines.find((l) => l.id === doc.filaments.find((f) => f.id === s.filamentId)?.productLineId);
    return html`
      <section class="card card-body mb-3">
        <h2 class="h6">Weigh</h2>
        <label class="form-label mb-2">Scale reading incl. spool (g)
          <input class="form-control form-control-lg" type="number" inputmode="decimal" min="0" step="1"
            .value=${this.grossG === null ? '' : String(this.grossG)}
            @input=${(e: Event) => { const v = (e.target as HTMLInputElement).valueAsNumber; this.grossG = Number.isFinite(v) ? v : null; this.saved = ''; }} />
        </label>
        <div class="small mb-2">Empty spool: <strong>${tare.grams === null ? '?' : `${tare.grams} g`}</strong> (${TARE_SOURCE[tare.source]}${tare.verified ? '' : ', unverified'})</div>
        ${switchField('This is the empty spool', this.isEmptySpool, (v) => (this.isEmptySpool = v), { help: 'Marks it empty and stores the weight as its empty weight.' })}
        ${this.isEmptySpool && line ? switchField(`Use as empty weight for all ${lineLabel(line)} (${s.spoolType ?? 'plastic'})`, this.saveAsPreset, (v) => (this.saveAsPreset = v)) : nothing}
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
      const line = doc.productLines.find((l) => l.id === doc.filaments.find((f) => f.id === s.filamentId)?.productLineId);
      const type = s.spoolType ?? 'plastic';
      const savePreset = this.saveAsPreset;
      await this.#store.store.update((d) => {
        const x = d.spools.find((y) => y.id === s.id)!;
        x.tareG = gross;
        x.status = 'empty';
        const left = remainingG(x);
        if (left) x.movements.push({ id: newId(), date, kind: 'weigh-in', grams: -left, grossG: gross, tareG: gross, note: 'Empty spool' });
        if (savePreset && line) {
          const existing = d.tarePresets.find((p) => p.productLineId === line.id && p.spoolType === type);
          if (existing) Object.assign(existing, { emptyG: gross, source: `measured ${date}`, verified: true });
          else d.tarePresets.push({ id: newId(), manufacturer: line.manufacturer, productLineId: line.id, spoolType: type, emptyG: gross, source: `measured ${date}`, verified: true });
        }
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
          <div class="col-6"><label class="small d-block">Size (g)${cellNumber(s.nominalG, (v) => v && set((x) => (x.nominalG = v)), { min: 1, step: 50, title: 'Nominal grams' })}</label></div>
          <div class="col-6"><label class="small d-block">Spool${cellSelect(s.spoolType ?? 'plastic', SPOOL_TYPES, (v) => set((x) => (x.spoolType = v as SpoolType)), true, 'Spool type')}</label></div>
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

  #delete(s: Spool) {
    if (!confirm(`Delete spool ${s.label} and its history?`)) return;
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
    return html`
      <section class="card card-body mb-3">
        <h1 class="h4">Label ${code}</h1>
        <p class="mb-0">This label is not on a spool yet. Which spool did you stick it on?</p>
      </section>
      <section class="card card-body mb-3">
        <h2 class="h6">Existing spool</h2>
        <input class="form-control mb-2" type="search" placeholder="Filter (color, brand, location)…" aria-label="Filter spools"
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
          ${candidates.length === 0 ? html`<div class="text-body-secondary small">No spools in use.</div>` : nothing}
        </div>
      </section>
      <section class="card card-body mb-3">
        <h2 class="h6">New spool</h2>
        <div class="mb-2">${pickFilament(this.newSpool.filamentId, (v) => (this.newSpool = { ...this.newSpool, filamentId: v }))}</div>
        <div class="row g-2 mb-2">
          <div class="col-6"><label class="small d-block">Size (g)${cellNumber(this.newSpool.nominalG, (v) => (this.newSpool = { ...this.newSpool, nominalG: v ?? 1000 }), { min: 1, step: 50, title: 'Nominal grams' })}</label></div>
          <div class="col-6"><label class="small d-block">Spool${cellSelect(this.newSpool.spoolType, SPOOL_TYPES, (v) => (this.newSpool = { ...this.newSpool, spoolType: v as SpoolType }), true, 'Spool type')}</label></div>
        </div>
        <button class="btn btn-primary w-100" ?disabled=${!this.newSpool.filamentId} @click=${() => this.#createWithLabel(code)}>Create spool with label ${code}</button>
      </section>
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
    await this.#store.store.update((d) =>
      d.spools.push({ id: newId(), filamentId: ns.filamentId, label: code, nominalG: ns.nominalG, spoolType: ns.spoolType, status: 'open', movements: [] }),
    );
  }
}
