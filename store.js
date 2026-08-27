/**
 * store.js — Storefront page for HUSTLR (Phase 2.3).
 *
 * Displays:
 *   - Store banner, logo, name, category, description
 *   - Open/Closed, Delivery, Collection badges
 *   - Product count
 *   - Store information section (contact, hours, status)
 *   - Product search (in-store), category filter, sort
 *   - Featured products (latest)
 *   - Related products (other stores in same category)
 *   - Product cards via reusable product-card.js
 *   - Reusable empty states
 *
 * Firestore reads (once per page load):
 *   1. doc("stores", storeId)
 *   2. collection("products") where storeId == X && available == true
 *   3. collection("stores") where status == "active" (for related product store names)
 *   4. collection("products") where category == store.category (related products)
 * All searching/filtering/sorting is in-memory.
 */

import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getItemCount } from "./cart.js";
import { filterBySearch, debounce } from "./search-utils.js";
import { applyFilters, createFilterState, getActiveFilterCount } from "./filters.js";
import { applySort, SORT_KEYS } from "./sorting.js";
import { createProductCard, defaultAddToCart } from "./product-card.js";
import { renderEmptyState } from "./empty-state.js";
import { PRODUCT_CATEGORIES, getCategoryOptions } from "./categories.js";

// Reviews imports
import { subscribeToStoreReviews, calculateReviewStatistics, REVIEW_SORT } from "./reviews.js";
import { createRatingStars } from "./rating-stars.js";
import { createRatingBreakdown } from "./rating-breakdown.js";
import { createReviewCard } from "./review-card.js";

// ── Elements ──────────────────────────────────────────────────────

const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const storeContent = document.getElementById("storeContent");

const storeBanner = document.getElementById("storeBanner");
const storeBannerPlaceholder = document.getElementById("storeBannerPlaceholder");
const storeLogo = document.getElementById("storeLogo");
const storeLogoPlaceholder = document.getElementById("storeLogoPlaceholder");
const storeNameEl = document.getElementById("storeName");
const storeCategoryEl = document.getElementById("storeCategory");
const storeDescriptionEl = document.getElementById("storeDescription");
const openBadge = document.getElementById("openBadge");
const deliveryBadge = document.getElementById("deliveryBadge");
const collectionBadge = document.getElementById("collectionBadge");
const storeProductCount = document.getElementById("storeProductCount");

// Store info section
const storeInfoSection = document.getElementById("storeInfoSection");
const storeInfoPhone = document.getElementById("storeInfoPhone");
const storeInfoWhatsapp = document.getElementById("storeInfoWhatsapp");
const storeInfoHours = document.getElementById("storeInfoHours");
const storeInfoStatus = document.getElementById("storeInfoStatus");
// storeInfoLocation was removed — no location element in HTML

// Toolbar
const productSearchInput = document.getElementById("productSearchInput");
const productCategoryFilters = document.getElementById("productCategoryFilters");
const availabilityChip = document.getElementById("availabilityChip");
const sortSelect = document.getElementById("sortSelect");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const productsResultsCount = document.getElementById("productsResultsCount");

// Grids
const productsGrid = document.getElementById("productsGrid");
const emptyState = document.getElementById("emptyState");
const featuredGrid = document.getElementById("featuredGrid");
const relatedGrid = document.getElementById("relatedGrid");
const featuredSection = document.getElementById("featuredSection");
const relatedSection = document.getElementById("relatedSection");

const cartCountNav = document.getElementById("cartCount");

// ── Module State ──────────────────────────────────────────────────

let currentStoreId = "";
let currentStoreName = "";
let currentStoreCategory = "";
let currentStore = {};

/** @type {Array<{id: string, data: Object}>} */
let allProducts = [];

/** @type {Map<string, {storeName: string}>} */
let storeNameMap = new Map();

let currentSearch = "";
let filterState = createFilterState();
let currentSort = SORT_KEYS.NEWEST;

// ── UI Helpers ────────────────────────────────────────────────────

function showLoading() {
  loadingState.style.display = "flex";
  errorState.style.display = "none";
  storeContent.style.display = "none";
}

function showError() {
  loadingState.style.display = "none";
  errorState.style.display = "flex";
  storeContent.style.display = "none";
}

function showContent() {
  loadingState.style.display = "none";
  errorState.style.display = "none";
  storeContent.style.display = "block";
}

function updateCartCount() {
  if (cartCountNav) {
    cartCountNav.textContent = getItemCount();
  }
}

function getProductSearchFields(product) {
  return [
    product.name,
    product.description,
    product.category
  ];
}

// ── Render Store Header ───────────────────────────────────────────

function renderStore(storeData) {
  // Banner
  if (storeData.bannerURL) {
    storeBanner.src = String(storeData.bannerURL);
    storeBanner.style.display = "block";
    storeBannerPlaceholder.style.display = "none";
  } else {
    storeBanner.style.display = "none";
    storeBannerPlaceholder.style.display = "flex";
  }

  // Logo
  if (storeData.logoURL) {
    storeLogo.src = String(storeData.logoURL);
    storeLogo.style.display = "block";
    storeLogoPlaceholder.style.display = "none";
  } else {
    storeLogo.style.display = "none";
    storeLogoPlaceholder.style.display = "flex";
  }

  // Name
  storeNameEl.textContent = String(storeData.storeName || "Unnamed Store");

  // Category
  if (storeData.category) {
    storeCategoryEl.textContent = String(storeData.category);
    storeCategoryEl.style.display = "inline-block";
  } else {
    storeCategoryEl.style.display = "none";
  }

  // Description
  if (storeData.description) {
    storeDescriptionEl.textContent = String(storeData.description);
    storeDescriptionEl.style.display = "block";
  } else {
    storeDescriptionEl.style.display = "none";
  }

  // Open/Closed badge
  const isOpen = storeData.isOpen === true;
  openBadge.className = "store-badge " + (isOpen ? "store-badge-open" : "store-badge-closed");
  openBadge.textContent = isOpen ? "● Open" : "● Closed";

  // Delivery badge
  if (storeData.deliveryAvailable) {
    deliveryBadge.style.display = "inline-flex";
  } else {
    deliveryBadge.style.display = "none";
  }

  // Collection badge
  if (storeData.collectionAvailable) {
    collectionBadge.style.display = "inline-flex";
  } else {
    collectionBadge.style.display = "none";
  }

  // Product count — calculated from loaded products (no extra Firestore read)
  if (storeProductCount) {
    const count = allProducts.length;
    storeProductCount.textContent = count > 0 ? count + " product" + (count !== 1 ? "s" : "") : "";
  }
}

// ── Store Information Section ─────────────────────────────────────

function renderStoreInfo(storeData) {
  if (!storeInfoSection) return;

  // Phone
  if (storeData.phone) {
    storeInfoPhone.textContent = storeData.phone;
    storeInfoPhone.closest(".store-info-item")?.style.removeProperty("display");
  } else {
    storeInfoPhone.closest(".store-info-item")?.style.setProperty("display", "none");
  }

  // WhatsApp
  if (storeData.whatsapp) {
    storeInfoWhatsapp.textContent = storeData.whatsapp;
    storeInfoWhatsapp.closest(".store-info-item")?.style.removeProperty("display");
  } else {
    storeInfoWhatsapp.closest(".store-info-item")?.style.setProperty("display", "none");
  }

  // Hours
  if (storeData.openingTime || storeData.closingTime) {
    const opening = storeData.openingTime ? formatTime(storeData.openingTime) : "?";
    const closing = storeData.closingTime ? formatTime(storeData.closingTime) : "?";
    storeInfoHours.textContent = opening + " – " + closing;
    storeInfoHours.closest(".store-info-item")?.style.removeProperty("display");
  } else {
    storeInfoHours.textContent = "Hours not set";
    storeInfoHours.closest(".store-info-item")?.style.setProperty("display", "flex");
  }

  // Status
  storeInfoStatus.textContent = storeData.isOpen === true ? "Open Now" : "Closed";
  storeInfoStatus.className = "store-info-status " + (storeData.isOpen === true ? "open" : "closed");
}

/**
 * Format an HH:mm (24h) string to a friendly time, or leave as-is.
 * @param {string} value
 * @returns {string}
 */
function formatTime(value) {
  if (!value) return "";
  // Already contains a colon — try to convert 24h → 12h
  if (typeof value === "string" && value.includes(":")) {
    const parts = value.split(":");
    const h = parseInt(parts[0], 10);
    const m = parts[1] || "00";
    if (!isNaN(h)) {
      const suffix = h >= 12 ? "PM" : "AM";
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      return hour12 + ":" + m + " " + suffix;
    }
  }
  return value;
}

// ── Category Chips ────────────────────────────────────────────────

function buildCategoryChips() {
  if (!productCategoryFilters) return;

  const options = getCategoryOptions(PRODUCT_CATEGORIES, "All");

  productCategoryFilters.replaceChildren();

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "category-btn" + (filterState.category === opt.value ? " active" : "");
    btn.dataset.category = opt.value;
    btn.textContent = opt.label;
    productCategoryFilters.appendChild(btn);
  });
}

function syncFilterUI() {
  if (availabilityChip) availabilityChip.classList.toggle("active", !!filterState.available);

  if (productCategoryFilters) {
    productCategoryFilters.querySelectorAll(".category-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.category === filterState.category);
    });
  }

  const activeCount = getActiveFilterCount(filterState);
  if (clearFiltersBtn) clearFiltersBtn.style.display = activeCount > 0 ? "inline-flex" : "none";
}

// ── Render Products (in-store grid) ───────────────────────────────

function renderProducts() {
  let items = allProducts.map((p) => ({
    ...p.data,
    productId: p.id,
    storeName: currentStoreName
  }));

  // Search
  items = filterBySearch(items, currentSearch, getProductSearchFields);

  // Filters
  items = applyFilters(items, filterState);

  // Sort
  items = applySort(items, currentSort);

  productsGrid.replaceChildren();

  if (items.length === 0) {
    if (allProducts.length === 0) {
      renderEmptyState(productsGrid, {
        icon: "📋",
        title: "No products available yet",
        message: "This store hasn't added any products yet. Check back later."
      });
    } else {
      renderEmptyState(productsGrid, {
        icon: "🔍",
        title: "No products match your search.",
        message: "Try adjusting your search term, category or filters.",
        actionLabel: "Clear Filters",
        actionHref: "#",
        onAction: clearFilters
      });
    }
    emptyState.style.display = "none";
  } else {
    emptyState.style.display = "none";
    items.forEach((product) => {
      const card = createProductCard(product, product.productId, {
        storeMap: null,
        storeName: currentStoreName,
        showAvailability: true,
        showStore: false
      });
      productsGrid.appendChild(card);
    });
  }

  if (productsResultsCount) {
    productsResultsCount.textContent = items.length + " of " + allProducts.length + " product" + (allProducts.length !== 1 ? "s" : "");
  }
}

function clearFilters() {
  currentSearch = "";
  if (productSearchInput) productSearchInput.value = "";
  filterState = createFilterState();
  if (sortSelect) sortSelect.value = SORT_KEYS.NEWEST;
  currentSort = SORT_KEYS.NEWEST;
  syncFilterUI();
  buildCategoryChips();
  renderProducts();
}

// ── Featured & Related ────────────────────────────────────────────

/**
 * Render a product grid section (featured / related).
 */
function renderSectionGrid(grid, section, products, options = {}) {
  if (!grid || !section) return;

  if (!products || products.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  grid.replaceChildren();

  products.forEach((p) => {
    const product = {
      ...p.data,
      productId: p.id,
      storeName: (storeNameMap.get(p.data.storeId) || {}).storeName || ""
    };
    const card = createProductCard(product, p.id, options);
    grid.appendChild(card);
  });
}

/**
 * Load featured products (up to 4 latest from this store) and
 * related products (up to 4 from other stores in the same category).
 */
async function loadFeaturedAndRelated() {
  // Featured = latest products from this store (already in allProducts)
  const featured = applySort(allProducts.map((p) => p.data), SORT_KEYS.NEWEST).slice(0, 4);
  const featuredWithIds = featured
    .map((p) => {
      const found = allProducts.find((ap) => ap.data === p);
      return found ? { id: found.id, data: p } : null;
    })
    .filter(Boolean);

  renderSectionGrid(featuredGrid, featuredSection, featuredWithIds, {
    showDescription: false,
    showAvailability: true
  });

  // Related products: same category, other stores
  let related = [];
  if (currentStoreCategory) {
    try {
      const q = query(
        collection(db, "products"),
        where("category", "==", currentStoreCategory),
        where("available", "==", true)
      );
      const snap = await getDocs(q);
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.storeId !== currentStoreId) {
          related.push({ id: docSnap.id, data });
        }
      });
      related = related.slice(0, 4);
    } catch {
      related = [];
    }
  }

  renderSectionGrid(relatedGrid, relatedSection, related, {
    showDescription: false,
    showAvailability: true
  });
}

// ── Load Store Data ───────────────────────────────────────────────

async function loadStore(storeId) {
  showLoading();

  try {
    // Read 1: store doc
    const storeRef = doc(db, "stores", storeId);
    const storeSnap = await getDoc(storeRef);

    if (!storeSnap.exists()) {
      showError();
      return;
    }

    const storeData = storeSnap.data();

    currentStoreId = storeId;
    currentStoreName = String(storeData.storeName || "Unnamed Store");
    currentStoreCategory = String(storeData.category || "");
    currentStore = storeData;

    renderStore(storeData);
    renderStoreInfo(storeData);

    // Read 3 (prefetch store names for related cards)
    try {
      const storesQ = query(collection(db, "stores"), where("status", "==", "active"));
      const storesSnap = await getDocs(storesQ);
      storesSnap.forEach((docSnap) => {
        const data = docSnap.data();
        storeNameMap.set(docSnap.id, { storeName: data.storeName || "" });
      });
    } catch {
      // Non-fatal
    }

    // Load products
    await loadProducts(storeId);

    showContent();
    updateCartCount();
  } catch {
    showError();
  }
}

// ── Load Products ─────────────────────────────────────────────────

async function loadProducts(storeId) {
  try {
    // Read 2: available products for this store
    const q = query(
      collection(db, "products"),
      where("storeId", "==", storeId),
      where("available", "==", true)
    );

    const querySnapshot = await getDocs(q);

    allProducts = [];
    querySnapshot.forEach((productDoc) => {
      allProducts.push({ id: productDoc.id, data: productDoc.data() });
    });

    buildCategoryChips();
    syncFilterUI();
    renderProducts();

    // Featured + related (reads 3 & 4 done after products)
    await loadFeaturedAndRelated();
  } catch {
    productsGrid.replaceChildren();
    renderEmptyState(productsGrid, {
      icon: "⚠️",
      title: "Unable to load products.",
      message: "Something went wrong. Please refresh the page to try again."
    });
  }
}

// ── Event Listeners ───────────────────────────────────────────────

productSearchInput?.addEventListener(
  "input",
  debounce((e) => {
    currentSearch = e.target.value;
    renderProducts();
  }, 150)
);

productCategoryFilters?.addEventListener("click", (e) => {
  const btn = e.target.closest(".category-btn");
  if (!btn) return;
  filterState.category = btn.dataset.category;
  syncFilterUI();
  renderProducts();
});

availabilityChip?.addEventListener("click", () => {
  filterState.available = !filterState.available;
  syncFilterUI();
  renderProducts();
});

sortSelect?.addEventListener("change", (e) => {
  currentSort = e.target.value;
  renderProducts();
});

clearFiltersBtn?.addEventListener("click", clearFilters);

// ────────────────────────────────────────────────────────────
// REVIEWS INTEGRATION
// ────────────────────────────────────────────────────────────

// Review elements
const reviewsSection = document.getElementById("reviewsSection");
const reviewAvgValue = document.getElementById("reviewAvgValue");
const reviewAvgStars = document.getElementById("reviewAvgStars");
const reviewAvgLabel = document.getElementById("reviewAvgLabel");
const reviewBreakdownContainer = document.getElementById("reviewBreakdownContainer");
const reviewList = document.getElementById("reviewList");
const reviewListLoading = document.getElementById("reviewListLoading");
const reviewEmpty = document.getElementById("reviewEmpty");
const reviewCountLabel = document.getElementById("reviewCountLabel");
const reviewSortBar = document.querySelector(".review-sort-bar");

/** @type {function|null} */
let reviewsUnsubscribe = null;

/** @type {Array} */
let allStoreReviews = [];

/** @type {string} */
let currentReviewSort = REVIEW_SORT.NEWEST;

/**
 * Render the review summary (average + breakdown + stars).
 * @param {Object} statistics - { averageRating, reviewCount, ratingBreakdown }
 */
function renderReviewSummary(statistics) {
  if (!reviewsSection || !reviewAvgValue) return;

  const { averageRating, reviewCount, ratingBreakdown } = statistics;

  // Average value
  reviewAvgValue.textContent = averageRating > 0 ? averageRating.toFixed(1) : "0.0";

  // Stars
  reviewAvgStars.replaceChildren();
  if (averageRating > 0) {
    const stars = createRatingStars({
      rating: averageRating,
      size: "md",
      interactive: false,
      showLabel: false
    });
    reviewAvgStars.appendChild(stars);
  }

  // Label
  reviewAvgLabel.textContent = reviewCount === 1
    ? "1 review"
    : `${reviewCount} reviews`;

  // Breakdown
  if (reviewBreakdownContainer) {
    reviewBreakdownContainer.replaceChildren();
    const breakdown = createRatingBreakdown({
      breakdown: ratingBreakdown,
      totalReviews: reviewCount,
      clickable: false
    });
    reviewBreakdownContainer.appendChild(breakdown);
  }

  // Count label
  if (reviewCountLabel) {
    reviewCountLabel.textContent = reviewCount > 0
      ? `${reviewCount} review${reviewCount !== 1 ? "s" : ""}`
      : "";
  }
}

/**
 * Render the review list from current store reviews.
 */
function renderReviewList() {
  if (!reviewList || !reviewListLoading || !reviewEmpty) return;

  // Hide loading
  reviewListLoading.style.display = "none";

  if (allStoreReviews.length === 0) {
    reviewList.replaceChildren();
    reviewEmpty.style.display = "flex";
    return;
  }

  reviewEmpty.style.display = "none";

  // Sort in-memory
  let sorted = [...allStoreReviews];
  switch (currentReviewSort) {
    case REVIEW_SORT.NEWEST:
      sorted.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.()?.getTime() || new Date(a.createdAt).getTime() || 0;
        const bTime = b.createdAt?.toDate?.()?.getTime() || new Date(b.createdAt).getTime() || 0;
        return bTime - aTime;
      });
      break;
    case REVIEW_SORT.OLDEST:
      sorted.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.()?.getTime() || new Date(a.createdAt).getTime() || 0;
        const bTime = b.createdAt?.toDate?.()?.getTime() || new Date(b.createdAt).getTime() || 0;
        return aTime - bTime;
      });
      break;
    case REVIEW_SORT.HIGHEST_RATING:
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
    case REVIEW_SORT.LOWEST_RATING:
      sorted.sort((a, b) => (a.rating || 0) - (b.rating || 0));
      break;
  }

  reviewList.replaceChildren();
  sorted.forEach((review) => {
    const card = createReviewCard(review, {
      showEditButton: false,
      showDeleteButton: false,
      showReplyButton: false
    });
    reviewList.appendChild(card);
  });
}

/**
 * Start listening to store reviews in real-time.
 * @param {string} storeId
 */
function startStoreReviewsListener(storeId) {
  // Clean up previous listener
  if (reviewsUnsubscribe) {
    reviewsUnsubscribe();
    reviewsUnsubscribe = null;
  }

  reviewsUnsubscribe = subscribeToStoreReviews(
    storeId,
    (reviews) => {
      allStoreReviews = reviews || [];

      // Calculate statistics
      const ratings = reviews.map((r) => r.rating).filter((r) => r >= 1 && r <= 5);
      const statistics = calculateReviewStatistics(ratings);

      // Show the reviews section
      if (reviewsSection) {
        reviewsSection.style.display = "block";
      }

      // Render summary
      renderReviewSummary(statistics);

      // Render list
      renderReviewList();
    },
    { sort: currentReviewSort },
    () => {
      // Error fallback — hide reviews section
      if (reviewsSection) reviewsSection.style.display = "none";
    }
  );
}

// ── Review Sort Event Listeners ─────────────────────────────────

reviewSortBar?.addEventListener("click", (e) => {
  const btn = e.target.closest(".review-sort-btn");
  if (!btn) return;

  const sort = btn.dataset.sort;
  if (!sort) return;

  // Update active state
  reviewSortBar.querySelectorAll(".review-sort-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  // Map to REVIEW_SORT constant
  const sortMap = {
    "newest": REVIEW_SORT.NEWEST,
    "oldest": REVIEW_SORT.OLDEST,
    "highest": REVIEW_SORT.HIGHEST_RATING,
    "lowest": REVIEW_SORT.LOWEST_RATING
  };

  currentReviewSort = sortMap[sort] || REVIEW_SORT.NEWEST;

  // Re-render list with new sort (in-memory, no new listener)
  renderReviewList();
});

// ── Modify loadStore to start reviews listener ──────────────────

// Store original loadStore to extend it
const originalLoadStore = loadStore;

// Override loadStore to add reviews listener after store loads
loadStore = async function extendedLoadStore(storeId) {
  await originalLoadStore(storeId);

  // Start reviews listener for this store
  if (storeId) {
    startStoreReviewsListener(storeId);
  }
};

// ── Initial Load ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const storeId = urlParams.get("id");

  if (!storeId) {
    showError();
    return;
  }

  loadStore(storeId);
});

// ── Cleanup on page unload ────────────────────────────────────────

window.addEventListener("beforeunload", () => {
  if (reviewsUnsubscribe) {
    reviewsUnsubscribe();
    reviewsUnsubscribe = null;
  }
});

