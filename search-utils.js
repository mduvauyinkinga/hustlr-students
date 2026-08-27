/**
 * search-utils.js — Reusable search logic for HUSTLR.
 *
 * Single source of truth for text normalisation, tokenisation and
 * partial matching across arbitrary fields (name, description, category).
 *
 * Framework-independent. No DOM access. No Firebase imports.
 *
 * Usage:
 *   import { filterBySearch, debounce } from "./search-utils.js";
 *
 *   const results = filterBySearch(products, query, (p) => [p.name, p.description, p.category]);
 */

/**
 * Normalise text for search: lowercase, trim, collapse whitespace.
 * @param {*} value
 * @returns {string}
 */
export function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Split a query into word tokens.
 * Multi-word queries require every token to match (AND semantics).
 * @param {*} value
 * @returns {string[]}
 */
export function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

/**
 * Check whether every token partially matches any of the given fields.
 * @param {string[]} tokens - Pre-tokenised query
 * @param {Array<*>} targetFields - Fields to search (strings preferred)
 * @returns {boolean}
 */
export function matchesTokens(tokens, targetFields) {
  if (!tokens || tokens.length === 0) return true;
  const haystack = (targetFields || []).map(normalizeText).join(" ");
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Convenience wrapper: tokenise the query then match against fields.
 * @param {*} query - Raw search string
 * @param {Array<*>} targetFields
 * @returns {boolean}
 */
export function matchesQuery(query, targetFields) {
  return matchesTokens(tokenize(query), targetFields);
}

/**
 * Filter an array by a search query using a field extractor.
 * Returns the same array reference if the query is empty (fast path).
 *
 * @param {Array<T>} items
 * @param {*} query - Raw search string
 * @param {function(T): Array<*>} getFields - Returns searchable fields for an item
 * @returns {Array<T>}
 */
export function filterBySearch(items, query, getFields) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return items;
  return items.filter((item) => matchesTokens(tokens, getFields(item)));
}

/**
 * Debounce a function call. Returns a wrapped function.
 * @param {function} fn
 * @param {number} [delay=150] - ms
 * @returns {function}
 */
export function debounce(fn, delay = 150) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

