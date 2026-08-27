/**
 * browse-stores.js — Browse Stores page for HUSTLR (Phase 2.3).
 *
 * Searchable fields:
 *   - Store Name
 *   - Store Category
 *   - Store Description
 *
 * Filters:
 *   - Category
 *   - Open Now
 *   - Delivery Available
 *   - Collection Available
 *
 * Sorting:
 *   - Newest / Oldest / Name A–Z / Name Z–A
 *
 * Reuses shared modules — no duplicated search/filter/sort/card logic:
 *   - store-card.js (card rendering)
 *   - search-utils.js (partial, case-insensitive, trimmed)
 *   - filters.js (config-driven)
 *   - sorting.js (in-memory)
 *   - categories.js (store categories)
 *   - empty-state.js (empty states)
 *
 * Firestore reads: ONE query — collection("stores") where status == "active".
 * All searching/filtering/sorting happens in memory.
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
import { createStoreCard } from "./store-card.js";
import { renderEmptyState } from "./empty-state.js";
import { STORE_CATEGORIES, getCategoryOptions } from "./categories.js";

// ── Elements ──────────────────────────────────────────────────────

const storesGrid = document.getElementById("storesGrid");
const loadingState = document.getElementById("loadingState");
const emptyState = document.getElementById("emptyState");
const noResultsState = document.getElementById("noResultsState");
const errorState = document.getElementById("errorState");
const searchInput = document.getElementById("searchInput");
const categoryFilters = document.getElementById("categoryFilters");
const openNowChip = document.getElementById("openNowChip");
const deliveryChip = document.getElementById("deliveryChip");
const collectionChip = document.getElementById("collectionChip");
const sortSelect = document.getElementById("sortSelect");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const resultsCount = document.getElementById("resultsCount");
const cartCountNav = document.getElementById("cartCount");

// ── State ─────────────────────────────────────────────────────────

/** @type {Array<{id: string, data: Object}>} */
let allStores = [];

let filterState = createFilterState();
let currentSearch = "";
let currentSort = SORT_KEYS.NEWEST;

// ── UI Helpers ────────────────────────────────────────────────────

function showById(elementId) {
  const elements = [loadingState, emptyState, noResultsState, errorState, storesGrid];
  for (const el of elements) {
    if (!el) continue;
    if (el.id === elementId) {
      el.style.display = "";
    } else {
      el.style.display = "none";
    }
  }
}

function setLoading() {
  showById("loadingState");
}

function setEmpty() {
  showById("emptyState");
}

function setNoResults() {
  showById("noResultsState");
}

function setError() {
  showById("errorState");
}

function setGrid() {
  showById("storesGrid");
}

function getStoreSearchFields(store) {
  return [
    store.storeName,
    store.category,
    store.description
  ];
}

// ── Category Chips ────────────────────────────────────────────────

function buildCategoryChips() {
  if (!categoryFilters) return;

  const options = getCategoryOptions(STORE_CATEGORIES, "All");

  categoryFilters.replaceChildren();

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "category-btn" + (filterState.category === opt.value ? " active" : "");
    btn.dataset.category = opt.value;
    btn.textContent = opt.label;
    categoryFilters.appendChild(btn);
  });
}

function syncFilterUI() {
  if (openNowChip) openNowChip.classList.toggle("active", !!filterState.openNow);
  if (deliveryChip) deliveryChip.classList.toggle("active", !!filterState.delivery);
  if (collectionChip) collectionChip.classList.toggle("active", !!filterState.collection);

  const activeCount = getActiveFilterCount(filterState);
  if (clearFiltersBtn) clearFiltersBtn.style.display = activeCount > 0 ? "inline-flex" : "none";

  if (categoryFilters) {
    categoryFilters.querySelectorAll(".category-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.category === filterState.category);
    });
  }
}

// ── Filter & Render ───────────────────────────────────────────────

function filterAndRender() {
  let filtered = allStores.map((s) => ({ ...s.data, storeId: s.id }));

  // Search (name, category, description)
  filtered = filterBySearch(filtered, currentSearch, getStoreSearchFields);

  // Filters (category, open now, delivery, collection)
  filtered = applyFilters(filtered, filterState);

  // Sort
  filtered = applySort(filtered, currentSort);

  // Clear grid
  storesGrid.replaceChildren();

  if (filtered.length === 0) {
    if (allStores.length === 0) {
      setEmpty();
    } else {
      setNoResults();
      renderEmptyState(storesGrid, {
        icon: "🔍",
        title: "No stores match your search.",
        message: "Try adjusting your search term, category or filters.",
        actionLabel: "Clear Filters",
        actionHref: "#",
        onAction: clearFilters
      });
    }
  } else {
    setGrid();
    filtered.forEach((store) => {
      const card = createStoreCard(store, store.storeId, {
        showProductCount: true,
        showRating: true
      });
      storesGrid.appendChild(card);
    });
  }

  if (resultsCount) {
    resultsCount.textContent =
      allStores.length === 0
        ? ""
        : filtered.length + " of " + allStores.length + " store" + (allStores.length !== 1 ? "s" : "");
  }
}

function clearFilters() {
  currentSearch = "";
  if (searchInput) searchInput.value = "";
  filterState = createFilterState();
  if (sortSelect) sortSelect.value = SORT_KEYS.NEWEST;
  currentSort = SORT_KEYS.NEWEST;
  syncFilterUI();
  buildCategoryChips();
  filterAndRender();
}

// ── Load Stores from Firestore ────────────────────────────────────

async function loadStores() {
  setLoading();

  try {
    // Single Firestore read — everything else is in-memory.
    const q = query(
      collection(db, "stores"),
      where("status", "==", "active")
    );

    const querySnapshot = await getDocs(q);

    allStores = [];

    querySnapshot.forEach((doc) => {
      allStores.push({
        id: doc.id,
        data: doc.data()
      });
    });

    buildCategoryChips();
    syncFilterUI();
    filterAndRender();
  } catch {
    setError();
  }
}

// ── Event Listeners ───────────────────────────────────────────────

// Debounced search input
searchInput?.addEventListener(
  "input",
  debounce((e) => {
    currentSearch = e.target.value;
    filterAndRender();
  }, 150)
);

// Category filter buttons
categoryFilters?.addEventListener("click", (e) => {
  const btn = e.target.closest(".category-btn");
  if (!btn) return;

  filterState.category = btn.dataset.category;
  syncFilterUI();
  filterAndRender();
});

// Toggle chips
[openNowChip, deliveryChip, collectionChip].forEach((chip) => {
  chip?.addEventListener("click", () => {
    const key = chip.dataset.filter;
    filterState[key] = !filterState[key];
    syncFilterUI();
    filterAndRender();
  });
});

// Sort select
sortSelect?.addEventListener("change", (e) => {
  currentSort = e.target.value;
  filterAndRender();
});

// Clear filters
clearFiltersBtn?.addEventListener("click", clearFilters);

// ── Cart Count ────────────────────────────────────────────────────

function updateCartCount() {
  if (cartCountNav) {
    cartCountNav.textContent = getItemCount();
  }
}

// ── Initial Load ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadStores();
  updateCartCount();
});

