import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
export const mediaDir = path.join(dataDir, 'media');
const mediaIndexPath = path.join(dataDir, 'media-index.json');
fs.mkdirSync(mediaDir, { recursive: true });

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_SCREENSHOT_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_CACHED_IMAGES_PER_CAPTURE = 60;
const NORMAL_MAX_EDGE = 1600;
const LONG_IMAGE_MAX_EDGE = 2400;
const NORMAL_WEBP_QUALITY = 80;
const LONG_IMAGE_WEBP_QUALITY = 82;

const WEBSITE_SCREENSHOT_TARGET_BYTES = 500 * 1024;
const WEBSITE_SCREENSHOT_HARD_LIMIT_BYTES = 2 * 1024 * 1024;
const WEBSITE_SCREENSHOT_MAX_WIDTH = 1440;
const WEBSITE_SCREENSHOT_MAX_HEIGHT = 1000;

type MediaIndex = Record<string, string>;

function loadMediaIndex(): MediaIndex {
  try {
    const parsed = JSON.parse(fs.readFileSync(mediaIndexPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

const mediaIndex = loadMediaIndex();

function persistMediaIndex() {
  fs.writeFileSync(mediaIndexPath, `${JSON.stringify(mediaIndex, null, 2)}\n`);
}

function localUrl(filename: string) {
  return `/media/${encodeURIComponent(filename)}`;
}

function filenameFromLocalUrl(url: string) {
  if (!url.startsWith('/media/')) return null;
  try {
    return decodeURIComponent(url.slice('/media/'.length));
  } catch {
    return url.slice('/media/'.length);
  }
}

async function fetchWithTimeout(url: string, pageUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36 ReadingInbox/0.8',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: pageUrl
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function renderWebp(bytes: Buffer, maxEdge: number, quality: number, animated: boolean) {
  const createPipeline = (keepAnimation: boolean) => sharp(bytes, {
    animated: keepAnimation,
    limitInputPixels: 150_000_000,
    failOn: 'none'
  })
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({
      quality,
      effort: 4,
      smartSubsample: true
    });

  try {
    return await createPipeline(animated).toBuffer();
  } catch (error) {
    if (!animated) throw error;
    return createPipeline(false).toBuffer();
  }
}

async function optimizeImage(bytes: Buffer) {
  const probe = sharp(bytes, { animated: true, limitInputPixels: 150_000_000, failOn: 'none' });
  const metadata = await probe.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  const shortestEdge = Math.max(1, Math.min(width || 1, height || 1));
  const longestEdge = Math.max(width, height);
  const aspectRatio = longestEdge / shortestEdge;
  const isLongOrDetailHeavy = aspectRatio >= 3;
  const maxEdge = isLongOrDetailHeavy ? LONG_IMAGE_MAX_EDGE : NORMAL_MAX_EDGE;
  const quality = isLongOrDetailHeavy ? LONG_IMAGE_WEBP_QUALITY : NORMAL_WEBP_QUALITY;
  const animated = (metadata.pages ?? 1) > 1;
  const output = await renderWebp(bytes, maxEdge, quality, animated);

  return { output, width, height, maxEdge, quality, animated };
}

export async function cacheRemoteImage(sourceUrl: string, pageUrl: string) {
  if (sourceUrl.startsWith('/media/')) return sourceUrl;

  const indexedFilename = mediaIndex[sourceUrl];
  if (indexedFilename && fs.existsSync(path.join(mediaDir, indexedFilename))) {
    return localUrl(indexedFilename);
  }

  try {
    const response = await fetchWithTimeout(sourceUrl, pageUrl);
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`Unexpected image content type: ${contentType || 'unknown'}`);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_IMAGE_BYTES) throw new Error('Image is too large');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Image is too large');

    const optimized = await optimizeImage(bytes);
    const contentHash = crypto.createHash('sha256').update(optimized.output).digest('hex').slice(0, 32);
    const filename = `${contentHash}.webp`;
    const outputPath = path.join(mediaDir, filename);
    if (!fs.existsSync(outputPath)) fs.writeFileSync(outputPath, optimized.output);

    mediaIndex[sourceUrl] = filename;
    persistMediaIndex();

    const savedPercent = bytes.byteLength > 0
      ? Math.round((1 - optimized.output.byteLength / bytes.byteLength) * 100)
      : 0;
    console.log(
      `Cached image ${optimized.width || '?'}×${optimized.height || '?'} as WebP ` +
      `(${Math.round(bytes.byteLength / 1024)} KB → ${Math.round(optimized.output.byteLength / 1024)} KB, ${savedPercent}% smaller)`
    );
    return localUrl(filename);
  } catch (error) {
    console.warn(`Could not cache image ${sourceUrl}:`, error);
    return sourceUrl;
  }
}

function decodeScreenshotDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('Unsupported screenshot format');
  const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (!bytes.length || bytes.byteLength > MAX_SCREENSHOT_INPUT_BYTES) throw new Error('Screenshot is too large');
  return bytes;
}

type ScreenshotCandidate = { width: number; height: number; quality: number };

async function encodeWebsiteScreenshot(bytes: Buffer) {
  const candidates: ScreenshotCandidate[] = [
    { width: WEBSITE_SCREENSHOT_MAX_WIDTH, height: WEBSITE_SCREENSHOT_MAX_HEIGHT, quality: 76 },
    { width: WEBSITE_SCREENSHOT_MAX_WIDTH, height: WEBSITE_SCREENSHOT_MAX_HEIGHT, quality: 68 },
    { width: 1320, height: 920, quality: 70 },
    { width: 1240, height: 860, quality: 64 },
    { width: 1120, height: 800, quality: 60 },
    { width: 1000, height: 720, quality: 54 }
  ];

  let smallest: Buffer | null = null;
  for (const candidate of candidates) {
    const output = await sharp(bytes, { limitInputPixels: 150_000_000, failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({
        width: candidate.width,
        height: candidate.height,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: candidate.quality, effort: 5, smartSubsample: true })
      .toBuffer();

    if (!smallest || output.byteLength < smallest.byteLength) smallest = output;
    if (output.byteLength <= WEBSITE_SCREENSHOT_TARGET_BYTES) return output;
  }

  if (!smallest) throw new Error('Could not encode screenshot');
  if (smallest.byteLength > WEBSITE_SCREENSHOT_HARD_LIMIT_BYTES) {
    const emergency = await sharp(bytes, { limitInputPixels: 150_000_000, failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 900, height: 650, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 45, effort: 6, smartSubsample: true })
      .toBuffer();
    if (emergency.byteLength > WEBSITE_SCREENSHOT_HARD_LIMIT_BYTES) throw new Error('Screenshot cannot be reduced below 2 MB');
    return emergency;
  }
  return smallest;
}

async function saveWebsiteScreenshotBytes(bytes: Buffer) {
  const output = await encodeWebsiteScreenshot(bytes);
  const contentHash = crypto.createHash('sha256').update(output).digest('hex').slice(0, 32);
  const filename = `website-${contentHash}.webp`;
  const outputPath = path.join(mediaDir, filename);
  if (!fs.existsSync(outputPath)) fs.writeFileSync(outputPath, output);
  console.log(`Saved website screenshot (${Math.round(bytes.byteLength / 1024)} KB → ${Math.round(output.byteLength / 1024)} KB)`);
  return localUrl(filename);
}

export async function cacheWebsiteScreenshot(dataUrl: string) {
  return saveWebsiteScreenshotBytes(decodeScreenshotDataUrl(dataUrl));
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export async function captureWebsiteScreenshot(url: string) {
  const executable = findChromeExecutable();
  if (!executable) throw new Error('Chrome executable was not found');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revisit-site-shot-'));
  const screenshotPath = path.join(tempDir, 'website.png');
  const profilePath = path.join(tempDir, 'profile');
  fs.mkdirSync(profilePath, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profilePath}`,
    `--window-size=${WEBSITE_SCREENSHOT_MAX_WIDTH},${WEBSITE_SCREENSHOT_MAX_HEIGHT}`,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=4500',
    `--screenshot=${screenshotPath}`,
    url
  ];
  if (process.platform === 'linux') args.unshift('--disable-dev-shm-usage', '--no-sandbox');

  try {
    try {
      await execFileAsync(executable, args, { timeout: 25_000, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      // Some Chrome builds keep the headless process alive briefly after the
      // screenshot is written. Accept the file if it already exists.
      if (!fs.existsSync(screenshotPath)) throw error;
    }
    if (!fs.existsSync(screenshotPath)) throw new Error('Chrome did not create a screenshot');
    const bytes = fs.readFileSync(screenshotPath);
    return await saveWebsiteScreenshotBytes(bytes);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function pruneUnusedMedia(referencedUrls: Array<string | null | undefined>) {
  const referenced = new Set(
    referencedUrls
      .map((url) => url ? filenameFromLocalUrl(url) : null)
      .filter((value): value is string => Boolean(value))
  );

  let removedFiles = 0;
  for (const filename of fs.readdirSync(mediaDir)) {
    const absolutePath = path.join(mediaDir, filename);
    if (!fs.statSync(absolutePath).isFile() || referenced.has(filename)) continue;
    fs.unlinkSync(absolutePath);
    removedFiles += 1;
  }

  let indexChanged = false;
  for (const [sourceUrl, filename] of Object.entries(mediaIndex)) {
    if (!referenced.has(filename) || !fs.existsSync(path.join(mediaDir, filename))) {
      delete mediaIndex[sourceUrl];
      indexChanged = true;
    }
  }
  if (indexChanged) persistMediaIndex();
  return removedFiles;
}

export type IncomingContentBlock = {
  kind: string;
  text?: string;
  imageUrl?: string;
  alt?: string;
  caption?: string;
};

export async function localizeContentImages(blocks: IncomingContentBlock[], pageUrl: string) {
  const result = blocks.map((block) => ({ ...block }));
  const imageIndexes = result
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.kind === 'image' && block.imageUrl)
    .slice(0, MAX_CACHED_IMAGES_PER_CAPTURE);

  const concurrency = 4;
  for (let start = 0; start < imageIndexes.length; start += concurrency) {
    const group = imageIndexes.slice(start, start + concurrency);
    const localized = await Promise.all(group.map(({ block }) => cacheRemoteImage(block.imageUrl!, pageUrl)));
    group.forEach(({ index }, groupIndex) => {
      result[index].imageUrl = localized[groupIndex];
    });
  }
  return result;
}
