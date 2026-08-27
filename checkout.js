import { auth, db } from "./firebase.js";
import { getCart, saveCart, clearCart, getCartTotal, formatPrice } from "./cart.js";
import { normalizePhone } from "./phoneUtils.js";
import { logError } from "./production-logger.js";
import { createOrder, generateClientRequestId } from "./orders.js";
import { requireAuthenticatedUser } from "./roles.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Elements ──────────────────────────────────────────────────────

const checkoutLoading = document.getElementById("checkoutLoading");
const checkoutEmpty = document.getElementById("checkoutEmpty");
const checkoutConfirmation = document.getElementById("checkoutConfirmation");
const checkoutContent = document.getElementById("checkoutContent");

const checkoutStoreName = document.getElementById("checkoutStoreName");
const checkoutItems = document.getElementById("checkoutItems");
const checkoutSubtotal = document.getElementById("checkoutSubtotal");
const checkoutItemCount = document.getElementById("checkoutItemCount");
const checkoutDeliveryFee = document.getElementById("checkoutDeliveryFee");
const checkoutDeliveryFeeRow = document.getElementById("checkoutDeliveryFeeRow");
const checkoutTotal = document.getElementById("checkoutTotal");
const cartCountNav = document.getElementById("cartCount");

const checkoutForm = document.getElementById("checkoutForm");
const customerNameInput = document.getElementById("customerName");
const customerPhoneInput = document.getElementById("customerPhone");
const orderTypeCollection = document.getElementById("orderTypeCollection");
const orderTypeDelivery = document.getElementById("orderTypeDelivery");
const addressField = document.getElementById("addressField");
const deliveryAddressInput = document.getElementById("deliveryAddress");
const placeOrderBtn = document.getElementById("placeOrderBtn");
const checkoutStatus = document.getElementById("checkoutStatus");

const nameError = document.getElementById("nameError");
const phoneError = document.getElementById("phoneError");
const addressError = document.getElementById("addressError");

// ── State ─────────────────────────────────────────────────────────

let currentUser = null;
let isSubmitting = false;
let storeData = null; // Cached store data for delivery fee calculation
let checkoutClientRequestId = null;

// ── UI Helpers ────────────────────────────────────────────────────

function showLoading() {
  checkoutLoading.style.display = "flex";
  checkoutEmpty.style.display = "none";
  checkoutConfirmation.style.display = "none";
  checkoutContent.style.display = "none";
}

function showEmpty() {
  checkoutLoading.style.display = "none";
  checkoutEmpty.style.display = "flex";
  checkoutConfirmation.style.display = "none";
  checkoutContent.style.display = "none";
}

function showConfirmation() {
  checkoutLoading.style.display = "none";
  checkoutEmpty.style.display = "none";
  checkoutConfirmation.style.display = "flex";
  checkoutContent.style.display = "none";
}

function showContent() {
  checkoutLoading.style.display = "none";
  checkoutEmpty.style.display = "none";
  checkoutConfirmation.style.display = "none";
  checkoutContent.style.display = "block";
}

function updateNavCount() {
  if (cartCountNav) {
    const cart = getCart();
    const count = cart.items ? cart.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
    cartCountNav.textContent = count;
  }
}

function setStatus(message, type) {
  if (!checkoutStatus) return;
  checkoutStatus.textContent = message;
  checkoutStatus.className = "checkout-status";
  if (type) {
    checkoutStatus.classList.add(type);
    checkoutStatus.classList.add("visible");
  } else {
    checkoutStatus.classList.remove("visible");
  }
}

function clearStatus() {
  if (checkoutStatus) {
    checkoutStatus.textContent = "";
    checkoutStatus.className = "checkout-status";
    checkoutStatus.classList.remove("visible");
  }
}

function clearFieldErrors() {
  [nameError, phoneError, addressError].forEach((el) => {
    if (el) el.classList.remove("visible");
  });
}

// ── Render Cart Review ────────────────────────────────────────────

function renderCheckoutReview(cart) {
  if (!cart || !cart.items || cart.items.length === 0) {
    showEmpty();
    return false;
  }

  // Store name
  if (checkoutStoreName) {
    checkoutStoreName.textContent = cart.storeName ? "From: " + cart.storeName : "";
  }

  // Items
  if (checkoutItems) {
    checkoutItems.replaceChildren();

    cart.items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "checkout-item";

      if (item.imageURL) {
        const img = document.createElement("img");
        img.className = "checkout-item-image";
        img.src = String(item.imageURL);
        img.alt = String(item.name || "Product image");
        img.loading = "lazy";
        el.appendChild(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "checkout-item-image-placeholder";
        placeholder.textContent = "📦";
        el.appendChild(placeholder);
      }

      const info = document.createElement("div");
      info.className = "checkout-item-info";

      const nameEl = document.createElement("div");
      nameEl.className = "checkout-item-name";
      nameEl.textContent = String(item.name || "Unnamed Product");
      info.appendChild(nameEl);

      const detailsEl = document.createElement("div");
      detailsEl.className = "checkout-item-details";
      const rawUnitPrice = Number(item.price) || 0;
      detailsEl.textContent = "Qty: " + (Number(item.quantity) || 0) + " × " + formatPrice(rawUnitPrice);
      info.appendChild(detailsEl);

      el.appendChild(info);

      const priceEl = document.createElement("div");
      priceEl.className = "checkout-item-price";
      const lineTotal = (Number(item.price) || 0) * (Number(item.quantity) || 0);
      priceEl.textContent = formatPrice(lineTotal);
      el.appendChild(priceEl);

      checkoutItems.appendChild(el);
    });
  }

  // Summary
  const subtotal = getCartTotal(cart);
  const totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  const deliveryFee = getDeliveryFee();
  const total = subtotal + deliveryFee;

  if (checkoutSubtotal) checkoutSubtotal.textContent = formatPrice(subtotal);
  if (checkoutItemCount) checkoutItemCount.textContent = totalItems;

  // Show/hide delivery fee row
  const isDelivery = orderTypeDelivery && orderTypeDelivery.checked;
  if (checkoutDeliveryFeeRow) {
    checkoutDeliveryFeeRow.style.display = isDelivery ? "flex" : "none";
  }
  if (checkoutDeliveryFee) {
    checkoutDeliveryFee.textContent = isDelivery ? formatPrice(deliveryFee) : formatPrice(0);
  }

  if (checkoutTotal) checkoutTotal.textContent = formatPrice(total);

  return true;
}

/**
 * Get the delivery fee from cached store data.
 * @returns {number}
 */
function getDeliveryFee() {
  if (storeData && storeData.deliveryFee !== undefined) {
    return Number(storeData.deliveryFee) || 0;
  }
  return 0;
}

// ── Form Validation Helpers ───────────────────────────────────────

function getFieldValue(input) {
  if (!input) return "";
  return input.value.trim();
}

/**
 * Track whether the user has interacted with each field.
 * Errors are only shown for dirty fields (blurred or submit attempted).
 */
const fieldStates = {
  name: { dirty: false },
  phone: { dirty: false },
  address: { dirty: false }
};

/**
 * Pure validity check — NO side effects (does not show/hide error messages).
 * This is used to drive the Place Order button's disabled state.
 */
function isFormValid() {
  let valid = true;

  const name = getFieldValue(customerNameInput);
  if (!name) valid = false;

  const phone = getFieldValue(customerPhoneInput);
  if (!normalizePhone(phone)) valid = false;

  if (orderTypeDelivery && orderTypeDelivery.checked) {
    const address = getFieldValue(deliveryAddressInput);
    if (!address) valid = false;
  }

  return valid;
}

/**
 * Validate a single field and toggle its error message (only if dirty).
 * @param {"name"|"phone"|"address"} fieldName
 * @returns {boolean} true if the field is valid
 */
function validateField(fieldName) {
  const state = fieldStates[fieldName];
  let valid = true;

  if (fieldName === "name") {
    valid = !!getFieldValue(customerNameInput);
    if (nameError && state && state.dirty) nameError.classList.toggle("visible", !valid);
  } else if (fieldName === "phone") {
    valid = !!normalizePhone(getFieldValue(customerPhoneInput));
    if (phoneError && state && state.dirty) phoneError.classList.toggle("visible", !valid);
  } else if (fieldName === "address") {
    const required = orderTypeDelivery && orderTypeDelivery.checked;
    valid = !required || !!getFieldValue(deliveryAddressInput);
    if (addressError) {
      if (state && state.dirty) {
        addressError.classList.toggle("visible", !valid);
      } else if (!required) {
        addressError.classList.remove("visible");
      }
    }
  }

  return valid;
}

/**
 * Mark all fields dirty and validate — used when the user attempts to submit.
 */
function validateAllFields() {
  fieldStates.name.dirty = true;
  fieldStates.phone.dirty = true;
  fieldStates.address.dirty = true;
  validateField("name");
  validateField("phone");
  validateField("address");
  updateSubmitButton();
}

function updateSubmitButton() {
  if (!placeOrderBtn) return;
  // Button disabled when submitting OR form is invalid
  placeOrderBtn.disabled = isSubmitting || !isFormValid();
}

// ── Order Type Toggle ─────────────────────────────────────────────

function onOrderTypeChange() {
  const isDelivery = orderTypeDelivery && orderTypeDelivery.checked;
  if (addressField) {
    addressField.classList.toggle("visible", isDelivery);
  }
  if (addressError) addressError.classList.remove("visible");

  // Re-validate the address only if the user already interacted with it
  if (fieldStates.address.dirty) {
    validateField("address");
  }

  // Re-render summary to show/hide delivery fee
  const cart = getCart();
  renderCheckoutReview(cart);

  // Keep the submit button in sync with the new validation requirements
  updateSubmitButton();
}

// ── Fetch Store Data ──────────────────────────────────────────────

async function fetchStoreData(storeId) {
  try {
    const storeRef = doc(db, "stores", storeId);
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      storeData = storeSnap.data();
      return storeData;
    }
  } catch {
    // Silently fail — delivery fee defaults to 0
  }
  return null;
}

// ── Place Order ───────────────────────────────────────────────────

async function handlePlaceOrder(e) {
  e.preventDefault();

  if (!currentUser) {
    setStatus("You must be logged in to place an order.", "error");
    return;
  }

  if (isSubmitting) return;

  if (!isFormValid()) {
    // User attempted to submit — reveal errors on all fields
    validateAllFields();
    setStatus("Please fill in all required fields.", "error");
    return;
  }

  const cart = getCart();
  if (!cart || !cart.items || cart.items.length === 0) {
    showEmpty();
    return;
  }

  if (!cart.storeId) {
    setStatus("Your cart is missing store information. Please try adding items again.", "error");
    return;
  }

  isSubmitting = true;
  updateSubmitButton();

  const originalBtnText = placeOrderBtn.innerText;
  placeOrderBtn.innerHTML = '<span class="spinner"></span> Placing Order...';
  clearStatus();

  const name = getFieldValue(customerNameInput);
  const phone = getFieldValue(customerPhoneInput);
  const normalizedPhone = normalizePhone(phone);
  const deliveryMethod = orderTypeDelivery && orderTypeDelivery.checked ? "delivery" : "collection";
  const address = deliveryMethod === "delivery" ? getFieldValue(deliveryAddressInput) : "";

  // Build items array with full snapshot data
  const rawItems = cart.items.map((item) => ({
    productId: String(item.productId || ""),
    name: String(item.name || "Unnamed Product"),
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 1,
    imageURL: String(item.imageURL || "")
  }));

  // ── Price Re-validation from Firestore ─────────────────────────
  let priceChanged = false;
  let validatedItems = [];
  for (const item of rawItems) {
    if (!item.productId) {
      validatedItems.push(item);
      continue;
    }
    try {
      const productRef = doc(db, "products", item.productId);
      const productSnap = await getDoc(productRef);
      if (!productSnap.exists()) {
        priceChanged = true;
        continue;
      }
      const freshProduct = productSnap.data();
      const freshPrice = Number(freshProduct.price) || 0;
      if (Math.abs(freshPrice - item.price) > 0.01) {
        priceChanged = true;
      }
      validatedItems.push({
        ...item,
        price: freshPrice,
        name: String(freshProduct.name || item.name),
        imageURL: String(freshProduct.imageURL || item.imageURL)
      });
    } catch (err) {
      logError("CHECKOUT_PRICE_REVALIDATE_FAILED");
      validatedItems.push(item);
    }
  }

  if (priceChanged) {
    const proceed = window.confirm(
      "Some product prices have changed since you added them to your cart. " +
      "Your order total will be updated to reflect the current prices. " +
      "Do you want to proceed?"
    );
    if (!proceed) {
      isSubmitting = false;
      placeOrderBtn.innerHTML = originalBtnText;
      updateSubmitButton();
      return;
    }
    const updatedCart = getCart();
    updatedCart.items = validatedItems.map((vi) => {
      const existing = updatedCart.items.find((i) => i.productId === vi.productId);
      return existing ? { ...existing, price: vi.price, name: vi.name, imageURL: vi.imageURL } : vi;
    });
    // Persist the corrected cart so the review, stored cart, and order payload stay in sync
    saveCart(updatedCart);
    renderCheckoutReview(updatedCart);
  }

  const items = validatedItems.length > 0 ? validatedItems : rawItems;
  const subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const deliveryFee = deliveryMethod === "delivery" ? getDeliveryFee() : 0;
  const total = subtotal + deliveryFee;

  // Get seller name from store data
  const sellerName = storeData ? storeData.storeName || "" : "";

  try {
    // Reuse the key when retrying a request whose response may have been lost.
    if (!checkoutClientRequestId) {
      checkoutClientRequestId = generateClientRequestId();
    }
    const result = await createOrder({
      clientRequestId: checkoutClientRequestId,
      customerId: currentUser.uid,
      customerName: name,
      customerPhone: normalizedPhone,
      storeId: cart.storeId,
      storeName: cart.storeName || "",
      sellerName: sellerName,
      items: items,
      subtotal: subtotal,
      deliveryFee: deliveryFee,
      total: total,
      deliveryMethod: deliveryMethod,
      address: address
    });

    if (!result.success) {
      setStatus(result.error || "Failed to place your order. Please try again.", "error");
      return;
    }

    // Clear cart after successful order
    clearCart();
    updateNavCount();

    // Redirect to customer orders page with the new order ID
    window.location.href = `customer-orders.html?order=${result.orderId}`;
  } catch (err) {
    logError("CHECKOUT_CREATE_ORDER_FAILED");
    const message =
      err?.code === "permission-denied"
        ? "You don't have permission to place an order. Please contact support."
        : err?.code === "unavailable"
        ? "The service is temporarily unavailable. Please try again."
        : "Failed to place your order. Please try again.";
    setStatus(message, "error");
  } finally {
    isSubmitting = false;
    placeOrderBtn.innerHTML = originalBtnText;
    updateSubmitButton();
  }
}

// ── Event Listeners ───────────────────────────────────────────────

orderTypeCollection?.addEventListener("change", onOrderTypeChange);
orderTypeDelivery?.addEventListener("change", onOrderTypeChange);
checkoutForm?.addEventListener("submit", handlePlaceOrder);

// Real-time form validation for submit button + per-field error display.
// Errors only appear after a field is blurred or the user attempts to submit.
function onFieldInput(fieldName) {
  // Once a field is dirty, keep live-validating it as the user types
  if (fieldStates[fieldName] && fieldStates[fieldName].dirty) {
    validateField(fieldName);
  }
  updateSubmitButton();
}

function onFieldBlur(fieldName) {
  if (fieldStates[fieldName]) fieldStates[fieldName].dirty = true;
  validateField(fieldName);
  updateSubmitButton();
}

customerNameInput?.addEventListener("input", () => onFieldInput("name"));
customerNameInput?.addEventListener("blur", () => onFieldBlur("name"));
customerPhoneInput?.addEventListener("input", () => onFieldInput("phone"));
customerPhoneInput?.addEventListener("blur", () => onFieldBlur("phone"));
deliveryAddressInput?.addEventListener("input", () => onFieldInput("address"));
deliveryAddressInput?.addEventListener("blur", () => onFieldBlur("address"));

// ── Auth Guard + Initial Load ─────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  currentUser = user;
  showLoading();

  const cart = getCart();

  if (!cart || !cart.items || cart.items.length === 0) {
    showEmpty();
    return;
  }

  if (!cart.storeId) {
    showEmpty();
    return;
  }

  // Fetch store data for delivery fee
  await fetchStoreData(cart.storeId);

  const hasItems = renderCheckoutReview(cart);
  if (!hasItems) {
    return;
  }

  updateSubmitButton();
  showContent();
  updateNavCount();
});
