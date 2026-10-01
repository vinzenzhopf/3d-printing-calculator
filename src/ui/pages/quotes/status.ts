import type { QuoteStatus } from '../../../core/model';

export const STATUS_COLOR: Record<QuoteStatus, string> = {
  draft: 'secondary',
  sent: 'info',
  accepted: 'primary',
  printing: 'warning',
  delivered: 'success',
  paid: 'success',
  rejected: 'danger',
};
