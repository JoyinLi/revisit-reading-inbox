# Revisit v1.0

**Save now. Return with intention.**

> **Current stable release: v1.0**

Revisit 用于收集看到但暂时没有时间仔细阅读 / 浏览的文章、网站、设计效果图等。通过 Chrome 插件对内容进行本地保存，在 Web App 上可以直接阅读带图文的文章，并进行标注、笔记的编写、支持连接三方模型 API 对内容进行快速总结。解决待读取 / 浏览的内容太多，平台太分散，容易遗漏忘记的问题。

A local-first Web App plus Chrome extension for saving cross-platform reading, preserving websites and articles, highlighting passages, writing notes, and returning to what matters.

## Version policy

Stable versions are preserved instead of being overwritten:

- **v1.0** — the first stable local-first release, permanently preserved on the [`v1.0`](https://github.com/JoyinLi/revisit-reading-inbox/tree/v1.0) branch.
- **main** — points to the latest stable version.
- Future major releases, such as **v2.0**, will have their own preserved version branch so v1.0 and v2.0 remain independently accessible.

## Included

- Library with Unread / Reading / Read / Archived states
- Source and full-text search
- Article extraction with a link-only fallback
- WeChat text and inline images preserved in their original reading order
- X Smart Capture detects text posts, native/external videos, image posts, and shared websites without using an AI model
- `t.co` links are resolved by the local server; shared website metadata and readable article content are fetched from the destination when available
- X Library/Reader views separate the primary resource from the author’s original post context
- Local image copies are converted to WebP, resized, content-hash deduplicated, and cleaned up when no saved item references them
- Delete any nonessential inline or X preview image directly from Reader; the local file is removed after its final saved-content reference is gone
- Reader view with persistent reading position
- Edit saved article titles directly in Reader view
- Text highlights with multiple independent notes per highlight
- One unified **My notes** area for page notes and highlight-linked notes
- Click a linked note to jump back to its highlighted passage
- One confirmation dialog before deleting any note
- Highlights review page
- Multiple page-level notes; every save creates a new note
- Chinese `Your takeaways` summary rebuilt from all notes
- Third-party model API connection path for fast content summaries
- Chrome popup: edit the article name, choose a status, and save the current page with an optional note
- Chrome context menus: save a page, selected text, link, or image
- Local JSON data store; no account, paid service, or API key


## Data privacy

Revisit is local-first. Saved URLs, extracted article text, website screenshots, images, highlights, notes, and reading history are stored under `apps/server/data` on your computer. That directory is excluded from Git by default.

Do not commit or publish:

- `apps/server/data/reading-inbox.json`
- `apps/server/data/media/`
- `apps/server/data/media-index.json`
- `.env` files, API keys, cookies, tokens, browser profiles, or exported user data

The public repository contains source code and documentation only. It does not contain personal saved content or local media.

## License

Revisit is released under the [MIT License](LICENSE). You may use, copy, modify, distribute, and commercially reuse the code, provided that the copyright notice and license text remain included. The software is provided as-is, without warranty.

## Requirements

- Node.js 20.19+ (Node 22 works well)
- Chrome

## 1. Run the Web App

```bash
cd revisit-reading-inbox
npm install
npm run dev
```

Open:

- Web App: http://localhost:5173
- API health check: http://localhost:8787/api/health

The local data file is created at `apps/server/data/reading-inbox.json`.

## 2. Install the Chrome extension locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `revisit-reading-inbox/apps/extension`.
5. Pin **Revisit** to the Chrome toolbar.
6. Keep `npm run dev` running while using the local version.

The extension defaults to:

- API: `http://localhost:8787`
- Web App: `http://localhost:5173`

These addresses can be changed from the extension's **Connection settings** page after deployment.

## Core workflow

1. Open an article or a specific X post in Chrome.
2. Click the Revisit extension.
3. Edit **Article name** when needed, add an optional note, and choose **Save page**.
4. Open the Library.
5. Select text in Reader view, attach an optional first note, and press **Save highlight**.
6. Hover an article image and use its delete button when the image is not worth keeping. Confirm once; the image disappears from the saved article and its unreferenced local file is cleaned up.
7. Click any highlighted passage to link the **My notes** editor to it. All notes remain in one list; click a linked note to jump back to the passage. Note deletion requires one confirmation dialog.
8. Review the Chinese **Your takeaways** section and all saved passages in **Highlights**.

## v1.0 limitations

- This build is single-user and local to one Mac.
- X Smart Capture works best on a specific post page (`x.com/.../status/...`). X can change its DOM at any time; if detection fails, the original post link and editable title are still saved.
- Pinterest, login-only pages, and other heavily scripted pages may still be saved as a post/link rather than a clean article.
- Up to 60 article images per save are copied into the local `apps/server/data/media` folder. Normal images are converted to WebP at quality 80 with a 1600 px maximum edge; very long images use a 2400 px maximum edge and quality 82 to keep diagrams readable. Identical image content is stored only once, even when it appears under different URLs. If a CDN image cannot be downloaded, the Reader keeps its original URL as a fallback. Each Reader image has a manual delete action. Deleting an image removes it from that saved item immediately; the local file is deleted when no other item references the same deduplicated file.
- Highlight selection is intentionally limited to one paragraph at a time so positions remain stable.
- Cloud sync, login, mobile capture, OCR, AI summaries, and automatic topic linking are intentionally excluded from this MVP.

## Next production step

After the local workflow proves useful, replace the local JSON store with hosted Postgres/Supabase and deploy the Web App/API. The extension already has editable server addresses, so it will not need a workflow redesign.

## Language behavior

- Original titles and article bodies are preserved in their source language. English content stays English; Chinese content stays Chinese.
- The Library preview and Reader `Summary` field are reserved for a Chinese summary so mixed-language content can be scanned quickly.
- Navigation, filters, buttons and other product UI remain in English.
- Highlights always quote the original text without translation.
- This local v1.0 release does not connect to a paid AI summarization provider. The Chinese content summary remains editable. `Your takeaways` currently uses a transparent local aggregation rule over your notes; it can later be replaced by a model-generated semantic summary after a provider and cost are approved.

## WeChat article extraction

Version 0.5 reads the rendered WeChat article body directly from Chrome (`#js_content` / `.rich_media_content`), accepts short Chinese paragraphs, and saves inline images in their original position between paragraphs. The extension popup reports both readable text sections and detected image count before saving.

After replacing the extension files, open `chrome://extensions` and click **Reload**. Then refresh the WeChat article tab before opening the extension. If the item was previously saved as link-only or text-only, saving it again enriches the existing item with readable text and inline images instead of creating a duplicate. Text block IDs are reused when possible so existing highlights keep working.

Image files are stored in `apps/server/data/media`. New or re-saved articles use compressed WebP copies; images saved by older builds remain unchanged until the article is saved again. A complete backup includes `reading-inbox.json`, the `media` folder, and optionally `media-index.json` (the index can be rebuilt by re-saving content).

## X Smart Capture (no model required)

Version 0.6 reads the currently visible X post directly from Chrome and classifies it as one of four resource types:

- **Text post** — saves the post text as the readable content.
- **Website share** — resolves `t.co`, fetches the destination title, description, cover image, and readable article body when available. The external website becomes the primary resource; the X post remains as sharing context.
- **Video post** — keeps the video poster/cover and a direct “Watch original” link. Native X video files are not downloaded. External video services such as YouTube, Vimeo, Loom, TikTok, and Bilibili are recognized from their links/domains and use the destination metadata when accessible.
- **Image post** — saves the visible X images through the existing compressed WebP pipeline.

The extension popup reports the detected type before saving. User-edited titles always win; when the title field is untouched, the destination website/video title is preferred over vague X copy.

This feature does not summarize, transcribe, translate, or interpret the resource. Those remain future model-backed capabilities.
