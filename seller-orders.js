/**
 * seller-orders.js — Seller Order Management Page.
 *
 * Displays the seller's incoming orders with metrics and filter support.
 * Uses the shared orders.js module as the single source of truth.
 * Uses order-details.js for the reusable order details modal.
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getCurrentUserRole } from "./roles.js";
import { formatPrice } from "./cart.js";

import {
  subscribeToSellerOrders,
  updateOrderStatus,
  createOrderCard,
  getAvailableActions,
  ORDER_STATUS,
  STATUS_LABELS
} from "./orders.js";

import { createOrderDetailsModal } from "./order-details.js";

// ── Elements ──────────────────────────────────────────────────────

const ordersLoading = document.getElementById("ordersLoading");
const ordersAuthRequired = document.getElementById("ordersAuthRequired");
const ordersNotSeller = document.getElementById("ordersNotSeller");
const ordersEmpty = document.getElementById("ordersEmpty");
const ordersContent = document.getElementById("ordersContent");
const ordersError = document.getElementById("ordersError");
const sellerOrdersList = document.getElementById("sellerOrdersList");
const sellerOrderFilters = document.getElementById("sellerOrderFilters");

// Seller metrics
const metricPending = document.getElementById("metricPending");
const metricOrdersToday = document.getElementById("metricOrdersToday");
const metricRevenueToday = document.getElementById("metricRevenueToday");
const metricCompletedToday = document.getElementById("metricCompletedToday");

// ── State ─────────────────────────────────────────────────────────

/** @type {function|null} */
let ordersUnsubscribe = null;

/** @type {string} */
let currentFilter = "all";

/** @type {Array} */
let allSellerOrders = [];

/** @type {string|null} */
let storeId = null;

/** @type {string|null} */
let deepLinkOrderId = null;

// ── UI Helpers ────────────────────────────────────────────────────

function showElement(el) {
  if (el) el.style.display = "";
}

function hideElement(el) {
  if (el) el.style.display = "none";
}

function showLoading() {
  hideElement(ordersAuthRequired);
  hideElement(ordersNotSeller);
  hideElement(ordersEmpty);
  hideElement(ordersContent);
  hideElement(ordersError);
  showElement(ordersLoading);
}

function showAuthRequired() {
  hideElement(ordersLoading);
  hideElement(ordersNotSeller);
  hideElement(ordersEmpty);
  hideElement(ordersContent);
  hideElement(ordersError);
  showElement(ordersAuthRequired);
}

function showNotSeller() {
  hideElement(ordersLoading);
  hideElement(ordersAuthRequired);
  hideElement(ordersEmpty);
  hideElement(ordersContent);
  hideElement(ordersError);
  showElement(ordersNotSeller);
}

function showEmpty() {
  hideElement(ordersLoading);
  hideElement(ordersAuthRequired);
  hideElement(ordersNotSeller);
  hideElement(ordersContent);
  hideElement(ordersError);
  showElement(ordersEmpty);
}

function showContent() {
  hideElement(ordersLoading);
  hideElement(ordersAuthRequired);
  hideElement(ordersNotSeller);
  hideElement(ordersEmpty);
  hideElement(ordersError);
  showElement(ordersContent);
}

function showError() {
  hideElement(ordersLoading);
  hideElement(ordersAuthRequired);
  hideElement(ordersNotSeller);
  hideElement(ordersEmpty);
  hideElement(ordersContent);
  showElement(ordersError);
}

// ── Deep Link Support ─────────────────────────────────────────────

/**
 * Parse the URL for an order ID parameter.
 * Supports: seller-orders.html?order=abc123
 * @returns {string|null}
 */
function getDeepLinkOrderId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("order");
}

/**
 * Open an order details modal for the given order ID.
 * @param {string} orderId
 */
function openOrderByDeepLink(orderId) {
  if (!orderId || !allSellerOrders.length) return;

  const order = allSellerOrders.find((o) => o.id === orderId);
  if (!order) return;

  setTimeout(() => {
    const modal = createOrderDetailsModal(order, {
      isSeller: true,
      onAction: handleSellerOrderAction
    });
    document.body.appendChild(modal);
    document.body.style.overflow = "hidden";
  }, 300);
}

// ── Fetch Seller Store ID ─────────────────────────────────────────

/**
 * Get the store ID for the current seller.
 * The store document ID matches the user's UID.
 * @param {string} uid
 * @returns {Promise<string|null>}
 */
async function getSellerStoreId(uid) {
  if (!uid) return null;
  try {
    const storeRef = doc(db, "stores", uid);
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      return uid; // Store ID = user UID in this architecture
    }
  } catch {
    // Silently fail
  }
  return null;
}

// ── Order Listener ────────────────────────────────────────────────

function startOrdersListener(sId) {
  // Clean up previous listener
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }

  ordersUnsubscribe = subscribeToSellerOrders(
    sId,
    (data) => {
      // Update metrics
      updateSellerMetrics(data.metrics);

      // Store all orders for filtering
      allSellerOrders = data.orders;

      // Render based on current filter
      renderSellerOrders(currentFilter);

      // If there's a deep link order, open it after first render
      if (deepLinkOrderId) {
        openOrderByDeepLink(deepLinkOrderId);
        deepLinkOrderId = null; // Only open once
      }
    },
    (err) => {
      showError();
    }
  );
}

// ── Update Seller Metrics ─────────────────────────────────────────

function updateSellerMetrics(metrics) {
  if (!metrics) return;

  if (metricPending) {
    metricPending.textContent = String(metrics.pending || 0);
  }
  if (metricOrdersToday) {
    metricOrdersToday.textContent = String(metrics.ordersToday || 0);
  }
  if (metricRevenueToday) {
    metricRevenueToday.textContent = formatPrice(metrics.revenueToday || 0);
  }
  if (metricCompletedToday) {
    metricCompletedToday.textContent = String(metrics.completedToday || 0);
  }
}

// ── Render Orders ─────────────────────────────────────────────────

function renderSellerOrders(filter) {
  if (!allSellerOrders || allSellerOrders.length === 0) {
    showEmpty();
    return;
  }

  let filtered = allSellerOrders;
  if (filter && filter !== "all") {
    if (filter === "completed") {
      filtered = allSellerOrders.filter((o) => o.status === ORDER_STATUS.COMPLETED);
    } else if (filter === "cancelled") {
      filtered = allSellerOrders.filter(
        (o) => o.status === ORDER_STATUS.CANCELLED || o.status === ORDER_STATUS.REJECTED
      );
    } else {
      filtered = allSellerOrders.filter((o) => o.status === filter);
    }
  }

  if (filtered.length === 0) {
    showEmpty();
    return;
  }

  showContent();
  sellerOrdersList.replaceChildren();

  filtered.forEach((order) => {
    const card = createOrderCard(order, true, {
      onAction: handleSellerOrderAction
    });

    // Click to open order details modal
    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      // Don't open if clicking an action button
      if (e.target.closest(".order-action-btn")) return;
      openOrderDetailsModal(order);
    });

    sellerOrdersList.appendChild(card);
  });
}

// ── Seller Order Action Handler ───────────────────────────────────

async function handleSellerOrderAction(orderId, nextStatus, order) {
  // For rejections, ask for confirmation
  if (nextStatus === ORDER_STATUS.REJECTED) {
    const confirmed = window.confirm(
      "Are you sure you want to reject this order? This cannot be undone."
    );
    if (!confirmed) return;
  }

  // For completed, ask for confirmation
  if (nextStatus === ORDER_STATUS.COMPLETED) {
    const confirmed = window.confirm("Mark this order as completed?");
    if (!confirmed) return;
  }

  const result = await updateOrderStatus(orderId, nextStatus);
  if (!result.success) {
    alert(result.error || "Failed to update order status.");
  }
  // Listener auto-updates the UI
}

// ── Open Order Details Modal ──────────────────────────────────────

function openOrderDetailsModal(order) {
  const modal = createOrderDetailsModal(order, {
    isSeller: true,
    onAction: handleSellerOrderAction
  });
  document.body.appendChild(modal);
  document.body.style.overflow = "hidden";
}

// ── Filter Switching ──────────────────────────────────────────────

sellerOrderFilters?.addEventListener("click", (e) => {
  const btn = e.target.closest(".order-filter-btn");
  if (!btn) return;

  const filter = btn.dataset.filter;
  if (!filter || filter === currentFilter) return;

  // Update active state
  const allBtns = sellerOrderFilters.querySelectorAll(".order-filter-btn");
  allBtns.forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  currentFilter = filter;
  renderSellerOrders(currentFilter);
});

// ── Auth Guard ────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showAuthRequired();
    return;
  }

  // Check if user is a seller
  const role = await getCurrentUserRole();
  if (role !== "seller") {
    showNotSeller();
    return;
  }

  // Check for deep link order ID
  deepLinkOrderId = getDeepLinkOrderId();

  // Get the seller's store ID
  storeId = await getSellerStoreId(user.uid);
  if (!storeId) {
    showNotSeller();
    return;
  }

  showLoading();
  startOrdersListener(storeId);
});

// ── Cleanup on page unload ────────────────────────────────────────

window.addEventListener("beforeunload", () => {
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }
});
