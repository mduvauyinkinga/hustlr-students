import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  addDoc,
  updateDoc,
  writeBatch,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import { getUserRole } from "./store-utils.js";

// ── Constants ─────────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// ── Elements ──────────────────────────────────────────────────────

const loadingState = document.getElementById("loadingState");
const addProductContent = document.getElementById("addProductContent");

const formTitle = document.getElementById("formTitle");
const formSubtitle = document.getElementById("formSubtitle");
const form = document.getElementById("addProductForm");

const imageInput = document.getElementById("imageInput");
const imageUploadArea = document.getElementById("imageUploadArea");
const imagePreview = document.getElementById("imagePreview");
const imageUploadIcon = document.getElementById("imageUploadIcon");
const imageUploadText = document.getElementById("imageUploadText");
const imageUploadSpinner = document.getElementById("imageUploadSpinner");

const productNameInput = document.getElementById("productName");
const categorySelect = document.getElementById("category");
const descriptionInput = document.getElementById("description");
const priceInput = document.getElementById("price");
const availableToggle = document.getElementById("available");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("addProductStatus");

// ── State ─────────────────────────────────────────────────────────

let currentUser = null;
let isSubmitting = false;
let selectedFile = null;
let existingImageURL = null;
let isEditMode = false;
let editProductId = null;

// ── Helpers ───────────────────────────────────────────────────────

function setStatus(message, type) {
  if (!statusEl) return;
  statusEl.innerText = message;
  statusEl.className = "add-product-status";
  if (type) {
    statusEl.classList.add(type);
  }
}

function getFieldValue(input) {
  if (!input) return "";
  return input.value.trim();
}

function isFormValid() {
  return (
    getFieldValue(productNameInput).length > 0 &&
    categorySelect.value !== "" &&
    categorySelect.value !== null &&
    parseFloat(priceInput?.value) >= 0
  );
}

function updateSaveButton() {
  if (!saveBtn) return;
  saveBtn.disabled = !isFormValid() || isSubmitting;
}

function showLoading() {
  if (loadingState) loadingState.style.display = "block";
  if (addProductContent) addProductContent.style.display = "none";
}

function showContent() {
  if (loadingState) loadingState.style.display = "none";
  if (addProductContent) addProductContent.style.display = "block";
}

// ── Form Validation on Input ──────────────────────────────────────

function onFieldInput() {
  updateSaveButton();
}

productNameInput?.addEventListener("input", onFieldInput);
categorySelect?.addEventListener("change", onFieldInput);
priceInput?.addEventListener("input", onFieldInput);

// ── Image Upload Handling ─────────────────────────────────────────

function validateImage(file) {
  if (!file) return { valid: false, error: "" };

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: "Please upload a JPG, PNG or WEBP image." };
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return { valid: false, error: "Image must be less than 5MB." };
  }

  return { valid: true, error: "" };
}

imageInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const validation = validateImage(file);
  if (!validation.valid) {
    setStatus(validation.error, "error");
    imageInput.value = "";
    return;
  }

  selectedFile = file;

  // Show preview
  const reader = new FileReader();
  reader.onload = (event) => {
    imagePreview.src = event.target.result;
    imagePreview.style.display = "block";
    imageUploadIcon.style.display = "none";
    imageUploadText.textContent = "Change image";
    imageUploadArea.classList.add("has-image");
  };
  reader.readAsDataURL(file);

  setStatus("");
});

imageUploadArea?.addEventListener("click", () => {
  imageInput?.click();
});

imageInput?.addEventListener("click", (e) => e.stopPropagation());

// ── Load Existing Product (Edit Mode) ─────────────────────────────

async function loadProductForEdit(productId) {
  showLoading();

  try {
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) {
      setStatus("Product not found.", "error");
      showContent();
      return;
    }

    const product = productSnap.data();

    // Security: verify ownership
    if (product.storeId !== currentUser.uid) {
      window.location.href = "products.html";
      return;
    }

    // Populate form
    if (productNameInput) productNameInput.value = product.name || "";
    if (categorySelect) categorySelect.value = product.category || "";
    if (descriptionInput) descriptionInput.value = product.description || "";
    if (priceInput) priceInput.value = product.price ?? "";
    if (availableToggle) availableToggle.checked = product.available !== false;

    // Existing image
    if (product.imageURL) {
      existingImageURL = product.imageURL;
      imagePreview.src = product.imageURL;
      imagePreview.style.display = "block";
      imageUploadIcon.style.display = "none";
      imageUploadText.textContent = "Change image";
      imageUploadArea.classList.add("has-image");
    }

    // Update title
    if (formTitle) formTitle.textContent = "Edit Product";
    if (formSubtitle) formSubtitle.textContent = "Update your product details.";

    updateSaveButton();
    showContent();
  } catch (err) {
    setStatus("Unable to load product. Please try again.", "error");
    showContent();
  }
}

// ── Upload Image to Storage ───────────────────────────────────────

async function uploadProductImage(productId, file) {
  const storagePath = `products/${currentUser.uid}/${productId}.jpg`;
  const storageRef = ref(storage, storagePath);

  const uploadTask = uploadBytesResumable(storageRef, file);

  await new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      null,
      (error) => reject(error),
      () => resolve()
    );
  });

  return await getDownloadURL(storageRef);
}

// ── Delete Old Image (for edit mode) ──────────────────────────────

async function deleteOldImage() {
  if (!existingImageURL) return;

  try {
    const oldImageRef = ref(storage, `products/${currentUser.uid}/${editProductId}.jpg`);
    await deleteObject(oldImageRef);
  } catch (err) {
    // If the old image doesn't exist in storage, ignore
    if (err.code !== "storage/object-not-found") {
      throw err;
    }
  }
}

// ── Form Submit Handler ───────────────────────────────────────────

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) {
    setStatus("You must be logged in to add a product.", "error");
    return;
  }

  if (isSubmitting) return;

  // Validate form
  if (!isFormValid()) {
    setStatus("Please complete all required fields.", "error");
    return;
  }

const name = getFieldValue(productNameInput);
  const category = categorySelect.value;
  const description = getFieldValue(descriptionInput);
  const price = parseFloat(priceInput?.value) || 0;
  const available = availableToggle?.checked ?? true;

  // ── Input Validation ──────────────────────────────────────────
  if (!name) {
    setStatus("Product name is required.", "error");
    isSubmitting = false;
    updateSaveButton();
    return;
  }
  if (!description) {
    setStatus("Product description is required.", "error");
    isSubmitting = false;
    updateSaveButton();
    return;
  }
  if (price < 0) {
    setStatus("Price cannot be negative.", "error");
    isSubmitting = false;
    updateSaveButton();
    return;
  }

  // ── Start submission ──────────────────────────────────────────

  isSubmitting = true;
  updateSaveButton();

  const originalBtnText = saveBtn.innerText;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving...';
  setStatus("");

  try {
    if (isEditMode && editProductId) {
      // ── EDIT MODE ───────────────────────────────────────────

      const updates = {
        name,
        category,
        description,
        price,
        available,
        updatedAt: serverTimestamp()
      };

      // If a new image was selected, upload it
      if (selectedFile) {
        // Delete old image first
        await deleteOldImage();

        // Upload new image
        const downloadURL = await uploadProductImage(editProductId, selectedFile);
        updates.imageURL = downloadURL;
      }

      // Update Firestore
      const productRef = doc(db, "products", editProductId);
      await updateDoc(productRef, updates);

      setStatus("Product updated successfully!", "success");
    } else {
      // ── CREATE MODE ─────────────────────────────────────────

      // Step 1: Create product document first (without imageURL)
      const productData = {
        storeId: currentUser.uid,
        name,
        description,
        price,
        category,
        imageURL: "",
        available,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, "products"), productData);
      const productId = docRef.id;

      const productPrivateRef = doc(db, "productPrivate", productId);
      const batch = writeBatch(db);
      batch.set(productPrivateRef, {
        ownerId: currentUser.uid,
        storeId: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await batch.commit();

      // Step 2: Upload image if selected
      if (selectedFile) {
        const downloadURL = await uploadProductImage(productId, selectedFile);

        // Step 3: Update document with imageURL
        await updateDoc(doc(db, "products", productId), {
          imageURL: downloadURL,
          updatedAt: serverTimestamp()
        });
      }

      setStatus("Product created successfully!", "success");
    }

    // Redirect to products page after short delay
    setTimeout(() => {
      window.location.href = "products.html";
    }, 1000);
  } catch (err) {
    const message =
      err?.code === "permission-denied"
        ? "You don't have permission to perform this action."
        : err?.code === "unavailable"
        ? "The service is temporarily unavailable. Please try again."
        : "Failed to save product. Please try again.";

    setStatus(message, "error");
  } finally {
    isSubmitting = false;
    saveBtn.innerHTML = originalBtnText;
    updateSaveButton();
  }
});

// ── Auth Guard ────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  // Role check: only sellers can add/edit products
  const role = await getUserRole(user.uid);
  if (role !== "seller") {
    window.location.href = "dashboard.html";
    return;
  }

  currentUser = user;

  // Check if we're in edit mode
  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get("id");

  if (productId) {
    isEditMode = true;
    editProductId = productId;
    await loadProductForEdit(productId);
  } else {
    // Create mode
    showContent();
    updateSaveButton();
  }
});

