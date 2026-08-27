import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  ref,
  uploadBytesResumable,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import { getUserRole } from "./store-utils.js";

// ── Constants ─────────────────────────────────────────────────────

/** Exposed for future modules (Product Manager, Orders, etc.).
 *  This value is set once the authenticated user is confirmed.
 *  Future modules can import this after my-store has initialized. */
export let STORE_ID = null;

// ── Elements ──────────────────────────────────────────────────────

const loadingState = document.getElementById("loadingState");
const myStoreContent = document.getElementById("myStoreContent");

const storeNameInput = document.getElementById("storeName");
const categoryDisplay = document.getElementById("categoryDisplay");
const descriptionInput = document.getElementById("description");
const phoneInput = document.getElementById("phone");
const whatsappInput = document.getElementById("whatsapp");
const openingTimeInput = document.getElementById("openingTime");
const closingTimeInput = document.getElementById("closingTime");
const deliveryFeeInput = document.getElementById("deliveryFee");
const deliveryAvailableToggle = document.getElementById("deliveryAvailable");
const collectionAvailableToggle = document.getElementById("collectionAvailable");
const isOpenToggle = document.getElementById("isOpen");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("myStoreStatus");

// Logo elements
const logoInput = document.getElementById("logoInput");
const logoUploadArea = document.getElementById("logoUploadArea");
const logoPreview = document.getElementById("logoPreview");
const logoUploadIcon = document.getElementById("logoUploadIcon");
const logoUploadText = document.getElementById("logoUploadText");
const logoUploadSpinner = document.getElementById("logoUploadSpinner");

// Banner elements
const bannerInput = document.getElementById("bannerInput");
const bannerUploadArea = document.getElementById("bannerUploadArea");
const bannerPreview = document.getElementById("bannerPreview");
const bannerUploadIcon = document.getElementById("bannerUploadIcon");
const bannerUploadText = document.getElementById("bannerUploadText");
const bannerUploadSpinner = document.getElementById("bannerUploadSpinner");

// Preview elements
const previewName = document.getElementById("previewName");
const previewLogo = document.getElementById("previewLogo");
const previewBanner = document.getElementById("previewBanner");
const previewBannerPlaceholder = document.getElementById("previewBannerPlaceholder");
const previewCategory = document.getElementById("previewCategory");
const previewStatusBadge = document.getElementById("previewStatusBadge");

// ── State ─────────────────────────────────────────────────────────

let currentUser = null;
let storeData = {};
let isSubmitting = false;
let logoUploading = false;
let bannerUploading = false;

// ── Helpers ───────────────────────────────────────────────────────

function setStatus(message, type) {
  if (!statusEl) return;
  statusEl.innerText = message;
  statusEl.className = "my-store-status";
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
    getFieldValue(storeNameInput).length > 0 &&
    getFieldValue(phoneInput).length > 0 &&
    getFieldValue(whatsappInput).length > 0
  );
}

function updateSaveButton() {
  if (!saveBtn) return;
  saveBtn.disabled = !isFormValid() || isSubmitting || logoUploading || bannerUploading;
}

function showLoading() {
  if (loadingState) loadingState.style.display = "block";
  if (myStoreContent) myStoreContent.style.display = "none";
}

function showContent() {
  if (loadingState) loadingState.style.display = "none";
  if (myStoreContent) myStoreContent.style.display = "block";
}

// ── Live Preview Updates ──────────────────────────────────────────

function updatePreview() {
  // Name
  const name = getFieldValue(storeNameInput) || storeData?.storeName || "Your Store Name";
  previewName.textContent = name;

  // Status badge
  const isOpen = isOpenToggle?.checked ?? storeData?.isOpen ?? false;
  previewStatusBadge.textContent = isOpen ? "Open" : "Closed";
  previewStatusBadge.className = "preview-status-badge " + (isOpen ? "open" : "closed");
}

function updatePreviewLogo(url) {
  if (url) {
    previewLogo.src = url;
    previewLogo.style.display = "block";
  } else {
    previewLogo.removeAttribute("src");
    previewLogo.style.display = "none";
  }
}

function updatePreviewBanner(url) {
  if (url) {
    previewBanner.src = url;
    previewBanner.style.display = "block";
    previewBannerPlaceholder.style.display = "none";
  } else {
    previewBanner.removeAttribute("src");
    previewBanner.style.display = "none";
    previewBannerPlaceholder.style.display = "flex";
  }
}

// Input listeners for live preview
storeNameInput?.addEventListener("input", updatePreview);
isOpenToggle?.addEventListener("change", updatePreview);

// ── Image Upload (Logo) ───────────────────────────────────────────

async function handleLogoUpload(file) {
  if (!file || !currentUser) return;

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    setStatus("Please upload a JPG, PNG or WEBP image.", "error");
    return;
  }

  logoUploading = true;
  updateSaveButton();

  // Show spinner
  logoUploadIcon.style.display = "none";
  logoUploadText.textContent = "Uploading...";
  logoUploadSpinner.style.display = "inline-block";

  try {
    // Always overwrite: use the same path
    const storagePath = `stores/${currentUser.uid}/logo.jpg`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    // Wait for upload to complete
    await new Promise((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        null,
        (error) => reject(error),
        () => resolve()
      );
    });

    const downloadURL = await getDownloadURL(storageRef);

    // Update Firestore immediately
    const storeRef = doc(db, "stores", currentUser.uid);
    await updateDoc(storeRef, {
      logoURL: downloadURL,
      updatedAt: serverTimestamp()
    });

    // Update local state and UI
    storeData.logoURL = downloadURL;
    logoPreview.src = downloadURL;
    logoPreview.style.display = "block";
    logoUploadText.textContent = "Change logo";
    logoUploadArea.classList.add("has-image");

    // Update preview
    updatePreviewLogo(downloadURL);

    setStatus("Logo updated!", "success");
  } catch (err) {
    setStatus("Failed to upload logo. Please try again.", "error");
  } finally {
    logoUploading = false;
    logoUploadIcon.style.display = "inline";
    logoUploadSpinner.style.display = "none";
    logoUploadText.textContent = logoPreview.style.display === "block" ? "Change logo" : "Click to upload logo";
    updateSaveButton();
  }
}

// ── Image Upload (Banner) ─────────────────────────────────────────

async function handleBannerUpload(file) {
  if (!file || !currentUser) return;

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    setStatus("Please upload a JPG, PNG or WEBP image.", "error");
    return;
  }

  bannerUploading = true;
  updateSaveButton();

  // Show spinner
  bannerUploadIcon.style.display = "none";
  bannerUploadText.textContent = "Uploading...";
  bannerUploadSpinner.style.display = "inline-block";

  try {
    // Always overwrite: use the same path
    const storagePath = `stores/${currentUser.uid}/banner.jpg`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    // Wait for upload to complete
    await new Promise((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        null,
        (error) => reject(error),
        () => resolve()
      );
    });

    const downloadURL = await getDownloadURL(storageRef);

    // Update Firestore immediately
    const storeRef = doc(db, "stores", currentUser.uid);
    await updateDoc(storeRef, {
      bannerURL: downloadURL,
      updatedAt: serverTimestamp()
    });

    // Update local state and UI
    storeData.bannerURL = downloadURL;
    bannerPreview.src = downloadURL;
    bannerPreview.style.display = "block";
    bannerUploadText.textContent = "Change banner";
    bannerUploadArea.classList.add("has-image");

    // Update preview
    updatePreviewBanner(downloadURL);

    setStatus("Banner updated!", "success");
  } catch (err) {
    setStatus("Failed to upload banner. Please try again.", "error");
  } finally {
    bannerUploading = false;
    bannerUploadIcon.style.display = "inline";
    bannerUploadSpinner.style.display = "none";
    bannerUploadText.textContent = bannerPreview.style.display === "block" ? "Change banner" : "Click to upload banner";
    updateSaveButton();
  }
}

// ── Upload Event Listeners ────────────────────────────────────────

logoInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) handleLogoUpload(file);
});

bannerInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) handleBannerUpload(file);
});

// Click on upload area triggers file input
logoUploadArea?.addEventListener("click", () => {
  // Always open file picker when clicking the area
  logoInput?.click();
});

// Prevent double-trigger when clicking input directly
logoInput?.addEventListener("click", (e) => e.stopPropagation());

bannerUploadArea?.addEventListener("click", () => {
  bannerInput?.click();
});

bannerInput?.addEventListener("click", (e) => e.stopPropagation());

// ── Load Store Data ───────────────────────────────────────────────

async function loadStore(uid) {
  showLoading();

  try {
    const storeRef = doc(db, "stores", uid);
    const storeSnap = await getDoc(storeRef);

    if (!storeSnap.exists()) {
      window.location.href = "create-store.html";
      return;
    }

    storeData = storeSnap.data();

    // Populate form fields
    if (storeNameInput) storeNameInput.value = storeData.storeName || "";
    if (categoryDisplay) categoryDisplay.textContent = storeData.category || "-";
    if (descriptionInput) descriptionInput.value = storeData.description || "";
    if (phoneInput) phoneInput.value = storeData.phone || "";
    if (whatsappInput) whatsappInput.value = storeData.whatsapp || "";
    if (openingTimeInput) openingTimeInput.value = storeData.openingTime || "";
    if (closingTimeInput) closingTimeInput.value = storeData.closingTime || "";
    if (deliveryFeeInput) deliveryFeeInput.value = storeData.deliveryFee ?? "";
    if (deliveryAvailableToggle) deliveryAvailableToggle.checked = !!storeData.deliveryAvailable;
    if (collectionAvailableToggle) collectionAvailableToggle.checked = !!storeData.collectionAvailable;
    if (isOpenToggle) isOpenToggle.checked = !!storeData.isOpen;

    // Populate logo preview
    if (storeData.logoURL) {
      logoPreview.src = storeData.logoURL;
      logoPreview.style.display = "block";
      logoUploadText.textContent = "Change logo";
      logoUploadArea.classList.add("has-image");
      updatePreviewLogo(storeData.logoURL);
    }

    // Populate banner preview
    if (storeData.bannerURL) {
      bannerPreview.src = storeData.bannerURL;
      bannerPreview.style.display = "block";
      bannerUploadText.textContent = "Change banner";
      bannerUploadArea.classList.add("has-image");
      updatePreviewBanner(storeData.bannerURL);
    }

    // Category display
    if (storeData.category) {
      previewCategory.textContent = storeData.category;
    }

    // Update preview
    updatePreview();

    // Enable form
    updateSaveButton();

    showContent();
  } catch (err) {
    setStatus("Unable to load your store. Please refresh and try again.", "error");
    showContent();
  }
}

// ── Form Validation on Input ──────────────────────────────────────

function onFieldInput() {
  updateSaveButton();
}

storeNameInput?.addEventListener("input", onFieldInput);
phoneInput?.addEventListener("input", onFieldInput);
whatsappInput?.addEventListener("input", onFieldInput);

// ── Auth Guard ────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  // Role check: only sellers can access my-store
  const role = await getUserRole(user.uid);
  if (role !== "seller") {
    window.location.href = "dashboard.html";
    return;
  }

  currentUser = user;

  // Expose STORE_ID for future modules (e.g. Product Manager, Orders)
  STORE_ID = user.uid;

  // Load store data
  loadStore(user.uid);
});

// ── Save Changes Handler ──────────────────────────────────────────

const form = document.getElementById("myStoreForm");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) {
    setStatus("You must be logged in to update your store.", "error");
    return;
  }

  if (isSubmitting) return;

  // Validate required fields
  if (!isFormValid()) {
    setStatus("Store Name, Phone and WhatsApp are required.", "error");
    return;
  }

  // Validate delivery fee
  const deliveryFeeVal = parseFloat(deliveryFeeInput?.value);
  if (deliveryFeeVal < 0 || (deliveryFeeInput?.value && isNaN(deliveryFeeVal))) {
    setStatus("Delivery fee must be zero or greater.", "error");
    return;
  }

  // Build update object with only the fields being edited
  const updates = {
    storeName: getFieldValue(storeNameInput),
    description: getFieldValue(descriptionInput),
    phone: getFieldValue(phoneInput),
    whatsapp: getFieldValue(whatsappInput),
    openingTime: openingTimeInput?.value || "",
    closingTime: closingTimeInput?.value || "",
    deliveryFee: deliveryFeeVal >= 0 ? deliveryFeeVal : 0,
    deliveryAvailable: !!deliveryAvailableToggle?.checked,
    collectionAvailable: !!collectionAvailableToggle?.checked,
    isOpen: !!isOpenToggle?.checked,
    updatedAt: serverTimestamp()
  };

  // Start submission
  isSubmitting = true;
  updateSaveButton();

  const originalBtnText = saveBtn.innerText;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving...';
  setStatus("");

  try {
    const storeRef = doc(db, "stores", currentUser.uid);
    await updateDoc(storeRef, updates);

    // Update local data
    Object.assign(storeData, updates);

    setStatus("Store updated successfully!", "success");
    updatePreview();
  } catch (err) {
    const message =
      err?.code === "permission-denied"
        ? "You don't have permission to update this store."
        : err?.code === "unavailable"
        ? "The service is temporarily unavailable. Please try again."
        : "Failed to save changes. Please try again.";

    setStatus(message, "error");
  } finally {
    isSubmitting = false;
    saveBtn.innerHTML = originalBtnText;
    updateSaveButton();
  }
});

