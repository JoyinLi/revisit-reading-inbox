# v0.6 — X Smart Capture

This release adds a no-model X capture pipeline.

## Added

- Detects text posts, website shares, native/external video posts, and image posts.
- Resolves `t.co` redirects through the local server.
- Fetches destination website title, description, cover image, author, and readable article body when available.
- Recognizes common external video services from their links/domains and stores a cover plus direct playback link.
- Saves X author, handle, and original post text as sharing context.
- Uses separate rich resource presentation in Library and Reader.
- Preserves user-edited titles; untouched titles prefer the destination resource title.
- Searches X resource metadata and post context.

## Not included

- AI summaries or translation
- Video download, transcription, or subtitle extraction
- Image understanding
- Thread summarization
