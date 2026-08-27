/**
 * store-card.js — Reusable store card component for HUSTLR.
 *
 * Single source of truth for store card rendering across:
 *   - browse-stores.js (browse stores grid)
 *   - discover.js (stores tab)
 *   - index.html homepage featured stores (optional)
 *
 * Displays: banner, logo, name, category, description, open/closed badge,
 * delivery badge, collection badge, product count (optional), rating (optional),
 * View Store button.
 *
 * Configurable through options:
 *   - showDescription (default true)
 *   - showProductCount (default false) — requires productCount in store data
 *   - showRating (default false) — displays average rating + review count
 *   - ctaLabel (default "View Store")
 */

import { createRatingStars } from "./rating-stars.js";

/**
 * Create a store card element.
 *
 * @param {Object} store - Store data from Firestore
 * @param {string} storeId - Firestore document id
 * @param {Object} [options]
 * @returns {HTMLElement}
 */
export function createStoreCard(store, storeId, options = {}) {
  const {
    showDescription = true,
    showProductCount = false,
    showRating = false,
    ctaLabel = "View Store"
  } = options;

  const card = document.createElement("div");
  card.className = "store-card";
  card.dataset.storeId = storeId;

  // ── Banner ────────────────────────────────────────────────────
  const bannerWrapper = document.createElement("div");
  bannerWrapper.className = "store-card-banner-wrapper";

  if (store.bannerURL) {
    const bannerImg = document.createElement("img");
    bannerImg.className = "store-card-banner";
    bannerImg.src = String(store.bannerURL);
    bannerImg.alt = String(store.storeName || "") + " banner";
    bannerImg.loading = "lazy";
    bannerImg.onerror = () => {
      bannerImg.style.display = "none";
      bannerPlaceholder.style.display = "flex";
    };
    bannerWrapper.appendChild(bannerImg);

    const bannerPlaceholder = document.createElement("div");
    bannerPlaceholder.className = "store-card-banner-placeholder";
    bannerPlaceholder.textContent = "🏪";
    bannerPlaceholder.style.display = "none";
    bannerWrapper.appendChild(bannerPlaceholder);
  } else {
    const bannerPlaceholder = document.createElement("div");
    bannerPlaceholder.className = "store-card-banner-placeholder";
    bannerPlaceholder.textContent = "🏪";
    bannerWrapper.appendChild(bannerPlaceholder);
  }

  card.appendChild(bannerWrapper);

  // ── Logo ──────────────────────────────────────────────────────
  const logoWrapper = document.createElement("div");
  logoWrapper.className = "store-card-logo-wrapper";

  if (store.logoURL) {
    const logoImg = document.createElement("img");
    logoImg.className = "store-card-logo";
    logoImg.src = String(store.logoURL);
    logoImg.alt = String(store.storeName || "") + " logo";
    logoImg.loading = "lazy";
    logoImg.onerror = () => {
      logoImg.style.display = "none";
      logoPlaceholder.style.display = "flex";
    };
    logoWrapper.appendChild(logoImg);

    const logoPlaceholder = document.createElement("div");
    logoPlaceholder.className = "store-card-logo-placeholder";
    logoPlaceholder.textContent = "🏪";
    logoPlaceholder.style.display = "none";
    logoWrapper.appendChild(logoPlaceholder);
  } else {
    const logoPlaceholder = document.createElement("div");
    logoPlaceholder.className = "store-card-logo-placeholder";
    logoPlaceholder.textContent = "🏪";
    logoWrapper.appendChild(logoPlaceholder);
  }

  card.appendChild(logoWrapper);

  // ── Body ──────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "store-card-body";

  // Name
  const nameEl = document.createElement("div");
  nameEl.className = "store-card-name";
  nameEl.textContent = String(store.storeName || "Unnamed Store");
  body.appendChild(nameEl);

  // Category
  if (store.category) {
    const categoryEl = document.createElement("div");
    categoryEl.className = "store-card-category";
    categoryEl.textContent = String(store.category);
    body.appendChild(categoryEl);
  }

  // Description
  if (showDescription && store.description) {
    const descEl = document.createElement("p");
    descEl.className = "store-card-description";
    descEl.textContent = String(store.description);
    body.appendChild(descEl);
  }

  // Badges row
  const badgesRow = document.createElement("div");
  badgesRow.className = "store-card-badges";

  const isOpen = store.isOpen === true;
  const openBadge = document.createElement("span");
  openBadge.className = "store-badge " + (isOpen ? "store-badge-open" : "store-badge-closed");
  openBadge.textContent = isOpen ? "● Open" : "● Closed";
  badgesRow.appendChild(openBadge);

  if (store.deliveryAvailable) {
    const deliveryBadge = document.createElement("span");
    deliveryBadge.className = "store-badge store-badge-delivery";
    deliveryBadge.textContent = "Delivery";
    badgesRow.appendChild(deliveryBadge);
  }

  if (store.collectionAvailable) {
    const collectionBadge = document.createElement("span");
    collectionBadge.className = "store-badge store-badge-collection";
    collectionBadge.textContent = "Collection";
    badgesRow.appendChild(collectionBadge);
  }

  if (showProductCount) {
    const count = Number(store.productCount);
    if (!isNaN(count)) {
      const countBadge = document.createElement("span");
      countBadge.className = "store-badge store-badge-count";
      countBadge.textContent = count + " product" + (count !== 1 ? "s" : "");
      badgesRow.appendChild(countBadge);
    }
  }

  body.appendChild(badgesRow);

  // Rating row — only shown when the store has reviews (reviewCount > 0)
  if (showRating) {
    const reviewCount = Number(store.reviewCount) || 0;
    const averageRating = Number(store.averageRating) || 0;

    if (reviewCount > 0 && averageRating > 0) {
      const ratingRow = document.createElement("div");
      ratingRow.className = "store-card-rating";

      const stars = createRatingStars({
        rating: averageRating,
        size: "sm",
        interactive: false,
        showLabel: false
      });
      ratingRow.appendChild(stars);

      const reviewLabel = document.createElement("span");
      reviewLabel.className = "store-card-rating-count";
      reviewLabel.textContent = averageRating.toFixed(1) + " (" + reviewCount + " review" + (reviewCount !== 1 ? "s" : "") + ")";
      ratingRow.appendChild(reviewLabel);

      body.appendChild(ratingRow);
    }
  }

  card.appendChild(body);

  // ── Footer / CTA ──────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "store-card-footer";

  const viewBtn = document.createElement("a");
  viewBtn.className = "store-card-btn";
  viewBtn.href = "store.html?id=" + encodeURIComponent(storeId);
  viewBtn.textContent = ctaLabel;
  footer.appendChild(viewBtn);

  card.appendChild(footer);

  return card;
}

