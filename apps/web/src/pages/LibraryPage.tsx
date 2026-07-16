import { ExternalLink, Globe2, Image as ImageIcon, Plus, Search, Sparkles, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { StatusSelect } from '../components/StatusSelect';
import type { Item, Status } from '../types';

const statusTabs = ['all', 'unread', 'reading', 'read', 'archived'] as const;
const statusLabels: Record<(typeof statusTabs)[number], string> = {
  all: 'All', unread: 'Unread', reading: 'Reading', read: 'Read', archived: 'Archived'
};

function formatDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 24 * 60 * 60 * 1000) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-Math.max(1, Math.round(diff / 3_600_000)), 'hour');
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

function ResourceIcon({ kind }: { kind?: Item['resource_kind'] }) {
  if (kind === 'video') return <Video size={14} />;
  if (kind === 'image') return <ImageIcon size={14} />;
  return <Globe2 size={14} />;
}

function resourceLabel(item: Item) {
  if (item.resource_kind === 'website') return item.resource_domain || 'Website';
  if (item.resource_kind === 'video') return 'Video on X';
  if (item.resource_kind === 'image') return 'Images on X';
  if (item.resource_kind === 'text') return 'Text post';
  return '';
}

function SourceMark({ source, type }: { source: string; type?: string }) {
  if (type === 'website') return <span className="source-mark source-website"><Globe2 size={15} /></span>;
  return <span className={`source-mark source-${source.toLowerCase()}`}>{source === 'Pinterest' ? 'P' : source === 'WeChat' ? 'W' : source === 'YouTube' ? 'Y' : source === 'X' ? 'X' : '↗'}</span>;
}

function ItemMeta({ item }: { item: Item }) {
  return (
    <div className="content-meta">
      <span>{item.type === 'website' ? 'Website' : item.source}</span>
      <span>·</span>
      <span>{formatDate(item.saved_at)}</span>
      {item.highlight_count ? <><span>·</span><span>{item.highlight_count} highlight{item.highlight_count === 1 ? '' : 's'}</span></> : null}
      {item.note_count ? <><span>·</span><span>{item.note_count} note{item.note_count === 1 ? '' : 's'}</span></> : null}
    </div>
  );
}

function WebsiteRow({ item, onStatus }: { item: Item; onStatus: (next: Status) => void }) {
  return (
    <article className="content-row website-content-row">
      <a className="website-list-preview" href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title}`}>
        {item.website_screenshot_url ? (
          <img src={item.website_screenshot_url} alt={`Preview of ${item.title}`} loading="lazy" />
        ) : (
          <span className="website-preview-empty"><Globe2 size={25} /> Preview unavailable</span>
        )}
        <span className="website-preview-open">Open website <ExternalLink size={13} /></span>
      </a>
      <Link to={`/item/${item.id}`} className="content-row-main website-row-main">
        <SourceMark source={item.source} type={item.type} />
        <div className="content-copy">
          <ItemMeta item={item} />
          <h2>{item.title}</h2>
          <p className="website-domain">{item.resource_domain || new URL(item.url).hostname}</p>
          {item.excerpt && <p className="website-description">{item.excerpt}</p>}
          {item.takeaway_summary_zh && <div className="quick-note" lang="zh-CN"><Sparkles size={14} /> {item.takeaway_summary_zh}</div>}
        </div>
      </Link>
      <div className="content-row-actions">
        <StatusSelect value={item.status} compact onChange={onStatus} />
        <a className="icon-button" href={item.url} target="_blank" rel="noreferrer" aria-label="Open website"><ExternalLink size={17} /></a>
      </div>
    </article>
  );
}

function StandardRow({ item, onStatus }: { item: Item; onStatus: (next: Status) => void }) {
  return (
    <article className="content-row">
      <Link to={`/item/${item.id}`} className="content-row-main">
        <SourceMark source={item.source} />
        <div className="content-copy">
          <ItemMeta item={item} />
          <h2>{item.title}</h2>
          {item.source === 'X' && item.resource_kind && (
            <div className={`x-resource-preview ${item.resource_image_url ? 'has-image' : ''}`}>
              {item.resource_image_url && <img src={item.resource_image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
              <div>
                <span className="x-resource-type"><ResourceIcon kind={item.resource_kind} /> {resourceLabel(item)}</span>
                {item.resource_description && <p>{item.resource_description}</p>}
              </div>
            </div>
          )}
          {item.source === 'X' && item.context_text && (
            <p className="x-context-preview">Shared by {item.context_handle || item.context_author || 'X'} · “{item.context_text}”</p>
          )}
          <div className={`summary-preview ${item.summary_zh ? '' : 'summary-empty'}`} lang="zh-CN">
            <span>Summary</span>
            <p>{item.summary_zh || '中文摘要尚未生成。原文标题和正文仍会保持原语言。'}</p>
          </div>
          {item.takeaway_summary_zh && <div className="quick-note" lang="zh-CN"><Sparkles size={14} /> {item.takeaway_summary_zh}</div>}
        </div>
      </Link>
      <div className="content-row-actions">
        <StatusSelect value={item.status} compact onChange={onStatus} />
        <a className="icon-button" href={item.resource_kind === 'website' && item.resource_url ? item.resource_url : item.url} target="_blank" rel="noreferrer" aria-label="Open original"><ExternalLink size={17} /></a>
      </div>
    </article>
  );
}

export function LibraryPage({ onAdd }: { onAdd: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<(typeof statusTabs)[number]>('all');
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const sources = useMemo(() => ['all', ...Array.from(new Set(items.map((item) => item.source)))], [items]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.listItems({ status, source, q: query });
        setItems(data);
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your library.');
      } finally {
        setLoading(false);
      }
    }, query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [status, source, query]);

  async function changeStatus(item: Item, nextStatus: Status) {
    const previous = item.status;
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: nextStatus } : entry));
    try {
      await api.updateItem(item.id, { status: nextStatus });
      if (status !== 'all' && status !== nextStatus) setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: previous } : entry));
    }
  }

  return (
    <div className="library-page page-frame">
      <header className="page-header">
        <div>
          <h1>Library</h1>
          <p>Your cross-platform reading inbox.</p>
        </div>
        <button className="button primary desktop-add" onClick={onAdd}><Plus size={17} /> Add link</button>
      </header>

      <div className="library-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, summaries, article text and notes" />
        </label>
        <select className="source-filter" value={source} onChange={(event) => setSource(event.target.value)} aria-label="Filter by source">
          {sources.map((option) => <option key={option} value={option}>{option === 'all' ? 'All sources' : option}</option>)}
        </select>
      </div>

      <div className="status-tabs" role="tablist" aria-label="Reading status">
        {statusTabs.map((tab) => (
          <button key={tab} role="tab" aria-selected={status === tab} className={status === tab ? 'selected' : ''} onClick={() => setStatus(tab)}>
            {statusLabels[tab]}
          </button>
        ))}
      </div>

      {error && <div className="inline-error">{error}</div>}
      {loading ? <div className="loading-list"><span /><span /><span /></div> : items.length === 0 ? <EmptyState onAdd={onAdd} /> : (
        <div className="content-list">
          {items.map((item) => item.type === 'website'
            ? <WebsiteRow key={item.id} item={item} onStatus={(next) => changeStatus(item, next)} />
            : <StandardRow key={item.id} item={item} onStatus={(next) => changeStatus(item, next)} />)}
        </div>
      )}

      <button className="floating-add" onClick={onAdd} aria-label="Add link"><Plus size={22} /></button>
    </div>
  );
}
