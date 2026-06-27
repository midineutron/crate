# Status: done

## Changes Made

### New files
- `www/js/cookies.js` — Restored from upstream/main (unchanged API): `hasValidCookies()`, `setSignedCookies()`, `clearAllCookies()`

### Modified files
- `www/js/config.js` — Added `COOKIE_NAMES`, `PASSWORD`, `AUTH_MODE` (from `SITE.authMode || 'cloudfront'`), and `SIGNED_COOKIES` placeholder with `// COOKIES_PLACEHOLDER` marker for deploy-cookies.py
- `www/js/site.config.js` — Added `authMode: 'cloudfront'` default fallback
- `tools/build-config.js` — Added `authMode: frontmatter.authMode || 'cloudfront'` to siteObj
- `site.md` — Added `authMode: proxy` to frontmatter (keeps fork's proxy behavior)
- `www/js/konami.js` — Added `unlockSecret()` dispatch: cloudfront -> setSignedCookies + local toggle; proxy -> local toggle only (lazy import of cookies.js to avoid bundling in proxy mode)
- `www/js/player.js` — Added lazy cookie helpers; `resetApp()` and `fullResetApp()` call `clearAllCookies()` in cloudfront mode; `handleEnter()` calls `setSignedCookies()` in cloudfront mode
- `README.md` — Added "Deployment topologies" section

## Behavior

### authMode=proxy (site.md → current fork deployment)
- No client cookie code runs
- Konami/B+A: local secret-mode toggle only (no network/cookie calls)
- handleEnter: unlockAudio() + startPlayer() (no cookie logic)
- resetApp/fullResetApp: no cookie clearing
- EXACTLY matches current fork behavior

### authMode=cloudfront (default; upstream-safe)
- cookies.js loaded; SIGNED_COOKIES placeholder present for deploy-cookies.py
- Konami/B+A: setSignedCookies() + local secret toggle
- handleEnter: setSignedCookies() on entry
- resetApp/fullResetApp: clearAllCookies() before redirect

## Verified
- `node tools/build-config.js` succeeds
- `node tools/obfuscate.js` succeeds (17 files, dist/ built)
- dist/js/site.config.js correctly shows authMode: "proxy"
- dist/js/config.js has COOKIES_PLACEHOLDER and SIGNED_COOKIES = null
- deploy-cookies.py regex `(export )?const SIGNED_COOKIES = null;` matches config.js format
- voice.js not imported anywhere (constraint honored)
- crate-auth/ untouched
- No new dependencies added
