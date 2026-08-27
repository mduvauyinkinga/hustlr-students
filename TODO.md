# Homepage Image Consistency Fix

## Goal
Ensure images on the home page (featured stores & featured products) are consistent, don't overlap, and don't look out of proportion when users scroll or view the page.

## Root Cause
- `index.html` renders `.store-card` and `.product-card` components, but **does not load `browse-stores.css`**, which contains ALL the store-card styles (banner height, `overflow: hidden`, circular logo overlay, card layout).
- Without those styles, store banner/logo images render at natural size → oversized, overlapping, out of proportion.
- `styles.css` uses `max-height: 220px` for `.product-card-image` instead of a fixed height, making product images inconsistent.

## Steps

- [x] **1. `index.html`** — Add `<link rel="stylesheet" href="browse-stores.css">` so store-card component styles (fixed banner height, object-fit cover, overflow hidden, circular logo) load on the homepage.
- [x] **2. `styles.css`** — Replace `.product-card-image { max-height: 220px }` with a fixed `height: 200px`, and add matching fixed height for `.product-card-image-placeholder` so product images are always consistent.
- [x] **3. `components.css`** — Add defensive guards: `overflow: hidden` + `aspect-ratio: 16/10` on `.product-card-media`, `height: 100%` fill for image/placeholder, reset legacy `margin`/`border-radius`, and remove the conflicting mobile `height: 180px` overrides.
- [x] **4. Verify** — Open `index.html` in browser; confirm featured store/product images are consistent, non-overlapping, and proportionate.

## All tasks completed ✅

## Notes
- `browse-stores.css` is a shared stylesheet already used by `discover.html` and `browse-stores.html` for the same card components, so adding it to the homepage keeps card styling consistent site-wide.

