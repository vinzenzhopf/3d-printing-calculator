import type { AppDocument } from '../core/model';
import { exportFileName, serializeDocument } from '../core/transfer';

const KEY = '3dpc.lastExport';

/** Downloads the document as JSON and remembers when (per device) for the backup reminder (ST-5). */
export function downloadBackup(doc: AppDocument): void {
  const url = URL.createObjectURL(new Blob([serializeDocument(doc)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: exportFileName() }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // storage blocked: the reminder just keeps showing
  }
}

export function lastBackup(): Date | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}
