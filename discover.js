/**
 * discover.js — Global Product Discovery for HUSTLR.
 *
 * Searchable: Products, Stores, Categories.
 * Uses shared modules only — no duplicated search/filter/sort logic.
 *   - search-utils.js  (partial, case-insensitive, trimmed, tokenised)
 *   - filters.js       (category, open now, delivery, collection)
 *   - sorting.js       (newest/oldest/price/alpha)
 *   - product-card.js  (product cards)
 *   - store-card.js    (store cards)
 *   - empty-state.js   (empty states)
 *
 * Firestore reads (once per page load):
 *   1. collection("stores") where status == "active"
 *   2. collection("products") where available == true
 * All filtering/searching/sorting happens in memory.
 */

import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getItemCount } from "./cart.js";
import { filterBySearch, debounce } from "./search-utils.js";
import { applyFilters, createFilterState, getActiveFilterCount } from "./filters.js";
import { applySort, SORT_KEYS } from "./sorting.js";
import { createProductCard } from "./product-card.js";
import { createStoreCard } from "./store-card.js";
import { renderEmptyState } from "./empty-state.js";
import { STORE_CATEGORIES, PRODUCT_CATEGORIES, getCategoryOptions } from "./categories.js";

// ── Elements ──────────────────────────────────────────────────────

const tabs = document.getElementById("discoverTabs");
const tabButtons = tabs ? tabs.querySelectorAll(".discover-tab-btn") : [];
const searchInput = document.getElementById("discoverSearchInput");
const categoryFilters = document.getElementById("discoverCategoryFilters");
const openNowChip = document.getElementById("openNowChip");
const deliveryChip = document.getElementById("deliveryChip");
const collectionChip = document.getElementById("collectionChip");
const sortSelect = document.getElementById("discoverSortSelect");
const clearFiltersBtn = document.getElementById("discoverClearFilters");
const productsGrid = document.getElementById("discoverProductsGrid");
const storesGrid = document.getElementById("discoverStoresGrid");
const loadingEl = document.getElementById("discoverLoading");
const resultsCount = document.getElementById("discoverResultsCount");
const productTabCount = document.getElementById("productTabCount");
const storeTabCount = document.getElementById("storeTabCount");
const cartCountNav = document.getElementById("cartCount");

// ── State ─────────────────────────────────────────────────────────

/** @type {Array<{id: string, data: Object}>} */
let allProducts = [];

/** @type {Array<{id: string, data: Object}>} */
let allStores = [];

/** @type {Map<string, {storeName: string, isOpen: boolean, deliveryAvailable: boolean, collectionAvailable: boolean}>} */
let storeMap = new Map();

let currentTab = "products"; // "products" | "stores"
let currentSearch = "";
let filterState = createFilterState();
let currentSort = SORT_KEYS.NEWEST;

// ── UI Helpers ────────────────────────────────────────────────────

function showLoading() {
  if (loadingEl) loadingEl.style.display = "flex";
  if (productsGrid) productsGrid.style.display = "none";
  if (storesGrid) storesGrid.style.display = "none";
  if (resultsCount) resultsCount.textContent = "";
}

function showResults() {
  if (loadingEl) loadingEl.style.display = "none";
}

function setTab(tab) {
  currentTab = tab;
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
  });

  // Show correct grid
  if (productsGrid) productsGrid.style.display = tab === "products" ? "grid" : "none";
  if (storesGrid) storesGrid.style.display = tab === "stores" ? "grid" : "none";

  // Rebuild category chips per tab
  buildCategoryChips(tab);

  // Reset category filter when switching tabs (categories differ)
  if (filterState.category !== "all") {
    filterState.category = "all";
    syncChipUI();
  }

  render();
}

function buildCategoryChips(tab) {
  if (!categoryFilters) return;

  const cats = tab === "stores" ? STORE_CATEGORIES : PRODUCT_CATEGORIES;
  const options = getCategoryOptions(cats, "All");

  categoryFilters.replaceChildren();

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "category-btn" + (filterState.category === opt.value ? " active" : "");
    btn.dataset.category = opt.value;
    btn.textContent = opt.label;
    categoryFilters.appendChild(btn);
  });
}

function syncChipUI() {
  if (openNowChip) openNowChip.classList.toggle("active", !!filterState.openNow);
  if (deliveryChip) deliveryChip.classList.toggle("active", !!filterState.delivery);
  if (collectionChip) collectionChip.classList.toggle("active", !!filterState.collection);

  const activeCount = getActiveFilterCount(filterState);
  if (clearFiltersBtn) clearFiltersBtn.style.display = activeCount > 0 ? "inline-flex" : "none";

  // Category chips active state
  if (categoryFilters) {
    categoryFilters.querySelectorAll(".category-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.category === filterState.category);
    });
  }
}

// ── Search + Filter + Sort Pipeline ───────────────────────────────

function getProductSearchFields(product) {
  const store = storeMap.get(product.storeId) || {};
  return [
    product.name,
    product.description,
    product.category,
    store.storeName
  ];
}

function getStoreSearchFields(store) {
  return [
    store.storeName,
    store.category,
    store.description
  ];
}

/**
 * Render the current tab's results.
 * All filtering/searching/sorting happens in memory.
 */
function render() {
  showResults();

  if (currentTab === "products") {
    renderProducts();
  } else {
    renderStores();
  }
}

function renderProducts() {
  if (!productsGrid) return;

  // Build product view objects (data only, with resolved store info)
  let items = allProducts.map((p) => ({
    ...p.data,
    productId: p.id,
    storeName: (storeMap.get(p.data.storeId) || {}).storeName || ""
  }));

  // Search (products: name, description, category, store name)
  items = filterBySearch(items, currentSearch, getProductSearchFields);

  // Filters (category, price, available, etc.)
  items = applyFilters(items, filterState);

  // Sort
  items = applySort(items, currentSort);

  productsGrid.replaceChildren();

  if (items.length === 0) {
    const hasAny = allProducts.length > 0;
    if (hasAny) {
      renderEmptyState(productsGrid, {
        icon: "🔍",
        title: "No products match your search.",
        message: "Try adjusting your search term, category or filters.",
        actionLabel: "Clear Filters",
        actionHref: "#",
        onAction: clearFilters
      });
    } else {
      renderEmptyState(productsGrid, {
        icon: "📦",
        title: "No products available yet.",
        message: "Check back later — sellers are adding new products every day.",
        actionLabel: "Browse Stores",
        actionHref: "browse-stores.html"
      });
    }
  } else {
    items.forEach((product) => {
      const card = createProductCard(product, product.productId, {
        storeMap: Object.fromEntries(storeMap),
        showAvailability: true
      });
      productsGrid.appendChild(card);
    });
  }

  if (resultsCount) {
    resultsCount.textContent = items.length === 0
      ? "0 results"
      : items.length + " product" + (items.length !== 1 ? "s" : "");
  }
}

function renderStores() {
  if (!storesGrid) return;

  let items = allStores.map((s) => ({ ...s.data, storeId: s.id }));

  // Search (stores: name, category, description)
  items = filterBySearch(items, currentSearch, getStoreSearchFields);

  // Filters (category, open now, delivery, collection)
  items = applyFilters(items, filterState);

  // Sort
  items = applySort(items, currentSort);

  storesGrid.replaceChildren();

  if (items.length === 0) {
    const hasAny = allStores.length > 0;
    if (hasAny) {
      renderEmptyState(storesGrid, {
        icon: "🔍",
        title: "No stores match your search.",
        message: "Try adjusting your search term, category or filters.",
        actionLabel: "Clear Filters",
        actionHref: "#",
        onAction: clearFilters
      });
    } else {
      renderEmptyState(storesGrid, {
        icon: "🏪",
        title: "No stores available yet.",
        message: "Check back later for new stores opening on HUSTLR."
      });
    }
  } else {
    items.forEach((store) => {
      const card = createStoreCard(store, store.storeId, {
        showProductCount: true,
        showRating: true
      });
      storesGrid.appendChild(card);
    });
  }

  if (resultsCount) {
    resultsCount.textContent = items.length === 0
      ? "0 results"
      : items.length + " store" + (items.length !== 1 ? "s" : "");
  }
}

function clearFilters() {
  filterState = createFilterState();
  currentSearch = "";
  if (searchInput) searchInput.value = "";
  if (sortSelect) sortSelect.value = SORT_KEYS.NEWEST;
  currentSort = SORT_KEYS.NEWEST;
  syncChipUI();
  buildCategoryChips(currentTab);
  render();
}

// ── Load Data from Firestore ──────────────────────────────────────

async function loadData() {
  showLoading();

  try {
    // Read 1: active stores
    const storesQ = query(
      collection(db, "stores"),
      where("status", "==", "active")
    );
    const storesSnap = await getDocs(storesQ);

    allStores = [];
    storeMap = new Map();

    storesSnap.forEach((doc) => {
      const data = doc.data();
      allStores.push({ id: doc.id, data });
      storeMap.set(doc.id, {
        storeName: data.storeName || "",
        isOpen: data.isOpen === true,
        deliveryAvailable: data.deliveryAvailable === true,
        collectionAvailable: data.collectionAvailable === true
      });
    });

    // Read 2: available products
    const productsQ = query(
      collection(db, "products"),
      where("available", "==", true)
    );
    const productsSnap = await getDocs(productsQ);

    allProducts = [];
    productsSnap.forEach((doc) => {
      allProducts.push({ id: doc.id, data: doc.data() });
    });

    // Tab counts
    if (productTabCount) productTabCount.textContent = "(" + allProducts.length + ")";
    if (storeTabCount) storeTabCount.textContent = "(" + allStores.length + ")";

    // Initial category chips
    buildCategoryChips(currentTab);

    // Render
    render();
  } catch {
    if (productsGrid) {
      renderEmptyState(productsGrid, {
        icon: "⚠️",
        title: "Unable to load the marketplace.",
        message: "Something went wrong. Please refresh the page to try again."
      });
    }
    showResults();
  }
}

// ── Event Listeners ───────────────────────────────────────────────

// Debounced search — no duplicate logic, instant but efficient.
searchInput?.addEventListener(
  "input",
  debounce((e) => {
    currentSearch = e.target.value;
    render();
  }, 150)
);

tabs?.addEventListener("click", (e) => {
  const btn = e.target.closest(".discover-tab-btn");
  if (!btn) return;
  setTab(btn.dataset.tab);
});

categoryFilters?.addEventListener("click", (e) => {
  const btn = e.target.closest(".category-btn");
  if (!btn) return;
  filterState.category = btn.dataset.category;
  syncChipUI();
  render();
});

// Toggle chips
[openNowChip, deliveryChip, collectionChip].forEach((chip) => {
  chip?.addEventListener("click", () => {
    const key = chip.dataset.filter;
    filterState[key] = !filterState[key];
    syncChipUI();
    render();
  });
});

sortSelect?.addEventListener("change", (e) => {
  currentSort = e.target.value;
  render();
});

clearFiltersBtn?.addEventListener("click", clearFilters);

// ── Cart Count ────────────────────────────────────────────────────

function updateCartCount() {
  if (cartCountNav) {
    cartCountNav.textContent = getItemCount();
  }
}

// ── Initial Load ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Support ?q=... from homepage search
  const urlParams = new URLSearchParams(window.location.search);
  const queryParam = urlParams.get("q");
  if (queryParam) {
    currentSearch = queryParam;
    if (searchInput) searchInput.value = queryParam;
  }

  const tabParam = urlParams.get("tab");
  if (tabParam === "stores") {
    setTab("stores");
  }

  // Support ?category=... from homepage category chips
  const categoryParam = urlParams.get("category");
  if (categoryParam) {
    filterState.category = categoryParam;
    // Chip active state is set in syncChipUI via buildCategoryChips
  }

  loadData();
  updateCartCount();
});

