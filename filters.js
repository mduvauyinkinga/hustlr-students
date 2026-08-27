/**
 * filters.js — Reusable, config-driven filter pipeline for HUSTLR.
 *
 * Framework-independent. No DOM access. No Firebase imports.
 *
 * Supported filters:
 *   category, priceMin, priceMax, available, delivery, collection, openNow
 *
 * Usage:
 *   import { applyFilters, createFilterState, FILTER_KEYS } from "./filters.js";
 *
 *   let state = createFilterState();
 *   state.category = "Food";
 *   state.delivery = true;
 *   const result = applyFilters(stores, state);
 *
 * Adding a new filter = adding one entry to FILTER_DEFS (modular, no hardcoding).
 */

/** Canonical filter keys — import these to avoid typos. */
export const FILTER_KEYS = Object.freeze({
  CATEGORY: "category",
  PRICE_MIN: "priceMin",
  PRICE_MAX: "priceMax",
  AVAILABLE: "available",
  DELIVERY: "delivery",
  COLLECTION: "collection",
  OPEN_NOW: "openNow"
});

/**
 * Filter definitions. Each entry:
 *   { key, test(item, state) -> boolean }
 * An item passes if EVERY def passes (filters combine additively/AND).
 *
 * State values:
 *   category  — "all" or a specific category string
 *   priceMin / priceMax — number (0/empty = no bound)
 *   available / delivery / collection / openNow — booleans (false = inactive)
 */
export const FILTER_DEFS = Object.freeze([
  {
    key: FILTER_KEYS.CATEGORY,
    test: (item, state) => {
      const cat = state[FILTER_KEYS.CATEGORY];
      if (!cat || cat === "all") return true;
      return String(item.category || "").toLowerCase() === String(cat).toLowerCase();
    }
  },
  {
    key: FILTER_KEYS.PRICE_MIN,
    test: (item, state) => {
      const min = Number(state[FILTER_KEYS.PRICE_MIN]);
      if (!min || isNaN(min) || min <= 0) return true;
      return (Number(item.price) || 0) >= min;
    }
  },
  {
    key: FILTER_KEYS.PRICE_MAX,
    test: (item, state) => {
      const max = Number(state[FILTER_KEYS.PRICE_MAX]);
      if (!max || isNaN(max) || max <= 0) return true;
      return (Number(item.price) || 0) <= max;
    }
  },
  {
    key: FILTER_KEYS.AVAILABLE,
    test: (item, state) => {
      if (!state[FILTER_KEYS.AVAILABLE]) return true;
      return item.available !== false;
    }
  },
  {
    key: FILTER_KEYS.DELIVERY,
    test: (item, state) => {
      if (!state[FILTER_KEYS.DELIVERY]) return true;
      return item.deliveryAvailable === true;
    }
  },
  {
    key: FILTER_KEYS.COLLECTION,
    test: (item, state) => {
      if (!state[FILTER_KEYS.COLLECTION]) return true;
      return item.collectionAvailable === true;
    }
  },
  {
    key: FILTER_KEYS.OPEN_NOW,
    test: (item, state) => {
      if (!state[FILTER_KEYS.OPEN_NOW]) return true;
      return item.isOpen === true;
    }
  }
]);

/**
 * Apply all active filters to an item list (AND composition).
 * @param {Array<T>} items
 * @param {Object} [filterState]
 * @returns {Array<T>}
 */
export function applyFilters(items, filterState = {}) {
  const state = filterState || {};
  return items.filter((item) =>
    FILTER_DEFS.every((def) => def.test(item, state))
  );
}

/**
 * Create a fresh, empty filter state.
 * @returns {Object}
 */
export function createFilterState() {
  return {
    category: "all",
    priceMin: "",
    priceMax: "",
    available: false,
    delivery: false,
    collection: false,
    openNow: false
  };
}

/**
 * Reset a filter state in place to its default values.
 * @param {Object} state
 */
export function resetFilterState(state) {
  if (!state) return;
  Object.assign(state, createFilterState());
}

/**
 * Count how many filters are currently active (for badge display).
 * @param {Object} state
 * @returns {number}
 */
export function getActiveFilterCount(state) {
  if (!state) return 0;
  let count = 0;
  if (state.category && state.category !== "all") count++;
  if (Number(state.priceMin) > 0) count++;
  if (Number(state.priceMax) > 0) count++;
  if (state.available) count++;
  if (state.delivery) count++;
  if (state.collection) count++;
  if (state.openNow) count++;
  return count;
}

