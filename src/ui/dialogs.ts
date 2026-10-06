/**
 * In-page replacements for confirm()/alert(). The native dialogs can be
 * suppressed (embedded browsers, "prevent this page from creating dialogs"),
 * where confirm() silently returns false.
 */

interface DialogOptions {
  /** Label of the confirming button. */
  ok?: string;
  /** Red confirm button, for deleting and disconnecting. */
  danger?: boolean;
  /** Show a cancel button (confirm) or only OK (notice). */
  cancel?: boolean;
}

function show(message: string, { ok = 'OK', danger = false, cancel = true }: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'border-0 rounded-3 shadow p-0';
    dialog.style.maxWidth = 'min(28rem, calc(100vw - 2rem))';
    dialog.innerHTML = `
      <form method="dialog" class="p-3 bg-body text-body">
        <p class="mb-3" style="white-space: pre-line"></p>
        <div class="d-flex justify-content-end gap-2">
          ${cancel ? '<button class="btn btn-outline-secondary" value="cancel">Cancel</button>' : ''}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok"></button>
        </div>
      </form>`;
    dialog.querySelector('p')!.textContent = message;
    dialog.querySelector<HTMLButtonElement>('button[value=ok]')!.textContent = ok;
    // Escape and the cancel button both leave returnValue at something other than "ok".
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'ok');
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>(cancel ? 'button[value=cancel]' : 'button[value=ok]')!.focus();
  });
}

/** Asks before a destructive or important action; resolves true on confirm. */
export function ask(message: string, options: DialogOptions = {}): Promise<boolean> {
  return show(message, { ok: 'OK', ...options, cancel: true });
}

/** Shows a notice with a single OK button. */
export async function tell(message: string): Promise<void> {
  await show(message, { cancel: false });
}
