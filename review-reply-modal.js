/**
 * review-reply-modal.js — Reusable seller reply modal for HUSTLR.
 *
 * Opens a HUSTLR-styled modal (no browser-native dialogs) that lets a
 * store owner reply to — or edit an existing reply on — a customer review.
 *
 * Architecture rules:
 *   - All review mutations go through reviews.js ONLY (replyToReview).
 *   - No business logic is duplicated here.
 *   - Reuses the review-form modal styles already shipped in reviews.css.
 *
 * @module review-reply-modal
 */

import { replyToReview } from "./reviews.js";

/**
 * Open the seller reply modal for a review.
 *
 * @param {string} reviewId - Review document ID (equal to the order ID)
 * @param {Object} [review={}] - Review data (used for the existing reply text)
 */
export function openSellerReplyModal(reviewId, review = {}) {
  if (!reviewId) return;

  const overlay = document.createElement("div");
  overlay.className = "review-form-overlay";

  const modal = document.createElement("div");
  modal.className = "review-form-modal";

  // ── Header ──────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "review-form-header";
  header.innerHTML = `
    <h3 class="review-form-title">${review.sellerReply ? "Edit Reply" : "Reply to Review"}</h3>
    <button class="review-form-close-btn" type="button" aria-label="Close">&times;</button>
  `;

  const closeBtn = header.querySelector(".review-form-close-btn");

  // ── Body ────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "review-form-body";

  const status = document.createElement("div");
  status.className = "review-form-status";
  body.appendChild(status);

  const field = document.createElement("div");
  field.className = "review-form-field";

  const label = document.createElement("label");
  label.className = "review-form-label";
  label.textContent = "Your Reply";
  field.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.className = "review-form-textarea";
  textarea.placeholder = "Thank the customer and address their feedback...";
  textarea.value = (review && review.sellerReply) || "";
  textarea.setAttribute("maxlength", "500");
  field.appendChild(textarea);

  const errorEl = document.createElement("div");
  errorEl.className = "review-form-error";
  errorEl.textContent = "Please enter a reply.";
  field.appendChild(errorEl);

  body.appendChild(field);

  const submitBtn = document.createElement("button");
  submitBtn.className = "review-form-submit";
  submitBtn.type = "button";
  submitBtn.innerHTML = `<span class="btn-text">${review.sellerReply ? "Update Reply" : "Submit Reply"}</span><span class="spinner"></span>`;
  body.appendChild(submitBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);

  // ── Helpers ─────────────────────────────────────────────────────
  const setStatus = (message, type) => {
    status.textContent = message;
    status.className = "review-form-status";
    if (type) {
      status.classList.add(type);
      status.classList.add("visible");
    }
  };

  const setLoading = (loading) => {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("loading", loading);
  };

  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", handleEscape);
  };

  const handleEscape = (e) => {
    if (e.key === "Escape") close();
  };

  // ── Events ──────────────────────────────────────────────────────
  submitBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text) {
      errorEl.classList.add("visible");
      return;
    }
    errorEl.classList.remove("visible");

    setLoading(true);
    status.classList.remove("visible");

    const result = await replyToReview(reviewId, text);
    if (result && result.success) {
      setStatus("Reply submitted successfully!", "success");
      setTimeout(close, 1200);
    } else {
      setStatus(result?.error || "Failed to submit reply.", "error");
      setLoading(false);
    }
  });

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", handleEscape);

  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  textarea.focus();
}

