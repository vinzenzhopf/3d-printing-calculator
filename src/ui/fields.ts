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
