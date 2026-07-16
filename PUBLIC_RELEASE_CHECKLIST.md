# Public release checklist

Before pushing a release:

- [ ] `apps/server/data/` is absent from the commit.
- [ ] No `.env`, API key, access token, cookie, browser profile, or private certificate is included.
- [ ] No absolute local file paths, personal email addresses, phone numbers, or saved-content exports are included.
- [ ] `npm install` and `npm run build` pass from a clean checkout.
- [ ] The Chrome extension loads from `apps/extension`.
- [ ] The `LICENSE` file and README license section are present.
