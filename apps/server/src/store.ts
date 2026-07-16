import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ItemRecord = {
  id: string;
  url: string;
  canonical_url: string | null;
  title: string;
  author: string | null;
  source: string;
  type: string;
  excerpt: string;
  summary_zh: string;
  takeaway_summary_zh: string;
  note: string;
  status: 'unread' | 'reading' | 'read' | 'archived';
  saved_at: string;
  updated_at: string;
  content_text: string;
  image_url: string | null;
  website_screenshot_url: string | null;
  progress: number;
  scroll_y: number;
  extraction_status: string;
  resource_kind: string | null;
  resource_url: string | null;
  resource_title: string | null;
  resource_description: string | null;
  resource_domain: string | null;
  resource_image_url: string | null;
  context_text: string | null;
  context_author: string | null;
  context_handle: string | null;
};

export type BlockRecord = {
  id: string;
  item_id: string;
  block_index: number;
  kind: string;
  text: string;
  image_url: string | null;
  alt: string | null;
  caption: string | null;
};

export type HighlightRecord = {
  id: string;
  item_id: string;
  block_id: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  created_at: string;
};

export type NoteRecord = {
  id: string;
  item_id: string;
  highlight_id: string | null;
  body: string;
  created_at: string;
};

type StoreState = {
  items: ItemRecord[];
  blocks: BlockRecord[];
  highlights: HighlightRecord[];
  notes: NoteRecord[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const dataPath = path.join(dataDir, 'reading-inbox.json');
fs.mkdirSync(dataDir, { recursive: true });

function makeTakeawaySummary(notes: NoteRecord[]) {
  const bodies = notes.map((note) => note.body.trim().replace(/[。！？.!?;；]+$/u, '')).filter(Boolean);
  if (bodies.length === 0) return '';
  const selected = bodies.slice(0, 4).map((body, index) => `${index + 1}）${body.length > 110 ? `${body.slice(0, 110)}…` : body}`);
  const remainder = bodies.length > selected.length ? `；另外还有 ${bodies.length - selected.length} 条笔记` : '';
  return `你目前记录了 ${bodies.length} 条 takeaway，重点包括：${selected.join('；')}${remainder}。`;
}

function seed(): StoreState {
  const now = new Date().toISOString();
  const englishId = crypto.randomUUID();
  const chineseId = crypto.randomUUID();
  const englishParagraphs = [
    'When an autonomous system returns control, the interface cannot assume the user already understands the current situation.',
    'A useful handoff first rebuilds situational awareness: what has happened, what remains uncertain, and what action is required now.',
    'The design problem is therefore not simply where to place a takeover button. It is how to compress the agent’s recent history into an explanation the user can absorb under time pressure.'
  ];
  const chineseParagraphs = [
    '当智能体能够连续执行多步任务时，用户真正需要的并不是每一步内部推理，而是那些会影响结果、需要承担责任或难以撤销的关键动作。',
    '可见的行动历史应该帮助用户快速回答三个问题：系统做了什么、为什么这样做、现在是否需要我介入。',
    '如果状态信息只是不断追加的日志，它会制造新的认知负担。设计需要压缩过程，并优先呈现对当前决策有影响的变化。'
  ];
  const englishBlocks = englishParagraphs.map((text, block_index) => ({ id: crypto.randomUUID(), item_id: englishId, block_index, kind: 'paragraph', text, image_url: null, alt: null, caption: null }));
  const chineseBlocks = chineseParagraphs.map((text, block_index) => ({ id: crypto.randomUUID(), item_id: chineseId, block_index, kind: 'paragraph', text, image_url: null, alt: null, caption: null }));
  const highlightId = crypto.randomUUID();
  const notes: NoteRecord[] = [
    {
      id: crypto.randomUUID(),
      item_id: englishId,
      highlight_id: highlightId,
      body: '交接不是把控制按钮还给用户，而是先恢复用户对当前状态的理解。',
      created_at: now
    },
    {
      id: crypto.randomUUID(),
      item_id: englishId,
      highlight_id: highlightId,
      body: '这可以和自动驾驶接管、Agent interruption 放在同一个框架下理解。',
      created_at: new Date(Date.now() + 1_000).toISOString()
    }
  ];
  return {
    items: [
      {
        id: englishId,
        url: 'https://example.com/agent-handoff',
        canonical_url: null,
        title: 'Agent handoff is a reconstruction of situational awareness',
        author: 'Demo article',
        source: 'Web',
        type: 'article',
        excerpt: 'A sample article showing how saved reading, highlights and notes work together.',
        summary_zh: '文章认为，智能体交还控制权并不等于完成交接。界面必须先帮助用户恢复情境认知，说明系统已经做了什么、仍有哪些不确定性，以及此刻为什么需要人工介入。',
        takeaway_summary_zh: makeTakeawaySummary(notes),
        note: '',
        status: 'reading',
        saved_at: now,
        updated_at: now,
        content_text: englishParagraphs.join('\n\n'),
        image_url: null,
        website_screenshot_url: null,
        progress: 0,
        scroll_y: 0,
        extraction_status: 'success',
        resource_kind: null,
        resource_url: null,
        resource_title: null,
        resource_description: null,
        resource_domain: null,
        resource_image_url: null,
        context_text: null,
        context_author: null,
        context_handle: null
      },
      {
        id: chineseId,
        url: 'https://mp.weixin.qq.com/example',
        canonical_url: null,
        title: 'AI 产品为什么需要一份“关键行动历史”',
        author: '未来交互观察',
        source: 'WeChat',
        type: 'article',
        excerpt: '一篇关于智能体任务日志、状态透明度与用户接管的中文文章。',
        summary_zh: '文章主张，Agent 产品不应把完整执行日志直接暴露给用户，而应保存并呈现真正影响结果的关键动作、假设和不可逆变化，让用户能迅速判断当前状态与是否需要介入。',
        takeaway_summary_zh: '',
        note: '',
        status: 'unread',
        saved_at: new Date(Date.now() - 3_600_000).toISOString(),
        updated_at: now,
        content_text: chineseParagraphs.join('\n\n'),
        image_url: null,
        website_screenshot_url: null,
        progress: 0,
        scroll_y: 0,
        extraction_status: 'success',
        resource_kind: null,
        resource_url: null,
        resource_title: null,
        resource_description: null,
        resource_domain: null,
        resource_image_url: null,
        context_text: null,
        context_author: null,
        context_handle: null
      }
    ],
    blocks: [...englishBlocks, ...chineseBlocks],
    highlights: [
      {
        id: highlightId,
        item_id: englishId,
        block_id: englishBlocks[1].id,
        start_offset: 0,
        end_offset: 'A useful handoff first rebuilds situational awareness'.length,
        quote: 'A useful handoff first rebuilds situational awareness',
        created_at: now
      }
    ],
    notes
  };
}

function normalize(raw: unknown): StoreState {
  const state = raw as Partial<StoreState> & {
    items?: Array<Partial<ItemRecord>>;
    highlights?: Array<Partial<HighlightRecord> & { note?: string }>;
  };
  const items = (state.items ?? []) as ItemRecord[];
  const blocks = (state.blocks ?? []).map((block) => {
    const legacy = block as Partial<BlockRecord>;
    return {
      id: String(legacy.id),
      item_id: String(legacy.item_id),
      block_index: Number(legacy.block_index ?? 0),
      kind: String(legacy.kind ?? 'paragraph'),
      text: String(legacy.text ?? ''),
      image_url: legacy.image_url ? String(legacy.image_url) : null,
      alt: legacy.alt ? String(legacy.alt) : null,
      caption: legacy.caption ? String(legacy.caption) : null
    };
  });
  const rawHighlights = (state.highlights ?? []) as Array<Partial<HighlightRecord> & { note?: string }>;
  const highlights = rawHighlights.map((highlight) => ({
    id: String(highlight.id),
    item_id: String(highlight.item_id),
    block_id: String(highlight.block_id),
    start_offset: Number(highlight.start_offset ?? 0),
    end_offset: Number(highlight.end_offset ?? 0),
    quote: String(highlight.quote ?? ''),
    created_at: String(highlight.created_at ?? new Date().toISOString())
  }));
  const notes = Array.isArray(state.notes) ? [...state.notes] as NoteRecord[] : [];

  rawHighlights.forEach((legacyHighlight) => {
    if (!legacyHighlight.id || !legacyHighlight.item_id || !legacyHighlight.note?.trim()) return;
    if (!notes.some((note) => note.highlight_id === legacyHighlight.id && note.body === legacyHighlight.note)) {
      notes.push({
        id: crypto.randomUUID(),
        item_id: String(legacyHighlight.item_id),
        highlight_id: String(legacyHighlight.id),
        body: legacyHighlight.note.trim(),
        created_at: String(legacyHighlight.created_at ?? new Date().toISOString())
      });
    }
  });

  items.forEach((item) => {
    item.summary_zh = item.summary_zh ?? '';
    item.takeaway_summary_zh = item.takeaway_summary_zh ?? '';
    item.note = item.note ?? '';
    item.website_screenshot_url = item.website_screenshot_url ?? (item.type === 'website' ? item.image_url ?? null : null);
    item.resource_kind = item.resource_kind ?? null;
    item.resource_url = item.resource_url ?? null;
    item.resource_title = item.resource_title ?? null;
    item.resource_description = item.resource_description ?? null;
    item.resource_domain = item.resource_domain ?? null;
    item.resource_image_url = item.resource_image_url ?? null;
    item.context_text = item.context_text ?? null;
    item.context_author = item.context_author ?? null;
    item.context_handle = item.context_handle ?? null;
    if (item.note.trim() && !notes.some((note) => note.item_id === item.id && note.highlight_id === null && note.body === item.note.trim())) {
      notes.push({ id: crypto.randomUUID(), item_id: item.id, highlight_id: null, body: item.note.trim(), created_at: item.updated_at || new Date().toISOString() });
      item.note = '';
    }
    item.takeaway_summary_zh = makeTakeawaySummary(notes.filter((note) => note.item_id === item.id));
  });

  return { items, blocks, highlights, notes };
}

function load(): StoreState {
  if (!fs.existsSync(dataPath)) {
    const initial = seed();
    fs.writeFileSync(dataPath, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const normalized = normalize(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
    fs.writeFileSync(dataPath, JSON.stringify(normalized, null, 2));
    return normalized;
  } catch {
    const backup = `${dataPath}.${Date.now()}.broken`;
    fs.copyFileSync(dataPath, backup);
    const initial = seed();
    fs.writeFileSync(dataPath, JSON.stringify(initial, null, 2));
    return initial;
  }
}

export const store = load();

export function persist() {
  const temp = `${dataPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, dataPath);
}

export function rebuildTakeawaySummary(itemId: string) {
  const item = store.items.find((entry) => entry.id === itemId);
  if (!item) return '';
  item.takeaway_summary_zh = makeTakeawaySummary(store.notes.filter((note) => note.item_id === itemId));
  item.updated_at = new Date().toISOString();
  return item.takeaway_summary_zh;
}

export function getItemDetail(id: string) {
  const item = store.items.find((entry) => entry.id === id);
  if (!item) return null;
  const notes = store.notes.filter((note) => note.item_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const highlights = store.highlights
    .filter((highlight) => highlight.item_id === id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((highlight) => ({ ...highlight, notes: notes.filter((note) => note.highlight_id === highlight.id) }));
  return {
    ...item,
    blocks: store.blocks.filter((block) => block.item_id === id).sort((a, b) => a.block_index - b.block_index),
    highlights,
    notes
  };
}
