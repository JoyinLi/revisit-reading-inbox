import { ArrowLeft, Check, ExternalLink, Globe2, Highlighter, Image as ImageIcon, LoaderCircle, Pencil, Play, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusSelect } from '../components/StatusSelect';
import type { Block, Highlight, ItemDetail, Note, Status } from '../types';

type PendingHighlight = {
  block_id: string;
  start_offset: number;
  end_offset: number;
  quote: string;
};

function renderHighlightedText(text: string, highlights: Highlight[], onOpen: (highlight: Highlight) => void) {
  const valid = [...highlights]
    .filter((highlight) => highlight.start_offset >= 0 && highlight.end_offset <= text.length && highlight.end_offset > highlight.start_offset)
    .sort((a, b) => a.start_offset - b.start_offset);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  valid.forEach((highlight) => {
    if (highlight.start_offset > cursor) nodes.push(text.slice(cursor, highlight.start_offset));
    nodes.push(
      <mark
        id={`highlight-${highlight.id}`}
        key={highlight.id}
        role="button"
        tabIndex={0}
        title="Add a note to this highlight"
        onClick={(event) => { event.stopPropagation(); onOpen(highlight); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(highlight); }}
      >
        {text.slice(highlight.start_offset, highlight.end_offset)}
      </mark>
    );
    cursor = Math.max(cursor, highlight.end_offset);
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function selectionOffsets(container: HTMLElement, range: Range) {
  const before = document.createRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

function ReaderBlock({
  block,
  highlights,
  onSelect,
  onOpenHighlight,
  onDeleteImage
}: {
  block: Block;
  highlights: Highlight[];
  onSelect: (pending: PendingHighlight) => void;
  onOpenHighlight: (highlight: Highlight) => void;
  onDeleteImage: (block: Block) => void;
}) {
  const ref = useRef<HTMLElement>(null);

  function handleSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !ref.current || block.kind === 'image') return;
    const range = selection.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) return;
    const quote = selection.toString().trim();
    if (!quote) return;
    const offsets = selectionOffsets(ref.current, range);
    onSelect({ block_id: block.id, start_offset: offsets.start, end_offset: offsets.end, quote });
    selection.removeAllRanges();
  }

  if (block.kind === 'image' && block.image_url) {
    return (
      <figure id={`block-${block.block_index}`} className="reader-media-block">
        <div className="reader-media-frame">
          <a href={block.image_url} target="_blank" rel="noreferrer" aria-label="Open image at full size">
            <img src={block.image_url} alt={block.alt || block.caption || ''} loading="lazy" referrerPolicy="no-referrer" />
          </a>
          <button
            className="media-delete-button"
            type="button"
            onClick={() => onDeleteImage(block)}
            aria-label="Delete this saved image"
            title="Delete image"
          >
            <Trash2 size={15} />
          </button>
        </div>
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  }

  const content = renderHighlightedText(block.text, highlights, onOpenHighlight);
  const commonProps = {
    ref: (node: HTMLElement | null) => { ref.current = node; },
    onMouseUp: handleSelection,
    onTouchEnd: () => { window.setTimeout(handleSelection, 20); }
  };

  return (
    <section id={`block-${block.block_index}`} className={`reader-block-wrap reader-block-${block.kind}`}>
      {block.kind === 'heading' ? (
        <h2 {...commonProps}>{content}</h2>
      ) : block.kind === 'quote' ? (
        <blockquote {...commonProps}>{content}</blockquote>
      ) : block.kind === 'code' ? (
        <pre {...commonProps}>{content}</pre>
      ) : block.kind === 'caption' ? (
        <p {...commonProps} className="reader-caption">{content}</p>
      ) : (
        <p {...commonProps} className="reader-paragraph">{content}</p>
      )}
    </section>
  );
}

function NoteCard({
  note,
  onDelete,
  onOpen
}: {
  note: Note;
  onDelete: (note: Note) => void;
  onOpen?: () => void;
}) {
  return (
    <article
      className="note-card"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen();
        }
      }}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? 'Open linked highlight' : undefined}
    >
      <p>{note.body}</p>
      <div className="note-card-footer">
        <time>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(note.created_at))}</time>
        <button
          className="mini-delete"
          onClick={(event) => { event.stopPropagation(); onDelete(note); }}
          aria-label="Delete note"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function XResource({ item, onDeleteImage }: { item: ItemDetail; onDeleteImage: () => void }) {
  if (!item.resource_kind || item.source !== 'X') return null;
  if (item.resource_kind === 'text') return null;

  const targetUrl = item.resource_url || item.url;
  const label = item.resource_kind === 'website' ? (item.resource_domain || 'Website') : item.resource_kind === 'video' ? 'Video on X' : 'Images on X';
  const Icon = item.resource_kind === 'video' ? Play : item.resource_kind === 'image' ? ImageIcon : Globe2;

  return (
    <section className={`x-resource-hero resource-${item.resource_kind}`}>
      {item.resource_image_url && (
        <div className="x-resource-image-wrap">
          <a href={targetUrl} target="_blank" rel="noreferrer" className="x-resource-image">
            <img src={item.resource_image_url} alt="" referrerPolicy="no-referrer" />
            {item.resource_kind === 'video' && <span className="video-play"><Play size={22} fill="currentColor" /></span>}
          </a>
          <button
            className="media-delete-button"
            type="button"
            onClick={onDeleteImage}
            aria-label="Delete saved preview image"
            title="Delete image"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
      <div className="x-resource-copy">
        <span><Icon size={15} /> {label}</span>
        {item.resource_description && <p>{item.resource_description}</p>}
        <a className="button secondary" href={targetUrl} target="_blank" rel="noreferrer">
          {item.resource_kind === 'website' ? 'Open website' : item.resource_kind === 'video' ? 'Watch original' : 'View original'} <ExternalLink size={15} />
        </a>
      </div>
    </section>
  );
}


function WebsitePreview({ item, onDeleteImage }: { item: ItemDetail; onDeleteImage: () => void }) {
  if (item.type !== 'website') return null;
  return (
    <section className="website-reader-preview">
      <div className="website-reader-frame">
        <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title}`}>
          {item.website_screenshot_url ? (
            <img src={item.website_screenshot_url} alt={`Preview of ${item.title}`} />
          ) : (
            <span className="website-reader-empty"><Globe2 size={34} /> Screenshot unavailable</span>
          )}
          <span className="website-reader-open">Open website <ExternalLink size={15} /></span>
        </a>
        {item.website_screenshot_url && (
          <button
            className="media-delete-button"
            type="button"
            onClick={onDeleteImage}
            aria-label="Delete website screenshot"
            title="Delete screenshot"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="website-reader-meta">
        <span><Globe2 size={15} /> {item.resource_domain || new URL(item.url).hostname}</span>
        {item.excerpt && <p>{item.excerpt}</p>}
        <a className="button secondary" href={item.url} target="_blank" rel="noreferrer">Open website <ExternalLink size={15} /></a>
      </div>
    </section>
  );
}

export function ReaderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [summarySaved, setSummarySaved] = useState(true);
  const [noteDraft, setNoteDraft] = useState('');
  const [pending, setPending] = useState<PendingHighlight | null>(null);
  const [highlightNote, setHighlightNote] = useState('');
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notePendingDelete, setNotePendingDelete] = useState<Note | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [imagePendingDelete, setImagePendingDelete] = useState<{ mode: 'block' | 'cover'; block?: Block } | null>(null);
  const [deletingImage, setDeletingImage] = useState(false);
  const scrollSaveTimer = useRef<number | null>(null);
  const noteEditorRef = useRef<HTMLElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      let data = await api.getItem(id);
      if (data.status === 'unread') data = await api.updateItem(id, { status: 'reading' });
      setItem(data);
      setSummary(data.summary_zh || '');
      setTitleDraft(data.title);
      setError('');
      window.setTimeout(() => {
        if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else window.scrollTo({ top: data.scroll_y || 0 });
      }, 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this item.');
    } finally {
      setLoading(false);
    }
  }, [id, location.hash]);

  const refreshItem = useCallback(async () => {
    if (!id) return null;
    const data = await api.getItem(id);
    setItem(data);
    setSummary(data.summary_zh || '');
    setTitleDraft(data.title);
    return data;
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    const saveScroll = () => {
      if (scrollSaveTimer.current) window.clearTimeout(scrollSaveTimer.current);
      scrollSaveTimer.current = window.setTimeout(() => {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const progress = Math.min(100, Math.round((window.scrollY / max) * 100));
        api.updateItem(id, { scroll_y: Math.round(window.scrollY), progress }).catch(() => undefined);
      }, 500);
    };
    window.addEventListener('scroll', saveScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', saveScroll);
      if (scrollSaveTimer.current) window.clearTimeout(scrollSaveTimer.current);
    };
  }, [id]);

  const highlightsByBlock = useMemo(() => {
    const result = new Map<string, Highlight[]>();
    item?.highlights.forEach((highlight) => result.set(highlight.block_id, [...(result.get(highlight.block_id) ?? []), highlight]));
    return result;
  }, [item]);

  const highlightsById = useMemo(() => {
    const result = new Map<string, Highlight>();
    item?.highlights.forEach((highlight) => result.set(highlight.id, highlight));
    return result;
  }, [item]);

  const articleLanguage = useMemo(() => {
    if (!item) return 'en';
    return /[\u3400-\u9fff]/.test(`${item.title}${item.content_text.slice(0, 800)}`) ? 'zh-CN' : 'en';
  }, [item]);

  const orderedNotes = useMemo(
    () => [...(item?.notes ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [item]
  );

  function focusHighlight(highlightId: string) {
    const target = document.getElementById(`highlight-${highlightId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('highlight-focus');
    window.requestAnimationFrame(() => {
      target.classList.add('highlight-focus');
      window.setTimeout(() => target.classList.remove('highlight-focus'), 1600);
    });
  }

  function selectHighlightForNote(highlight: Highlight) {
    setActiveHighlightId(highlight.id);
    setPending(null);
    window.setTimeout(() => {
      noteEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      noteInputRef.current?.focus();
    }, 40);
  }

  async function updateStatus(status: Status) {
    if (!item) return;
    setItem({ ...item, status });
    try { setItem(await api.updateItem(item.id, { status })); } catch { load(); }
  }

  async function saveSummary() {
    if (!item) return;
    setSummarySaved(false);
    try {
      setItem(await api.updateItem(item.id, { summary_zh: summary }));
      setSummarySaved(true);
    } catch { setSummarySaved(false); }
  }

  function beginTitleEdit() {
    if (!item) return;
    setTitleDraft(item.title);
    setEditingTitle(true);
  }

  function cancelTitleEdit() {
    if (!item) return;
    setTitleDraft(item.title);
    setEditingTitle(false);
  }

  async function saveTitle() {
    if (!item) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) return;
    if (nextTitle === item.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      const updated = await api.updateItem(item.id, { title: nextTitle });
      setItem(updated);
      setTitleDraft(updated.title);
      setEditingTitle(false);
    } finally {
      setSavingTitle(false);
    }
  }

  async function addNote() {
    if (!item || !noteDraft.trim()) return;
    setSaving(true);
    try {
      await api.addNote(item.id, { body: noteDraft.trim(), highlight_id: activeHighlightId });
      setNoteDraft('');
      setActiveHighlightId(null);
      await refreshItem();
    } finally { setSaving(false); }
  }

  async function saveHighlight() {
    if (!item || !pending) return;
    setSaving(true);
    try {
      const savedHighlight = await api.addHighlight(item.id, pending);
      if (highlightNote.trim()) await api.addNote(item.id, { body: highlightNote.trim(), highlight_id: savedHighlight.id });
      setPending(null);
      setHighlightNote('');
      setActiveHighlightId(null);
      await refreshItem();
    } finally { setSaving(false); }
  }

  function deleteNote(note: Note) {
    setNotePendingDelete(note);
  }

  async function confirmDeleteNote() {
    if (!notePendingDelete) return;
    setDeletingNote(true);
    try {
      await api.deleteNote(notePendingDelete.id);
      setNotePendingDelete(null);
      await refreshItem();
    } finally {
      setDeletingNote(false);
    }
  }

  async function confirmDeleteImage() {
    if (!item || !imagePendingDelete) return;
    setDeletingImage(true);
    try {
      const updated = imagePendingDelete.mode === 'block' && imagePendingDelete.block
        ? await api.deleteImageBlock(item.id, imagePendingDelete.block.id)
        : await api.deleteCoverImage(item.id);
      setItem(updated);
      setImagePendingDelete(null);
    } finally {
      setDeletingImage(false);
    }
  }

  async function removeItem() {
    if (!item || !window.confirm('Delete this saved item, its highlights and all notes?')) return;
    await api.deleteItem(item.id);
    navigate('/');
  }

  if (loading) return <div className="reader-loading"><LoaderCircle className="spin" /> Opening reader…</div>;
  if (error || !item) return <div className="reader-error"><p>{error || 'Item not found.'}</p><Link to="/">Back to Library</Link></div>;

  return (
    <div className="reader-page">
      <header className="reader-topbar">
        <button className="icon-button" onClick={() => navigate('/')} aria-label="Back to library"><ArrowLeft size={19} /></button>
        <div className="reader-topbar-actions">
          <StatusSelect value={item.status} onChange={updateStatus} compact />
          {item.type === 'website' ? (
            <a className="button secondary" href={item.url} target="_blank" rel="noreferrer"><Globe2 size={16} /> Website</a>
          ) : item.source === 'X' && item.resource_kind === 'website' && item.resource_url ? (
            <>
              <a className="button secondary" href={item.resource_url} target="_blank" rel="noreferrer"><Globe2 size={16} /> Website</a>
              <a className="icon-button" href={item.url} target="_blank" rel="noreferrer" aria-label="Open X post">X</a>
            </>
          ) : (
            <a className="button secondary" href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Original</a>
          )}
          <button className="icon-button danger-hover" onClick={removeItem} aria-label="Delete item"><Trash2 size={17} /></button>
        </div>
      </header>

      <article className="reader-layout">
        <main className="reader-article" lang={articleLanguage}>
          <div className="article-kicker">{item.type === 'website' ? 'Website' : item.source} · {new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(item.saved_at))}</div>
          {editingTitle ? (
            <div className="title-editor">
              <textarea
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') cancelTitleEdit();
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveTitle();
                }}
                aria-label={item.type === 'website' ? 'Website title' : 'Article title'}
                autoFocus
                rows={Math.min(4, Math.max(1, Math.ceil(titleDraft.length / 34)))}
              />
              <div className="title-editor-actions">
                <button className="icon-button" onClick={cancelTitleEdit} aria-label="Cancel title edit"><X size={17} /></button>
                <button className="icon-button title-save-button" onClick={saveTitle} disabled={savingTitle || !titleDraft.trim()} aria-label="Save title"><Check size={18} /></button>
              </div>
            </div>
          ) : (
            <div className="article-title-row">
              <h1>{item.title}</h1>
              <button className="title-edit-button" onClick={beginTitleEdit} aria-label={item.type === 'website' ? 'Edit website title' : 'Edit article title'} title="Edit title"><Pencil size={16} /></button>
            </div>
          )}
          {item.type === 'website' ? (
            <WebsitePreview item={item} onDeleteImage={() => setImagePendingDelete({ mode: 'cover' })} />
          ) : (
            <>
              {item.author && <p className="article-author">By {item.author}</p>}
              <XResource item={item} onDeleteImage={() => setImagePendingDelete({ mode: 'cover' })} />
              {item.source === 'X' && item.context_text && (
                <section className="x-share-context">
                  <span>Shared on X by {item.context_handle || item.context_author || 'X'}</span>
                  <p>{item.context_text}</p>
                </section>
              )}
              {item.extraction_status === 'link_only' && (
                <div className="link-only-state">
                  <ExternalLink size={20} />
                  <div><strong>Reader view is unavailable for this page.</strong><p>The link is safely stored. Open the original and keep your notes here.</p></div>
                </div>
              )}
              <div className="reader-body">
                {item.blocks.map((block) => (
                  <ReaderBlock
                    key={block.id}
                    block={block}
                    highlights={highlightsByBlock.get(block.id) ?? []}
                    onSelect={(next) => { setPending(next); setActiveHighlightId(null); }}
                    onOpenHighlight={selectHighlightForNote}
                    onDeleteImage={(imageBlock) => setImagePendingDelete({ mode: 'block', block: imageBlock })}
                  />
                ))}
              </div>
              {item.blocks.length === 0 && !item.resource_kind && <a href={item.url} target="_blank" rel="noreferrer" className="open-original-card">Open the original page <ExternalLink size={17} /></a>}
            </>
          )}
        </main>

        <aside className="notes-panel">
          <div className="notes-panel-sticky">
            {item.type !== 'website' && (
              <section className="summary-editor">
                <div className="notes-heading"><h2>Content summary</h2><span>{summarySaved ? 'Saved · Chinese' : 'Unsaved'}</span></div>
                <textarea lang="zh-CN" value={summary} onChange={(event) => { setSummary(event.target.value); setSummarySaved(false); }} placeholder="中文摘要将在这里显示。接入摘要服务前，也可以手动补充。" rows={7} />
                <button className="button secondary full" onClick={saveSummary} disabled={summarySaved}><Save size={16} /> Save summary</button>
              </section>
            )}

            <section className="takeaway-summary">
              <div className="notes-heading"><h2>Your takeaways</h2><span>{item.notes.length} note{item.notes.length === 1 ? '' : 's'} · Chinese</span></div>
              {item.takeaway_summary_zh ? <p lang="zh-CN">{item.takeaway_summary_zh}</p> : <p className="summary-placeholder" lang="zh-CN">添加 note 后，这里会形成对你个人阅读结论的汇总。</p>}
            </section>

            <section className="note-editor" ref={noteEditorRef}>
              <div className="notes-heading"><h2>My notes</h2><span>All notes in one place</span></div>
              <textarea
                ref={noteInputRef}
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="What do you want to remember?"
                rows={5}
              />
              <button className="button primary full" onClick={addNote} disabled={saving || !noteDraft.trim()}><Save size={16} /> Save as new note</button>
              {orderedNotes.length > 0 && (
                <div className="note-card-list">
                  {orderedNotes.map((note) => {
                    const linkedHighlight = note.highlight_id ? highlightsById.get(note.highlight_id) : undefined;
                    return (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onDelete={deleteNote}
                        onOpen={linkedHighlight ? () => focusHighlight(linkedHighlight.id) : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </section>
            {item.type !== 'website' && <div className="annotation-tip"><Highlighter size={16} /><p>Select text to create a highlight. Click a highlight to add a note; later, click that note to return to the passage.</p></div>}
          </div>
        </aside>
      </article>

      <ConfirmDialog
        open={Boolean(notePendingDelete)}
        title="Delete note?"
        description="This note will be permanently deleted."
        confirmLabel="Delete"
        busy={deletingNote}
        onCancel={() => setNotePendingDelete(null)}
        onConfirm={confirmDeleteNote}
      />

      <ConfirmDialog
        open={Boolean(imagePendingDelete)}
        title="Delete image?"
        description="The image will be removed from this saved content. Its local file will also be deleted when no other saved item uses it."
        confirmLabel="Delete image"
        busy={deletingImage}
        onCancel={() => setImagePendingDelete(null)}
        onConfirm={confirmDeleteImage}
      />

      {item.type !== 'website' && pending && (
        <div className="highlight-composer">
          <div className="highlight-composer-inner">
            <button className="icon-button" onClick={() => { setPending(null); setHighlightNote(''); }} aria-label="Cancel highlight"><X size={18} /></button>
            <div className="highlight-quote">“{pending.quote}”</div>
            <input value={highlightNote} onChange={(event) => setHighlightNote(event.target.value)} placeholder="Add the first note (optional)" autoFocus />
            <button className="button primary" onClick={saveHighlight} disabled={saving}>{saving ? 'Saving…' : 'Save highlight'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
