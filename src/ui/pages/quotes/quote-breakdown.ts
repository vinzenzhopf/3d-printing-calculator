import { html, nothing, type TemplateResult } from 'lit';
import type { PlateExplain, QuoteResult } from '../../../core/calc/quote';
import type { AppDocument } from '../../../core/model';
import { formatDuration } from '../../../core/duration';
import { SPLIT_LABEL } from '../../../core/parts';
import { money, num, percent } from '../../format';
import { findFilament } from '../../../core/catalog-cleanup';
import { SOURCE_LABEL, filamentLabel } from '../filaments/labels';

/** Cost blocks of a quote, in the order of the share bar, with their colors (see styles.css). */
const BLOCKS = [
  ['filament', 'Filament'],
  ['energy', 'Energy'],
  ['machine', 'Machine'],
  ['labor', 'Labor'],
  ['items', 'Items'],
  ['failure', 'Failure allowance'],
  ['profit', 'Profit'],
] as const;
type Block = (typeof BLOCKS)[number][0];

/**
 * How a quote's price comes about: a bar of the cost blocks and the profit, and
 * every step with its formula and the values it used (from `QuoteResult.explain`;
 * snapshots frozen by older versions show the amounts only).
 */
export function quoteBreakdown(doc: AppDocument, r: QuoteResult): TemplateResult {
  const cur = doc.settings.currency;
  const m = (v: number) => money(v, cur);
  // Frozen snapshots may name a duplicate that was merged since: findFilament follows it.
  const filamentName = { get: (id: string) => { const f = findFilament(doc, id); return f ? filamentLabel(doc, f) : undefined; } };
  const e = r.explain;
  const plates = r.plates.filter((p) => p.explain) as (QuoteResult['plates'][number] & { explain: PlateExplain })[];
  const multi = plates.length > 1;
  const plateLabel = (name: string) => (multi ? html`<span class="text-body-secondary">${name}: </span>` : nothing);
  const profit = r.net - r.cost;

  const amounts: Record<Block, number> = {
    filament: r.production.filament,
    energy: r.production.energy,
    machine: r.production.machine,
    labor: r.production.labor + r.laborExtras,
    items: r.items,
    failure: r.failure,
    profit: Math.max(profit, 0),
  };
  const barTotal = Object.values(amounts).reduce((a, b) => a + b, 0);

  /** One step: label, amount, and its formula (expandable when there is one). */
  const step = (label: string, amount: number, formula: unknown, opts: { strong?: boolean; sign?: '+' | '−'; block?: Block } = {}) => {
    if (Math.abs(amount) < 0.005 && !opts.strong) return nothing;
    const value = html`<span class="text-nowrap ${opts.strong ? 'fw-semibold' : ''}">${opts.sign ?? ''}${m(Math.abs(amount))}</span>`;
    const swatch = opts.block ? html`<span class="cost-dot cost-${opts.block}"></span>` : nothing;
    return formula
      ? html`<details class="calc-step"><summary class="d-flex gap-2"><span class="me-auto">${swatch}${label}</span>${value}</summary><div class="calc-formula">${formula}</div></details>`
      : html`<div class="calc-step d-flex gap-2 ${opts.strong ? 'calc-total' : ''}"><span class="me-auto">${swatch}${label}</span>${value}</div>`;
  };

  const filamentFormula = plates.flatMap((p) => p.explain.filaments.map((f) => {
    const used = r.prices.find((x) => x.filamentId === f.filamentId);
    return html`<div>${plateLabel(p.name)}${filamentName.get(f.filamentId) ?? '?'}:
      ${num(f.modelG, 1)} g model${f.wasteG > 0.05 ? html` + ${num(f.wasteG, 1)} g waste` : nothing} × ${m(f.pricePerKg)}/kg = <strong>${m(f.cost)}</strong>
      ${used ? html`<span class="text-body-secondary">(price: ${SOURCE_LABEL[used.source]}${used.stale ? ', stale' : ''})</span>` : nothing}</div>`;
  }));
  const wasteNote = plates.some((p) => p.explain.primingG || p.explain.purgeG)
    ? html`<div class="text-body-secondary">Waste per run: ${plates.map((p) => html`${plateLabel(p.name)}${num(p.explain.primingG)} g priming line/skirt${p.explain.purgeG ? html` + ${num(p.explain.purgeG, 1)} g purge` : nothing}. `)}Split by weight between the filaments.</div>`
    : nothing;

  const energyFormula = plates.map((p) => {
    const x = p.explain.energy;
    if (!x.power) return html`<div>${plateLabel(p.name)}no power profile for this material on ${p.explain.printer}: counted as 0.</div>`;
    return html`<div>${plateLabel(p.name)}heat-up ${num(x.power.heatupMin)} min × ${num(x.power.heatupPowerW)} W
      + ${num(x.firstPhaseH, 2)} h × ${num(x.power.powerFirstHourW)} W
      ${x.followingH > 0 ? html`+ ${num(x.followingH, 2)} h × ${num(x.power.powerFollowingHoursW)} W` : nothing}
      = ${num(x.perRunWh / 1000, 3)} kWh per run × ${num(p.runs)} run${p.runs === 1 ? '' : 's'} × ${m(x.pricePerKwh)}/kWh = <strong>${m(p.energy)}</strong></div>`;
  });

  const machineFormula = plates.map((p) => {
    const x = p.explain.machine;
    const partsOfRate = [
      x.includeMachine && x.investmentPerHour ? `investment ${m(x.investmentPerHour)}` : '',
      x.includeMachine && x.wearPerHour ? `wear parts ${m(x.wearPerHour)}` : '',
      x.includeMachine && x.sharedPerHour ? `shared costs ${m(x.sharedPerHour)}` : '',
      x.reservePerHour && x.reserveShare ? `reserve ${m(x.reservePerHour)} × ${percent(x.reserveShare)}` : '',
    ].filter(Boolean);
    return html`<div>${plateLabel(p.name)}${formatDuration(p.printHours * 60)} h on ${p.explain.printer} × ${m(x.ratePerHour)}/h = <strong>${m(p.machine)}</strong>
      ${partsOfRate.length ? html`<div class="text-body-secondary">per hour: ${partsOfRate.join(' + ')}${x.includeMachine ? '' : ' (this profile charges no machine costs)'}</div>` : nothing}</div>`;
  });

  const laborFormula = html`${plates.filter((p) => p.labor > 0).map((p) => html`<div>${plateLabel(p.name)}${num(p.explain.labor.minutesPerRun)} min × ${num(p.runs)} run${p.runs === 1 ? '' : 's'} × ${m(p.explain.labor.hourlyRate)}/h = <strong>${m(p.labor)}</strong></div>`)}
    ${r.laborExtras > 0 ? html`<div>Extra work (design, post-processing): <strong>${m(r.laborExtras)}</strong></div>` : nothing}`;

  return html`
    ${barTotal > 0
      ? html`<div class="cost-bar mb-1" role="img" aria-label="Share of the price by cost block">
          ${BLOCKS.map(([k, label]) => amounts[k] > 0.005 ? html`<span class="cost-${k}" style="width:${(amounts[k] / barTotal) * 100}%" title="${label}: ${m(amounts[k])} (${percent(amounts[k] / barTotal)})"></span>` : nothing)}
        </div>
        <div class="d-flex flex-wrap column-gap-3 small mb-3">
          ${BLOCKS.map(([k, label]) => amounts[k] > 0.005 ? html`<span><span class="cost-dot cost-${k}"></span>${label} ${percent(amounts[k] / barTotal)}</span>` : nothing)}
        </div>`
      : nothing}

    <div class="small calc">
      ${step('Filament', r.production.filament, e ? html`${filamentFormula}${wasteNote}` : null, { block: 'filament' })}
      ${step('Energy', r.production.energy, e ? energyFormula : null, { block: 'energy' })}
      ${step('Machine', r.production.machine, e ? machineFormula : null, { block: 'machine' })}
      ${step('Labor', r.production.labor + r.laborExtras, e ? laborFormula : null, { block: 'labor' })}
      ${step('Items (hardware, packaging, …)', r.items, null, { block: 'items' })}
      ${step('Failure allowance', r.failure, e ? html`${percent(e.failureRate, 1)} of filament, energy and machine (${m(e.failureBase)}), for prints that fail.` : null, { block: 'failure' })}
      ${step('Cost', r.cost, null, { strong: true })}

      ${e?.target
        ? step(r.markup >= 0 ? (e.target.kind === 'parts' ? 'Markup from the part prices' : 'Markup to reach the target price') : 'Below cost', r.markup,
            html`${e.target.kind === 'parts'
              ? html`${(r.parts ?? []).filter((p) => p.price !== null && p.required > 0).map((p) => html`<div>${num(p.required)} × ${p.name} à ${m(p.price!)} = ${m(p.required * p.price!)}</div>`)}<div>Part prices total <strong>${m(e.target.total)}</strong>${e.showGross ? ' incl. VAT' : ''}.</div>`
              : html`Target price for the quote: ${m(e.target.total)}${e.showGross ? ' incl. VAT' : ''}.`}
              <div class="text-body-secondary">Markup, discounts, minimum price and rounding of the profile are not applied.</div>`,
            { sign: r.markup >= 0 ? '+' : '−' })
        : html`
          ${step('Markup', r.markup, e ? html`${percent(e.markupRate, 1)} of ${m(e.markupBase)} (${e.profileName}${e.markupOnItems ? ', items included' : ', without items'})` : null, { sign: '+' })}
          ${step('Quantity discount', r.quantityDiscount, r.quantityTier ? html`${num(r.quantityTier.discountPercent)} % from ${num(r.quantityTier.fromParts)} parts (this quote: ${num(e?.parts ?? 0)} parts)` : null, { sign: '−' })}
          ${step('Discount', r.discount, e ? html`${num(e.discountPercent)} % customer discount` : null, { sign: '−' })}
          ${step('Raised to the minimum price', r.minimumApplied, e ? html`The profile's minimum price is ${m(e.minimumPrice)}.` : null, { sign: '+' })}
          ${step('Rounding', r.rounding, e ? html`Rounded up to the next ${m(e.roundTo)}${e.showGross ? ' (on the price incl. VAT)' : ''}.` : null, { sign: '+' })}`}

      ${e && e.vatRate > 0
        ? html`${step('Net', r.net, null, { strong: true })}
            ${step(`VAT ${num(e.vatRate * 100)} %`, r.vat, null, { sign: '+' })}
            ${step('Price incl. VAT', r.gross, null, { strong: true })}`
        : step('Price', r.net, null, { strong: true })}
    </div>

    <div class="calc-profit small mt-2 ${profit < 0 ? 'text-danger' : ''}">
      <strong>${profit >= 0 ? 'Profit' : 'Loss'}: ${m(Math.abs(profit))}</strong>
      ${r.margin !== null ? html` · margin ${percent(r.margin, 1)}` : nothing}
      ${r.pricePerPrintHour !== null ? html` · ${m(r.pricePerPrintHour)} per print hour` : nothing}
      <div class="text-body-secondary">Price − cost. Full cost incl. labor, machine and the whole reserve: ${m(r.fullCost)}.</div>
    </div>

    ${r.plates.length > 0
      ? html`<table class="table table-sm small mt-3 mb-0">
          <thead><tr><th>${multi ? 'Plate' : ''}</th><th class="text-end">Parts</th><th class="text-end">Cost / part</th><th class="text-end">Price / part</th></tr></thead>
          <tbody>${r.plates.map((p) => html`<tr>
            <td>${multi ? p.name : 'Per part'}</td>
            <td class="text-end">${num(p.parts)}</td>
            <td class="text-end">${p.parts ? m(p.cost / p.parts) : '–'}</td>
            <td class="text-end">${p.parts ? m(p.pricePerPart) : '–'}</td>
          </tr>`)}</tbody>
        </table>
        ${r.plates.filter((p) => p.split && p.split.mode !== 'even').map((p) => html`<div class="text-body-secondary small">
          ${p.name}: cost split ${SPLIT_LABEL[p.split!.mode]}, per piece ${p.split!.parts.map((x) => `${x.name || '(unnamed)'} ${m(x.each)}`).join(', ')}
          (share of one run, before failure allowance and extras).</div>`)}
        <div class="text-body-secondary small">Plates share the price by their cost. Print time ${formatDuration(r.printHours * 60)} h, ${num(r.plates.reduce((s, p) => s + p.filamentG, 0))} g filament.</div>`
      : nothing}
  `;
}
