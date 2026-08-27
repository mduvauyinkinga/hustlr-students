import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getCurrentUserRole } from "./store-utils.js";
import { logoutUser } from "./nav.js";
import { formatPrice } from "./cart.js";

import {
  subscribeToCustomerOrders,
  subscribeToSellerOrders,
  updateOrderStatus,
  cancelOrder,
  createOrderCard,
  createOrderTimeline,
  ORDER_STATUS,
  STATUS_LABELS,
  STATUS_COLORS,
  formatOrderTimestamp
} from "./orders.js";

import {
  canReviewOrder,
  createReview,
  updateReview,
  softDeleteReview,
  subscribeToCustomerReviews,
  subscribeToStoreReviews,
  replyToReview
} from "./reviews.js";

import { createReviewCard } from "./review-card.js";
import { createReviewForm } from "./review-form.js";
import { createRatingBreakdown } from "./rating-breakdown.js";
import { openSellerReplyModal } from "./review-reply-modal.js";

// ── Helper ────────────────────────────────────────────────────────

function showElement(el) {
  if (el) el.style.display = "";
}

function hideElement(el) {
  if (el) el.style.display = "none";
}

function setText(el, value) {
  if (!el) return;
  el.innerText = value ?? "-";
}

function formatDate(value) {
  try {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString();
  } catch {
    return "-";
  }
}

// ── Elements ──────────────────────────────────────────────────────

const welcomeText = document.getElementById("welcomeText");
const logoutBtn = document.getElementById("logoutBtn");

// Profile elements
const profilePicture = document.getElementById("profilePicture");
const profileUsername = document.getElementById("profileUsername");
const profileEmail = document.getElementById("profileEmail");
const joinedDateEl = document.getElementById("joinedDate");
const jobsCompletedEl = document.getElementById("jobsCompleted");
const ratingEl = document.getElementById("rating");

// Customer-only sections
const customerOrdersSection = document.getElementById("customerOrdersSection");
const customerHistorySection = document.getElementById("customerHistorySection");
const customerRecentSection = document.getElementById("customerRecentSection");

// Customer Active Orders
const customerActiveLoading = document.getElementById("customerActiveLoading");
const customerActiveEmpty = document.getElementById("customerActiveEmpty");
const customerActiveOrdersList = document.getElementById("customerActiveOrdersList");

// Customer Past Orders
const customerPastLoading = document.getElementById("customerPastLoading");
const customerPastEmpty = document.getElementById("customerPastEmpty");
const customerPastOrdersList = document.getElementById("customerPastOrdersList");

// Customer Recent Orders
const customerRecentEmpty = document.getElementById("customerRecentEmpty");
const customerRecentOrdersList = document.getElementById("customerRecentOrdersList");

// Customer error states
const customerActiveError = document.getElementById("customerActiveError");
const customerPastError = document.getElementById("customerPastError");

// Seller-only sections wrapper
const sellerSections = document.getElementById("sellerSections");

// Seller metrics
const metricPending = document.getElementById("metricPending");
const metricPreparing = document.getElementById("metricPreparing");
const metricReady = document.getElementById("metricReady");
const metricOrdersToday = document.getElementById("metricOrdersToday");
const metricRevenueToday = document.getElementById("metricRevenueToday");
const metricCompletedToday = document.getElementById("metricCompletedToday");

// Seller orders
const sellerOrdersLoading = document.getElementById("sellerOrdersLoading");
const sellerOrdersEmpty = document.getElementById("sellerOrdersEmpty");
const sellerOrdersList = document.getElementById("sellerOrdersList");
const sellerOrderFilters = document.getElementById("sellerOrderFilters");

// Seller Recent Orders
const sellerRecentSection = document.getElementById("sellerRecentSection");
const sellerRecentEmpty = document.getElementById("sellerRecentEmpty");
const sellerRecentOrdersList = document.getElementById("sellerRecentOrdersList");

// Seller Reviews
const sellerReviewsSection = document.getElementById("sellerReviewsSection");
const sellerAvgRating = document.getElementById("sellerAvgRating");
const sellerTotalReviews = document.getElementById("sellerTotalReviews");
const sellerReviewsLoading = document.getElementById("sellerReviewsLoading");
const sellerReviewsEmpty = document.getElementById("sellerReviewsEmpty");
const sellerReviewsList = document.getElementById("sellerReviewsList");
const sellerReviewsBreakdown = document.getElementById("sellerReviewsBreakdown");

// Tracking Modal
const trackingModal = document.getElementById("orderTrackingModal");
const trackingModalTitle = document.getElementById("trackingModalTitle");
const trackingModalBody = document.getElementById("trackingModalBody");
const trackingModalClose = document.getElementById("trackingModalClose");

// Customer Pending Reviews (elements)
const customerPendingReviewsSection = document.getElementById("customerPendingReviewsSection");
const customerPendingReviewsLoading = document.getElementById("customerPendingReviewsLoading");
const customerPendingReviewsEmpty = document.getElementById("customerPendingReviewsEmpty");
const customerPendingReviewsList = document.getElementById("customerPendingReviewsList");

// Customer Reviewed (elements)
const customerReviewedSection = document.getElementById("customerReviewedSection");
const customerReviewedLoading = document.getElementById("customerReviewedLoading");
const customerReviewedEmpty = document.getElementById("customerReviewedEmpty");
const customerReviewedList = document.getElementById("customerReviewedList");

// ── State ─────────────────────────────────────────────────────────

/** @type {function|null} */
let customerOrdersUnsubscribe = null;

/** @type {function|null} */
let customerReviewsUnsubscribe = null;

/** @type {string|null} */
let currentCustomerId = null;

/** @type {function|null} */
let sellerOrdersUnsubscribe = null;

/** @type {Array} */
let allSellerOrders = [];

/** @type {string} */
let currentSellerFilter = "all";

/** @type {boolean} */
let isSeller = false;

// ── Role-based Renderers ──────────────────────────────────────────

function renderCustomerDashboard(user) {
  hideElement(sellerSections);
  showElement(customerOrdersSection);
  showElement(customerHistorySection);

  // Start listening to customer orders
  startCustomerOrdersListener(user.uid);

  // Start listening to customer reviews
  startCustomerReviewsListener(user.uid);
}

function renderSellerDashboard(user) {
  hideElement(customerOrdersSection);
  hideElement(customerHistorySection);
  showElement(sellerSections);

  // Start listening to seller orders
  startSellerOrdersListener(user.uid);

  // Start listening to seller reviews
  startSellerReviewsListener(user.uid);
}

// ── Customer Orders Listener ──────────────────────────────────────

function startCustomerOrdersListener(customerId) {
  // Clean up previous listener
  if (customerOrdersUnsubscribe) {
    customerOrdersUnsubscribe();
    customerOrdersUnsubscribe = null;
  }

customerOrdersUnsubscribe = subscribeToCustomerOrders(
    customerId,
    (data) => {
      renderCustomerActiveOrders(data.active);
      renderCustomerPastOrders(data.past);
      renderCustomerRecentOrders(data.active, data.past);
      // Check for pending reviews from completed orders
      checkPendingReviews(data.past);
    },
    (err) => {
      // Error fallback — show error states
      showErrorState(customerActiveLoading, customerActiveError, customerActiveEmpty, customerActiveOrdersList);
      showErrorState(customerPastLoading, customerPastError, customerPastEmpty, customerPastOrdersList);
    }
  );
}

function renderCustomerActiveOrders(orders) {
  hideElement(customerActiveLoading);

  if (!orders || orders.length === 0) {
    showEmptyState(null, customerActiveEmpty, customerActiveOrdersList);
    return;
  }

  hideElement(customerActiveEmpty);
  showElement(customerActiveOrdersList);

  customerActiveOrdersList.replaceChildren();

  orders.forEach((order) => {
    const card = createOrderCard(order, false, {
      onAction: handleCustomerOrderAction
    });

    // Add click to view tracking
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      openOrderTracking(order);
    });

    customerActiveOrdersList.appendChild(card);
  });
}

function renderCustomerPastOrders(orders) {
  hideElement(customerPastLoading);

  if (!orders || orders.length === 0) {
    showEmptyState(null, customerPastEmpty, customerPastOrdersList);
    return;
  }

  hideElement(customerPastEmpty);
  showElement(customerPastOrdersList);

  customerPastOrdersList.replaceChildren();

  orders.forEach((order) => {
    const card = createOrderCard(order, false, {
      onAction: null // No actions for past orders
    });

    // Click to view timeline
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      openOrderTracking(order);
    });

    customerPastOrdersList.appendChild(card);
  });
}

// ── Customer Recent Orders (max 5) ────────────────────────────────

function renderCustomerRecentOrders(active, past) {
  if (!customerRecentSection) return;

  // Combine active and past, sort by createdAt desc, take max 5
  const allOrders = [...(active || []), ...(past || [])];
  allOrders.sort((a, b) => {
    const aTime = a.createdAt?.toDate?.()?.getTime() || new Date(a.createdAt).getTime() || 0;
    const bTime = b.createdAt?.toDate?.()?.getTime() || new Date(b.createdAt).getTime() || 0;
    return bTime - aTime;
  });

  const recentOrders = allOrders.slice(0, 5);

  if (recentOrders.length === 0) {
    showEmptyState(null, customerRecentEmpty, customerRecentOrdersList);
    showElement(customerRecentSection);
    return;
  }

  showElement(customerRecentSection);
  hideElement(customerRecentEmpty);
  showElement(customerRecentOrdersList);

  customerRecentOrdersList.replaceChildren();

  recentOrders.forEach((order) => {
    const card = createOrderCard(order, false, {
      onAction: handleCustomerOrderAction
    });

    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      openOrderTracking(order);
    });

    customerRecentOrdersList.appendChild(card);
  });
}

// ── Customer Order Action ─────────────────────────────────────────

async function handleCustomerOrderAction(orderId, action) {
  if (action === ORDER_STATUS.CANCELLED) {
    const confirmed = window.confirm("Are you sure you want to cancel this order? This cannot be undone.");
    if (!confirmed) return;

    const result = await cancelOrder(orderId);
    if (!result.success) {
      alert(result.error || "Failed to cancel order.");
    }
  }
}

// ── Seller Orders Listener ────────────────────────────────────────

function startSellerOrdersListener(storeId) {
  // Clean up previous listener
  if (sellerOrdersUnsubscribe) {
    sellerOrdersUnsubscribe();
    sellerOrdersUnsubscribe = null;
  }

  sellerOrdersUnsubscribe = subscribeToSellerOrders(
    storeId,
    (data) => {
      // Update metrics
      updateSellerMetrics(data.metrics);

      // Store all orders for filtering
      allSellerOrders = data.orders;

      // Render based on current filter
      renderSellerOrders(currentSellerFilter);

      // Render recent orders (max 5)
      renderSellerRecentOrders(data.orders);
    },
    (err) => {
      showEmptyState(sellerOrdersLoading, sellerOrdersEmpty, sellerOrdersList);
    }
  );
}

function updateSellerMetrics(metrics) {
  if (metricPending) metricPending.textContent = String(metrics.pending || 0);
  if (metricPreparing) metricPreparing.textContent = String(metrics.preparing || 0);
  if (metricReady) metricReady.textContent = String(metrics.ready || 0);
  if (metricOrdersToday) metricOrdersToday.textContent = String(metrics.ordersToday || 0);
  if (metricRevenueToday) metricRevenueToday.textContent = formatPrice(metrics.revenueToday || 0);
  if (metricCompletedToday) metricCompletedToday.textContent = String(metrics.completedToday || 0);
}

// ── Seller Recent Orders (max 5) ──────────────────────────────────

function renderSellerRecentOrders(orders) {
  if (!sellerRecentSection) return;

  if (!orders || orders.length === 0) {
    showEmptyState(null, sellerRecentEmpty, sellerRecentOrdersList);
    return;
  }

  // Sort by createdAt desc, take max 5
  const sorted = [...orders].sort((a, b) => {
    const aTime = a.createdAt?.toDate?.()?.getTime() || new Date(a.createdAt).getTime() || 0;
    const bTime = b.createdAt?.toDate?.()?.getTime() || new Date(b.createdAt).getTime() || 0;
    return bTime - aTime;
  });

  const recent = sorted.slice(0, 5);

  hideElement(sellerRecentEmpty);
  showElement(sellerRecentOrdersList);

  sellerRecentOrdersList.replaceChildren();

  recent.forEach((order) => {
    const card = createOrderCard(order, true, {
      onAction: handleSellerOrderAction
    });

    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      if (e.target.closest(".order-action-btn")) return;
      openOrderTracking(order);
    });

    sellerRecentOrdersList.appendChild(card);
  });
}

function renderSellerOrders(filter) {
  hideElement(sellerOrdersLoading);

  if (!allSellerOrders || allSellerOrders.length === 0) {
    showEmptyState(null, sellerOrdersEmpty, sellerOrdersList);
    return;
  }

  let filtered = allSellerOrders;
  if (filter && filter !== "all") {
    if (filter === "completed") {
      filtered = allSellerOrders.filter(o => o.status === ORDER_STATUS.COMPLETED);
    } else if (filter === "cancelled") {
      filtered = allSellerOrders.filter(o => o.status === ORDER_STATUS.CANCELLED || o.status === ORDER_STATUS.REJECTED);
    } else {
      filtered = allSellerOrders.filter(o => o.status === filter);
    }
  }

  if (filtered.length === 0) {
    showEmptyState(null, sellerOrdersEmpty, sellerOrdersList);
    return;
  }

  hideElement(sellerOrdersEmpty);
  showElement(sellerOrdersList);

  sellerOrdersList.replaceChildren();

  filtered.forEach((order) => {
    const card = createOrderCard(order, true, {
      onAction: handleSellerOrderAction
    });

    // Add click to view full order details
    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      // Don't open if clicking an action button
      if (e.target.closest(".order-action-btn")) return;
      openOrderTracking(order);
    });

    sellerOrdersList.appendChild(card);
  });
}

// ── Seller Order Action ───────────────────────────────────────────

async function handleSellerOrderAction(orderId, nextStatus) {
  // For rejections, ask for confirmation
  if (nextStatus === ORDER_STATUS.REJECTED) {
    const confirmed = window.confirm("Are you sure you want to reject this order? This cannot be undone.");
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
}

// ── Order Tracking Modal ──────────────────────────────────────────

function openOrderTracking(order) {
  if (!trackingModal || !trackingModalBody) return;

  // Build modal content
  const title = `Order ${order.orderNumber || order.id}`;
  if (trackingModalTitle) trackingModalTitle.textContent = title;

  trackingModalBody.replaceChildren();

  // Order info section
  const infoSection = document.createElement("div");
  infoSection.className = "tracking-order-info";

  const statusColor = STATUS_COLORS[order.status] || "#6b7280";
  const statusLabel = STATUS_LABELS[order.status] || order.status;

  infoSection.innerHTML = `
    <div class="tracking-order-header">
      <div class="tracking-order-number">
        <span class="tracking-label">Order Number</span>
        <span class="tracking-value">${escapeHtml(order.orderNumber || order.id)}</span>
      </div>
      <span class="order-status-badge" style="background:${statusColor}20; color:${statusColor}; border:1px solid ${statusColor}40;">
        ${escapeHtml(statusLabel)}
      </span>
    </div>
    <div class="tracking-order-details">
      <div class="tracking-detail-row">
        <span>Store</span>
        <span>${escapeHtml(order.storeName || "N/A")}</span>
      </div>
      <div class="tracking-detail-row">
        <span>Customer</span>
        <span>${escapeHtml(order.customerName || "N/A")}</span>
      </div>
      <div class="tracking-detail-row">
        <span>Contact</span>
        <span>${escapeHtml(order.customerPhone || "N/A")}</span>
      </div>
      <div class="tracking-detail-row">
        <span>Method</span>
        <span>${order.deliveryMethod === "delivery" ? "Delivery" : "Collection"}</span>
      </div>
      ${order.deliveryMethod === "delivery" && order.address ? `
        <div class="tracking-detail-row">
          <span>Address</span>
          <span>${escapeHtml(order.address)}</span>
        </div>
      ` : ""}
      <div class="tracking-detail-row">
        <span>Total</span>
        <span class="tracking-total">${formatPrice(order.total)}</span>
      </div>
      <div class="tracking-detail-row">
        <span>Placed</span>
        <span>${formatOrderTimestamp(order.createdAt)}</span>
      </div>
    </div>
  `;
  trackingModalBody.appendChild(infoSection);

  // Items section
  if (order.items && order.items.length > 0) {
    const itemsSection = document.createElement("div");
    itemsSection.className = "tracking-items-section";
    itemsSection.innerHTML = `<h4 class="tracking-section-title">Items (${order.items.length})</h4>`;

    const itemsList = document.createElement("div");
    itemsList.className = "tracking-items-list";

    order.items.forEach((item) => {
      const itemEl = document.createElement("div");
      itemEl.className = "tracking-item";
      itemEl.innerHTML = `
        <span class="tracking-item-name">${escapeHtml(item.name || "Item")}</span>
        <span class="tracking-item-qty">×${item.quantity || 1}</span>
        <span class="tracking-item-price">${formatPrice((item.price || 0) * (item.quantity || 1))}</span>
      `;
      itemsList.appendChild(itemEl);
    });

    itemsSection.appendChild(itemsList);
    trackingModalBody.appendChild(itemsSection);
  }

  // Timeline section
  const timelineSection = document.createElement("div");
  timelineSection.className = "tracking-timeline-section";
  timelineSection.innerHTML = `<h4 class="tracking-section-title">Status Timeline</h4>`;

  const timeline = createOrderTimeline(order);
  timelineSection.appendChild(timeline);
  trackingModalBody.appendChild(timelineSection);

  // Show modal
  showElement(trackingModal);
  document.body.style.overflow = "hidden";
}

function closeOrderTracking() {
  if (trackingModal) {
    hideElement(trackingModal);
    document.body.style.overflow = "";
  }
}

// ── Modal Event Listeners ─────────────────────────────────────────

trackingModalClose?.addEventListener("click", closeOrderTracking);

// Close modal on overlay click
trackingModal?.addEventListener("click", (e) => {
  if (e.target === trackingModal) {
    closeOrderTracking();
  }
});

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && trackingModal && trackingModal.style.display !== "none") {
    closeOrderTracking();
  }
});

// ── Seller Filter Tabs ────────────────────────────────────────────

sellerOrderFilters?.addEventListener("click", (e) => {
  const btn = e.target.closest(".order-filter-btn");
  if (!btn) return;

  const filter = btn.dataset.filter;
  if (!filter) return;

  // Update active state
  const allBtns = sellerOrderFilters.querySelectorAll(".order-filter-btn");
  allBtns.forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  currentSellerFilter = filter;
  renderSellerOrders(currentSellerFilter);
});

// ── Seller Reviews Listener ───────────────────────────────────────

/** @type {function|null} */
let sellerReviewsUnsubscribe = null;

/** @type {function|null} */
let sellerStoreUnsubscribe = null;

/** @type {Object} */
let sellerStoreAggregates = { averageRating: 0, reviewCount: 0, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

/**
 * Subscribe to the store document for authoritative rating aggregates
 * (averageRating, reviewCount, ratingBreakdown). These are maintained
 * by reviews.js in the same atomic batch as every review mutation — no
 * recalculation happens on the dashboard.
 * @param {string} storeId
 */
function startSellerStoreListener(storeId) {
  if (sellerStoreUnsubscribe) {
    sellerStoreUnsubscribe();
    sellerStoreUnsubscribe = null;
  }

  try {
    const storeRef = doc(db, "stores", storeId);
    sellerStoreUnsubscribe = onSnapshot(storeRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      sellerStoreAggregates = {
        averageRating: Number(data.averageRating) || 0,
        reviewCount: Number(data.reviewCount) || 0,
        ratingBreakdown: data.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
      renderSellerReviewMetrics();
    });
  } catch {
    // Non-fatal — metrics simply won't update
  }
}

/**
 * Render seller review metrics (avg rating, total reviews, breakdown)
 * from the store document aggregates.
 */
function renderSellerReviewMetrics() {
  if (sellerAvgRating) sellerAvgRating.textContent = sellerStoreAggregates.averageRating.toFixed(1);
  if (sellerTotalReviews) sellerTotalReviews.textContent = String(sellerStoreAggregates.reviewCount);

  if (sellerReviewsBreakdown) {
    sellerReviewsBreakdown.replaceChildren();
    const breakdown = createRatingBreakdown({
      breakdown: sellerStoreAggregates.ratingBreakdown,
      totalReviews: sellerStoreAggregates.reviewCount,
      clickable: false
    });
    sellerReviewsBreakdown.appendChild(breakdown);
  }
}

/**
 * Start listening to reviews for the seller's store (list only).
 * Aggregates come from the store document — not recalculated here.
 * @param {string} storeId
 */
function startSellerReviewsListener(storeId) {
  if (sellerReviewsUnsubscribe) {
    sellerReviewsUnsubscribe();
    sellerReviewsUnsubscribe = null;
  }

  startSellerStoreListener(storeId);

  sellerReviewsUnsubscribe = subscribeToStoreReviews(
    storeId,
    (reviews) => {
      renderSellerReviews(reviews);
    },
    () => {
      // Error fallback
      if (sellerReviewsLoading) hideElement(sellerReviewsLoading);
      if (sellerReviewsEmpty) showElement(sellerReviewsEmpty);
      if (sellerReviewsList) hideElement(sellerReviewsList);
    }
  );
}

/**
 * Render seller reviews list with reply buttons.
 * @param {Array} reviews
 */
function renderSellerReviews(reviews) {
  if (!sellerReviewsSection) return;

  hideElement(sellerReviewsLoading);
  showElement(sellerReviewsSection);

  if (!reviews || reviews.length === 0) {
    showEmptyState(null, sellerReviewsEmpty, sellerReviewsList);
    return;
  }

  hideElement(sellerReviewsEmpty);
  showElement(sellerReviewsList);

  const sorted = [...reviews].sort((a, b) => {
    const aTime = a.createdAt?.toDate?.()?.getTime() || new Date(a.createdAt).getTime() || 0;
    const bTime = b.createdAt?.toDate?.()?.getTime() || new Date(b.createdAt).getTime() || 0;
    return bTime - aTime;
  });

  sellerReviewsList.replaceChildren();
  sorted.slice(0, 10).forEach((review) => {
    const card = createReviewCard(review, {
      showStoreName: false,
      showReplyButton: true,
      onReply: (reviewId, review) => {
        openSellerReplyModal(reviewId, review);
      }
    });
    sellerReviewsList.appendChild(card);
  });
}

// ── Customer Reviews Listeners ────────────────────────────────────

/**
 * Start listening to reviews by this customer.
 * Also computes pending reviews from completed orders.
 */
function startCustomerReviewsListener(customerId) {
  if (customerReviewsUnsubscribe) {
    customerReviewsUnsubscribe();
    customerReviewsUnsubscribe = null;
  }

  currentCustomerId = customerId;

  customerReviewsUnsubscribe = subscribeToCustomerReviews(
    customerId,
    (reviews) => {
      renderCustomerReviewed(reviews);
    },
    () => {
      hideElement(customerReviewedLoading);
      showEmptyState(null, customerReviewedEmpty, customerReviewedList);
    }
  );
}

/**
 * Render the customer's own reviews (Recently Reviewed section).
 */
function renderCustomerReviewed(reviews) {
  if (!customerReviewedSection) return;
  hideElement(customerReviewedLoading);

  if (!reviews || reviews.length === 0) {
    showEmptyState(null, customerReviewedEmpty, customerReviewedList);
    showElement(customerReviewedSection);
    return;
  }

  // Sort by createdAt desc, take max 5
  const sorted = [...reviews].sort((a, b) => {
    const aTime = a.createdAt?.toDate?.()?.getTime() || new Date(a.createdAt).getTime() || 0;
    const bTime = b.createdAt?.toDate?.()?.getTime() || new Date(b.createdAt).getTime() || 0;
    return bTime - aTime;
  });

  const recent = sorted.slice(0, 5);

  hideElement(customerReviewedEmpty);
  showElement(customerReviewedSection);
  showElement(customerReviewedList);

  customerReviewedList.replaceChildren();

  recent.forEach((review) => {
    const card = createReviewCard(review, {
      showStoreName: true,
      showReply: true,
      onEdit: null,
      onDelete: null
    });
    customerReviewedList.appendChild(card);
  });
}

// ── Pending Reviews (completed orders not yet reviewed) ────────────

/**
 * Check past orders for completed ones that have no review yet.
 * @param {Array} pastOrders - Terminal status orders
 */
function checkPendingReviews(pastOrders) {
  if (!customerPendingReviewsSection) return;
  hideElement(customerPendingReviewsLoading);

  if (!pastOrders || pastOrders.length === 0) {
    showEmptyState(null, customerPendingReviewsEmpty, customerPendingReviewsList);
    return;
  }

  // Only COMPLETED orders are reviewable
  const completedOrders = pastOrders.filter(o => o.status === ORDER_STATUS.COMPLETED);

  if (completedOrders.length === 0) {
    showEmptyState(null, customerPendingReviewsEmpty, customerPendingReviewsList);
    return;
  }

  // Check each completed order for existing reviews
  checkPendingReviewsBatch(completedOrders);
}

/**
 * Batch-check which completed orders have existing reviews.
 * Uses Firestore to check for existing review documents by customerId + orderId.
 */
async function checkPendingReviewsBatch(completedOrders) {
  try {
    // Query the private review ownership collection for this customer and these order IDs.
    const reviewPrivateRef = collection(db, "reviewPrivate");
    const q = query(
      reviewPrivateRef,
      where("customerId", "==", currentCustomerId),
      where("orderId", "in", completedOrders.map(o => o.id))
    );
    const snap = await getDocs(q);

    const reviewedOrderIds = new Set();
    snap.forEach(docSnap => {
      reviewedOrderIds.add(docSnap.data().orderId);
    });

    // Filter to orders NOT yet reviewed
    const pending = completedOrders.filter(o => !reviewedOrderIds.has(o.id));

    renderPendingReviews(pending);
  } catch {
    // If query fails, show empty
    showEmptyState(null, customerPendingReviewsEmpty, customerPendingReviewsList);
  }
}

/**
 * Render pending review items with Write Review buttons.
 * @param {Array} orders - Completed orders without reviews
 */
function renderPendingReviews(orders) {
  if (!customerPendingReviewsSection) return;

  if (!orders || orders.length === 0) {
    showEmptyState(null, customerPendingReviewsEmpty, customerPendingReviewsList);
    return;
  }

  hideElement(customerPendingReviewsEmpty);
  showElement(customerPendingReviewsSection);
  showElement(customerPendingReviewsList);

  customerPendingReviewsList.replaceChildren();

  orders.forEach((order) => {
    const item = document.createElement("div");
    item.className = "pending-review-item";

    const storeInfo = document.createElement("div");
    storeInfo.className = "pending-review-store";
    storeInfo.innerHTML = `
      <div class="pending-review-store-name">${escapeHtml(order.storeName || "Store")}</div>
      <div class="pending-review-order-number">${escapeHtml(order.orderNumber || order.id)}</div>
      <div class="pending-review-total">${formatPrice(order.total)}</div>
    `;

    const reviewBtn = document.createElement("button");
    reviewBtn.className = "btn pending-review-btn";
    reviewBtn.textContent = "Write Review";
    reviewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openReviewForm(order);
    });

    item.appendChild(storeInfo);
    item.appendChild(reviewBtn);
    customerPendingReviewsList.appendChild(item);
  });
}

// ── Review Form Integration ──────────────────────────────────────

/**
 * Open the review form modal for a specific order.
 * @param {Object} order - The completed order to review
 */
function openReviewForm(order) {
  // Check eligibility first — async/await pattern
  (async () => {
    const eligibility = await canReviewOrder(order.id);
    if (!eligibility.canReview) {
      alert(eligibility.reason || "You cannot review this order.");
      return;
    }

    const modal = createReviewForm({
      mode: "create",
      title: `Review ${escapeHtml(order.storeName || "Store")}`,
      onSubmit: async (data) => {
        const result = await createReview({
          orderId: order.id,
          rating: data.rating,
          comment: data.comment
        });
        if (result && result.success) {
          return { success: true };
        }
        return { success: false, error: result?.error || "Failed to submit review." };
      }
    });

    document.body.appendChild(modal);
  })();
}

// ── Utility Functions ─────────────────────────────────────────────

function showEmptyState(loadingEl, emptyEl, listEl) {
  if (loadingEl) hideElement(loadingEl);
  if (emptyEl) showElement(emptyEl);
  if (listEl) hideElement(listEl);
}

function showErrorState(loadingEl, errorEl, emptyEl, listEl) {
  if (loadingEl) hideElement(loadingEl);
  if (errorEl) showElement(errorEl);
  if (emptyEl) hideElement(emptyEl);
  if (listEl) hideElement(listEl);
}

function escapeHtml(str) {
  if (typeof str !== "string") return String(str || "");
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Auth Check ────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  // Fetch role using the centralized role system (cache-first, Firestore fallback)
  const role = await getCurrentUserRole();

  // ── Render shared UI ─────────────────────────────────────────

  setText(welcomeText, `Logged in as ${user.email}`);

  if (logoutBtn) logoutBtn.style.display = "inline-block";

  setText(profileUsername, user.displayName || "-");
  setText(profileEmail, user.email || "-");
  setText(joinedDateEl, formatDate(user?.metadata?.creationTime));

  if (profilePicture) {
    if (user.photoURL) {
      profilePicture.src = user.photoURL;
    } else {
      profilePicture.removeAttribute("src");
      profilePicture.style.background = "#2a2a2e";
    }
  }

  setText(jobsCompletedEl, "-");
  setText(ratingEl, "-");

  // ── Role-specific rendering ─────────────────────────────────

  isSeller = role === "seller";

  if (isSeller) {
    renderSellerDashboard(user);
  } else {
    renderCustomerDashboard(user);
  }
});

// ── Logout ────────────────────────────────────────────────────────

if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    // Clean up listeners before logout
    if (customerOrdersUnsubscribe) {
      customerOrdersUnsubscribe();
      customerOrdersUnsubscribe = null;
    }
    if (customerReviewsUnsubscribe) {
      customerReviewsUnsubscribe();
      customerReviewsUnsubscribe = null;
    }
    if (sellerOrdersUnsubscribe) {
      sellerOrdersUnsubscribe();
      sellerOrdersUnsubscribe = null;
    }
    if (sellerReviewsUnsubscribe) {
      sellerReviewsUnsubscribe();
      sellerReviewsUnsubscribe = null;
    }
    if (sellerStoreUnsubscribe) {
      sellerStoreUnsubscribe();
      sellerStoreUnsubscribe = null;
    }

    await logoutUser();
  });
}

// ── Cleanup on page unload ────────────────────────────────────────

window.addEventListener("beforeunload", () => {
  if (customerOrdersUnsubscribe) {
    customerOrdersUnsubscribe();
    customerOrdersUnsubscribe = null;
  }
  if (customerReviewsUnsubscribe) {
    customerReviewsUnsubscribe();
    customerReviewsUnsubscribe = null;
  }
  if (sellerOrdersUnsubscribe) {
    sellerOrdersUnsubscribe();
    sellerOrdersUnsubscribe = null;
  }
if (sellerReviewsUnsubscribe) {
    sellerReviewsUnsubscribe();
    sellerReviewsUnsubscribe = null;
  }
  if (sellerStoreUnsubscribe) {
    sellerStoreUnsubscribe();
    sellerStoreUnsubscribe = null;
  }
});
