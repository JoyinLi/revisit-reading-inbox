import { Highlighter, MessageSquareText, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Highlight, Note } from '../types';

export function HighlightsPage() {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [notePendingDelete, setNotePendingDelete] = useState<Note | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);

  async function load() {
    setLoading(true);
    try { setHighlights(await api.listHighlights()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return highlights;
    return highlights.filter((highlight) => [
      highlight.quote,
      highlight.title,
      highlight.source,
      ...(highlight.notes ?? []).map((note) => note.body)
    ].some((value) => value?.toLowerCase().includes(term)));
  }, [highlights, query]);

  async function removeHighlight(id: string) {
    await api.deleteHighlight(id);
    setHighlights((current) => current.filter((highlight) => highlight.id !== id));
  }

  function removeNote(note: Note) {
    setNotePendingDelete(note);
  }

  async function confirmRemoveNote() {
    if (!notePendingDelete) return;
    setDeletingNote(true);
    try {
      await api.deleteNote(notePendingDelete.id);
      setHighlights((current) => current.map((highlight) => ({
        ...highlight,
        notes: (highlight.notes ?? []).filter((entry) => entry.id !== notePendingDelete.id)
      })));
      setNotePendingDelete(null);
    } finally {
      setDeletingNote(false);
    }
  }

  return (
    <div className="highlights-page page-frame">
      <header className="page-header">
        <div><h1>Highlights</h1><p>The passages and thoughts you chose to keep.</p></div>
      </header>
      <label className="search-field highlights-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search highlights and notes" /></label>

      {loading ? <div className="loading-list"><span /><span /></div> : filtered.length === 0 ? (
        <div className="empty-state"><Highlighter size={30} /><h2>No highlights yet</h2><p>Select text inside any Reader view to create your first highlight.</p></div>
      ) : (
        <div className="highlight-list">
          {filtered.map((highlight) => (
            <article className="highlight-card" key={highlight.id}>
              <Link className="highlight-main-link" to={`/item/${highlight.item_id}#block-${highlight.block_index ?? 0}`}>
                <div className="highlight-source">{highlight.source} · {highlight.title}</div>
                <blockquote>{highlight.quote}</blockquote>
                <time>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(highlight.created_at))}</time>
              </Link>
              {(highlight.notes ?? []).length > 0 && (
                <div className="highlight-notes-stack">
                  {(highlight.notes ?? []).map((note) => (
                    <div className="highlight-note" key={note.id}>
                      <MessageSquareText size={15} />
                      <p>{note.body}</p>
                      <button className="mini-delete" onClick={() => removeNote(note)} aria-label="Delete note"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="highlight-card-actions">
                <Link className="text-action" to={`/item/${highlight.item_id}#block-${highlight.block_index ?? 0}`}>Open and add note</Link>
                <button className="icon-button danger-hover" onClick={() => removeHighlight(highlight.id)} aria-label="Delete highlight"><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(notePendingDelete)}
        title="Delete note?"
        description="This note will be permanently deleted."
        confirmLabel="Delete"
        busy={deletingNote}
        onCancel={() => setNotePendingDelete(null)}
        onConfirm={confirmRemoveNote}
      />
    </div>
  );
}
