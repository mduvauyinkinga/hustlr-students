import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  ref,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import { getUserRole } from "./store-utils.js";
import { formatPrice } from "./cart.js";

// ── Elements ──────────────────────────────────────────────────────

const loadingState = document.getElementById("loadingState");
const productsContent = document.getElementById("productsContent");
const productsGrid = document.getElementById("productsGrid");
const productsSubtitle = document.getElementById("productsSubtitle");

// ── State ─────────────────────────────────────────────────────────

let currentUser = null;

// ── Helpers ───────────────────────────────────────────────────────

function showLoading() {
  if (loadingState) loadingState.style.display = "block";
  if (productsContent) productsContent.style.display = "none";
}

function showContent() {
  if (loadingState) loadingState.style.display = "none";
  if (productsContent) productsContent.style.display = "block";
}

// ── Render Product Card ───────────────────────────────────────────

function createProductCard(productDoc) {
  const product = productDoc.data();
  const productId = productDoc.id;

  const card = document.createElement("div");
  card.className = "product-card";

  // Image
  if (product.imageURL) {
    const img = document.createElement("img");
    img.className = "product-card-image";
    img.src = String(product.imageURL);
    img.alt = String(product.name || "Product image");
    img.loading = "lazy";
    card.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "product-card-image-placeholder";
    placeholder.textContent = "📦";
    card.appendChild(placeholder);
  }

  // Body
  const body = document.createElement("div");
  body.className = "product-card-body";

  // Name
  const nameEl = document.createElement("h3");
  nameEl.className = "product-card-name";
  nameEl.textContent = String(product.name || "Unnamed Product");
  body.appendChild(nameEl);

  // Category
  if (product.category) {
    const categoryEl = document.createElement("div");
    categoryEl.className = "product-card-category";
    categoryEl.textContent = String(product.category);
    body.appendChild(categoryEl);
  }

  // Description
  if (product.description) {
    const descEl = document.createElement("p");
    descEl.className = "product-card-description";
    descEl.textContent = String(product.description);
    body.appendChild(descEl);
  }

  // Price
  const priceEl = document.createElement("div");
  priceEl.className = "product-card-price";
  priceEl.textContent = formatPrice(product.price);
  body.appendChild(priceEl);

  // Availability toggle
  const isAvailable = product.available !== false;
  const availabilityEl = document.createElement("span");
  availabilityEl.className = "product-card-availability " + (isAvailable ? "available" : "unavailable");
  availabilityEl.textContent = isAvailable ? "● Available" : "● Unavailable";
  availabilityEl.dataset.productId = productId;
  availabilityEl.dataset.currentState = isAvailable ? "true" : "false";

  availabilityEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    await toggleAvailability(productId, availabilityEl);
  });

  body.appendChild(availabilityEl);

  card.appendChild(body);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "product-card-actions";

  // Edit button
  const editBtn = document.createElement("a");
  editBtn.className = "btn edit-btn";
  editBtn.href = `add-product.html?id=${productId}`;
  editBtn.textContent = "Edit";
  actions.appendChild(editBtn);

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.dataset.productId = productId;
  deleteBtn.dataset.hasImage = product.imageURL ? "true" : "false";

  deleteBtn.addEventListener("click", async () => {
    await handleDelete(productId, deleteBtn.dataset.hasImage === "true");
  });

  actions.appendChild(deleteBtn);

  card.appendChild(actions);

  return card;
}

// ── Toggle Availability ───────────────────────────────────────────

async function toggleAvailability(productId, badgeEl) {
  if (!currentUser) return;

  const isCurrentlyAvailable = badgeEl.dataset.currentState === "true";
  const newAvailability = !isCurrentlyAvailable;

  // Optimistic UI update
  badgeEl.className = "product-card-availability " + (newAvailability ? "available" : "unavailable");
  badgeEl.textContent = newAvailability ? "● Available" : "● Unavailable";
  badgeEl.dataset.currentState = newAvailability ? "true" : "false";

  try {
    await updateDoc(doc(db, "products", productId), {
      available: newAvailability,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    // Revert on failure
    badgeEl.className = "product-card-availability " + (isCurrentlyAvailable ? "available" : "unavailable");
    badgeEl.textContent = isCurrentlyAvailable ? "● Available" : "● Unavailable";
    badgeEl.dataset.currentState = isCurrentlyAvailable ? "true" : "false";
    alert("Unable to update availability. Please try again.");
  }
}

// ── Delete Product ────────────────────────────────────────────────

async function handleDelete(productId, hasImage) {
  if (!currentUser) return;

  const confirmed = confirm("Delete this product? This action cannot be undone.");
  if (!confirmed) return;

  try {
    // Delete image from Storage if exists
    if (hasImage) {
      try {
        const imageRef = ref(storage, `products/${currentUser.uid}/${productId}.jpg`);
        await deleteObject(imageRef);
      } catch (storageErr) {
        // If image doesn't exist in storage, continue with deletion
        if (storageErr.code !== "storage/object-not-found") {
          throw storageErr;
        }
      }
    }

    // Delete document from Firestore
    await deleteDoc(doc(db, "products", productId));

    // Reload products
    loadProducts(currentUser.uid);
  } catch (err) {
    alert("Unable to delete this product right now. Please try again.");
  }
}

// ── Load Products ─────────────────────────────────────────────────

async function loadProducts(uid) {
  showLoading();

  try {
    const q = query(
      collection(db, "products"),
      where("storeId", "==", uid)
    );

    const querySnapshot = await getDocs(q);

    // Clear grid
    productsGrid.replaceChildren();

    // Empty state
    if (querySnapshot.empty) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "products-empty";

      const icon = document.createElement("span");
      icon.className = "empty-icon";
      icon.textContent = "📦";
      emptyEl.appendChild(icon);

      const h3 = document.createElement("h3");
      h3.textContent = "No products yet";
      emptyEl.appendChild(h3);

      const p = document.createElement("p");
      p.textContent = "Add your first product to start selling.";
      emptyEl.appendChild(p);

      const addBtn = document.createElement("a");
      addBtn.className = "btn";
      addBtn.href = "add-product.html";
      addBtn.textContent = "+ Add Product";
      emptyEl.appendChild(addBtn);

      productsGrid.appendChild(emptyEl);

      if (productsSubtitle) productsSubtitle.textContent = "You have no products.";
      showContent();
      return;
    }

    // Render products
    querySnapshot.forEach((productDoc) => {
      const card = createProductCard(productDoc);
      productsGrid.appendChild(card);
    });

    if (productsSubtitle) {
      const count = querySnapshot.size;
      productsSubtitle.textContent = `You have ${count} product${count !== 1 ? "s" : ""}.`;
    }

    showContent();
  } catch (err) {
    productsGrid.replaceChildren();
    const errorEl = document.createElement("div");
    errorEl.className = "products-error";

    const h3 = document.createElement("h3");
    h3.textContent = "Error";
    errorEl.appendChild(h3);

    const p = document.createElement("p");
    p.textContent = "Unable to load your products. Please refresh and try again.";
    errorEl.appendChild(p);

    productsGrid.appendChild(errorEl);
    showContent();
  }
}

// ── Auth Guard ────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  // Role check: only sellers can access products management
  const role = await getUserRole(user.uid);
  if (role !== "seller") {
    window.location.href = "dashboard.html";
    return;
  }

  currentUser = user;

  // Load products
  loadProducts(user.uid);
});

