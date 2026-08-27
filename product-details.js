/**
 * product-details.js — Product Details page for HUSTLR.
 *
 * Displays:
 *   - Large product image (gallery-ready for multiple images)
 *   - Product information (name, category, price, description, availability)
 *   - Store information card (logo, name, category, badges, description)
 *   - Add to Cart (reuses cart.js conflict handling)
 *   - Back to Store
 *   - Related Products (same category, other stores)
 *   - Suggested Products (same store, other products)
 *
 * Firestore reads (bounded, once per page load):
 *   1. doc("products", id)
 *   2. doc("stores", product.storeId)
 *   3. collection("products") where storeId == X && available == true (store's other products)
 *   4. collection("products") where category == Y && available == true (related)
 *   5. collection("stores") where status == "active" (store-name map for cards)
 *
 * All related/suggested selection happens in memory.
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

import { getItemCount, formatPrice } from "./cart.js";
import { defaultAddToCart } from "./product-card.js";
import { createProductCard } from "./product-card.js";
import { renderEmptyState } from "./empty-state.js";

// ── Review/Rating Imports ─────────────────────────────────────────

import { createRatingStars } from "./rating-stars.js";

// ── Elements ──────────────────────────────────────────────────────

const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const productContent = document.getElementById("productContent");

const breadcrumbStore = document.getElementById("breadcrumbStore");
const breadcrumbProduct = document.getElementById("breadcrumbProduct");

const mainImage = document.getElementById("mainImage");
const mainImagePlaceholder = document.getElementById("mainImagePlaceholder");
const galleryThumbs = document.getElementById("galleryThumbs");

const productCategory = document.getElementById("productCategory");
const productName = document.getElementById("productName");
const productStoreLink = document.getElementById("productStoreLink");
const productPrice = document.getElementById("productPrice");
const productAvailability = document.getElementById("productAvailability");
const productDescription = document.getElementById("productDescription");
const addToCartBtn = document.getElementById("addToCartBtn");
const backToStoreBtn = document.getElementById("backToStoreBtn");
const storeInfoCard = document.getElementById("storeInfoCard");

const relatedSection = document.getElementById("relatedSection");
const suggestedSection = document.getElementById("suggestedSection");
const relatedProductsGrid = document.getElementById("relatedProductsGrid");
const suggestedProductsGrid = document.getElementById("suggestedProductsGrid");
const cartCountNav = document.getElementById("cartCount");

// ── State ─────────────────────────────────────────────────────────

let currentProduct = null;
let currentProductId = "";
let currentStore = null;
let currentStoreId = "";
let storeNameMap = new Map();

// ── UI Helpers ────────────────────────────────────────────────────

function showLoading() {
  loadingState.style.display = "flex";
  errorState.style.display = "none";
  productContent.style.display = "none";
}

function showError() {
  loadingState.style.display = "none";
  errorState.style.display = "flex";
  productContent.style.display = "none";
}

function showContent() {
  loadingState.style.display = "none";
  errorState.style.display = "none";
  productContent.style.display = "block";
}

function updateCartCount() {
  if (cartCountNav) {
    cartCountNav.textContent = getItemCount();
  }
}

// ── Gallery (future-ready for multiple images) ────────────────────

/**
 * Render the gallery. Currently supports a single image (imageURL),
 * but is built to accept an array of image URLs (imageURLs) later
 * without redesigning the layout.
 */
function renderGallery(product) {
  const images = [];

  // Future-ready: multiple images
  if (Array.isArray(product.imageURLs) && product.imageURLs.length > 0) {
    product.imageURLs.forEach((url) => images.push(String(url)));
  }

  // Current single image
  if (product.imageURL) {
    images.push(String(product.imageURL));
  }

  if (images.length === 0) {
    mainImage.style.display = "none";
    mainImagePlaceholder.style.display = "flex";
    galleryThumbs.replaceChildren();
    return;
  }

  const showImage = (url) => {
    mainImage.src = url;
    mainImage.style.display = "block";
    mainImagePlaceholder.style.display = "none";
  };

  showImage(images[0]);

  // Thumbnails
  galleryThumbs.replaceChildren();
  images.forEach((url, index) => {
    const thumb = document.createElement("div");
    thumb.className = "product-gallery-thumb" + (index === 0 ? " active" : "");
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Product image " + (index + 1);
    img.loading = "lazy";
    thumb.appendChild(img);
    thumb.addEventListener("click", () => {
      showImage(url);
      galleryThumbs.querySelectorAll(".product-gallery-thumb").forEach((t) => t.classList.remove("active"));
      thumb.classList.add("active");
    });
    galleryThumbs.appendChild(thumb);
  });
}

// ── Store Information Card ────────────────────────────────────────

function renderStoreInfo(store, storeId) {
  storeInfoCard.replaceChildren();

  const header = document.createElement("div");
  header.className = "store-info-card-header";

  if (store.logoURL) {
    const logo = document.createElement("img");
    logo.className = "store-info-card-logo";
    logo.src = String(store.logoURL);
    logo.alt = String(store.storeName || "") + " logo";
    logo.loading = "lazy";
    header.appendChild(logo);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "store-info-card-logo-placeholder";
    placeholder.textContent = "🏪";
    header.appendChild(placeholder);
  }

  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "store-info-card-name";
  name.textContent = String(store.storeName || "Unnamed Store");
  info.appendChild(name);

  if (store.category) {
    const category = document.createElement("div");
    category.className = "store-info-card-category";
    category.textContent = String(store.category);
    info.appendChild(category);
  }

  header.appendChild(info);
  storeInfoCard.appendChild(header);

  // Badges
  const badges = document.createElement("div");
  badges.className = "store-info-card-badges";

  const isOpen = store.isOpen === true;
  const openBadge = document.createElement("span");
  openBadge.className = "store-badge " + (isOpen ? "store-badge-open" : "store-badge-closed");
  openBadge.textContent = isOpen ? "● Open" : "● Closed";
  badges.appendChild(openBadge);

  if (store.deliveryAvailable) {
    const deliveryBadge = document.createElement("span");
    deliveryBadge.className = "store-badge store-badge-delivery";
    deliveryBadge.textContent = "Delivery";
    badges.appendChild(deliveryBadge);
  }

  if (store.collectionAvailable) {
    const collectionBadge = document.createElement("span");
    collectionBadge.className = "store-badge store-badge-collection";
    collectionBadge.textContent = "Collection";
    badges.appendChild(collectionBadge);
  }

  storeInfoCard.appendChild(badges);

  // Store rating (average + count) — graceful when no reviews exist
  const avgRating = Number(store.averageRating) || 0;
  const reviewCount = Number(store.reviewCount) || 0;

  if (reviewCount > 0 && avgRating > 0) {
    const ratingRow = document.createElement("div");
    ratingRow.className = "store-info-card-rating";

    const starsWrap = document.createElement("span");
    starsWrap.className = "store-info-card-rating-stars";
    const stars = createRatingStars({
      rating: avgRating,
      size: "sm",
      interactive: false
    });
    starsWrap.appendChild(stars);
    ratingRow.appendChild(starsWrap);

    const ratingLabel = document.createElement("span");
    ratingLabel.className = "store-info-card-rating-label";
    ratingLabel.textContent = `${avgRating.toFixed(1)} (${reviewCount} review${reviewCount !== 1 ? "s" : ""})`;
    ratingRow.appendChild(ratingLabel);

    storeInfoCard.appendChild(ratingRow);
  }

  if (store.description) {
    const desc = document.createElement("p");
    desc.className = "store-info-card-desc";
    desc.textContent = String(store.description);
    storeInfoCard.appendChild(desc);
  }

  const footer = document.createElement("div");
  footer.className = "store-info-card-footer";
  const storeLink = document.createElement("a");
  storeLink.className = "btn";
  storeLink.href = "store.html?id=" + encodeURIComponent(storeId);
  storeLink.textContent = "Visit Store";
  footer.appendChild(storeLink);
  storeInfoCard.appendChild(footer);
}

// ── Render Product ────────────────────────────────────────────────

function renderProduct(product, productId) {
  // Breadcrumb
  if (breadcrumbStore) {
    breadcrumbStore.href = "store.html?id=" + encodeURIComponent(currentStoreId);
    breadcrumbStore.textContent = currentStore?.storeName || "Store";
  }
  if (breadcrumbProduct) breadcrumbProduct.textContent = product.name || "Product";

  // Category
  productCategory.textContent = product.category || "";

  // Name
  productName.textContent = product.name || "Unnamed Product";

  // Store link
  productStoreLink.innerHTML = "";
  if (currentStoreId && currentStore) {
    const link = document.createElement("a");
    link.href = "store.html?id=" + encodeURIComponent(currentStoreId);
    link.textContent = "Sold by " + (currentStore.storeName || "this store");
    productStoreLink.appendChild(link);
  }

  // Price
  productPrice.textContent = formatPrice(product.price);

  // Availability
  const isAvailable = product.available !== false;
  productAvailability.textContent = isAvailable ? "● Available" : "● Unavailable";
  productAvailability.className =
    "product-details-availability " + (isAvailable ? "available" : "unavailable");

  // Description
  productDescription.textContent = product.description || "No description provided.";

  // Gallery
  renderGallery(product);

  // Add to Cart button
  addToCartBtn.disabled = !isAvailable;
  if (!isAvailable) {
    addToCartBtn.textContent = "Currently Unavailable";
  } else {
    addToCartBtn.textContent = "Add to Cart";
  }

  // Back to Store
  backToStoreBtn.href = "store.html?id=" + encodeURIComponent(currentStoreId);

  // Store info card
  renderStoreInfo(currentStore, currentStoreId);
}

// ── Related & Suggested Products ──────────────────────────────────

/**
 * Build related/suggested product cards into the given grid.
 * @param {HTMLElement|null} grid
 * @param {HTMLElement|null} section
 * @param {Array<{id: string, data: Object}>} products
 * @param {Object} options - passed through to createProductCard
 */
function renderProductList(grid, section, products, options = {}) {
  if (!grid || !section) return;

  if (!products || products.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  grid.replaceChildren();

  products.forEach((p) => {
    const productWithStore = {
      ...p.data,
      productId: p.id,
      storeName: (storeNameMap.get(p.data.storeId) || {}).storeName || ""
    };
    const card = createProductCard(productWithStore, p.id, options);
    grid.appendChild(card);
  });
}

/**
 * Load related (same category, other stores) + suggested (same store, other products).
 */
async function loadRelatedAndSuggested(product, productId) {
  const category = product.category || "";
  const storeId = product.storeId || "";

  // Store's other available products → Suggested
  let suggested = [];
  if (storeId) {
    const q = query(
      collection(db, "products"),
      where("storeId", "==", storeId),
      where("available", "==", true)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (docSnap.id !== productId) {
        suggested.push({ id: docSnap.id, data });
      }
    });
  }

  // Same category, other stores → Related
  let related = [];
  if (category) {
    const q = query(
      collection(db, "products"),
      where("category", "==", category),
      where("available", "==", true)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (
        docSnap.id !== productId &&
        data.storeId !== storeId &&
        data.category === category
      ) {
        related.push({ id: docSnap.id, data });
      }
    });
  }

  // Cap at 4 each for performance
  suggested = suggested.slice(0, 4);
  related = related.slice(0, 4);

  renderProductList(suggestedProductsGrid, suggestedSection, suggested, {
    showDescription: false
  });
  renderProductList(relatedProductsGrid, relatedSection, related, {
    showDescription: false
  });
}

// ── Load Product ──────────────────────────────────────────────────

async function loadProduct(productId) {
  showLoading();

  try {
    // Read 1: product
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) {
      showError();
      return;
    }

    const product = productSnap.data();
    currentProduct = product;
    currentProductId = productId;

    // Read 2: store
    const storeId = product.storeId || "";
    currentStoreId = storeId;
    let storeData = null;

    if (storeId) {
      const storeRef = doc(db, "stores", storeId);
      const storeSnap = await getDoc(storeRef);
      if (storeSnap.exists()) {
        storeData = storeSnap.data();
        storeNameMap.set(storeId, { storeName: storeData.storeName || "" });
      }
    }
    currentStore = storeData || {};

    // Read 5 (prefetch store names for cards)
    try {
      const storesQ = query(collection(db, "stores"), where("status", "==", "active"));
      const storesSnap = await getDocs(storesQ);
      storesSnap.forEach((docSnap) => {
        const data = docSnap.data();
        storeNameMap.set(docSnap.id, { storeName: data.storeName || "" });
      });
    } catch {
      // Non-fatal: cards simply show no store name
    }

    renderProduct(product, productId);
    showContent();
    updateCartCount();

    // Load related + suggested (reads 3 & 4)
    await loadRelatedAndSuggested(product, productId);
  } catch {
    showError();
  }
}

// ── Event Listeners ───────────────────────────────────────────────

addToCartBtn?.addEventListener("click", () => {
  if (!currentProduct) return;
  const productWithId = {
    ...currentProduct,
    productId: currentProductId,
    storeId: currentStoreId,
    storeName: currentStore?.storeName || ""
  };
  defaultAddToCart(productWithId, addToCartBtn);
});

// ── Initial Load ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get("id");

  if (!productId) {
    showError();
    return;
  }

  loadProduct(productId);
});

