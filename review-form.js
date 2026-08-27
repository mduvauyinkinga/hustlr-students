/**
 * review-form.js — Reusable review form/modal component for HUSTLR.
 *
 * Supports:
 *   - Create mode (new review)
 *   - Edit mode (update existing review)
 *   - Interactive star picker
 *   - Character counter with configurable max
 *   - Validation (rating required, comment length)
 *   - Loading/success/error states
 *   - Keyboard accessible
 *   - Mobile responsive
 *
 * @module review-form
 */

import { createRatingStars, getRatingStarsValue, updateRatingStars } from "./rating-stars.js";

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_MAX_COMMENT_LENGTH = 500;

const RATING_LABELS = {
  0: "Select your rating",
  1: "Poor",
  2: "Fair",
  3: "Average",
  4: "Good",
  5: "Excellent"
};

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

// ── Component ─────────────────────────────────────────────────────

/**
 * Create a review form modal.
 *
 * @param {Object} options
 * @param {string} [options.mode="create"] - "create" or "edit"
 * @param {Object} [options.review] - Existing review data (for edit mode)
 * @param {string} options.review.id - Review ID
 * @param {number} options.review.rating - 1–5
 * @param {string} options.review.comment - Review text
 * @param {string} [options.title] - Custom modal title
 * @param {number} [options.maxCommentLength=500] - Maximum comment characters
 * @param {function} [options.onSubmit] - Async callback(reviewData) => Promise<{success, error?}>
 * @param {function} [options.onClose] - Callback when form is closed
 * @returns {HTMLElement} The modal overlay element
 */
export function createReviewForm(options = {}) {
  const {
    mode = "create",
    review = null,
    title = "",
    maxCommentLength = DEFAULT_MAX_COMMENT_LENGTH,
    onSubmit = null,
    onClose = null
  } = options;

  const isEdit = mode === "edit";
  const existingRating = review?.rating || 0;
  const existingComment = review?.comment || "";

  // ── Create overlay ──────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "review-form-overlay";

  const modal = document.createElement("div");
  modal.className = "review-form-modal";

  // ── Header ──────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "review-form-header";

  const modalTitle = document.createElement("h3");
  modalTitle.className = "review-form-title";
  modalTitle.textContent = title || (isEdit ? "Edit Your Review" : "Write a Review");
  header.appendChild(modalTitle);

  const closeBtn = document.createElement("button");
  closeBtn.className = "review-form-close-btn";
  closeBtn.textContent = "×";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close review form");
  header.appendChild(closeBtn);

  modal.appendChild(header);

  // ── Body ────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "review-form-body";

  // Status message
  const statusEl = document.createElement("div");
  statusEl.className = "review-form-status";
  body.appendChild(statusEl);

  // Rating field
  const ratingField = document.createElement("div");
  ratingField.className = "review-form-field";

  const ratingLabel = document.createElement("label");
  ratingLabel.className = "review-form-label";
  ratingLabel.textContent = "Rating";
  ratingField.appendChild(ratingLabel);

  const starsContainer = document.createElement("div");
  starsContainer.className = "review-form-stars";
  starsContainer.setAttribute("role", "group");
  starsContainer.setAttribute("aria-label", "Select a rating");

  const stars = createRatingStars({
    rating: existingRating,
    interactive: true,
    size: "lg",
    onChange: (value) => {
      ratingValueEl.textContent = RATING_LABELS[value] || "";
      // Clear rating error when user selects
      ratingErrorEl.classList.remove("visible");
    }
  });

  starsContainer.appendChild(stars);

  const ratingValueEl = document.createElement("span");
  ratingValueEl.className = "review-form-rating-value";
  ratingValueEl.textContent = RATING_LABELS[existingRating] || "";
  starsContainer.appendChild(ratingValueEl);

  ratingField.appendChild(starsContainer);

  // Rating error
  const ratingErrorEl = document.createElement("div");
  ratingErrorEl.className = "review-form-error";
  ratingErrorEl.textContent = "Please select a rating.";
  ratingField.appendChild(ratingErrorEl);

  body.appendChild(ratingField);

  // Comment field
  const commentField = document.createElement("div");
  commentField.className = "review-form-field";

  const commentLabel = document.createElement("label");
  commentLabel.className = "review-form-label";
  commentLabel.textContent = "Your Review";
  commentField.appendChild(commentLabel);

  const textareaWrapper = document.createElement("div");
  textareaWrapper.className = "review-form-textarea-wrapper";

  const textarea = document.createElement("textarea");
  textarea.className = "review-form-textarea";
  textarea.placeholder = "Share your experience... What did you like or dislike?";
  textarea.value = existingComment;
  textarea.setAttribute("maxlength", String(maxCommentLength));
  textarea.setAttribute("aria-label", "Your review comment");
  textareaWrapper.appendChild(textarea);

  const charCount = document.createElement("span");
  charCount.className = "review-form-char-count";
  charCount.textContent = `${existingComment.length}/${maxCommentLength}`;
  textareaWrapper.appendChild(charCount);

  commentField.appendChild(textareaWrapper);

  // Comment error
  const commentErrorEl = document.createElement("div");
  commentErrorEl.className = "review-form-error";
  commentErrorEl.textContent = "Please write a review comment (at least 10 characters).";
  commentField.appendChild(commentErrorEl);

  body.appendChild(commentField);

  // Submit button
  const submitBtn = document.createElement("button");
  submitBtn.className = "review-form-submit";
  submitBtn.type = "button";
  submitBtn.innerHTML = `<span class="btn-text">${isEdit ? "Update Review" : "Submit Review"}</span><span class="spinner"></span>`;
  body.appendChild(submitBtn);

  modal.appendChild(body);
  overlay.appendChild(modal);

  // ── State ───────────────────────────────────────────────────────
  let isSubmitting = false;

  // ── Validation ──────────────────────────────────────────────────

  function validate() {
    let valid = true;

    const rating = getRatingStarsValue(stars);
    if (rating < 1) {
      ratingErrorEl.classList.add("visible");
      valid = false;
    } else {
      ratingErrorEl.classList.remove("visible");
    }

    const comment = textarea.value.trim();
    if (comment.length < 10) {
      commentErrorEl.classList.add("visible");
      valid = false;
    } else {
      commentErrorEl.classList.remove("visible");
    }

    return valid;
  }

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = "review-form-status";
    if (type) {
      statusEl.classList.add(type);
      statusEl.classList.add("visible");
    } else {
      statusEl.classList.remove("visible");
    }
  }

  function clearStatus() {
    statusEl.textContent = "";
    statusEl.className = "review-form-status";
    statusEl.classList.remove("visible");
  }

  function setLoading(loading) {
    isSubmitting = loading;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("loading", loading);
    textarea.disabled = loading;
  }

  // ── Events ─────────────────────────────────────────────────────

  // Textarea input — update char count + validate
  textarea.addEventListener("input", () => {
    const len = textarea.value.length;
    charCount.textContent = `${len}/${maxCommentLength}`;
    charCount.classList.toggle("over", len > maxCommentLength);
    if (len >= 10) {
      commentErrorEl.classList.remove("visible");
    }
  });

  // Submit
  submitBtn.addEventListener("click", async () => {
    if (isSubmitting) return;

    if (!validate()) return;

    const rating = getRatingStarsValue(stars);
    const comment = textarea.value.trim();

    if (typeof onSubmit !== "function") return;

    setLoading(true);
    clearStatus();

    try {
      const result = await onSubmit({
        rating,
        comment,
        reviewId: review?.id || null
      });

      if (result && result.success) {
        setStatus(isEdit ? "Review updated successfully!" : "Review submitted successfully!", "success");
        // Close after brief delay
        setTimeout(() => {
          close();
        }, 1200);
      } else {
        setStatus(result?.error || "Failed to submit review. Please try again.", "error");
        setLoading(false);
      }
    } catch (err) {
      setStatus("An unexpected error occurred. Please try again.", "error");
      setLoading(false);
    }
  });

  // Close
  function close() {
    overlay.remove();
    document.body.style.overflow = "";
    if (typeof onClose === "function") {
      onClose();
    }
  }

  closeBtn.addEventListener("click", close);

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      close();
    }
  });

  // Close on Escape
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);

  // Focus the textarea on open
  setTimeout(() => {
    textarea.focus();
  }, 100);

  // Prevent body scroll
  document.body.style.overflow = "hidden";

  return overlay;
}

