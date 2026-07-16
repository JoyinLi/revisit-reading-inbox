import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { IncomingContentBlock } from './media.js';

export type ExtractedPage = {
  finalUrl: string;
  domain: string;
  title?: string;
  author?: string;
  excerpt?: string;
  imageUrl?: string;
  blocks: string[];
  contentBlocks: IncomingContentBlock[];
};

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

export type LinkInspection = {
  finalUrl: string;
  domain: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  recommendedMode: 'article' | 'website';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
};

function schemaTypes(doc: Document) {
  const types = new Set<string>();
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const parsed = JSON.parse(script.textContent || 'null');
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        const type = (node as Record<string, unknown>)['@type'];
        if (typeof type === 'string') types.add(type.toLowerCase());
        if (Array.isArray(type)) type.filter((entry): entry is string => typeof entry === 'string').forEach((entry) => types.add(entry.toLowerCase()));
        const graph = (node as Record<string, unknown>)['@graph'];
        if (Array.isArray(graph)) queue.push(...graph);
      }
    } catch {
      // Invalid JSON-LD is common and should not block saving.
    }
  }
  return types;
}

function classifyDocument(doc: Document, finalUrl: string) {
  const url = new URL(finalUrl);
  const host = url.hostname.replace(/^www\./, '');
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const pathname = url.pathname.toLowerCase();
  const ogType = normalizeText(doc.querySelector('meta[property="og:type"]')?.getAttribute('content') || '').toLowerCase();
  const schemas = schemaTypes(doc);
  const articleSchema = ['article', 'blogposting', 'newsarticle', 'techarticle', 'report'].some((type) => schemas.has(type));
  const websiteSchema = ['website', 'webapplication', 'softwareapplication', 'collectionpage'].some((type) => schemas.has(type));
  const articleUrl = /\/(?:article|articles|blog|blogs|post|posts|news|story|stories|read|detail|entry|entries)\//i.test(pathname) || /\/20\d{2}\/\d{1,2}\//.test(pathname);
  const knownArticleHost = host === 'mp.weixin.qq.com' || /(?:medium\.com|substack\.com|dev\.to)$/.test(host);
  const reader = new Readability(doc.cloneNode(true) as Document).parse();
  const readerLength = normalizeText(reader?.textContent || '').length;
  const articleElements = doc.querySelectorAll('article').length;
  const paragraphCount = doc.querySelectorAll('article p, main p, [role="main"] p').length;
  const hasPublishedTime = Boolean(doc.querySelector('time, meta[property="article:published_time"], meta[name="date"]'));
  const hasAuthor = Boolean(doc.querySelector('[rel="author"], .author, [class*="byline"], meta[name="author"], meta[property="article:author"]'));
  const navLinks = doc.querySelectorAll('nav a, header a').length;
  const sectionCount = doc.querySelectorAll('main > section, body > section, [role="main"] > section').length;
  const interactiveCount = doc.querySelectorAll('button, form, input, select, textarea, [role="button"]').length;
  const rootLike = pathSegments.length <= 1 && !/\.[a-z0-9]{2,5}$/i.test(url.pathname);
  const productProjectRoot = (host.endsWith('github.io') || host.endsWith('vercel.app') || host.endsWith('netlify.app')) && pathSegments.length <= 1;

  let articleScore = 0;
  let websiteScore = 0;
  const articleReasons: string[] = [];
  const websiteReasons: string[] = [];

  if (knownArticleHost) { articleScore += 6; articleReasons.push('known article platform'); }
  if (ogType === 'article') { articleScore += 5; articleReasons.push('article metadata'); }
  if (articleSchema) { articleScore += 5; articleReasons.push('Article schema'); }
  if (articleUrl) { articleScore += 4; articleReasons.push('article-style URL'); }
  if (articleElements > 0 && readerLength >= 500) { articleScore += 3; articleReasons.push('continuous article body'); }
  if (hasPublishedTime && hasAuthor) { articleScore += 3; articleReasons.push('author and publication date'); }
  if (paragraphCount >= 8 && readerLength >= 1200) articleScore += 2;

  if (ogType === 'website') { websiteScore += 4; websiteReasons.push('website metadata'); }
  if (websiteSchema) { websiteScore += 5; websiteReasons.push('Website or application schema'); }
  if (rootLike) { websiteScore += 3; websiteReasons.push('site-level URL'); }
  if (productProjectRoot) { websiteScore += 3; websiteReasons.push('project homepage'); }
  if (sectionCount >= 4 && navLinks >= 4) { websiteScore += 3; websiteReasons.push('site navigation and multiple sections'); }
  if (interactiveCount >= 6 && articleElements === 0) { websiteScore += 2; websiteReasons.push('interactive product structure'); }
  if (readerLength < 500 && (navLinks >= 4 || sectionCount >= 3)) { websiteScore += 2; websiteReasons.push('no stable article body'); }

  const difference = Math.abs(articleScore - websiteScore);
  const recommendedMode: 'article' | 'website' = websiteScore > articleScore ? 'website' : 'article';
  const winningScore = Math.max(articleScore, websiteScore);
  const confidence: 'high' | 'medium' | 'low' = winningScore >= 7 && difference >= 3 ? 'high' : winningScore >= 4 && difference >= 2 ? 'medium' : 'low';
  const reasons = recommendedMode === 'website' ? websiteReasons : articleReasons;

  return {
    recommendedMode,
    confidence,
    reason: reasons.slice(0, 2).join(' + ') || (recommendedMode === 'website' ? 'site-level page structure' : 'readable page content')
  };
}

const minimumUsefulLength = (text: string) => (/\p{Script=Han}/u.test(text) ? 8 : 20);
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36 ReadingInbox/0.8';

function absoluteUrl(raw: string | null | undefined, baseUrl: string) {
  if (!raw || /^(data:|blob:|javascript:)/i.test(raw)) return undefined;
  try { return new URL(raw, baseUrl).href; } catch { return undefined; }
}

function collectContentBlocks(doc: Document, baseUrl: string) {
  const result: IncomingContentBlock[] = [];
  const seenText = new Set<string>();
  const seenImages = new Set<string>();
  const nodes = Array.from(doc.querySelectorAll('h1, h2, h3, h4, p, blockquote, li, pre, figcaption, img'));

  for (const node of nodes) {
    if (node instanceof doc.defaultView!.HTMLImageElement) {
      const raw = node.getAttribute('data-src') || node.getAttribute('data-original') || node.getAttribute('data-lazy-src') || node.getAttribute('src') || '';
      const imageUrl = absoluteUrl(raw, baseUrl);
      if (!imageUrl) continue;
      if (seenImages.has(imageUrl) || /(?:emoji|avatar|qrcode|qr_code|icon|logo)/i.test(`${imageUrl} ${node.className || ''}`)) continue;
      const width = node.naturalWidth || Number(node.getAttribute('width')) || 0;
      const height = node.naturalHeight || Number(node.getAttribute('height')) || 0;
      if (width && height && width <= 80 && height <= 80) continue;
      seenImages.add(imageUrl);
      const figure = node.closest('figure');
      result.push({
        kind: 'image',
        imageUrl,
        alt: normalizeText(node.getAttribute('alt') || ''),
        caption: normalizeText(figure?.querySelector('figcaption')?.textContent || '') || undefined
      });
      continue;
    }

    const text = normalizeText(node.textContent || '');
    if (!text || text.length < minimumUsefulLength(text) || text.length > 12_000) continue;
    const key = text.replace(/\s+/g, '');
    if (seenText.has(key)) continue;
    seenText.add(key);
    let kind = 'paragraph';
    if (node.matches('h1, h2, h3, h4')) kind = 'heading';
    else if (node.matches('blockquote')) kind = 'quote';
    else if (node.matches('pre')) kind = 'code';
    else if (node.matches('figcaption')) kind = 'caption';
    result.push({ kind, text });
    if (result.length >= 300) break;
  }

  return result;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    return { html: await response.text(), finalUrl: response.url || url };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveUrl(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*;q=0.8' }
    });
    return response.url || url;
  } catch {
    return url;
  } finally {
    clearTimeout(timeout);
  }
}


export async function inspectLink(url: string): Promise<LinkInspection> {
  const { html, finalUrl } = await fetchHtml(url);
  const dom = new JSDOM(html, { url: finalUrl });
  const doc = dom.window.document;
  const classification = classifyDocument(doc, finalUrl);
  return {
    finalUrl,
    domain: new URL(finalUrl).hostname.replace(/^www\./, ''),
    title: doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || undefined,
    description: doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || doc.querySelector('meta[name="description"]')?.getAttribute('content') || undefined,
    imageUrl: absoluteUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), finalUrl),
    ...classification
  };
}

export async function extractPage(url: string): Promise<ExtractedPage> {
  const { html, finalUrl } = await fetchHtml(url);
  const dom = new JSDOM(html, { url: finalUrl });
  const doc = dom.window.document;
  const ogImage = absoluteUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), finalUrl);
  const reader = new Readability(doc.cloneNode(true) as Document).parse();
  const contentDom = reader?.content ? new JSDOM(reader.content, { url: finalUrl }).window.document : doc;
  const contentBlocks = collectContentBlocks(contentDom, finalUrl);
  const blocks = contentBlocks.filter((block) => block.kind !== 'image' && block.text).map((block) => block.text!);
  return {
    finalUrl,
    domain: new URL(finalUrl).hostname.replace(/^www\./, ''),
    title: reader?.title || doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || undefined,
    author: reader?.byline || doc.querySelector('meta[name="author"]')?.getAttribute('content') || doc.querySelector('meta[property="article:author"]')?.getAttribute('content') || undefined,
    excerpt: reader?.excerpt || doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || doc.querySelector('meta[name="description"]')?.getAttribute('content') || undefined,
    imageUrl: ogImage,
    blocks,
    contentBlocks
  };
}
