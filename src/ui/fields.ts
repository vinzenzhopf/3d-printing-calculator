import { html, nothing, type TemplateResult } from 'lit';

/**
 * Bootstrap form controls as small template helpers. They are "uncontrolled
 * until committed": values are written back on `change` (blur/enter), not on
 * every keystroke, so each edit is one store update.
 */

interface FieldOptions {
  help?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}

function wrap(label: string, control: TemplateResult, opts: FieldOptions): TemplateResult {
  return html`
    <label class="form-label d-block mb-3">
      <span class="d-block mb-1">${label}</span>
      ${opts.suffix ? html`<div class="input-group">${control}<span class="input-group-text">${opts.suffix}</span></div>` : control}
      ${opts.help ? html`<span class="form-text d-block">${opts.help}</span>` : nothing}
    </label>
  `;
}

export function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  opts: FieldOptions = {},
): TemplateResult {
  const control = html`<input
    type="number"
    class="form-control"
    .value=${String(value)}
    step=${opts.step ?? 'any'}
    min=${opts.min ?? nothing}
    max=${opts.max ?? nothing}
    @change=${(e: Event) => {
      const input = e.target as HTMLInputElement;
      if (input.checkValidity() && Number.isFinite(input.valueAsNumber)) onChange(input.valueAsNumber);
      else input.value = String(value);
    }}
  />`;
  return wrap(label, control, opts);
}

export function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  opts: FieldOptions = {},
): TemplateResult {
  const control = html`<input
    type="text"
    class="form-control"
    .value=${value}
    placeholder=${opts.placeholder ?? nothing}
    @change=${(e: Event) => onChange((e.target as HTMLInputElement).value.trim())}
  />`;
  return wrap(label, control, opts);
}

export function textAreaField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  opts: FieldOptions = {},
): TemplateResult {
  const control = html`<textarea
    class="form-control"
    rows="3"
    .value=${value}
    placeholder=${opts.placeholder ?? nothing}
    @change=${(e: Event) => onChange((e.target as HTMLTextAreaElement).value.trim())}
  ></textarea>`;
  return wrap(label, control, opts);
}

export function switchField(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  opts: Pick<FieldOptions, 'help'> = {},
): TemplateResult {
  return html`
    <div class="form-check form-switch mb-3">
      <label class="form-check-label">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          .checked=${checked}
          @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
        />
        ${label}
      </label>
      ${opts.help ? html`<div class="form-text">${opts.help}</div>` : nothing}
    </div>
  `;
}

export interface Option {
  value: string;
  label: string;
}

export function selectField(
  label: string,
  value: string,
  options: Option[],
  onChange: (value: string) => void,
  opts: Pick<FieldOptions, 'help'> = {},
): TemplateResult {
  return wrap(label, cellSelect(value, options, onChange, false), opts);
}

// --- Compact controls for table cells (no label; pass aria-label via `title`). ---

export function cellNumber(
  value: number | null | undefined,
  onChange: (value: number | null) => void,
  opts: { step?: number; min?: number; title?: string; width?: string; allowEmpty?: boolean } = {},
): TemplateResult {
  return html`<input
    type="number"
    class="form-control form-control-sm"
    style=${opts.width ? `width:${opts.width}` : nothing}
    aria-label=${opts.title ?? nothing}
    title=${opts.title ?? nothing}
    .value=${value === null || value === undefined ? '' : String(value)}
    step=${opts.step ?? 'any'}
    min=${opts.min ?? nothing}
    @change=${(e: Event) => {
      const input = e.target as HTMLInputElement;
      if (input.value === '' && opts.allowEmpty) return onChange(null);
      if (input.checkValidity() && Number.isFinite(input.valueAsNumber)) onChange(input.valueAsNumber);
      else input.value = value === null || value === undefined ? '' : String(value);
    }}
  />`;
}

export function cellText(
  value: string | null | undefined,
  onChange: (value: string) => void,
  opts: { title?: string; placeholder?: string; type?: 'text' | 'date' | 'url' | 'color'; list?: string } = {},
): TemplateResult {
  return html`<input
    type=${opts.type ?? 'text'}
    list=${opts.list ?? nothing}
    class=${opts.type === 'color' ? 'form-control form-control-sm form-control-color' : 'form-control form-control-sm'}
    aria-label=${opts.title ?? nothing}
    title=${opts.title ?? nothing}
    placeholder=${opts.placeholder ?? nothing}
    .value=${value ?? ''}
    @change=${(e: Event) => onChange((e.target as HTMLInputElement).value.trim())}
  />`;
}

export function cellSelect(
  value: string,
  options: Option[],
  onChange: (value: string) => void,
  small = true,
  title?: string,
): TemplateResult {
  return html`<select
    class=${small ? 'form-select form-select-sm' : 'form-select'}
    aria-label=${title ?? nothing}
    @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
  >
    ${options.map((o) => html`<option value=${o.value} ?selected=${o.value === value}>${o.label}</option>`)}
  </select>`;
}
