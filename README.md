# Quiet Reader

A small, local-first Manifest V3 Chrome extension for reading articles and keeping private highlights with optional notes. No account, server, or background service worker.

## Load in Chrome

1. Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**.
2. Select the `quiet-reader` folder (the one containing `manifest.json`).
3. Open an `http` or `https` article and click **Quiet Reader** → **Open in Reader**.
4. Select text in the article to reveal two quiet actions: **Highlight** or **Comment**. Highlights sit directly on the article text. Comments appear as handwritten cards in the side annotation rail and connect back to their highlighted passage with a fine curved line. Your saved articles are listed in the popup.
5. Choose **Download** in the reader header to save a compact, self-contained HTML copy containing only the sanitized article text, highlights, and comments. The copy can be opened later or printed without the extension.

Chrome restricts extensions on browser-internal pages, the Chrome Web Store, local files, and some protected pages. If extraction fails, the popup explains why and does not save an empty document. Some paywalled or app-like pages may not expose readable article content.

## Browser demo without installing

Open `reader.html?demo=1` directly in a browser (or serve this directory with a static file server and visit `/reader.html?demo=1`). The sample article exercises selection, notes, themes, progress, and local persistence using browser `localStorage`. Use `reader.html?demo=comments` to preview a seeded handwritten side comment and its curved connector. The demo uses a fictional URL, so its **View original** link is illustrative. The extension itself uses `chrome.storage.local`.

## Design and storage

The page content script extracts a cloned page with Mozilla Readability, sanitizes HTML with DOMPurify, and saves the sanitized source. The reader sanitizes it again before rendering. Highlights and comments are separate records: highlights store an exact quote plus up to 48 characters of prefix and suffix, while comments store their own anchor, a link to the related highlight when one exists, and plain-text comment content. On each change, the reader re-renders the clean source and maps quotes onto text nodes with a TreeWalker. No annotation markup is persisted, and anchors can be ambiguous when the source changes substantially. Source URLs are stored with each article; copied quotes include the URL. Existing MVP annotations with an optional note are migrated into one highlight and one independent comment on first load. Downloads rebuild the clean source in memory, add annotation markup only to the exported copy, and do not alter the saved article.

The extension stores articles, notes, theme, and reading progress on this device. Data is not encrypted and Chrome's local extension storage is not a secret vault. To clear all data, remove the extension's site data in Chrome.

## Files

`manifest.json`, `popup.*`, `content.js`, `reader.*`, and `anchors.js` are the app. `lib/Readability.js` is Mozilla Readability 0.6.0 (Apache-2.0), and `lib/DOMPurify.js` is DOMPurify 3.2.6 (Apache-2.0 / MPL-2.0); license files are alongside them. Dependencies are vendored so the unpacked extension works offline and complies with MV3's no-remotely-hosted-code rule.

## Quick checks

From the project root: `node --check quiet-reader/content.js && node --check quiet-reader/popup.js && node --check quiet-reader/anchors.js && node --check quiet-reader/reader.js && node -e "JSON.parse(require('fs').readFileSync('quiet-reader/manifest.json'))"`. To test quote anchoring and sanitization in a browser, open `tests/smoke.html` and look for `PASS`.