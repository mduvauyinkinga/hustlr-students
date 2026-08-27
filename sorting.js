/**
 * sorting.js — Reusable in-memory sorting for HUSTLR.
 *
 * Framework-independent. No DOM access. No Firebase imports.
 *
 * Supports: newest, oldest, price low→high, price high→low, alpha A→Z / Z→A.
 * Future-ready: popular, rating, best-selling (fall back to newest until data exists).
 *
 * Usage:
 *   import { applySort, SORT_OPTIONS } from "./sorting.js";
 *   const sorted = applySort(items, "price_asc");
 */

export const SORT_KEYS = Object.freeze({
  NEWEST: "newest",
  OLDEST: "oldest",
  PRICE_LOW_HIGH: "price_asc",
  PRICE_HIGH_LOW: "price_desc",
  ALPHA_ASC: "alpha_asc",
  ALPHA_DESC: "alpha_desc",
  POPULAR: "popular",
  RATING: "rating",
  BEST_SELLING: "bestselling"
});

/**
 * Sort options — used to render <select> / menu options and labels.
 * A single array drives every sorting control across the app.
 */
export const SORT_OPTIONS = Object.freeze([
  { key: SORT_KEYS.NEWEST, label: "Newest" },
  { key: SORT_KEYS.OLDEST, label: "Oldest" },
  { key: SORT_KEYS.PRICE_LOW_HIGH, label: "Price: Low to High" },
  { key: SORT_KEYS.PRICE_HIGH_LOW, label: "Price: High to Low" },
  { key: SORT_KEYS.ALPHA_ASC, label: "Name: A to Z" },
  { key: SORT_KEYS.ALPHA_DESC, label: "Name: Z to A" },
  { key: SORT_KEYS.POPULAR, label: "Most Popular" },
  { key: SORT_KEYS.RATING, label: "Highest Rated" },
  { key: SORT_KEYS.BEST_SELLING, label: "Best Selling" }
]);

/**
 * Normalise a Firestore timestamp / Date / string / number to epoch ms.
 * @param {*} value
 * @returns {number}
 */
function getTime(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime() || 0;
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === "string") return new Date(value).getTime() || 0;
  if (typeof value === "number") return value;
  return 0;
}

/**
 * Get the display "name" for an item — works for both products (name)
 * and stores (storeName).
 * @param {Object} item
 * @returns {string}
 */
function getItemName(item) {
  return String(item.name || item.storeName || "");
}

/**
 * Sort a copy of items in place by the given sort key.
 * Returns a NEW array (input is not mutated).
 *
 * @param {Array<T>} items
 * @param {string} key — one of SORT_KEYS
 * @returns {Array<T>}
 */
export function applySort(items, key) {
  const list = [...items];

  switch (key) {
    case SORT_KEYS.NEWEST:
      return list.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));

    case SORT_KEYS.OLDEST:
      return list.sort((a, b) => getTime(a.createdAt) - getTime(b.createdAt));

    case SORT_KEYS.PRICE_LOW_HIGH:
      return list.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

    case SORT_KEYS.PRICE_HIGH_LOW:
      return list.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));

    case SORT_KEYS.ALPHA_ASC:
      return list.sort((a, b) => getItemName(a).localeCompare(getItemName(b)));

    case SORT_KEYS.ALPHA_DESC:
      return list.sort((a, b) => getItemName(b).localeCompare(getItemName(a)));

    // ── Future-ready sort keys ──────────────────────────────────
    // Once data exists (salesCount, rating, reviewCount), replace the
    // fallback comparator below with the real one. Kept additive so
    // pages can render these options today without breaking.
    case SORT_KEYS.POPULAR:
      return list.sort((a, b) => (Number(b.salesCount) || 0) - (Number(a.salesCount) || 0)
        || getTime(b.createdAt) - getTime(a.createdAt));

    case SORT_KEYS.RATING:
      return list.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0)
        || (Number(b.reviewCount) || 0) - (Number(a.reviewCount) || 0)
        || getTime(b.createdAt) - getTime(a.createdAt));

    case SORT_KEYS.BEST_SELLING:
      return list.sort((a, b) => (Number(b.salesCount) || 0) - (Number(a.salesCount) || 0)
        || getTime(b.createdAt) - getTime(a.createdAt));

    default:
      return list.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
  }
}

/**
 * Get the human label for a sort key (for UI display).
 * @param {string} key
 * @returns {string}
 */
export function getSortLabel(key) {
  const opt = SORT_OPTIONS.find((o) => o.key === key);
  return opt ? opt.label : SORT_OPTIONS[0].label;
}

