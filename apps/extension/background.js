const DEFAULT_API = 'http://localhost:8787';
const DEFAULT_APP = 'http://localhost:5173';

async function getSettings() {
  return chrome.storage.sync.get({ apiBase: DEFAULT_API, appBase: DEFAULT_APP });
}

async function postCapture(payload) {
  const { apiBase } = await getSettings();
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.error === 'string'
      ? body.error
      : body?.error?.fieldErrors
        ? Object.entries(body.error.fieldErrors)
            .flatMap(([field, messages]) => (Array.isArray(messages) ? messages.map((message) => `${field}: ${message}`) : []))
            .join('; ')
        : '';
    throw new Error(detail || `Save failed (${response.status})`);
  }
  return response.json();
}

function showBadge(tabId, success) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: success ? '#171715' : '#b93c35' });
  chrome.action.setBadgeText({ tabId, text: success ? '✓' : '!' });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 1600);
}

/** Runs inside the active page. Keep helpers nested so executeScript can serialize them. */
function extractPageData() {
  const normalize = (value) => (value || '').replace(/[\t\f\v ]+/g, ' ').replace(/\u00a0/g, ' ').trim();
  const meta = (selector) => normalize(document.querySelector(selector)?.getAttribute('content'));
  const textOf = (selector) => normalize(document.querySelector(selector)?.textContent);
  const isHanText = (text) => /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
  const minimumUsefulLength = (text) => (isHanText(text) ? 8 : 20);
  const isNoise = (text) => {
    const compact = text.replace(/\s+/g, '');
    if (!compact) return true;
    return /^(阅读原文|点击阅读原文|关注公众号|长按识别二维码|扫码关注|继续滑动看下一个|广告|赞赏|分享|收藏|在看|写留言)$/.test(compact);
  };
  const isVisible = (node) => {
    if (!(node instanceof HTMLElement)) return true;
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') !== 0;
  };
  const isInsideNoise = (node) => Boolean(node.closest(
    'script, style, noscript, nav, footer, form, button, [hidden], [aria-hidden="true"], .qr_code_pc, .rich_media_tool, .reward_area, .js_comment_area, #js_tags, #js_pc_qr_code'
  ));
  const absoluteUrl = (raw) => {
    if (!raw || /^(data:|blob:|javascript:)/i.test(raw)) return '';
    try { return new URL(raw, location.href).href; } catch { return ''; }
  };
  const imageSource = (img) => absoluteUrl(
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-lazy-src') ||
    img.currentSrc ||
    img.getAttribute('src') ||
    ''
  );
  const isUsefulImage = (img, url) => {
    if (!url || /(?:emoji|avatar|qrcode|qr_code|icon|logo)/i.test(`${url} ${img.className || ''} ${img.id || ''}`)) return false;
    const width = img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const height = img.naturalHeight || Number(img.getAttribute('height')) || 0;
    if (width && height && width <= 80 && height <= 80) return false;
    return true;
  };
  const firstSentence = (value, maxLength = 160) => {
    const text = normalize(value);
    if (!text) return '';
    const sentence = text.split(/(?<=[.!?。！？])\s+/u)[0] || text;
    return sentence.length > maxLength ? `${sentence.slice(0, maxLength).trim()}…` : sentence;
  };
  const cssBackgroundUrl = (node) => {
    if (!(node instanceof HTMLElement)) return '';
    const value = window.getComputedStyle(node).backgroundImage || node.style.backgroundImage || '';
    const match = value.match(/url\(["']?([^"')]+)["']?\)/i);
    return absoluteUrl(match?.[1] || '');
  };
  const nonXUrl = (anchor) => {
    const raw = anchor?.getAttribute('data-expanded-url') || anchor?.getAttribute('title') || anchor?.href || anchor?.getAttribute('href') || '';
    const url = absoluteUrl(raw);
    if (!url) return '';
    try {
      const parsed = new URL(url);
      const linkHost = parsed.hostname.replace(/^www\./, '');
      if (linkHost === 't.co') return url;
      if (linkHost === 'x.com' || linkHost === 'twitter.com' || linkHost.endsWith('.x.com')) return '';
      return url;
    } catch { return ''; }
  };

  const detectCaptureMode = () => {
    const pathSegments = location.pathname.split('/').filter(Boolean);
    const pathname = location.pathname.toLowerCase();
    const ogType = meta('meta[property=\"og:type\"]')?.toLowerCase() || '';
    const jsonLdText = Array.from(document.querySelectorAll('script[type=\"application/ld+json\"]')).map((node) => node.textContent || '').join(' ').toLowerCase();
    const isArticleSchema = /blogposting|newsarticle|techarticle|\"article\"/.test(jsonLdText);
    const isWebsiteSchema = /website|webapplication|softwareapplication|collectionpage/.test(jsonLdText);
    const articleUrl = /\/(?:article|articles|blog|blogs|post|posts|news|story|stories|read|detail|entry|entries)\//i.test(pathname) || /\/20\d{2}\/\d{1,2}\//.test(pathname);
    const hasArticle = Boolean(document.querySelector('article'));
    const hasAuthor = Boolean(document.querySelector('[rel=\"author\"], .author, [class*=\"byline\"], meta[name=\"author\"], meta[property=\"article:author\"]'));
    const hasDate = Boolean(document.querySelector('time, meta[property=\"article:published_time\"], meta[name=\"date\"]'));
    const readableParagraphs = document.querySelectorAll('article p, main p, [role=\"main\"] p').length;
    const navLinks = document.querySelectorAll('nav a, header a').length;
    const sectionCount = document.querySelectorAll('main > section, body > section, [role=\"main\"] > section').length;
    const interactiveCount = document.querySelectorAll('button, form, input, select, textarea, [role=\"button\"]').length;
    const rootLike = pathSegments.length <= 1 && !/\.[a-z0-9]{2,5}$/i.test(location.pathname);
    const projectHomepage = (location.hostname.endsWith('github.io') || location.hostname.endsWith('vercel.app') || location.hostname.endsWith('netlify.app')) && pathSegments.length <= 1;

    let articleScore = 0;
    let websiteScore = 0;
    const articleReasons = [];
    const websiteReasons = [];
    if (location.hostname === 'mp.weixin.qq.com') { articleScore += 8; articleReasons.push('article platform'); }
    if (ogType === 'article') { articleScore += 5; articleReasons.push('article metadata'); }
    if (isArticleSchema) { articleScore += 5; articleReasons.push('Article schema'); }
    if (articleUrl) { articleScore += 4; articleReasons.push('article URL'); }
    if (hasArticle && readableParagraphs >= 5) { articleScore += 3; articleReasons.push('continuous article body'); }
    if (hasAuthor && hasDate) { articleScore += 3; articleReasons.push('author and date'); }

    if (ogType === 'website') { websiteScore += 4; websiteReasons.push('website metadata'); }
    if (isWebsiteSchema) { websiteScore += 5; websiteReasons.push('Website schema'); }
    if (rootLike) { websiteScore += 3; websiteReasons.push('site-level URL'); }
    if (projectHomepage) { websiteScore += 3; websiteReasons.push('project homepage'); }
    if (sectionCount >= 4 && navLinks >= 4) { websiteScore += 3; websiteReasons.push('navigation and multiple sections'); }
    if (interactiveCount >= 6 && !hasArticle) { websiteScore += 2; websiteReasons.push('interactive page'); }

    const suggestedCaptureMode = websiteScore > articleScore ? 'website' : 'article';
    const difference = Math.abs(articleScore - websiteScore);
    const winningScore = Math.max(articleScore, websiteScore);
    return {
      suggestedCaptureMode,
      captureModeConfidence: winningScore >= 7 && difference >= 3 ? 'high' : winningScore >= 4 && difference >= 2 ? 'medium' : 'low',
      captureModeReason: (suggestedCaptureMode === 'website' ? websiteReasons : articleReasons).slice(0, 2).join(' + ') || 'page structure'
    };
  };

  const host = location.hostname.replace(/^www\./, '');
  const isWeChat = host === 'mp.weixin.qq.com';
  const isX = host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com');

  if (isX) {
    const selectedArticle = window.getSelection()?.anchorNode instanceof Node
      ? window.getSelection()?.anchorNode?.parentElement?.closest('article[data-testid="tweet"]')
      : null;
    const statusId = location.pathname.match(/\/status\/(\d+)/)?.[1];
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const matchedArticle = statusId
      ? articles.find((article) => Array.from(article.querySelectorAll('a[href]')).some((anchor) => anchor.getAttribute('href')?.includes(`/status/${statusId}`)))
      : null;
    const article = selectedArticle || matchedArticle || articles.find((candidate) => isVisible(candidate)) || null;

    if (article) {
      const tweetTextNode = Array.from(article.querySelectorAll('[data-testid="tweetText"]'))
        .find((node) => !node.closest('[data-testid="quoteTweet"]'));
      const postText = normalize(tweetTextNode?.textContent || '');
      const userNameNode = article.querySelector('[data-testid="User-Name"]');
      const userParts = Array.from(userNameNode?.querySelectorAll('span') || [])
        .map((node) => normalize(node.textContent || ''))
        .filter(Boolean);
      const postHandle = userParts.find((part) => /^@[A-Za-z0-9_]+$/.test(part)) || '';
      const postAuthor = userParts.find((part) => part !== postHandle && !/^·$/.test(part) && !/^\d+[mhd]$/.test(part)) || postHandle;
      const primaryUrl = statusId && postHandle
        ? `https://x.com/${postHandle.slice(1)}/status/${statusId}`
        : location.href;
      const card = article.querySelector('[data-testid="card.wrapper"], [data-testid="card.layoutLarge.media"], [data-testid="card.layoutSmall.media"]');
      const cardText = normalize(card?.textContent || '');
      const externalLinkAnchors = Array.from(article.querySelectorAll('a[href]'))
        .filter((anchor) => !anchor.closest('[data-testid="User-Name"]'))
        .filter((anchor) => !anchor.getAttribute('href')?.includes('/photo/'))
        .filter((anchor) => !anchor.getAttribute('href')?.includes('/analytics'));
      const cardLink = externalLinkAnchors.map(nonXUrl).find(Boolean) || '';
      const sharedDomain = (() => {
        try { return cardLink ? new URL(cardLink).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
      })();
      const cardImageNode = card?.querySelector('img') || null;
      const cardImageUrl = cardImageNode ? imageSource(cardImageNode) : cssBackgroundUrl(card?.querySelector('[style*="background-image"]'));
      const mediaImages = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]'));
      const imageBlocks = [];
      const seenXImages = new Set();
      for (const image of mediaImages) {
        const url = imageSource(image);
        if (!url || seenXImages.has(url)) continue;
        seenXImages.add(url);
        imageBlocks.push({ kind: 'image', imageUrl: url, alt: normalize(image.alt) || undefined });
      }
      const nativeVideo = Boolean(article.querySelector('[data-testid="videoPlayer"], video, [data-testid="playButton"]'));
      const videoDomains = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com|tiktok\.com|bilibili\.com|nicovideo\.jp)$/i;
      const externalVideo = sharedDomain && videoDomains.test(sharedDomain);
      const hasSharedCard = Boolean(card && cardLink);
      const resourceKind = nativeVideo || externalVideo
        ? 'video'
        : imageBlocks.length
          ? 'image'
          : hasSharedCard
            ? 'website'
            : 'text';
      const cardTitleCandidates = Array.from(card?.querySelectorAll('span, div') || [])
        .map((node) => normalize(node.textContent || ''))
        .filter((value) => value.length >= 4 && value.length <= 180 && value !== sharedDomain && value !== postText);
      const cardTitle = cardTitleCandidates.find((value) => !cardText.startsWith(`${value} ${value}`)) || '';
      const resourceUrl = cardLink || primaryUrl;
      const fallbackTitle = resourceKind === 'website'
        ? cardTitle || sharedDomain || firstSentence(postText, 110) || 'Shared website'
        : resourceKind === 'video'
          ? cardTitle || (externalVideo ? `${sharedDomain} video` : firstSentence(postText, 110) || 'Video post')
          : resourceKind === 'image'
            ? firstSentence(postText, 110) || `Image post by ${postAuthor || postHandle}`
            : firstSentence(postText, 110) || `Post by ${postAuthor || postHandle}`;
      const contentBlocks = [];
      if (resourceKind === 'text' && postText) contentBlocks.push({ kind: 'paragraph', text: postText });
      if (resourceKind === 'image') {
        if (postText) contentBlocks.push({ kind: 'paragraph', text: postText });
        contentBlocks.push(...imageBlocks);
      }
      const captureMode = detectCaptureMode();

      return {
        url: resourceUrl,
        canonicalUrl: resourceUrl,
        title: normalize(fallbackTitle),
        author: postAuthor || postHandle || undefined,
        description: resourceKind === 'website' || resourceKind === 'video' ? firstSentence(cardText || postText, 180) : firstSentence(postText, 180),
        imageUrl: cardImageUrl || imageBlocks[0]?.imageUrl || undefined,
        selectedText: window.getSelection()?.toString().trim() || undefined,
        blocks: contentBlocks.filter((block) => block.kind !== 'image').map((block) => block.text),
        contentBlocks,
        extractionMethod: `x-smart:${resourceKind}`,
        extractedCharacterCount: contentBlocks.reduce((sum, block) => sum + (block.text?.length || 0), 0),
        extractedImageCount: contentBlocks.filter((block) => block.kind === 'image').length,
        source: 'X',
        resourceKind,
        resourceUrl,
        resourceTitle: normalize(fallbackTitle),
        resourceDescription: resourceKind === 'website' || resourceKind === 'video' ? firstSentence(cardText || postText, 180) : '',
        resourceImageUrl: cardImageUrl || imageBlocks[0]?.imageUrl || undefined,
        sharedDomain: sharedDomain || undefined,
        postUrl: primaryUrl,
        postText: postText || undefined,
        postAuthor: postAuthor || undefined,
        postHandle: postHandle || undefined,
        externalVideoProvider: externalVideo ? sharedDomain : nativeVideo ? 'x.com' : undefined,
        ...captureMode
      };
    }
  }

  let contentRoot = null;
  let extractionMethod = 'generic';

  if (isWeChat) {
    const preferredSelectors = [
      '#js_content',
      '.rich_media_content',
      '#img-content',
      '.rich_media_area_primary_inner',
      '.rich_media_wrp'
    ];
    for (const selector of preferredSelectors) {
      const candidate = document.querySelector(selector);
      if (candidate && normalize(candidate.textContent).length >= 80) {
        contentRoot = candidate;
        extractionMethod = `wechat:${selector}`;
        break;
      }
    }
  }

  if (!contentRoot) {
    const preferredSelectors = [
      'article',
      '[itemprop="articleBody"]',
      '.article-content',
      '.article-body',
      '.article__content',
      '.story-body',
      '.markdown-body',
      'main',
      '[role="main"]'
    ];
    for (const selector of preferredSelectors) {
      const candidate = document.querySelector(selector);
      if (candidate && normalize(candidate.textContent).length >= 180) {
        contentRoot = candidate;
        extractionMethod = `selector:${selector}`;
        break;
      }
    }
  }

  if (!contentRoot) {
    const candidates = Array.from(document.querySelectorAll('article, main, [role="main"], div'))
      .filter((node) => isVisible(node))
      .map((node) => {
        const text = normalize(node.textContent);
        const linksText = Array.from(node.querySelectorAll('a')).reduce((sum, link) => sum + normalize(link.textContent).length, 0);
        const paragraphCount = node.querySelectorAll('p, section, blockquote').length;
        const linkRatio = text.length ? linksText / text.length : 1;
        const score = text.length + paragraphCount * 120 - linkRatio * text.length * 0.8;
        return { node, textLength: text.length, score };
      })
      .filter((entry) => entry.textLength >= 300)
      .sort((a, b) => b.score - a.score);
    contentRoot = candidates[0]?.node || document.body;
    extractionMethod = candidates[0] ? 'scored-root' : 'body';
  }

  const contentBlocks = [];
  const seenText = new Set();
  const seenImages = new Set();
  const candidates = Array.from(contentRoot.querySelectorAll('h1, h2, h3, h4, p, blockquote, li, pre, figcaption, section, img'));

  for (const node of candidates) {
    if (isInsideNoise(node) || !isVisible(node)) continue;

    if (node instanceof HTMLImageElement) {
      const url = imageSource(node);
      if (!isUsefulImage(node, url) || seenImages.has(url)) continue;
      seenImages.add(url);
      const figure = node.closest('figure');
      const caption = normalize(figure?.querySelector('figcaption')?.textContent || node.getAttribute('data-caption') || '');
      contentBlocks.push({
        kind: 'image',
        imageUrl: url,
        alt: normalize(node.getAttribute('alt') || node.getAttribute('data-ratio') || ''),
        caption: caption || undefined
      });
      if (contentBlocks.length >= 300) break;
      continue;
    }

    if (!(node instanceof HTMLElement)) continue;

    if (node.matches('section')) {
      const substantialDescendant = Array.from(node.querySelectorAll(':scope > p, :scope > section, :scope > blockquote, :scope > li, :scope > h1, :scope > h2, :scope > h3, :scope > h4'))
        .some((child) => normalize(child.textContent).length >= minimumUsefulLength(normalize(child.textContent)));
      if (substantialDescendant) continue;
    }

    const text = normalize(node.textContent);
    if (!text || text.length < minimumUsefulLength(text) || text.length > 12000 || isNoise(text)) continue;
    const key = text.replace(/\s+/g, '');
    if (seenText.has(key)) continue;
    seenText.add(key);

    let kind = 'paragraph';
    if (node.matches('h1, h2, h3, h4')) kind = 'heading';
    else if (node.matches('blockquote')) kind = 'quote';
    else if (node.matches('pre')) kind = 'code';
    else if (node.matches('figcaption')) kind = 'caption';
    contentBlocks.push({ kind, text });
    if (contentBlocks.length >= 300) break;
  }

  const textBlocks = contentBlocks.filter((block) => block.kind !== 'image' && block.text);
  const textLength = textBlocks.reduce((sum, block) => sum + block.text.length, 0);

  // WeChat sometimes wraps all text in spans. Use visible line breaks as a final
  // fallback, while keeping any images already collected.
  if (textBlocks.length < 3 || textLength < 180) {
    const fallback = (contentRoot.innerText || contentRoot.textContent || '')
      .split(/\n+/)
      .map(normalize)
      .filter((text) => text && text.length >= minimumUsefulLength(text) && !isNoise(text));
    for (const text of fallback) {
      const key = text.replace(/\s+/g, '');
      if (seenText.has(key)) continue;
      seenText.add(key);
      contentBlocks.push({ kind: 'paragraph', text });
      if (contentBlocks.length >= 300) break;
    }
  }

  const blocks = contentBlocks.filter((block) => block.kind !== 'image').map((block) => block.text);
  const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || location.href;
  const wechatTitle = textOf('#activity-name') || textOf('h1.rich_media_title');
  const wechatAuthor = textOf('#js_name') || textOf('.rich_media_meta_nickname');
  const firstImageBlock = contentBlocks.find((block) => block.kind === 'image');
  const pageTitle = wechatTitle || meta('meta[property="og:title"]') || document.title;
  const captureMode = detectCaptureMode();

  return {
    url: location.href,
    canonicalUrl,
    title: normalize(pageTitle),
    author: wechatAuthor || meta('meta[name="author"]') || meta('meta[property="article:author"]'),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    imageUrl: meta('meta[property="og:image"]') || firstImageBlock?.imageUrl || undefined,
    selectedText: window.getSelection()?.toString().trim() || undefined,
    blocks,
    contentBlocks,
    extractionMethod,
    extractedCharacterCount: blocks.reduce((sum, block) => sum + block.length, 0),
    extractedImageCount: contentBlocks.filter((block) => block.kind === 'image').length,
    ...captureMode
  };
}

async function extractFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageData
  });
  return results[0]?.result;
}

async function captureVisibleScreenshot(tab) {
  if (!tab?.windowId) return undefined;
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (error) {
    console.warn('Could not capture website screenshot:', error);
    return undefined;
  }
}

async function prepareCapturePayload(payload, tab) {
  if (payload?.captureMode !== 'website') {
    // contentBlocks already contain the readable text. Avoid sending the
    // legacy duplicate blocks array, which can exceed validation limits on
    // long pages and needlessly enlarge the request.
    if (Array.isArray(payload?.contentBlocks) && payload.contentBlocks.length > 0) {
      const { blocks: _legacyBlocks, ...withoutLegacyBlocks } = payload;
      return withoutLegacyBlocks;
    }
    return payload;
  }

  const screenshotDataUrl = await captureVisibleScreenshot(tab);

  // A Website capture stores the page identity and visual snapshot only.
  // Do not upload article extraction fields from large landing pages. They
  // are irrelevant for Website mode and previously caused 400 responses when
  // the page contained more than 250 extracted text blocks.
  return {
    url: payload.url,
    canonicalUrl: payload.canonicalUrl,
    title: payload.title,
    author: payload.author,
    description: payload.description,
    source: payload.source,
    type: 'website',
    note: payload.note || '',
    status: payload.status || 'unread',
    titleIsCustom: Boolean(payload.titleIsCustom),
    captureMode: 'website',
    screenshotDataUrl
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-page', title: 'Save page to Revisit', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'save-selection', title: 'Save selected text to Revisit', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Revisit', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'save-image', title: 'Save image to Revisit', contexts: ['image'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    let payload;
    if (info.menuItemId === 'save-selection') {
      payload = {
        url: info.pageUrl || tab.url,
        title: tab.title,
        selectedText: info.selectionText,
        type: 'selected_text'
      };
    } else if (info.menuItemId === 'save-link') {
      payload = {
        url: info.linkUrl,
        title: info.linkUrl,
        type: 'link'
      };
    } else if (info.menuItemId === 'save-image') {
      payload = {
        url: info.pageUrl || tab.url,
        title: tab.title,
        imageUrl: info.srcUrl,
        type: 'image'
      };
    } else {
      payload = await extractFromTab(tab.id);
      payload.captureMode = payload.suggestedCaptureMode || 'article';
    }
    payload = await prepareCapturePayload(payload, tab);
    await postCapture(payload);
    showBadge(tab.id, true);
  } catch (error) {
    console.error(error);
    showBadge(tab.id, false);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'capture') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        const payload = await prepareCapturePayload(message.payload, tab);
        return postCapture(payload);
      })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'extract-active-tab') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        if (!tab?.id) throw new Error('No active tab');
        const data = await extractFromTab(tab.id);
        sendResponse({ ok: true, data, tabId: tab.id });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'open-library') {
    getSettings().then(({ appBase }) => chrome.tabs.create({ url: appBase }));
  }
});
