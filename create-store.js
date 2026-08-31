import { auth, db } from "./firebase.js";
import { checkStoreExists } from "./store-utils.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Elements ──────────────────────────────────────────────────────

const form = document.getElementById("createStoreForm");
const storeNameInput = document.getElementById("storeName");
const categorySelect = document.getElementById("category");
const descriptionInput = document.getElementById("description");
const phoneInput = document.getElementById("phone");
const whatsappInput = document.getElementById("whatsapp");
const submitBtn = document.getElementById("createStoreBtn");
const statusEl = document.getElementById("createStoreStatus");

// ── State ─────────────────────────────────────────────────────────

let currentUser = null;
let isSubmitting = false;

// ── Helpers ───────────────────────────────────────────────────────

function setStatus(message, type) {
  if (!statusEl) return;
  statusEl.innerText = message;
  statusEl.className = "create-store-status";
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
    getFieldValue(categorySelect).length > 0 &&
    categorySelect.value !== "" &&
    getFieldValue(descriptionInput).length > 0 &&
    getFieldValue(phoneInput).length > 0 &&
    getFieldValue(whatsappInput).length > 0
  );
}

function updateSubmitButton() {
  if (!submitBtn) return;
  submitBtn.disabled = !isFormValid() || isSubmitting;
}

function redirectToPendingStoreFlow() {
  window.location.href = "subscription.html";
}

// ── Form Validation on Input ──────────────────────────────────────

function onFieldInput() {
  updateSubmitButton();
}

storeNameInput?.addEventListener("input", onFieldInput);
categorySelect?.addEventListener("change", onFieldInput);
descriptionInput?.addEventListener("input", onFieldInput);
phoneInput?.addEventListener("input", onFieldInput);
whatsappInput?.addEventListener("input", onFieldInput);

// ── Auth Guard + Store Existence Check ────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  const hasStore = await checkStoreExists(user.uid);
  if (hasStore) {
    const storeSnap = await getDoc(doc(db, "stores", user.uid));
    const storeStatus = storeSnap.data()?.status || "pending_subscription";
    if (storeStatus === "pending_subscription" || storeStatus === "pending") {
      redirectToPendingStoreFlow();
      return;
    }
    if (storeStatus === "active") {
      window.location.href = "dashboard.html";
      return;
    }
  }

  currentUser = user;
  updateSubmitButton();
});

// ── Create Store Submit Handler ───────────────────────────────────

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) {
    setStatus("You must be logged in to create a store.", "error");
    return;
  }

  if (isSubmitting) return;

  if (!isFormValid()) {
    setStatus("Please complete all required fields.", "error");
    return;
  }

  const storeName = getFieldValue(storeNameInput);
  const category = categorySelect.value;
  const description = getFieldValue(descriptionInput);
  const phone = getFieldValue(phoneInput);
  const whatsapp = getFieldValue(whatsappInput);

  isSubmitting = true;
  updateSubmitButton();

  const originalBtnText = submitBtn.innerText;
  submitBtn.innerHTML = '<span class="spinner"></span> Creating Store...';
  setStatus("");

  try {
    const storeRef = doc(db, "stores", currentUser.uid);
    const storePrivateRef = doc(db, "storePrivate", currentUser.uid);
    const batch = writeBatch(db);

    batch.set(storeRef, {
      storeName: storeName,
      category: category,
      description: description,
      phone: phone,
      whatsapp: whatsapp,
      logoURL: "",
      bannerURL: "",
      deliveryAvailable: false,
      collectionAvailable: true,
      deliveryFee: 0,
      rating: 0,
      averageRating: 0,
      reviewCount: 0,
      ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      isOpen: true,
      status: "pending_subscription",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(storePrivateRef, {
      ownerId: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    setStatus("Store created. Please complete the seller subscription to activate your account.", "success");
    redirectToPendingStoreFlow();
  } catch (err) {
    try {
      const storeRef = doc(db, "stores", currentUser.uid);
      const privateRef = doc(db, "storePrivate", currentUser.uid);
      const batch = writeBatch(db);
      batch.set(storeRef, { status: "disabled" }, { merge: true });
      batch.delete(privateRef);
      await batch.commit();
    } catch (rollbackErr) {
      console.error("[HUSTLR:ROLLBACK]", rollbackErr);
    }

    const message =
      err?.code === "permission-denied"
        ? "You don't have permission to create a store. Please contact support."
        : err?.code === "unavailable"
        ? "The service is temporarily unavailable. Please try again."
        : "Failed to create your store. Please try again.";

    setStatus(message, "error");
  } finally {
    isSubmitting = false;
    submitBtn.innerHTML = originalBtnText;
    updateSubmitButton();
  }
});
