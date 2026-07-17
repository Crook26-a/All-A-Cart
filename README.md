# My Price Book 🧾

A grocery price comparison app. Log an item's price at each store, compare by
plain price or by **$/oz** (and other units), track **sale vs regular** prices,
build a basket to see the total at each store, and see which store is cheapest
for what. Everything is stored on your device; back up and restore via a JSON file.

Built as an offline-capable PWA in the same style as My Scorebook — no build step,
no dependencies, no server needed.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page shell + all styling |
| `app.js` | All app logic |
| `sw.js` | Service worker (offline caching) |
| `manifest.webmanifest` | Makes it installable to a home screen |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | App icons |

Keep all files in the same folder — paths are relative.

## Put it on GitHub Pages

**Option A — a new repo (simplest):**
1. Create a new repository on GitHub (e.g. `price-book`).
2. Upload all the files in this folder to the repo root (drag-and-drop works:
   *Add file → Upload files*).
3. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy
   from a branch**, branch **main**, folder **/ (root)**. Save.
4. Wait a minute, then open `https://<your-username>.github.io/price-book/`.

**Option B — a subfolder of an existing repo (e.g. alongside your Scorebook):**
1. In your existing Pages repo, create a folder like `pricebook/`.
2. Upload all these files into that folder.
3. Open `https://<your-username>.github.io/<repo>/pricebook/`.

Because the app uses relative paths and a scoped service worker, a subfolder works
fine without changes.

## Install to your phone

Open the Pages URL in Safari (iPhone) or Chrome (Android) and choose **Add to Home
Screen**. It then launches full-screen and works offline.

## Updating later

When you change `index.html` or `app.js`, bump the cache name in `sw.js`
(`pricebook-v1` → `pricebook-v2`) so installed copies pull the new version.

## Notes

- **Each vs per-unit:** each item is either priced *per package/each* or *per unit*.
  For per-unit items you enter the price and the size it covers at each store, and
  the app compares by $/unit — so a 20 oz jar and a 64 oz jug compare fairly.
- **Sale prices:** enter a Sale price alongside Reg and the sale price is used for
  comparisons, marked with a `sale` tag; the regular price shows struck as "was $X".
- **Incomplete baskets:** a store missing a basket item is flagged rather than
  ranked cheapest on a partial total.
- Your data is only on the device/browser you use. Use **Back up to a file**
  regularly, and **Restore from backup** to move it or merge it elsewhere.
