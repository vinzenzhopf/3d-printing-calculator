import { printerHours } from './calc/machine-rate';
import type { AppDocument, Id, IsoDate, MaintenanceTask, Printer } from './model';

export interface MaintenanceDue {
  printerId: Id;
  taskId: Id;
  task: string;
  /** Print hours until due; negative = overdue; null = never recorded or no hour counter. */
  dueInHours: number | null;
}

/** Status of every task on printers that are not retired, most urgent first (MC-5). */
export function maintenanceStatus(doc: AppDocument): MaintenanceDue[] {
  const rows: MaintenanceDue[] = [];
  for (const printer of doc.printers.filter((p) => p.status !== 'retired')) {
    const hours = printerHours(printer, doc.printJobs).lifetimeHours;
    for (const t of printer.maintenance ?? []) {
      rows.push({
        printerId: printer.id,
        taskId: t.id,
        task: t.task,
        dueInHours: hours === null || t.lastDoneHours === null ? null : t.lastDoneHours + t.everyHours - hours,
      });
    }
  }
  return rows.sort((a, b) => (a.dueInHours ?? -Infinity) - (b.dueInHours ?? -Infinity));
}

/** Records a task as done at the printer's current hour counter. */
export function markDone(doc: AppDocument, printer: Printer, task: MaintenanceTask, date: IsoDate): void {
  task.lastDoneHours = printerHours(printer, doc.printJobs).lifetimeHours ?? 0;
  task.lastDoneDate = date;
}
