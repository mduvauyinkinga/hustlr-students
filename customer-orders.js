/**
 * customer-orders.js — Customer Order History Page.
 *
 * Displays the customer's orders with filter support.
 * Uses the shared orders.js module as the single source of truth.
 * Uses order-details.js for the reusable order details modal.
 */

import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  subscribeToCustomerOrdersWithFilter,
  cancelOrder,
  createOrderCard,
  ORDER_STATUS
} from "./orders.js";

import { createOrderDetailsModal } from "./order-details.js";

// ── Review Imports ─────────────────────────────────────────────────

import { canReviewOrder, createReview, updateReview, hasExistingReview } from "./reviews.js";
import { createReviewForm } from "./review-form.js";

// ── Elements ──────────────────────────────────────────────────────

const ordersLoading = document.getElementById("ordersLoading");
const ordersAuthRequired = document.getElementById("ordersAuthRequired");
const ordersEmpty = document.getElementById("ordersEmpty");
const ordersContent = document.getElementById("ordersContent");
const ordersError = document.getElementById("ordersError");
const customerOrdersList = document.getElementById("customerOrdersList");
const customerOrderFilters = document.getElementById("customerOrderFilters");

// ── State ─────────────────────────────────────────────────────────

/** @type {function|null} */
let ordersUnsubscribe = null;

/** @type {string} */
let currentFilter = "all";

/** @type {Array} */
let allOrders = [];

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
  hideElement(ordersEmpty);
  hideElement(ordersContent);
  hideElement(ordersError);
  showElement(ordersLoading);
}

function showAuthRequired() {
  hideElement(ordersLoading);
  hideElement(ordersEmpty);
  hideElement(ordersContent);
  hideElement(ordersError);
  showElement(ordersAuthRequired);
}

function showEmpty() {
  hideElement(ordersLoading);
  hideElement(ordersAuthRequired);
  hideElement(ordersContent);
  hideElement(ordersError);
  showElement(ordersEmpty);
}

function showContent() {
  hideElement(ordersLoading);
  hideElement(ordersAuthRequired);
  hideElement(ordersEmpty);
  hideElement(ordersError);
  showElement(ordersContent);
}

function showError() {
  hideElement(ordersLoading);
  hideElement(ordersAuthRequired);
  hideElement(ordersEmpty);
  hideElement(ordersContent);
  showElement(ordersError);
}

// ── Deep Link Support ─────────────────────────────────────────────

/**
 * Parse the URL for an order ID parameter.
 * Supports: customer-orders.html?order=abc123
 * @returns {string|null}
 */
function getDeepLinkOrderId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("order");
}

/**
 * Open an order details modal for the given order ID.
 * Searches through allOrders to find the matching order.
 * @param {string} orderId
 */
function openOrderByDeepLink(orderId) {
  if (!orderId || !allOrders.length) return;

  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  // Small delay to ensure DOM is ready
  setTimeout(() => {
    const modal = createOrderDetailsModal(order, {
      isSeller: false,
      onAction: handleCustomerOrderAction
    });
    document.body.appendChild(modal);
    document.body.style.overflow = "hidden";
  }, 300);
}

// ── Order Listener ────────────────────────────────────────────────

function startOrdersListener(customerId) {
  // Clean up previous listener
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }

  ordersUnsubscribe = subscribeToCustomerOrdersWithFilter(
    customerId,
    currentFilter,
    (data) => {
      allOrders = data.all || [];
      renderOrders(data.orders);

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

// ── Render Orders ─────────────────────────────────────────────────

function renderOrders(orders) {
  if (!orders || orders.length === 0) {
    showEmpty();
    return;
  }

  showContent();
  customerOrdersList.replaceChildren();

  orders.forEach((order) => {
    const card = createOrderCard(order, false, {
      onAction: handleCustomerOrderAction
    });

    // Add a "Write Review" / "Review Submitted" action for completed orders
    if (order.status === ORDER_STATUS.COMPLETED) {
      appendReviewButtonToCard(card, order);
    }

    // Click to open order details modal
    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      // Don't open if clicking an action button
      if (e.target.closest(".order-action-btn")) return;
      if (e.target.closest(".review-order-cta")) return;
      openOrderDetailsModal(order);
    });

    customerOrdersList.appendChild(card);
  });
}

/**
 * Append a review CTA to an order card for completed orders.
 * Shows "Write Review" when no review exists, or "Review Submitted" with
 * an "Edit Review" action when the customer has already reviewed.
 * Uses reviews.js canReviewOrder for eligibility — no duplicated logic.
 * @param {HTMLElement} card - The order card element
 * @param {Object} order - Order data (must have id)
 */
function appendReviewButtonToCard(card, order) {
  const wrapper = document.createElement("div");
  wrapper.className = "order-card-review-cta";

  const reviewBtn = document.createElement("button");
  reviewBtn.className = "order-action-btn review-order-cta";
  reviewBtn.dataset.orderId = order.id;
  reviewBtn.textContent = "Write Review";
  reviewBtn.style.background = "#b1123a";

  reviewBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await openReviewFormForOrder(order, reviewBtn);
  });

  wrapper.appendChild(reviewBtn);
  card.appendChild(wrapper);
}

/**
 * Open the review form modal for a given order.
 * Eligibility is re-checked via reviews.js before opening.
 * @param {Object} order - Order data
 * @param {HTMLElement} [btn] - Optional button to update after submit
 */
async function openReviewFormForOrder(order, btn) {
  try {
    const eligibility = await canReviewOrder(order.id);

    if (!eligibility.canReview) {
      // Already reviewed or not eligible — reflect state on button
      if (btn && (eligibility.reason || "").toLowerCase().includes("already")) {
        btn.textContent = "Review Submitted";
        btn.style.background = "#22c55e";
        btn.disabled = true;
      } else {
        alert(eligibility.reason || "You cannot review this order.");
        return;
      }
    } else {
      const existing = await hasExistingReview(order.id);
      const modal = createReviewForm({
        mode: existing ? "edit" : "create",
        title: `Review ${(order.storeName || "Store")}`,
        onSubmit: async (data) => {
          if (existing) {
            const result = await updateReview(order.id, {
              rating: data.rating,
              comment: data.comment
            });
            return result;
          }
          const result = await createReview({
            orderId: order.id,
            rating: data.rating,
            comment: data.comment
          });
          return result;
        }
      });

      document.body.appendChild(modal);
    }
  } catch (err) {
    alert("Unable to check review eligibility. Please try again.");
  }
}

// ── Order Action Handler ──────────────────────────────────────────

async function handleCustomerOrderAction(orderId, action, order) {
  if (action === ORDER_STATUS.CANCELLED) {
    const confirmed = window.confirm(
      "Are you sure you want to cancel this order? This cannot be undone."
    );
    if (!confirmed) return;

    const result = await cancelOrder(orderId);
    if (!result.success) {
      alert(result.error || "Failed to cancel order.");
    }
    // Listener auto-updates the UI
  }
}

// ── Open Order Details Modal ──────────────────────────────────────

function openOrderDetailsModal(order) {
  const modal = createOrderDetailsModal(order, {
    isSeller: false,
    onAction: handleCustomerOrderAction
  });
  document.body.appendChild(modal);
  document.body.style.overflow = "hidden";
}

// ── Filter Switching ──────────────────────────────────────────────

customerOrderFilters?.addEventListener("click", (e) => {
  const btn = e.target.closest(".order-filter-btn");
  if (!btn) return;

  const filter = btn.dataset.filter;
  if (!filter || filter === currentFilter) return;

  // Update active state
  const allBtns = customerOrderFilters.querySelectorAll(".order-filter-btn");
  allBtns.forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  currentFilter = filter;

  // Re-subscribe with new filter
  const user = auth.currentUser;
  if (user) {
    startOrdersListener(user.uid);
  }
});

// ── Auth Guard ────────────────────────────────────────────────────

onAuthStateChanged(auth, (user) => {
  if (!user) {
    showAuthRequired();
    return;
  }

  // Check for deep link order ID
  deepLinkOrderId = getDeepLinkOrderId();

  showLoading();
  startOrdersListener(user.uid);
});

// ── Cleanup on page unload ────────────────────────────────────────

window.addEventListener("beforeunload", () => {
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }
});
