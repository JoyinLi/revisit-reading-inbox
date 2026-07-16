import { BookPlus } from 'lucide-react';

export function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="empty-state">
      <BookPlus size={30} />
      <h2>Nothing here yet</h2>
      <p><strong>Save now. Return with intention.</strong><br />Save an article or website with the Chrome extension, or paste a link directly.</p>
      {onAdd && <button className="button primary" onClick={onAdd}>Add your first link</button>}
    </div>
  );
}
