/** The colour of a run status badge. */
export function statusColor(status?: string): string {
  switch (status) {
    case 'SUCCESS':
      return 'var(--sf-jade)';
    case 'PARTIAL':
      return 'var(--sf-amber)';
    case 'FAILED':
      return 'var(--sf-rust)';
    case 'RUNNING':
    case 'QUEUED':
      return 'var(--sf-signal)';
    default:
      return 'var(--sf-slate)';
  }
}
