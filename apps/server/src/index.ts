import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { extractPage, inspectLink, resolveUrl } from './extract.js';
import { cacheRemoteImage, cacheWebsiteScreenshot, captureWebsiteScreenshot, localizeContentImages, mediaDir, pruneUnusedMedia, type IncomingContentBlock } from './media.js';
import { getItemDetail, persist, rebuildTakeawaySummary, store, type BlockRecord, type ItemRecord } from './store.js';

const app = express();
const PORT = Number(process.env.PORT ?? 8787);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '32mb' }));
app.use('/media', express.static(mediaDir, { maxAge: '30d', fallthrough: true }));

const statusValues = ['unread', 'reading', 'read', 'archived'] as const;

function pruneCurrentMedia() {
  pruneUnusedMedia([
    ...store.items.flatMap((item) => [item.image_url, item.website_screenshot_url, item.resource_image_url]),
    ...store.blocks.map((block) => block.image_url)
  ]);
}

const contentBlockSchema = z.object({
  kind: z.string().trim().max(40),
  text: z.string().max(20_000).optional(),
  imageUrl: z.string().url().optional(),
  alt: z.string().max(2_000).optional(),
  caption: z.string().max(5_000).optional()
});

const captureSchema = z.object({
  url: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  title: z.string().trim().max(500).optional(),
  author: z.string().trim().max(300).optional(),
  description: z.string().trim().max(3000).optional(),
  text: z.string().max(100_000).optional(),
  selectedText: z.string().max(100_000).optional(),
  blocks: z.array(z.string().max(20_000)).max(320).optional(),
  contentBlocks: z.array(contentBlockSchema).max(320).optional(),
  imageUrl: z.string().url().optional(),
  source: z.string().trim().max(80).optional(),
  type: z.string().trim().max(80).optional(),
  note: z.string().max(20_000).optional().default(''),
  summaryZh: z.string().max(10_000).optional(),
  status: z.enum(statusValues).optional().default('unread'),
  titleIsCustom: z.boolean().optional().default(false),
  captureMode: z.enum(['article', 'website']).optional().default('article'),
  screenshotDataUrl: z.string().max(30_000_000).optional(),
  resourceKind: z.enum(['text', 'website', 'video', 'image']).optional(),
  sharedUrl: z.string().url().optional(),
  sharedTitle: z.string().trim().max(500).optional(),
  sharedDescription: z.string().trim().max(3000).optional(),
  sharedImageUrl: z.string().url().optional(),
  sharedDomain: z.string().trim().max(300).optional(),
  postText: z.string().max(20_000).optional(),
  postAuthor: z.string().trim().max(300).optional(),
  postHandle: z.string().trim().max(200).optional()
});

function detectSource(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com') return 'X';
  if (host.includes('pinterest.')) return 'Pinterest';
  if (host === 'mp.weixin.qq.com') return 'WeChat';
  if (host.includes('youtube.') || host === 'youtu.be') return 'YouTube';
  return 'Web';
}

function firstMeaningfulLine(value: string | undefined, maxLength = 160) {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentence = text.split(/(?<=[.!?。！？])\s+/u)[0] || text;
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength).trim()}…` : sentence;
}

function looksLikeGenericXTitle(value: string) {
  const title = value.trim();
  return !title || /^https?:\/\//i.test(title) || /(?:\/ X| on X|Twitter)$/i.test(title) || title === 'X';
}

function safeDomain(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return null; }
}

function includesTerm(value: string | null | undefined, term: string) {
  return Boolean(value?.toLocaleLowerCase().includes(term));
}

function normalizeContentBlocks(input: IncomingContentBlock[]) {
  const seenText = new Set<string>();
  const seenImages = new Set<string>();
  const result: IncomingContentBlock[] = [];

  for (const raw of input) {
    const kind = (raw.kind || 'paragraph').trim().toLowerCase();
    if (kind === 'image') {
      if (!raw.imageUrl || seenImages.has(raw.imageUrl)) continue;
      seenImages.add(raw.imageUrl);
      result.push({
        kind: 'image',
        imageUrl: raw.imageUrl,
        alt: raw.alt?.trim() || undefined,
        caption: raw.caption?.trim() || undefined
      });
      continue;
    }

    const text = (raw.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 20_000) continue;
    const key = text.replace(/\s+/g, '');
    if (seenText.has(key)) continue;
    seenText.add(key);
    result.push({
      kind: ['heading', 'quote', 'code', 'caption'].includes(kind) ? kind : 'paragraph',
      text
    });
  }

  return result.slice(0, 300);
}

function blockKey(block: BlockRecord) {
  if (block.kind === 'image') return `image:${block.image_url || ''}`;
  return `text:${block.kind}:${block.text.replace(/\s+/g, ' ').trim()}`;
}

function incomingKey(block: IncomingContentBlock) {
  if (block.kind === 'image') return `image:${block.imageUrl || ''}`;
  return `text:${block.kind}:${(block.text || '').replace(/\s+/g, ' ').trim()}`;
}

function writeContentBlocks(itemId: string, incoming: IncomingContentBlock[]) {
  const existingBlocks = store.blocks
    .filter((block) => block.item_id === itemId)
    .sort((a, b) => a.block_index - b.block_index);
  const reusable = new Map<string, BlockRecord[]>();
  existingBlocks.forEach((block) => {
    const key = blockKey(block);
    reusable.set(key, [...(reusable.get(key) ?? []), block]);
  });

  const next: BlockRecord[] = incoming.map((block, block_index) => {
    const key = incomingKey(block);
    const match = reusable.get(key)?.shift();
    return {
      id: match?.id || crypto.randomUUID(),
      item_id: itemId,
      block_index,
      kind: block.kind,
      text: block.kind === 'image' ? '' : block.text || '',
      image_url: block.kind === 'image' ? block.imageUrl || null : null,
      alt: block.kind === 'image' ? block.alt || null : null,
      caption: block.kind === 'image' ? block.caption || null : null
    };
  });

  // Preserve any unmatched highlighted paragraph so a re-save never destroys
  // an existing note's navigation target. This is rare and only happens when
  // the source article has changed since the highlight was created.
  const nextIds = new Set(next.map((block) => block.id));
  const highlightedIds = new Set(store.highlights.filter((highlight) => highlight.item_id === itemId).map((highlight) => highlight.block_id));
  existingBlocks.forEach((block) => {
    if (highlightedIds.has(block.id) && !nextIds.has(block.id)) {
      next.push({ ...block, block_index: next.length });
    }
  });

  store.blocks = [
    ...store.blocks.filter((block) => block.item_id !== itemId),
    ...next
  ];
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'revisit-server' });
});

const detectLinkSchema = z.object({ url: z.string().url() });

app.post('/api/detect-link', async (req, res) => {
  const parsed = detectLinkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const inspection = await inspectLink(parsed.data.url);
    res.json(inspection);
  } catch (error) {
    console.warn('Link inspection failed:', error);
    const parsedUrl = new URL(parsed.data.url);
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    res.json({
      finalUrl: parsed.data.url,
      domain: parsedUrl.hostname.replace(/^www\./, ''),
      title: parsedUrl.hostname.replace(/^www\./, ''),
      recommendedMode: segments.length <= 1 ? 'website' : 'article',
      confidence: 'low',
      reason: 'URL structure only'
    });
  }
});

app.get('/api/items', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const source = typeof req.query.source === 'string' ? req.query.source : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase() : '';
  const rows = store.items
    .filter((item) => !status || status === 'all' || item.status === status)
    .filter((item) => !source || source === 'all' || item.source === source)
    .filter((item) => {
      if (!q) return true;
      const direct = [item.title, item.excerpt, item.summary_zh, item.takeaway_summary_zh, item.note, item.content_text, item.resource_title, item.resource_description, item.resource_domain, item.context_text, item.context_author, item.context_handle].some((value) => includesTerm(value, q));
      const highlightMatch = store.highlights.some((highlight) => highlight.item_id === item.id && includesTerm(highlight.quote, q));
      const noteMatch = store.notes.some((note) => note.item_id === item.id && includesTerm(note.body, q));
      return direct || highlightMatch || noteMatch;
    })
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
    .map((item) => ({
      ...item,
      highlight_count: store.highlights.filter((highlight) => highlight.item_id === item.id).length,
      note_count: store.notes.filter((note) => note.item_id === item.id).length
    }));
  res.json(rows);
});

app.get('/api/items/:id', (req, res) => {
  const item = getItemDetail(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

app.post('/api/capture', async (req, res) => {
  const parsed = captureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const source = input.source || detectSource(input.url);
  const isWebsiteCapture = input.captureMode === 'website';
  const isXSmartCapture = !isWebsiteCapture && source === 'X' && Boolean(input.resourceKind);
  const allowSameUrl = input.type === 'selected_text' || input.type === 'image';
  const existing = allowSameUrl ? undefined : store.items.find((item) =>
    item.url === input.url && (isWebsiteCapture ? item.type === 'website' : item.type !== 'website')
  );

  if (isWebsiteCapture) {
    const now = new Date().toISOString();
    let inspection: Awaited<ReturnType<typeof inspectLink>> | null = null;
    try { inspection = await inspectLink(input.url); } catch (error) { console.warn('Website metadata inspection failed:', error); }

    let screenshotUrl: string | null = null;
    try {
      screenshotUrl = input.screenshotDataUrl
        ? await cacheWebsiteScreenshot(input.screenshotDataUrl)
        : await captureWebsiteScreenshot(input.url);
    } catch (error) {
      console.warn('Website screenshot failed:', error);
    }

    const domain = inspection?.domain || safeDomain(input.url) || new URL(input.url).hostname;
    const title = input.title?.trim() || inspection?.title?.trim() || domain;
    const description = input.description?.trim() || inspection?.description?.trim() || '';

    if (existing) {
      let changed = false;
      if (input.title?.trim() && input.title.trim() !== existing.title) { existing.title = input.title.trim(); changed = true; }
      if (!input.title?.trim() && inspection?.title?.trim() && existing.title !== inspection.title.trim()) { existing.title = inspection.title.trim(); changed = true; }
      if (description && description !== existing.excerpt) { existing.excerpt = description; changed = true; }
      if (screenshotUrl && screenshotUrl !== existing.website_screenshot_url) {
        existing.website_screenshot_url = screenshotUrl;
        existing.image_url = screenshotUrl;
        changed = true;
      }
      if (existing.type !== 'website') { existing.type = 'website'; changed = true; }
      if (existing.extraction_status !== 'website_saved') { existing.extraction_status = 'website_saved'; changed = true; }
      if (existing.resource_domain !== domain) { existing.resource_domain = domain; changed = true; }
      if (input.note.trim()) {
        store.notes.push({ id: crypto.randomUUID(), item_id: existing.id, highlight_id: null, body: input.note.trim(), created_at: now });
        rebuildTakeawaySummary(existing.id);
        changed = true;
      }
      if (changed) { existing.updated_at = now; persist(); pruneCurrentMedia(); }
      return res.json({ item: getItemDetail(existing.id), duplicate: true, enriched: Boolean(screenshotUrl) });
    }

    const id = crypto.randomUUID();
    const item: ItemRecord = {
      id,
      url: input.url,
      canonical_url: inspection?.finalUrl || input.canonicalUrl || null,
      title,
      author: null,
      source,
      type: 'website',
      excerpt: description,
      summary_zh: '',
      takeaway_summary_zh: '',
      note: '',
      status: input.status,
      saved_at: now,
      updated_at: now,
      content_text: '',
      image_url: screenshotUrl,
      website_screenshot_url: screenshotUrl,
      progress: 0,
      scroll_y: 0,
      extraction_status: screenshotUrl ? 'website_saved' : 'website_no_screenshot',
      resource_kind: null,
      resource_url: null,
      resource_title: null,
      resource_description: null,
      resource_domain: domain,
      resource_image_url: null,
      context_text: null,
      context_author: null,
      context_handle: null
    };
    store.items.push(item);
    if (input.note.trim()) {
      store.notes.push({ id: crypto.randomUUID(), item_id: id, highlight_id: null, body: input.note.trim(), created_at: now });
      rebuildTakeawaySummary(id);
    }
    persist();
    pruneCurrentMedia();
    return res.status(201).json({ item: getItemDetail(id), duplicate: false, enriched: Boolean(screenshotUrl) });
  }

  let extracted: Awaited<ReturnType<typeof extractPage>> | null = null;
  let resourceUrl: string | null = input.sharedUrl || null;
  let resourceTitle: string | null = input.sharedTitle?.trim() || null;
  let resourceDescription: string | null = input.sharedDescription?.trim() || null;
  let resourceDomain: string | null = input.sharedDomain?.trim() || safeDomain(resourceUrl);
  let resourceImageUrl: string | null = input.sharedImageUrl || null;
  let contentBlocks = normalizeContentBlocks(input.contentBlocks ?? []);

  if (contentBlocks.length === 0 && input.blocks?.length) {
    contentBlocks = normalizeContentBlocks(input.blocks.map((text) => ({ kind: 'paragraph', text })));
  }
  if (contentBlocks.length === 0 && (input.selectedText || input.text)) {
    contentBlocks = normalizeContentBlocks([{ kind: 'paragraph', text: input.selectedText || input.text || '' }]);
  }

  // An X website share is a pointer to another resource. Resolve t.co and use
  // the target page—not the tweet chrome—as the readable copy.
  if (isXSmartCapture && (input.resourceKind === 'website' || input.resourceKind === 'video') && resourceUrl) {
    resourceUrl = await resolveUrl(resourceUrl);
    resourceDomain = safeDomain(resourceUrl) || resourceDomain;
    try {
      extracted = await extractPage(resourceUrl);
      resourceUrl = extracted.finalUrl;
      resourceDomain = extracted.domain || resourceDomain;
      resourceTitle = extracted.title?.trim() || resourceTitle;
      resourceDescription = extracted.excerpt?.trim() || resourceDescription;
      resourceImageUrl = extracted.imageUrl || resourceImageUrl;
      if (input.resourceKind === 'website') {
        const targetBlocks = normalizeContentBlocks(extracted.contentBlocks);
        if (targetBlocks.length > 0) contentBlocks = targetBlocks;
      }
    } catch (error) {
      console.warn('External X resource extraction failed:', error);
    }
  }

  const needsReadableCopy = !existing || existing.extraction_status === 'link_only' || !existing.content_text.trim();
  if (!isXSmartCapture && contentBlocks.length === 0 && needsReadableCopy && input.type !== 'image' && input.type !== 'link') {
    try {
      extracted = await extractPage(input.url);
      contentBlocks = normalizeContentBlocks(extracted.contentBlocks);
    } catch (error) {
      console.warn('Extraction failed:', error);
    }
  }

  if (isXSmartCapture && input.resourceKind === 'text' && contentBlocks.length === 0 && input.postText?.trim()) {
    contentBlocks = normalizeContentBlocks([{ kind: 'paragraph', text: input.postText }]);
  }

  const mediaReferer = resourceUrl || input.url;
  if (contentBlocks.some((block) => block.kind === 'image')) {
    contentBlocks = await localizeContentImages(contentBlocks, mediaReferer);
  }

  let representativeImage = resourceImageUrl || contentBlocks.find((block) => block.kind === 'image')?.imageUrl || input.imageUrl || extracted?.imageUrl || null;
  if (representativeImage && !representativeImage.startsWith('/media/')) {
    const representativeReferer = /(?:^|\.)pbs\.twimg\.com$/i.test(safeDomain(representativeImage) || '') ? input.url : mediaReferer;
    representativeImage = await cacheRemoteImage(representativeImage, representativeReferer);
  }
  resourceImageUrl = resourceImageUrl ? representativeImage : (isXSmartCapture ? representativeImage : null);

  const textBlocks = contentBlocks.filter((block) => block.kind !== 'image' && block.text).map((block) => block.text!);
  const imageCount = contentBlocks.filter((block) => block.kind === 'image').length;
  const now = new Date().toISOString();
  const contentText = textBlocks.join('\n\n');
  const contextText = input.postText?.trim() || null;
  const incomingExcerpt = resourceDescription || input.description || extracted?.excerpt || contextText || textBlocks[0]?.slice(0, 320) || '';
  const inferredType = isXSmartCapture ? `x_${input.resourceKind}` : (input.type || (source === 'X' ? 'post' : source === 'Pinterest' ? 'image' : 'article'));
  const suggestedTitle = isXSmartCapture
    ? resourceTitle || firstMeaningfulLine(contextText || undefined) || input.title || `${input.postAuthor || input.postHandle || 'X'} post`
    : input.title || extracted?.title || input.selectedText?.slice(0, 120) || new URL(input.url).hostname;
  const finalTitle = input.titleIsCustom && input.title?.trim() ? input.title.trim() : suggestedTitle;
  const finalAuthor = isXSmartCapture && input.resourceKind === 'website'
    ? extracted?.author || null
    : input.author || input.postAuthor || extracted?.author || null;

  if (existing) {
    let changed = false;
    let enriched = false;
    const existingBlocks = store.blocks.filter((block) => block.item_id === existing.id).sort((a, b) => a.block_index - b.block_index);
    const existingImageUrls = existingBlocks.filter((block) => block.kind === 'image').map((block) => block.image_url || '');
    const incomingImageUrls = contentBlocks.filter((block) => block.kind === 'image').map((block) => block.imageUrl || '');
    const imageSequenceChanged = incomingImageUrls.join('|') !== existingImageUrls.join('|');
    const currentLength = existing.content_text.trim().length;
    const shouldReplaceBlocks = contentBlocks.length > 0 && (
      existing.extraction_status === 'link_only' ||
      existing.extraction_status === 'resource_only' ||
      contentText.length > currentLength * 1.15 ||
      imageCount > existingImageUrls.length ||
      imageSequenceChanged
    );

    if (shouldReplaceBlocks) {
      writeContentBlocks(existing.id, contentBlocks);
      existing.content_text = contentText || existing.content_text;
      existing.extraction_status = textBlocks.length || imageCount ? 'success' : existing.extraction_status;
      existing.excerpt = incomingExcerpt || existing.excerpt;
      enriched = true;
      changed = true;
    }

    if (input.titleIsCustom && input.title?.trim() && input.title.trim() !== existing.title) {
      existing.title = input.title.trim();
      changed = true;
    } else if (!input.titleIsCustom && resourceTitle && looksLikeGenericXTitle(existing.title)) {
      existing.title = resourceTitle;
      changed = true;
    }
    if (!existing.author && finalAuthor) {
      existing.author = finalAuthor;
      changed = true;
    }
    if (representativeImage && representativeImage !== existing.image_url) {
      existing.image_url = representativeImage;
      changed = true;
    }
    if (!existing.canonical_url && input.canonicalUrl) {
      existing.canonical_url = input.canonicalUrl;
      changed = true;
    }
    if (!existing.summary_zh && input.summaryZh) {
      existing.summary_zh = input.summaryZh;
      changed = true;
    }

    const metadataPatch: Partial<ItemRecord> = {
      type: inferredType,
      resource_kind: input.resourceKind || existing.resource_kind,
      resource_url: resourceUrl || existing.resource_url,
      resource_title: resourceTitle || existing.resource_title,
      resource_description: resourceDescription || existing.resource_description,
      resource_domain: resourceDomain || existing.resource_domain,
      resource_image_url: resourceImageUrl || existing.resource_image_url,
      context_text: contextText || existing.context_text,
      context_author: input.postAuthor?.trim() || existing.context_author,
      context_handle: input.postHandle?.trim() || existing.context_handle
    };
    for (const [key, value] of Object.entries(metadataPatch) as Array<[keyof ItemRecord, ItemRecord[keyof ItemRecord]]>) {
      if (value !== undefined && value !== null && existing[key] !== value) {
        (existing as Record<string, unknown>)[key] = value;
        changed = true;
      }
    }
    if (incomingExcerpt && incomingExcerpt !== existing.excerpt && isXSmartCapture) {
      existing.excerpt = incomingExcerpt;
      changed = true;
    }
    if (existing.extraction_status === 'link_only' && isXSmartCapture && input.resourceKind !== 'text') {
      existing.extraction_status = contentBlocks.length ? 'success' : 'resource_only';
      changed = true;
    }
    if (input.note.trim()) {
      store.notes.push({ id: crypto.randomUUID(), item_id: existing.id, highlight_id: null, body: input.note.trim(), created_at: now });
      rebuildTakeawaySummary(existing.id);
      changed = true;
    }

    if (changed) {
      existing.updated_at = now;
      persist();
      pruneCurrentMedia();
    }
    return res.json({ item: getItemDetail(existing.id), duplicate: true, enriched });
  }

  const id = crypto.randomUUID();
  const extractionStatus = textBlocks.length || imageCount ? 'success' : (isXSmartCapture ? 'resource_only' : 'link_only');
  const item: ItemRecord = {
    id,
    url: input.url,
    canonical_url: input.canonicalUrl ?? null,
    title: finalTitle,
    author: finalAuthor,
    source,
    type: inferredType,
    excerpt: incomingExcerpt,
    summary_zh: input.summaryZh || (/\p{Script=Han}/u.test(incomingExcerpt) && !isXSmartCapture ? incomingExcerpt.slice(0, 500) : ''),
    takeaway_summary_zh: '',
    note: '',
    status: input.status,
    saved_at: now,
    updated_at: now,
    content_text: contentText,
    image_url: representativeImage,
    website_screenshot_url: null,
    progress: 0,
    scroll_y: 0,
    extraction_status: extractionStatus,
    resource_kind: input.resourceKind || null,
    resource_url: resourceUrl,
    resource_title: resourceTitle,
    resource_description: resourceDescription,
    resource_domain: resourceDomain,
    resource_image_url: resourceImageUrl,
    context_text: contextText,
    context_author: input.postAuthor?.trim() || null,
    context_handle: input.postHandle?.trim() || null
  };
  store.items.push(item);
  writeContentBlocks(id, contentBlocks);
  if (input.note.trim()) {
    store.notes.push({ id: crypto.randomUUID(), item_id: id, highlight_id: null, body: input.note.trim(), created_at: now });
    rebuildTakeawaySummary(id);
  }
  persist();
  pruneCurrentMedia();
  res.status(201).json({ item: getItemDetail(id), duplicate: false, enriched: false });
});

const patchSchema = z.object({
  status: z.enum(statusValues).optional(),
  note: z.string().max(20_000).optional(),
  summary_zh: z.string().max(10_000).optional(),
  takeaway_summary_zh: z.string().max(20_000).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  scroll_y: z.number().int().min(0).max(10_000_000).optional(),
  title: z.string().trim().max(500).optional()
});

app.patch('/api/items/:id', (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const item = store.items.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  Object.assign(item, parsed.data, { updated_at: new Date().toISOString() });
  persist();
  res.json(getItemDetail(req.params.id));
});

const highlightSchema = z.object({
  block_id: z.string().uuid(),
  start_offset: z.number().int().min(0),
  end_offset: z.number().int().positive(),
  quote: z.string().min(1).max(20_000)
});

app.post('/api/items/:id/highlights', (req, res) => {
  const parsed = highlightSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const item = store.items.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const block = store.blocks.find((entry) => entry.id === parsed.data.block_id && entry.item_id === req.params.id);
  if (!block || block.kind === 'image') return res.status(400).json({ error: 'Text block not found' });
  if (parsed.data.end_offset > block.text.length || parsed.data.start_offset >= parsed.data.end_offset) return res.status(400).json({ error: 'Invalid text range' });
  const highlight = { id: crypto.randomUUID(), item_id: req.params.id, ...parsed.data, created_at: new Date().toISOString() };
  store.highlights.push(highlight);
  persist();
  res.status(201).json({ ...highlight, notes: [] });
});

const noteSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  highlight_id: z.string().uuid().nullable().optional().default(null)
});

app.post('/api/items/:id/notes', (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const item = store.items.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (parsed.data.highlight_id) {
    const highlight = store.highlights.find((entry) => entry.id === parsed.data.highlight_id && entry.item_id === req.params.id);
    if (!highlight) return res.status(400).json({ error: 'Highlight not found' });
  }
  const note = {
    id: crypto.randomUUID(),
    item_id: req.params.id,
    highlight_id: parsed.data.highlight_id ?? null,
    body: parsed.data.body,
    created_at: new Date().toISOString()
  };
  store.notes.push(note);
  rebuildTakeawaySummary(req.params.id);
  persist();
  res.status(201).json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  const index = store.notes.findIndex((note) => note.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Note not found' });
  const [removed] = store.notes.splice(index, 1);
  rebuildTakeawaySummary(removed.item_id);
  persist();
  res.status(204).end();
});

app.delete('/api/highlights/:id', (req, res) => {
  const index = store.highlights.findIndex((highlight) => highlight.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Highlight not found' });
  const [removed] = store.highlights.splice(index, 1);
  store.notes = store.notes.filter((note) => note.highlight_id !== removed.id);
  rebuildTakeawaySummary(removed.item_id);
  persist();
  res.status(204).end();
});


app.delete('/api/items/:itemId/blocks/:blockId', (req, res) => {
  const item = store.items.find((entry) => entry.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const index = store.blocks.findIndex(
    (block) => block.id === req.params.blockId && block.item_id === req.params.itemId
  );
  if (index < 0) return res.status(404).json({ error: 'Image not found' });

  const block = store.blocks[index];
  if (block.kind !== 'image' || !block.image_url) {
    return res.status(400).json({ error: 'Only image blocks can be deleted' });
  }

  const removedUrl = block.image_url;
  store.blocks.splice(index, 1);

  const remainingBlocks = store.blocks
    .filter((entry) => entry.item_id === item.id)
    .sort((a, b) => a.block_index - b.block_index);
  remainingBlocks.forEach((entry, blockIndex) => { entry.block_index = blockIndex; });

  const nextImage = remainingBlocks.find((entry) => entry.kind === 'image' && entry.image_url)?.image_url ?? null;
  if (item.image_url === removedUrl) item.image_url = nextImage;
  if (item.resource_image_url === removedUrl) item.resource_image_url = nextImage;
  item.updated_at = new Date().toISOString();

  persist();
  pruneCurrentMedia();
  res.json(getItemDetail(item.id));
});

app.delete('/api/items/:id/cover-image', (req, res) => {
  const item = store.items.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const removedUrls = new Set([item.image_url, item.website_screenshot_url, item.resource_image_url].filter((value): value is string => Boolean(value)));
  item.image_url = null;
  item.website_screenshot_url = null;
  item.resource_image_url = null;
  if (item.type === 'website') item.extraction_status = 'website_no_screenshot';

  // A resource preview can also have been stored as a reader image block.
  // Remove only matching preview copies, while preserving unrelated article images.
  if (removedUrls.size > 0) {
    store.blocks = store.blocks.filter(
      (block) => block.item_id !== item.id || block.kind !== 'image' || !block.image_url || !removedUrls.has(block.image_url)
    );
    store.blocks
      .filter((block) => block.item_id === item.id)
      .sort((a, b) => a.block_index - b.block_index)
      .forEach((block, blockIndex) => { block.block_index = blockIndex; });
  }

  item.updated_at = new Date().toISOString();
  persist();
  pruneCurrentMedia();
  res.json(getItemDetail(item.id));
});

app.get('/api/highlights', (_req, res) => {
  const rows = store.highlights
    .map((highlight) => {
      const item = store.items.find((entry) => entry.id === highlight.item_id);
      const block = store.blocks.find((entry) => entry.id === highlight.block_id);
      return {
        ...highlight,
        title: item?.title,
        source: item?.source,
        url: item?.url,
        block_index: block?.block_index ?? 0,
        notes: store.notes.filter((note) => note.highlight_id === highlight.id)
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(rows);
});

app.delete('/api/items/:id', (req, res) => {
  const index = store.items.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Item not found' });
  store.items.splice(index, 1);
  store.blocks = store.blocks.filter((block) => block.item_id !== req.params.id);
  store.highlights = store.highlights.filter((highlight) => highlight.item_id !== req.params.id);
  store.notes = store.notes.filter((note) => note.item_id !== req.params.id);
  persist();
  pruneCurrentMedia();
  res.status(204).end();
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(PORT, () => {
  console.log(`Revisit API running at http://localhost:${PORT}`);
});
