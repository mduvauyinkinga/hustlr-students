/**
 * orders.js — Single Source of Truth for HUSTLR Order Management.
 *
 * All order-related logic, queries, listeners, and formatting live here.
 * No other module should duplicate order logic.
 */

import { db, functions } from "./firebase.js";
import { logError } from "./production-logger.js";

import {
  doc,
  addDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { formatPrice } from "./cart.js";

// ────────────────────────────────────────────────────────────
// 1. STATUS CONSTANTS
// ────────────────────────────────────────────────────────────

export const ORDER_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  PREPARING: "preparing",
  READY: "ready",
  COLLECTED: "collected",
  OUT_FOR_DELIVERY: "out_for_delivery",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
});

// Human-readable labels for display
export const STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.PENDING]: "Pending",
  [ORDER_STATUS.ACCEPTED]: "Accepted",
  [ORDER_STATUS.REJECTED]: "Rejected",
  [ORDER_STATUS.PREPARING]: "Preparing",
  [ORDER_STATUS.READY]: "Ready for Collection/Delivery",
  [ORDER_STATUS.COLLECTED]: "Collected",
  [ORDER_STATUS.OUT_FOR_DELIVERY]: "Out for Delivery",
  [ORDER_STATUS.COMPLETED]: "Completed",
  [ORDER_STATUS.CANCELLED]: "Cancelled"
});

// Color mapping for status badges
export const STATUS_COLORS = Object.freeze({
  [ORDER_STATUS.PENDING]: "#f59e0b",
  [ORDER_STATUS.ACCEPTED]: "#3b82f6",
  [ORDER_STATUS.REJECTED]: "#ef4444",
  [ORDER_STATUS.PREPARING]: "#8b5cf6",
  [ORDER_STATUS.READY]: "#10b981",
  [ORDER_STATUS.COLLECTED]: "#06b6d4",
  [ORDER_STATUS.OUT_FOR_DELIVERY]: "#f97316",
  [ORDER_STATUS.COMPLETED]: "#22c55e",
  [ORDER_STATUS.CANCELLED]: "#6b7280"
});

// ────────────────────────────────────────────────────────────
// 2. VALID STATUS TRANSITIONS
// ────────────────────────────────────────────────────────────

/**
 * Valid transitions map.
 * Key = current status, Value = Array of allowed next statuses.
 */
const VALID_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]:       [ORDER_STATUS.ACCEPTED, ORDER_STATUS.REJECTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ACCEPTED]:      [ORDER_STATUS.PREPARING, ORDER_STATUS.REJECTED],
  [ORDER_STATUS.REJECTED]:      [], // terminal
  [ORDER_STATUS.PREPARING]:     [ORDER_STATUS.READY],
  [ORDER_STATUS.READY]:         [ORDER_STATUS.COLLECTED, ORDER_STATUS.OUT_FOR_DELIVERY],
  [ORDER_STATUS.COLLECTED]:     [ORDER_STATUS.COMPLETED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.COMPLETED],
  [ORDER_STATUS.COMPLETED]:     [], // terminal
  [ORDER_STATUS.CANCELLED]:     []  // terminal
});

/**
 * Check whether a status transition is valid.
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {boolean}
 */
export function isValidTransition(currentStatus, nextStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}

/**
 * Get the list of valid next statuses for a given status.
 * @param {string} status
 * @returns {string[]}
 */
export function getValidNextStatuses(status) {
  return VALID_TRANSITIONS[status] || [];
}

/**
 * Whether a status is terminal (no further transitions possible).
 * @param {string} status
 * @returns {boolean}
 */
export function isTerminalStatus(status) {
  return VALID_TRANSITIONS[status] && VALID_TRANSITIONS[status].length === 0;
}

/**
 * Whether a status represents an active/progressing order.
 * @param {string} status
 * @returns {boolean}
 */
export function isActiveStatus(status) {
  return [
    ORDER_STATUS.ACCEPTED,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.READY,
    ORDER_STATUS.COLLECTED,
    ORDER_STATUS.OUT_FOR_DELIVERY
  ].includes(status);
}

/**
 * Whether a customer can cancel based on current status.
 * @param {string} status
 * @returns {boolean}
 */
export function canCustomerCancel(status) {
  return status === ORDER_STATUS.PENDING;
}

/**
 * Whether a seller can reject based on current status.
 * @param {string} status
 * @returns {boolean}
 */
export function canSellerReject(status) {
  return status === ORDER_STATUS.PENDING || status === ORDER_STATUS.ACCEPTED;
}

// ────────────────────────────────────────────────────────────
// 3. ORDER NUMBER GENERATION
// ────────────────────────────────────────────────────────────

/**
 * Generate a human-friendly order number.
 * Format: HST-YYYYMMDD-XXXXX
 * @returns {Promise<string>}
 */
export async function generateOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dateStr = `${y}${m}${d}`;

  let seq = 1;
  try {
    const ordersRef = collection(db, "orders");
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86400000);

    const q = query(
      ordersRef,
      where("createdAt", ">=", startOfDay),
      where("createdAt", "<", endOfDay)
    );
    const snap = await getDocs(q);
    seq = snap.size + 1;
  } catch {
    // Fallback: random suffix
    seq = Math.floor(Math.random() * 99999) + 1;
  }

  const seqStr = String(seq).padStart(5, "0");
  return `HST-${dateStr}-${seqStr}`;
}

// ────────────────────────────────────────────────────────────
// 4. ORDER CREATION HELPER
// ────────────────────────────────────────────────────────────

/**
 * Create a new order in Firestore.
 * @param {Object} params
 * @returns {Promise<{success: boolean, orderId?: string, orderNumber?: string, error?: string}>}
 */
export function generateClientRequestId() {
  const safeCrypto = globalThis.crypto;
  if (safeCrypto && typeof safeCrypto.randomUUID === "function") {
    return safeCrypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export async function createOrder(params) {
  const {
    customerName,
    customerPhone,
    items,
    deliveryMethod,
    address,
    clientRequestId
  } = params;

  if (!items || items.length === 0) {
    return { success: false, error: "Missing required order fields." };
  }

  try {
    const callable = httpsCallable(functions, "createOrder");
    const result = await callable({
      clientRequestId: clientRequestId || generateClientRequestId(),
      items: items.map((item) => ({
        productId: String(item.productId || ""),
        quantity: Number(item.quantity)
      })),
      deliveryMethod: String(deliveryMethod || "collection"),
      address: deliveryMethod === "delivery" ? String(address || "") : "",
      customerName: String(customerName || ""),
      customerPhone: String(customerPhone || "")
    });
    return { success: true, ...result.data };
  } catch (err) {
    logError("CREATE_ORDER_FAILED");
    const errorMessages = {
      "functions/unauthenticated": "You must be logged in to place an order.",
      "functions/permission-denied": "You don't have permission to place an order.",
      "functions/not-found": "One of the products is no longer available.",
      "functions/invalid-argument": "Some order information is invalid.",
      "functions/failed-precondition": "The order cannot be placed with the selected products or delivery method.",
      "functions/already-exists": "This order request has already been used for a different cart. Please review your order and try again."
    };
    const message = errorMessages[err?.code] || "Failed to place your order. Please try again.";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// 5. STATUS UPDATE HELPER
// ────────────────────────────────────────────────────────────

/**
 * Update an order's status with validation and history tracking.
 * @param {string} orderId
 * @param {string} newStatus
 * @param {string} [note] - Optional note for the status history entry.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateOrderStatus(orderId, newStatus, note = "") {
  if (!orderId || !newStatus) {
    return { success: false, error: "Order ID and new status are required." };
  }

  try {
    const callable = httpsCallable(functions, "updateOrderStatus");
    const result = await callable({
      orderId,
      requestedStatus: newStatus,
      sellerNote: note || ""
    });
    return { success: true, ...(result && result.data ? result.data : {}) };
  } catch (err) {
    logError("UPDATE_ORDER_STATUS_FAILED");
    const errorMessages = {
      "functions/unauthenticated": "You must be logged in to update this order.",
      "functions/permission-denied": "You don't have permission to update this order.",
      "functions/not-found": "Order not found.",
      "functions/invalid-argument": "The requested status is invalid.",
      "functions/failed-precondition": err?.message || "This status change is not allowed."
    };
    const message = errorMessages[err?.code] || "Failed to update order status. Please try again.";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// 6. CANCEL ORDER (Customer)
// ────────────────────────────────────────────────────────────

/**
 * Cancel an order. Only allowed if status is PENDING.
 * @param {string} orderId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function cancelOrder(orderId) {
  if (!orderId) {
    return { success: false, error: "Order ID is required." };
  }

  try {
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      return { success: false, error: "Order not found." };
    }

    const orderData = orderSnap.data();
    if (!canCustomerCancel(orderData.status)) {
      return { success: false, error: "Orders can only be cancelled while pending." };
    }

    return await updateOrderStatus(orderId, ORDER_STATUS.CANCELLED, "Cancelled by customer");
  } catch (err) {
    logError("CANCEL_ORDER_FAILED");
    return { success: false, error: "Failed to cancel order. Please try again." };
  }
}

// ────────────────────────────────────────────────────────────
// 7. REAL-TIME LISTENERS
// ────────────────────────────────────────────────────────────

/**
 * Subscribe to a customer's orders in real-time.
 * @param {string} customerId
 * @param {function} onOrders - Callback with { active: [], past: [] }
 * @param {function} [onError] - Error callback
 * @returns {function} Unsubscribe function
 */
export function subscribeToCustomerOrders(customerId, onOrders, onError) {
  if (!customerId) {
    if (onError) onError(new Error("Customer ID is required."));
    return () => {};
  }

  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("customerId", "==", customerId),
    orderBy("createdAt", "desc")
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const active = [];
      const past = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const order = { id: docSnap.id, ...data };

        if (isTerminalStatus(order.status)) {
          past.push(order);
        } else {
          active.push(order);
        }
      });

      if (onOrders) onOrders({ active, past });
    },
    (err) => {
      logError("CUSTOMER_ORDERS_LISTENER_FAILED");
      if (onError) onError(err);
    }
  );

  return unsubscribe;
}

/**
 * Subscribe to a customer's orders with filter support.
 * Supports filters: "all", "active", "completed", "cancelled"
 * @param {string} customerId
 * @param {function} onOrders - Callback with { orders, filter }
 * @param {function} [onError] - Error callback
 * @returns {function} Unsubscribe function
 */
export function subscribeToCustomerOrdersWithFilter(customerId, filter = "all", onOrders, onError) {
  if (!customerId) {
    if (onError) onError(new Error("Customer ID is required."));
    return () => {};
  }

  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("customerId", "==", customerId),
    orderBy("createdAt", "desc")
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const allOrders = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        allOrders.push({ id: docSnap.id, ...data });
      });

      // Apply filter
      let filtered = allOrders;
      if (filter === "active") {
        filtered = allOrders.filter(o => !isTerminalStatus(o.status));
      } else if (filter === "completed") {
        filtered = allOrders.filter(o => o.status === ORDER_STATUS.COMPLETED);
      } else if (filter === "cancelled") {
        filtered = allOrders.filter(o => o.status === ORDER_STATUS.CANCELLED || o.status === ORDER_STATUS.REJECTED);
      }

      if (onOrders) onOrders({ orders: filtered, all: allOrders, filter });
    },
    (err) => {
      logError("CUSTOMER_ORDERS_FILTER_LISTENER_FAILED");
      if (onError) onError(err);
    }
  );

  return unsubscribe;
}

/**
 * Subscribe to a seller's orders in real-time with metrics.
 * @param {string} storeId
 * @param {function} onOrders - Callback with { orders, metrics, ordersToday, revenueToday }
 * @param {function} [onError] - Error callback
 * @returns {function} Unsubscribe function
 */
export function subscribeToSellerOrders(storeId, onOrders, onError) {
  if (!storeId) {
    if (onError) onError(new Error("Store ID is required."));
    return () => {};
  }

  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("storeId", "==", storeId),
    orderBy("createdAt", "desc")
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const orders = [];
      let pending = 0;
      let preparing = 0;
      let ready = 0;
      let completedToday = 0;
      let cancelled = 0;
      let ordersToday = 0;
      let revenueToday = 0;

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const order = { id: docSnap.id, ...data };
        orders.push(order);

        switch (data.status) {
          case ORDER_STATUS.PENDING:
            pending++;
            break;
          case ORDER_STATUS.PREPARING:
            preparing++;
            break;
          case ORDER_STATUS.READY:
            ready++;
            break;
          case ORDER_STATUS.CANCELLED:
            cancelled++;
            break;
        }

        // Check if order was placed today
        if (data.createdAt) {
          const created = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
          if (created >= startOfToday) {
            ordersToday++;
          }
        }

        // Revenue: only count completed orders today
        if (data.status === ORDER_STATUS.COMPLETED && data.updatedAt) {
          const updated = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
          if (updated >= startOfToday) {
            completedToday++;
            revenueToday += Number(data.total) || 0;
          }
        }
      });

      if (onOrders) {
        onOrders({
          orders,
          pending,
          preparing,
          ready,
          completedToday,
          cancelled,
          ordersToday,
          revenueToday,
          metrics: {
            pending,
            preparing,
            ready,
            completedToday,
            cancelled,
            ordersToday,
            revenueToday
          }
        });
      }
    },
    (err) => {
      logError("SELLER_ORDERS_LISTENER_FAILED");
      if (onError) onError(err);
    }
  );

  return unsubscribe;
}

// ────────────────────────────────────────────────────────────
// 8. FORMATTING UTILITIES
// ────────────────────────────────────────────────────────────

/**
 * Format a timestamp to a readable date/time string.
 * @param {any} ts - Firestore Timestamp, ISO string, or Date
 * @returns {string}
 */
export function formatOrderTimestamp(ts) {
  if (!ts) return "-";
  try {
    let date;
    if (ts instanceof Timestamp) {
      date = ts.toDate();
    } else if (ts instanceof Date) {
      date = ts;
    } else if (typeof ts === "string") {
      date = new Date(ts);
    } else if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else {
      return "-";
    }
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "-";
  }
}

/**
 * Get the delivery method label for display.
 * @param {string} method
 * @returns {string}
 */
export function getDeliveryMethodLabel(method) {
  if (method === "delivery") return "Delivery";
  return "Collection";
}

/**
 * Get the status icon for timeline display.
 * @param {string} status
 * @param {string} currentStatus - The order's current status
 * @returns {string} Emoji/icon
 */
export function getTimelineIcon(status, currentStatus) {
  const statusOrder = [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.ACCEPTED,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.READY
  ];

  // For terminal states
  if (currentStatus === ORDER_STATUS.CANCELLED || currentStatus === ORDER_STATUS.REJECTED) {
    if (status === currentStatus) return "✕";
    return "○";
  }

  if (currentStatus === ORDER_STATUS.COMPLETED) {
    // Add collected or out_for_delivery step
    const allStatuses = [
      ...statusOrder,
      ORDER_STATUS.COLLECTED,
      ORDER_STATUS.COMPLETED
    ];
    const idx = allStatuses.indexOf(status);
    const currentIdx = allStatuses.indexOf(currentStatus);
    if (idx < currentIdx) return "✔";
    if (idx === currentIdx) return "●";
    return "○";
  }

  // For delivery orders
  const extendedStatuses = [
    ...statusOrder,
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.COMPLETED
  ];

  const idx = extendedStatuses.indexOf(status);
  const currentIdx = extendedStatuses.indexOf(currentStatus);

  if (idx < 0) return "○";
  if (idx < currentIdx) return "✔";
  if (idx === currentIdx) return "●";
  return "○";
}

// ────────────────────────────────────────────────────────────
// 9. ORDER CARD HTML GENERATOR
// ────────────────────────────────────────────────────────────

/**
 * Create an order card element for display.
 * @param {Object} order - Order data with id
 * @param {boolean} [isSeller=false] - Whether to render seller actions
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement}
 */
export function createOrderCard(order, isSeller = false, options = {}) {
  const { onAction } = options;
  const card = document.createElement("div");
  card.className = "order-card";
  card.dataset.orderId = order.id;
  card.dataset.status = order.status;

  // Status badge
  const statusColor = STATUS_COLORS[order.status] || "#6b7280";
  const statusLabel = STATUS_LABELS[order.status] || order.status;
  const orderNumber = escapeHtml(order.orderNumber || order.id);
  const safeStatusLabel = escapeHtml(statusLabel);

  // Header
  const header = document.createElement("div");
  header.className = "order-card-header";
  header.innerHTML = `
    <div class="order-card-number">
      <span class="order-number-label">Order</span>
      <span class="order-number-value">${orderNumber}</span>
    </div>
    <span class="order-status-badge" style="background:${statusColor}20; color:${statusColor}; border:1px solid ${statusColor}40;">
      ${safeStatusLabel}
    </span>
  `;
  card.appendChild(header);

  // Customer info (seller view) or Store info (customer view)
  if (isSeller) {
    const customerInfo = document.createElement("div");
    customerInfo.className = "order-card-customer";
    customerInfo.innerHTML = `
      <div class="order-card-customer-name">${escapeHtml(order.customerName || "Unknown")}</div>
      <div class="order-card-customer-contact">${escapeHtml(order.customerPhone || "")}</div>
    `;
    card.appendChild(customerInfo);
  } else {
    const storeInfo = document.createElement("div");
    storeInfo.className = "order-card-store";
    storeInfo.innerHTML = `
      <div class="order-card-store-name">${escapeHtml(order.storeName || "Store")}</div>
    `;
    card.appendChild(storeInfo);
  }

  // Items
  const itemsContainer = document.createElement("div");
  itemsContainer.className = "order-card-items";

  if (order.items && order.items.length > 0) {
    // Show first 3 items, then "+N more"
    const maxVisible = 3;
    const visibleItems = order.items.slice(0, maxVisible);
    const remaining = order.items.length - maxVisible;

    visibleItems.forEach((item) => {
      const itemEl = document.createElement("div");
      itemEl.className = "order-card-item";
      itemEl.innerHTML = `
        <span class="order-card-item-name">${escapeHtml(item.name || "Item")}</span>
        <span class="order-card-item-qty">×${item.quantity || 1}</span>
        <span class="order-card-item-price">${formatPrice((item.price || 0) * (item.quantity || 1))}</span>
      `;
      itemsContainer.appendChild(itemEl);
    });

    if (remaining > 0) {
      const moreEl = document.createElement("div");
      moreEl.className = "order-card-item-more";
      moreEl.textContent = `+${remaining} more item${remaining > 1 ? "s" : ""}`;
      itemsContainer.appendChild(moreEl);
    }
  }
  card.appendChild(itemsContainer);

  // Order details
  const details = document.createElement("div");
  details.className = "order-card-details";
  details.innerHTML = `
    <div class="order-card-detail-row">
      <span>Delivery</span>
      <span>${getDeliveryMethodLabel(order.deliveryMethod)}</span>
    </div>
    ${order.deliveryMethod === "delivery" && order.deliveryFee > 0 ? `
      <div class="order-card-detail-row">
        <span>Delivery Fee</span>
        <span>${formatPrice(order.deliveryFee)}</span>
      </div>
    ` : ""}
    <div class="order-card-detail-row">
      <span>Total</span>
      <span class="order-card-total">${formatPrice(order.total)}</span>
    </div>
    <div class="order-card-detail-row order-card-time">
      <span>Placed</span>
      <span>${formatOrderTimestamp(order.createdAt)}</span>
    </div>
  `;
  card.appendChild(details);

  // Actions (if applicable)
  const actions = document.createElement("div");
  actions.className = "order-card-actions";

  if (isSeller) {
    // Seller actions based on status
    const validNextStatuses = getValidNextStatuses(order.status);
    validNextStatuses.forEach((nextStatus) => {
      if (nextStatus === ORDER_STATUS.CANCELLED) return; // handled separately
      const btn = document.createElement("button");
      btn.className = "order-action-btn";
      btn.dataset.orderId = order.id;
      btn.dataset.nextStatus = nextStatus;
      btn.textContent = getActionButtonLabel(nextStatus);
      btn.style.background = STATUS_COLORS[nextStatus] || "#6b7280";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (onAction) onAction(order.id, nextStatus);
      });
      actions.appendChild(btn);
    });
  } else if (canCustomerCancel(order.status)) {
    // Customer cancel button
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "order-action-btn order-cancel-btn";
    cancelBtn.dataset.orderId = order.id;
    cancelBtn.textContent = "Cancel Order";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (onAction) onAction(order.id, ORDER_STATUS.CANCELLED);
    });
    actions.appendChild(cancelBtn);
  }

  card.appendChild(actions);

  return card;
}

/**
 * Get a human-friendly label for action buttons.
 * @param {string} status
 * @returns {string}
 */
export function getActionButtonLabel(status) {
  const labels = {
    [ORDER_STATUS.ACCEPTED]: "Accept",
    [ORDER_STATUS.REJECTED]: "Reject",
    [ORDER_STATUS.PREPARING]: "Preparing",
    [ORDER_STATUS.READY]: "Mark Ready",
    [ORDER_STATUS.COLLECTED]: "Mark Collected",
    [ORDER_STATUS.OUT_FOR_DELIVERY]: "Out for Delivery",
    [ORDER_STATUS.COMPLETED]: "Mark Completed"
  };
  return labels[status] || status;
}

/**
 * Get the available actions for an order as an array of action configs.
 * Each action config has: { status, label, color }
 * Used to dynamically render action buttons without hardcoding.
 * @param {Object} order - Order data with status and deliveryMethod
 * @param {boolean} [isSeller=false] - Whether to get seller or customer actions
 * @returns {Array<{status: string, label: string, color: string}>}
 */
export function getAvailableActions(order, isSeller = false) {
  if (!order || !order.status) return [];

  if (isSeller) {
    // Seller actions — skip CANCELLED (handled separately via reject)
    return getValidNextStatuses(order.status)
      .filter(s => s !== ORDER_STATUS.CANCELLED)
      .map(s => ({
        status: s,
        label: getActionButtonLabel(s),
        color: STATUS_COLORS[s] || "#6b7280"
      }));
  }

  // Customer actions
  if (canCustomerCancel(order.status)) {
    return [{
      status: ORDER_STATUS.CANCELLED,
      label: "Cancel Order",
      color: "#ef4444"
    }];
  }

  return [];
}

// ────────────────────────────────────────────────────────────
// 10. ORDER TIMELINE HTML GENERATOR
// ────────────────────────────────────────────────────────────

/**
 * Create a visual timeline element for an order.
 * @param {Object} order - Order data with statusHistory
 * @returns {HTMLElement}
 */
export function createOrderTimeline(order) {
  const container = document.createElement("div");
  container.className = "order-timeline";

  if (!order.statusHistory || !Array.isArray(order.statusHistory) || order.statusHistory.length === 0) {
    container.innerHTML = '<p class="timeline-empty">No status updates available.</p>';
    return container;
  }

  const currentStatus = order.status;
  const isTerminal = isTerminalStatus(currentStatus);
  const isCancelled = currentStatus === ORDER_STATUS.CANCELLED;
  const isRejected = currentStatus === ORDER_STATUS.REJECTED;

  // Define the timeline steps based on delivery method
  let timelineSteps;
  if (isCancelled || isRejected) {
    timelineSteps = [
      ORDER_STATUS.PENDING,
      currentStatus
    ];
  } else if (order.deliveryMethod === "delivery") {
    timelineSteps = [
      ORDER_STATUS.PENDING,
      ORDER_STATUS.ACCEPTED,
      ORDER_STATUS.PREPARING,
      ORDER_STATUS.READY,
      ORDER_STATUS.OUT_FOR_DELIVERY,
      ORDER_STATUS.COMPLETED
    ];
  } else {
    timelineSteps = [
      ORDER_STATUS.PENDING,
      ORDER_STATUS.ACCEPTED,
      ORDER_STATUS.PREPARING,
      ORDER_STATUS.READY,
      ORDER_STATUS.COLLECTED,
      ORDER_STATUS.COMPLETED
    ];
  }

  // Find history entries for each step
  timelineSteps.forEach((stepStatus) => {
    const historyEntry = order.statusHistory.find(h => h.status === stepStatus);
    const stepIndex = timelineSteps.indexOf(stepStatus);
    const currentIndex = timelineSteps.indexOf(currentStatus);

    const isCompleted = stepIndex < currentIndex;
    const isCurrent = stepIndex === currentIndex;
    const isFuture = stepIndex > currentIndex;

    let icon = "○";
    let iconClass = "timeline-icon-future";
    if (isCompleted) {
      icon = "✔";
      iconClass = "timeline-icon-completed";
    } else if (isCurrent) {
      icon = "●";
      iconClass = "timeline-icon-current";
    }

    const stepEl = document.createElement("div");
    stepEl.className = `timeline-step ${isCurrent ? "timeline-step-current" : ""} ${isCompleted ? "timeline-step-completed" : ""}`;

    stepEl.innerHTML = `
      <div class="timeline-icon ${iconClass}">${icon}</div>
      <div class="timeline-content">
        <div class="timeline-status">${STATUS_LABELS[stepStatus] || stepStatus}</div>
        <div class="timeline-time">${historyEntry ? formatOrderTimestamp(historyEntry.timestamp) : ""}</div>
        ${historyEntry && historyEntry.note ? `<div class="timeline-note">${escapeHtml(historyEntry.note)}</div>` : ""}
      </div>
    `;

    container.appendChild(stepEl);
  });

  return container;
}

// ────────────────────────────────────────────────────────────
// 11. HELPER: Escape HTML
// ────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== "string") return String(str || "");
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
