/**
 * index.js — Homepage data loading for HUSTLR (Phase 2.3).
 *
 * Loads:
 *   - Featured stores (latest active stores, capped at 6)
 *   - Featured products (latest available products, capped at 8)
 *   - Browse categories shortcut chips (store categories)
 *
 * Firestore reads (once per page load):
 *   1. collection("stores") where status == "active"
 *   2. collection("products") where available == true
 * All selection/sorting is in-memory.
 */

import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { applySort, SORT_KEYS } from "./sorting.js";
import { createStoreCard } from "./store-card.js";
import { createProductCard } from "./product-card.js";
import { renderEmptyState } from "./empty-state.js";
import { STORE_CATEGORIES } from "./categories.js";

// ── Elements ──────────────────────────────────────────────────────

const featuredStoresGrid = document.getElementById("featuredStores");
const featuredProductsGrid = document.getElementById("featuredProducts");
const featuredProductsSection = document.getElementById("featuredProductsSection");
const categoryChips = document.getElementById("categoryChips");

// ── Load Featured Stores ──────────────────────────────────────────

async function loadFeaturedStores() {
  if (!featuredStoresGrid) return;

  try {
    const q = query(collection(db, "stores"), where("status", "==", "active"));
    const snap = await getDocs(q);

    const stores = [];
    snap.forEach((docSnap) => {
      stores.push({ id: docSnap.id, data: docSnap.data() });
    });

    const sorted = applySort(
      stores.map((s) => ({ ...s.data, storeId: s.id })),
      SORT_KEYS.NEWEST
    ).slice(0, 6);

    featuredStoresGrid.replaceChildren();

    if (sorted.length === 0) {
      renderEmptyState(featuredStoresGrid, {
        icon: "🏪",
        title: "No stores yet",
        message: "Be the first to open a store on HUSTLR.",
        actionLabel: "Open a Store",
        actionHref: "create-store.html"
      });
      return;
    }

    sorted.forEach((store) => {
      const card = createStoreCard(store, store.storeId, {
        showDescription: false,
        showRating: true,
        ctaLabel: "View Store"
      });
      featuredStoresGrid.appendChild(card);
    });
  } catch {
    // Silent — homepage should never block on a failed section.
  }
}

// ── Load Featured Products ────────────────────────────────────────

async function loadFeaturedProducts() {
  if (!featuredProductsGrid || !featuredProductsSection) return;

  try {
    const q = query(collection(db, "products"), where("available", "==", true));
    const snap = await getDocs(q);

    const products = [];
    const storeMap = new Map();

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      products.push({ id: docSnap.id, data });
    });

    const sorted = applySort(products, SORT_KEYS.NEWEST).slice(0, 8);

    if (sorted.length === 0) {
      featuredProductsSection.style.display = "none";
      return;
    }

    // Resolve store names in one pass
    products.forEach((p) => {
      if (!storeMap.has(p.data.storeId)) {
        storeMap.set(p.data.storeId, { storeName: "" });
      }
    });

    try {
      const storesQ = query(collection(db, "stores"), where("status", "==", "active"));
      const storesSnap = await getDocs(storesQ);
      storesSnap.forEach((docSnap) => {
        const data = docSnap.data();
        storeMap.set(docSnap.id, { storeName: data.storeName || "" });
      });
    } catch {
      // Non-fatal — cards show no store name.
    }

    featuredProductsSection.style.display = "block";
    featuredProductsGrid.replaceChildren();

    sorted.forEach((p) => {
      const product = {
        ...p.data,
        productId: p.id,
        storeName: (storeMap.get(p.data.storeId) || {}).storeName || ""
      };
      const card = createProductCard(product, p.id, {
        showDescription: false,
        showAvailability: true
      });
      featuredProductsGrid.appendChild(card);
    });
  } catch {
    featuredProductsSection.style.display = "none";
  }
}

// ── Build Category Shortcuts ──────────────────────────────────────

function buildCategoryChips() {
  if (!categoryChips) return;

  categoryChips.replaceChildren();

  STORE_CATEGORIES.slice(0, 8).forEach((cat) => {
    const chip = document.createElement("a");
    chip.className = "category-chip";
    chip.href = "discover.html?tab=stores&category=" + encodeURIComponent(cat);
    chip.textContent = cat;
    categoryChips.appendChild(chip);
  });

  // "All" shortcut
  const all = document.createElement("a");
  all.className = "category-chip";
  all.href = "discover.html";
  all.textContent = "View All";
  categoryChips.appendChild(all);
}

// ── Initial Load ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  buildCategoryChips();
  loadFeaturedStores();
  loadFeaturedProducts();
});

