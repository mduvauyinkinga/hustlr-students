/**
 * order-details.js — Reusable Order Details Renderer.
 *
 * Single renderer for order detail UI used by:
 *   - dashboard.js
 *   - customer-orders.js
 *   - seller-orders.js
 *
 * Do NOT duplicate order detail rendering logic across pages.
 * Always use this module to render order details.
 */

import { formatPrice } from "./cart.js";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  formatOrderTimestamp,
  createOrderTimeline,
  getAvailableActions,
  updateOrderStatus,
  cancelOrder,
  ORDER_STATUS
} from "./orders.js";

import { canReviewOrder, getReview, createReview, updateReview } from "./reviews.js";
import { createReviewForm } from "./review-form.js";

// ── Escape HTML Helper ───────────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== "string") return String(str || "");
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Render full order details into a container element.
 *
 * @param {Object} order - Order data object with { id, status, items, ... }
 * @param {HTMLElement} container - The container to render into (cleared before render)
 * @param {Object} [options]
 * @param {boolean} [options.isSeller=false] - Show seller actions/views
 * @param {function} [options.onAction] - Callback when an action button is clicked.
 *        Receives (orderId, nextStatus, order)
 * @param {boolean} [options.showActions=true] - Whether to show action buttons
 * @param {boolean} [options.showHeader=true] - Whether to show order header info
 * @param {boolean} [options.showItems=true] - Whether to show items list
 * @param {boolean} [options.showTimeline=true] - Whether to show status timeline
 */
export function renderOrderDetails(order, container, options = {}) {
  if (!container) return;

  const {
    isSeller = false,
    onAction = null,
    showActions = true,
    showHeader = true,
    showItems = true,
    showTimeline = true
  } = options;

  // Clear container
  container.replaceChildren();

  if (!order) {
    container.innerHTML = '<p class="empty-state">Order details not available.</p>';
    return;
  }

  // ── Order Header ──────────────────────────────────────────────
  if (showHeader) {
    const headerSection = document.createElement("div");
    headerSection.className = "order-details-header";

    const statusColor = STATUS_COLORS[order.status] || "#6b7280";
    const statusLabel = STATUS_LABELS[order.status] || order.status;

    headerSection.innerHTML = `
      <div class="order-details-order-number">
        <span class="order-details-label">Order Number</span>
        <span class="order-details-value">${escapeHtml(order.orderNumber || order.id)}</span>
      </div>
      <span class="order-status-badge" style="background:${statusColor}20; color:${statusColor}; border:1px solid ${statusColor}40;">
        ${escapeHtml(statusLabel)}
      </span>
    `;

    container.appendChild(headerSection);
  }

  // ── Order Info Section ────────────────────────────────────────
  const infoSection = document.createElement("div");
  infoSection.className = "order-details-info";

  const infoRows = [
    { label: "Store", value: escapeHtml(order.storeName || "N/A") },
    { label: "Customer", value: escapeHtml(order.customerName || "N/A") },
    { label: "Contact", value: escapeHtml(order.customerPhone || "N/A") },
    { label: "Method", value: order.deliveryMethod === "delivery" ? "Delivery" : "Collection" }
  ];

  if (order.deliveryMethod === "delivery" && order.address) {
    infoRows.push({ label: "Address", value: escapeHtml(order.address) });
  }

  infoRows.push(
    { label: "Total", value: formatPrice(order.total), isTotal: true },
    { label: "Placed", value: formatOrderTimestamp(order.createdAt) }
  );

  infoRows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "order-details-row";
    if (row.isTotal) rowEl.classList.add("order-details-row-total");
    rowEl.innerHTML = `
      <span class="order-details-row-label">${row.label}</span>
      <span class="order-details-row-value">${row.value}</span>
    `;
    infoSection.appendChild(rowEl);
  });

  container.appendChild(infoSection);

  // ── Items Section ─────────────────────────────────────────────
  if (showItems && order.items && order.items.length > 0) {
    const itemsSection = document.createElement("div");
    itemsSection.className = "order-details-items-section";

    const titleEl = document.createElement("h4");
    titleEl.className = "order-details-section-title";
    titleEl.textContent = `Items (${order.items.length})`;
    itemsSection.appendChild(titleEl);

    const itemsList = document.createElement("div");
    itemsList.className = "order-details-items-list";

    order.items.forEach((item) => {
      const itemEl = document.createElement("div");
      itemEl.className = "order-details-item";

      const itemName = document.createElement("span");
      itemName.className = "order-details-item-name";
      itemName.textContent = escapeHtml(item.name || "Item");

      const itemQty = document.createElement("span");
      itemQty.className = "order-details-item-qty";
      itemQty.textContent = `×${item.quantity || 1}`;

      const itemPrice = document.createElement("span");
      itemPrice.className = "order-details-item-price";
      itemPrice.textContent = formatPrice((item.price || 0) * (item.quantity || 1));

      itemEl.appendChild(itemName);
      itemEl.appendChild(itemQty);
      itemEl.appendChild(itemPrice);
      itemsList.appendChild(itemEl);
    });

    itemsSection.appendChild(itemsList);
    container.appendChild(itemsSection);
  }

  // ── Timeline Section ──────────────────────────────────────────
  if (showTimeline) {
    const timelineSection = document.createElement("div");
    timelineSection.className = "order-details-timeline-section";

    const titleEl = document.createElement("h4");
    titleEl.className = "order-details-section-title";
    titleEl.textContent = "Status Timeline";
    timelineSection.appendChild(titleEl);

    const timeline = createOrderTimeline(order);
    timelineSection.appendChild(timeline);

    container.appendChild(timelineSection);
  }

  // ── Action Buttons ────────────────────────────────────────────
  if (showActions) {
    const actions = getAvailableActions(order, isSeller);

    if (actions.length > 0) {
      const actionsSection = document.createElement("div");
      actionsSection.className = "order-details-actions";

      actions.forEach((action) => {
        const btn = document.createElement("button");
        btn.className = "order-action-btn";
        btn.dataset.orderId = order.id;
        btn.dataset.nextStatus = action.status;
        btn.textContent = action.label;
        btn.style.background = action.color;

        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (onAction) onAction(order.id, action.status, order);
        });

        actionsSection.appendChild(btn);
      });

      container.appendChild(actionsSection);
    }
  }

  // ── Review CTA (customer view, completed orders only) ─────────
  // Eligibility checked via reviews.js — no duplicated logic here.
  if (showActions && !isSeller && order.status === ORDER_STATUS.COMPLETED) {
    const reviewCtaSection = document.createElement("div");
    reviewCtaSection.className = "order-details-review-cta";

    const reviewBtn = document.createElement("button");
    reviewBtn.className = "order-action-btn review-order-cta";
    reviewBtn.textContent = "Write Review";
    reviewBtn.style.background = "#b1123a";

    reviewBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await openOrderReviewFlow(order, reviewBtn, onAction);
    });

    reviewCtaSection.appendChild(reviewBtn);
    container.appendChild(reviewCtaSection);
  }
}

/**
 * Open the review form for a completed order from the order details modal.
 * If the customer already reviewed, shows "Review Submitted" plus an
 * "Edit Review" inline action. All eligibility logic delegates to reviews.js.
 *
 * @param {Object} order - The completed order
 * @param {HTMLElement} btn - The CTA button to update after submit
 * @param {function|null} [onAction] - Optional callback fired after submit (for UI refresh)
 */
export async function openOrderReviewFlow(order, btn, onAction) {
  try {
    const eligibility = await canReviewOrder(order.id);

    if (!eligibility.canReview) {
      const reason = (eligibility.reason || "").toLowerCase();

      if (reason.includes("already")) {
        // Existing review — switch to Edit mode
        const reviewResult = await getReview(order.id);
        const existingReview = reviewResult.review;

        const modal = createReviewForm({
          mode: "edit",
          review: existingReview || { id: order.id },
          title: `Edit Review for ${(order.storeName || "Store")}`,
          onSubmit: async (data) => {
            const result = await updateReview(order.id, {
              rating: data.rating,
              comment: data.comment
            });
            return result;
          }
        });

        document.body.appendChild(modal);
        if (btn) {
          btn.textContent = "Review Submitted";
          btn.style.background = "#22c55e";
        }
      } else {
        alert(eligibility.reason || "You cannot review this order.");
      }
      return;
    }

    // Eligible — create mode
    const modal = createReviewForm({
      mode: "create",
      title: `Review ${(order.storeName || "Store")}`,
      onSubmit: async (data) => {
        const result = await createReview({
          orderId: order.id,
          rating: data.rating,
          comment: data.comment
        });
        if (result.success && typeof onAction === "function") {
          onAction(order.id, "review_submitted", order);
        }
        return result;
      }
    });

    document.body.appendChild(modal);
  } catch (err) {
    alert("Unable to check review eligibility. Please try again.");
  }
}

/**
 * Create a full order details modal (including overlay).
 * Returns the modal element so callers can manage visibility.
 *
 * @param {Object} order - Order data
 * @param {Object} [options] - Options passed to renderOrderDetails
 * @returns {HTMLElement} The modal overlay element
 */
export function createOrderDetailsModal(order, options = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal-content";

  // Header with close button
  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <h3>Order ${escapeHtml(order.orderNumber || order.id)}</h3>
    <button class="modal-close-btn">&times;</button>
  `;

  const closeBtn = header.querySelector(".modal-close-btn");
  closeBtn.addEventListener("click", () => {
    overlay.remove();
    document.body.style.overflow = "";
  });

  modal.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  overlay.appendChild(modal);

  // Render order details into body
  renderOrderDetails(order, body, options);

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.remove();
      document.body.style.overflow = "";
    }
  });

  // Close on Escape
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);

  return overlay;
}

