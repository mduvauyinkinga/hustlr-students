/**
 * categories.js — Central category constants for HUSTLR.
 *
 * Single source of truth for store and product categories.
 * No page should hardcode a category list; import from here.
 *
 * Framework-independent. No DOM access. No Firebase imports.
 */

/** Business categories used when creating a store (create-store.html). */
export const STORE_CATEGORIES = Object.freeze([
  "Food",
  "Tutoring",
  "Electronics",
  "Repairs",
  "Beauty",
  "Clothing",
  "Printing",
  "Delivery",
  "Other"
]);

/** Product categories used when adding a product (add-product.html). */
export const PRODUCT_CATEGORIES = Object.freeze([
  "Meals",
  "Drinks",
  "Snacks",
  "Services",
  "Repairs",
  "Clothing",
  "Other"
]);

/**
 * Build a category chip list for filter buttons.
 * @param {string[]} categories
 * @param {string} allLabel
 * @returns {Array<{value: string, label: string}>}
 */
export function getCategoryOptions(categories = STORE_CATEGORIES, allLabel = "All") {
  return [{ value: "all", label: allLabel }].concat(
    categories.map((cat) => ({ value: cat, label: cat }))
  );
}

