import type { Status } from '../types';

const labels: Record<Status, string> = {
  unread: 'Unread',
  reading: 'Reading',
  read: 'Read',
  archived: 'Archived'
};

export function StatusSelect({ value, onChange, compact = false }: { value: Status; onChange: (status: Status) => void; compact?: boolean }) {
  return (
    <select className={`status-select ${compact ? 'compact' : ''}`} value={value} onChange={(event) => onChange(event.target.value as Status)} aria-label="Reading status">
      {Object.entries(labels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
    </select>
  );
}
