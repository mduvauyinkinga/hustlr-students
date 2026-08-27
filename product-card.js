/**
 * product-card.js — Reusable product card component for HUSTLR.
 *
 * Single source of truth for product card rendering across:
 *   - store.js (storefront)
 *   - discover.js (global product discovery)
 *   - product-details.js (related/suggested products)
 *   - seller products.js (seller management — Edit/Delete via options)
 *
 * Configurable through options — no hardcoded behaviour:
 *   - showStore: display store name row (default true)
 *   - showCategory: display category badge (default true)
 *   - showDescription: display truncated description (default true)
 *   - showAvailability: display availability badge (default false)
 *   - showAddToCart: display Add to Cart button (default true)
 *   - showDetails: display View Details button (default true)
 *   - storeMap: { [storeId]: { storeName } } — resolve store names without extra reads
 *   - storeName: fallback store name string
 *   - onAddToCart: async callback(productWithId) — default uses cart.js
 *   - extraActions: array of { label, className, onClick } — seller Edit/Delete etc.
 *
 * Future-ready: rating, favourite, promotional badges can be added by
 * extending renderBody/renderBadges without rewriting the card shell.
 */

import {
  addToCart,
  clearCart,
  getItemCount,
  formatPrice
} from "./cart.js";

// ── Badge helpers ─────────────────────────────────────────────────

/**
 * Create a small badge element.
 * @param {string} text
 * @param {string} className
 * @returns {HTMLElement}
 */
function createBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = "product-badge " + className;
  badge.textContent = text;
  return badge;
}

// ── Card shell ────────────────────────────────────────────────────

/**
 * Create the product card element.
 *
 * @param {Object} product - Product data from Firestore
 * @param {string} productId - Firestore document id
 * @param {Object} [options]
 * @returns {HTMLElement}
 */
export function createProductCard(product, productId, options = {}) {
  const {
    showStore = true,
    showCategory = true,
    showDescription = true,
    showAvailability = false,
    showAddToCart = true,
    showDetails = true,
    storeMap = null,
    storeName = "",
    onAddToCart = null,
    extraActions = []
  } = options;

  const id = productId || product.productId || product.id || "";

  const card = document.createElement("div");
  card.className = "product-card";
  card.dataset.productId = id;

  // ── Image (with placeholder fallback) ─────────────────────────
  const media = document.createElement("div");
  media.className = "product-card-media";

  if (product.imageURL) {
    const img = document.createElement("img");
    img.className = "product-card-image";
    img.src = String(product.imageURL);
    img.alt = String(product.name || "Product image");
    img.loading = "lazy";
    img.onerror = () => {
      img.style.display = "none";
      placeholder.style.display = "flex";
    };
    media.appendChild(img);

    const placeholder = document.createElement("div");
    placeholder.className = "product-card-image-placeholder";
    placeholder.textContent = "📦";
    placeholder.style.display = "none";
    media.appendChild(placeholder);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "product-card-image-placeholder";
    placeholder.textContent = "📦";
    media.appendChild(placeholder);
  }

  card.appendChild(media);

  // ── Body ──────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "product-card-body";

  // Name
  const nameEl = document.createElement("h3");
  nameEl.className = "product-card-name";
  nameEl.textContent = String(product.name || "Unnamed Product");
  body.appendChild(nameEl);

  // Store name
  if (showStore) {
    const resolvedName =
      (storeMap && product.storeId && storeMap[product.storeId]?.storeName) ||
      storeName ||
      "";
    if (resolvedName) {
      const storeEl = document.createElement("div");
      storeEl.className = "product-card-store";
      storeEl.textContent = String(resolvedName);
      body.appendChild(storeEl);
    }
  }

  // Category
  if (showCategory && product.category) {
    const categoryEl = document.createElement("div");
    categoryEl.className = "product-card-category";
    categoryEl.textContent = String(product.category);
    body.appendChild(categoryEl);
  }

  // Description
  if (showDescription && product.description) {
    const descEl = document.createElement("p");
    descEl.className = "product-card-description";
    descEl.textContent = String(product.description);
    body.appendChild(descEl);
  }

  // Availability badge
  if (showAvailability) {
    const isAvailable = product.available !== false;
    const availabilityEl = document.createElement("span");
    availabilityEl.className =
      "product-card-availability " + (isAvailable ? "available" : "unavailable");
    availabilityEl.textContent = isAvailable ? "● Available" : "● Unavailable";
    body.appendChild(availabilityEl);
  }

  card.appendChild(body);

  // ── Footer: price + actions ───────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "product-card-footer";

  const priceEl = document.createElement("div");
  priceEl.className = "product-card-price";
  priceEl.textContent = formatPrice(product.price);
  footer.appendChild(priceEl);

  const actions = document.createElement("div");
  actions.className = "product-card-actions";

  // Add to Cart
  if (showAddToCart && product.available !== false) {
    const addBtn = document.createElement("button");
    addBtn.className = "product-card-add-btn";
    addBtn.textContent = "Add";
    addBtn.type = "button";
    addBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const productWithId = { ...product, productId: id };

      if (typeof onAddToCart === "function") {
        await onAddToCart(productWithId, addBtn);
      } else {
        defaultAddToCart(productWithId, addBtn);
      }
    });
    actions.appendChild(addBtn);
  }

  // View Details
  if (showDetails) {
    const detailsLink = document.createElement("a");
    detailsLink.className = "product-card-details-btn";
    detailsLink.href = "product-details.html?id=" + encodeURIComponent(id);
    detailsLink.textContent = "View Details";
    detailsLink.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    actions.appendChild(detailsLink);
  }

  // Extra actions (seller management: Edit/Delete, etc.)
  if (Array.isArray(extraActions)) {
    extraActions.forEach((action) => {
      if (!action || typeof action.label !== "string") return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "product-card-extra-btn " + (action.className || "");
      btn.textContent = action.label;
      if (typeof action.onClick === "function") {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          action.onClick(id, product);
        });
      }
      actions.appendChild(btn);
    });
  }

  footer.appendChild(actions);
  card.appendChild(footer);

  return card;
}

// ── Default add-to-cart behaviour ─────────────────────────────────

/**
 * Default add-to-cart handler (matches existing store.js behaviour):
 * handles cross-store cart conflicts via confirm().
 *
 * @param {Object} productWithId - Product data with productId
 * @param {HTMLElement} btn
 * @returns {Promise<void>}
 */
export async function defaultAddToCart(productWithId, btn) {
  const storeId = productWithId.storeId || "";
  const storeName = productWithId.storeName || "";

  const result = addToCart(productWithId, storeId, storeName);

  if (result.conflict) {
    const confirmed = window.confirm(
      "Your cart contains items from another store. Clear cart and add this item?"
    );
    if (!confirmed) return;
    clearCart();
    addToCart(productWithId, storeId, storeName);
  }

  // Refresh cart count in nav (if present)
  const cartCount = document.getElementById("cartCount");
  if (cartCount) cartCount.textContent = getItemCount();

  showAddConfirmation(btn);
}

/**
 * Temporarily swap a button's label to "Added ✓".
 * @param {HTMLElement} btn
 */
export function showAddConfirmation(btn) {
  const originalText = btn.textContent;
  btn.textContent = "Added ✓";
  btn.style.background = "#22c55e";
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = "";
  }, 1200);
}

