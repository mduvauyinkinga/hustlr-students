/**
 * review-card.js — Reusable review card component for HUSTLR.
 *
 * Renders a complete review card with:
 *   - Customer photo (or placeholder)
 *   - Customer name
 *   - Verified Purchase badge
 *   - Star rating (read-only)
 *   - Review date
 *   - Review comment
 *   - Seller reply (when available)
 *   - Configurable action controls
 *
 * Visibility of controls is configured through options — no separate layouts.
 * Works on: store pages, product pages, customer dashboard, seller dashboard.
 *
 * @module review-card
 */

import { createRatingStars } from "./rating-stars.js";

// ── Constants ─────────────────────────────────────────────────────

const AVATAR_SIZE = 40;

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Escape HTML to prevent XSS.
 * @param {*} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== "string") return String(str || "");
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Format a review date for display.
 * @param {*} ts - Firestore Timestamp, ISO string, Date, or null
 * @returns {string}
 */
function formatDate(ts) {
  if (!ts) return "";
  try {
    let date;
    if (typeof ts === "object" && ts.toDate) {
      date = ts.toDate();
    } else if (typeof ts === "object" && ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else if (typeof ts === "string") {
      date = new Date(ts);
    } else if (ts instanceof Date) {
      date = ts;
    } else {
      return "";
    }
    if (isNaN(date.getTime())) return "";
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;

    return date.toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  } catch {
    return "";
  }
}

/**
 * Get initials from a name.
 * @param {string} name
 * @returns {string}
 */
function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Create a review card element.
 *
 * @param {Object} review - Review data object
 * @param {string} review.id - Review document ID
 * @param {number} review.rating - 1–5
 * @param {string} review.comment - Review text
 * @param {string} review.customerName - Customer's display name
 * @param {string} [review.customerPhoto] - Customer's photo URL
 * @param {boolean} [review.verifiedPurchase] - Whether purchase is verified
 * @param {*} [review.createdAt] - Timestamp
 * @param {string} [review.sellerReply] - Seller reply text
 * @param {*} [review.sellerReplyAt] - Seller reply timestamp
 * @param {string} [review.status] - "active" | "deleted"
 * @param {Object} [options]
 * @param {boolean} [options.showEditButton=false] - Show edit button for customer
 * @param {boolean} [options.showDeleteButton=false] - Show delete button for customer
 * @param {boolean} [options.showReplyButton=false] - Show reply button for seller
 * @param {boolean} [options.showReplyForm=false] - Show reply form inline
 * @param {boolean} [options.compact=false] - Compact mode for dashboard lists
 * @param {function} [options.onEdit] - Callback(reviewId, review) for edit
 * @param {function} [options.onDelete] - Callback(reviewId, review) for delete
 * @param {function} [options.onReply] - Callback(reviewId, review) for reply
 * @returns {HTMLElement} The review card element
 */
export function createReviewCard(review, options = {}) {
  const {
    showEditButton = false,
    showDeleteButton = false,
    showReplyButton = false,
    showReplyForm = false,
    compact = false,
    onEdit = null,
    onDelete = null,
    onReply = null
  } = options;

  const card = document.createElement("div");
  card.className = "review-card";
  card.dataset.reviewId = review.id || "";

  // ── Header ──────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "review-card-header";

  // Avatar
  if (review.customerPhoto) {
    const img = document.createElement("img");
    img.className = "review-card-avatar";
    img.src = String(review.customerPhoto);
    img.alt = `${escapeHtml(review.customerName || "Customer")}'s photo`;
    img.loading = "lazy";
    img.onerror = function () {
      this.style.display = "none";
      placeholder.style.display = "flex";
    };
    header.appendChild(img);

    const placeholder = document.createElement("div");
    placeholder.className = "review-card-avatar-placeholder";
    placeholder.textContent = getInitials(review.customerName);
    placeholder.style.display = "none";
    header.appendChild(placeholder);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "review-card-avatar-placeholder";
    placeholder.textContent = getInitials(review.customerName);
    header.appendChild(placeholder);
  }

  // Meta (name + stars)
  const meta = document.createElement("div");
  meta.className = "review-card-meta";

  const nameEl = document.createElement("div");
  nameEl.className = "review-card-name";
  nameEl.textContent = review.customerName || "Anonymous";
  meta.appendChild(nameEl);

  const starsEl = document.createElement("div");
  starsEl.className = "review-card-stars";
  const stars = createRatingStars({
    rating: review.rating || 0,
    size: "sm",
    interactive: false
  });
  starsEl.appendChild(stars);
  meta.appendChild(starsEl);

  header.appendChild(meta);

  // Date
  const dateEl = document.createElement("div");
  dateEl.className = "review-card-date";
  dateEl.textContent = formatDate(review.createdAt);
  header.appendChild(dateEl);

  card.appendChild(header);

  // ── Body ────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "review-card-body";

  // Badges
  if (review.verifiedPurchase) {
    const badges = document.createElement("div");
    badges.className = "review-card-badges";

    const verifiedBadge = document.createElement("span");
    verifiedBadge.className = "review-card-badge review-card-badge-verified";
    verifiedBadge.textContent = "✓ Verified Purchase";
    badges.appendChild(verifiedBadge);

    body.appendChild(badges);
  }

  // Comment
  if (review.comment) {
    const commentEl = document.createElement("p");
    commentEl.className = "review-card-comment";
    commentEl.textContent = review.comment;
    body.appendChild(commentEl);
  }

  card.appendChild(body);

  // ── Seller Reply ────────────────────────────────────────────────
  if (review.sellerReply) {
    const replyEl = document.createElement("div");
    replyEl.className = "review-card-reply";

    const replyHeading = document.createElement("div");
    replyHeading.className = "review-card-reply-heading";
    replyHeading.textContent = "Seller Response";
    replyEl.appendChild(replyHeading);

    const replyText = document.createElement("p");
    replyText.className = "review-card-reply-text";
    replyText.textContent = review.sellerReply;
    replyEl.appendChild(replyText);

    if (review.sellerReplyAt) {
      const replyDate = document.createElement("div");
      replyDate.className = "review-card-reply-date";
      replyDate.textContent = formatDate(review.sellerReplyAt);
      replyEl.appendChild(replyDate);
    }

    card.appendChild(replyEl);
  }

  // ── Actions ─────────────────────────────────────────────────────
  const hasActions = showEditButton || showDeleteButton || showReplyButton;

  if (hasActions) {
    const actions = document.createElement("div");
    actions.className = "review-card-actions";

    // Edit button (customer)
    if (showEditButton && review.status !== "deleted") {
      const editBtn = document.createElement("button");
      editBtn.className = "review-action-btn review-action-btn-edit";
      editBtn.textContent = "Edit";
      editBtn.type = "button";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onEdit === "function") {
          onEdit(review.id, review);
        }
      });
      actions.appendChild(editBtn);
    }

    // Delete button (customer)
    if (showDeleteButton && review.status !== "deleted") {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "review-action-btn review-action-btn-delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.type = "button";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onDelete === "function") {
          onDelete(review.id, review);
        }
      });
      actions.appendChild(deleteBtn);
    }

    // Reply button (seller)
    if (showReplyButton) {
      const replyBtn = document.createElement("button");
      replyBtn.className = "review-action-btn review-action-btn-reply";
      replyBtn.textContent = review.sellerReply ? "Edit Reply" : "Reply";
      replyBtn.type = "button";
      replyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onReply === "function") {
          onReply(review.id, review);
        }
      });
      actions.appendChild(replyBtn);
    }

    card.appendChild(actions);
  }

  return card;
}

