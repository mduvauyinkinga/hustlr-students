/**
 * rating-stars.js — Reusable star rating component for HUSTLR.
 *
 * Supports two modes:
 *   1. Static display (read-only stars)
 *   2. Interactive input (click to rate)
 *
 * Features:
 *   - Configurable size (sm, md, lg, xl)
 *   - Keyboard accessibility (arrow keys + Enter/Space)
 *   - Mobile touch support
 *   - Future-ready for decimal/half-star ratings
 *   - Rating change callback (interactive mode)
 *   - Focus-visible states for accessibility
 *
 * @module rating-stars
 */

// ── Constants ─────────────────────────────────────────────────────

const STAR_CHAR = "★";
const EMPTY_CHAR = "★"; // Same char, different color via CSS

const SIZE_MAP = {
  sm: "rating-stars-sm",
  md: "rating-stars-md",
  lg: "rating-stars-lg",
  xl: "rating-stars-xl"
};

const LABELS = {
  0: "No rating",
  1: "1 star — Poor",
  2: "2 stars — Fair",
  3: "3 stars — Average",
  4: "4 stars — Good",
  5: "5 stars — Excellent"
};

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Clamp a value between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Create a star rating element.
 *
 * @param {Object} options
 * @param {number} [options.rating=0] - Current rating (1–5, 0 = unrated)
 * @param {boolean} [options.interactive=false] - Enable interactive mode
 * @param {string} [options.size="md"] - Size: "sm", "md", "lg", "xl"
 * @param {boolean} [options.showLabel=false] - Show numeric rating label
 * @param {function} [options.onChange] - Callback(rating) when rating changes (interactive only)
 * @param {number} [options.maxRating=5] - Maximum stars (future: 10-star)
 * @returns {HTMLElement} The stars container element
 */
export function createRatingStars(options = {}) {
  const {
    rating = 0,
    interactive = false,
    size = "md",
    showLabel = false,
    onChange = null,
    maxRating = 5
  } = options;

  const container = document.createElement("div");
  container.className = `rating-stars ${SIZE_MAP[size] || SIZE_MAP.md}`;
  if (interactive) {
    container.classList.add("rating-stars-interactive");
  }
  container.setAttribute("role", interactive ? "radiogroup" : "img");
  container.setAttribute("aria-label", interactive ? "Rating" : `Rating: ${rating} out of ${maxRating}`);
  if (!interactive) {
    container.setAttribute("aria-roledescription", "star rating");
  }

  // Current value (internal)
  let currentRating = clamp(Math.round(rating), 0, maxRating);
  let hoverRating = 0;

  // Label element (optional)
  let labelEl = null;
  if (showLabel) {
    labelEl = document.createElement("span");
    labelEl.className = "rating-value-label";
    labelEl.textContent = currentRating > 0 ? `${currentRating}/${maxRating}` : "";
    container.appendChild(labelEl);
  }

  // State
  const state = { currentRating, hoverRating, maxRating };

  /**
   * Render or re-render the stars.
   */
  function render() {
    // Remove existing stars but keep the label
    const existingStars = container.querySelectorAll(".rating-star");
    existingStars.forEach((s) => s.remove());

    const insertBefore = labelEl || null;

    for (let i = 1; i <= state.maxRating; i++) {
      const star = document.createElement("span");
      star.className = "rating-star";
      star.textContent = STAR_CHAR;
      star.dataset.value = String(i);

      const displayRating = state.hoverRating > 0 ? state.hoverRating : state.currentRating;

      if (i <= displayRating) {
        star.classList.add("filled");
      }

      // Accessibility
      star.setAttribute("role", interactive ? "radio" : "presentation");
      star.setAttribute("aria-label", `${i} star${i !== 1 ? "s" : ""}`);
      if (interactive) {
        star.setAttribute("aria-checked", String(i <= state.currentRating));
        star.setAttribute("tabindex", "0");
      }

      container.insertBefore(star, insertBefore);
    }

    // Update label
    if (labelEl) {
      const display = state.hoverRating > 0 ? state.hoverRating : state.currentRating;
      labelEl.textContent = display > 0 ? `${display}/${state.maxRating}` : "";
    }

    container.setAttribute("aria-label", interactive
      ? `Rating: ${state.currentRating} out of ${state.maxRating}`
      : `Rating: ${state.currentRating} out of ${state.maxRating}`);
  }

  /**
   * Set rating programmatically.
   * @param {number} value - Rating 0–5
   * @param {boolean} [silent=false] - Skip onChange callback
   */
  function setRating(value, silent = false) {
    const newRating = clamp(Math.round(value), 0, state.maxRating);
    if (newRating !== state.currentRating) {
      state.currentRating = newRating;
      state.hoverRating = 0;
      render();
      if (!silent && typeof onChange === "function") {
        onChange(newRating);
      }
    }
  }

  /**
   * Get current rating value.
   * @returns {number}
   */
  function getRating() {
    return state.currentRating;
  }

  // ── Interactive Event Handlers ──────────────────────────────────

  if (interactive) {
    // Click handler (event delegation)
    container.addEventListener("click", (e) => {
      const star = e.target.closest(".rating-star");
      if (!star) return;
      const value = parseInt(star.dataset.value, 10);
      if (value >= 1 && value <= state.maxRating) {
        setRating(value);
      }
    });

    // Mouse hover
    container.addEventListener("mouseenter", () => {
      state.hoverRating = 0;
    });

    container.addEventListener("mouseleave", () => {
      state.hoverRating = 0;
      render();
    });

    container.addEventListener("mousemove", (e) => {
      const star = e.target.closest(".rating-star");
      if (!star) return;
      const value = parseInt(star.dataset.value, 10);
      if (value >= 1 && value <= state.maxRating && value !== state.hoverRating) {
        state.hoverRating = value;
        render();
      }
    });

    // Touch support
    container.addEventListener("touchmove", (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const star = target?.closest?.(".rating-star");
      if (!star) return;
      const value = parseInt(star.dataset.value, 10);
      if (value >= 1 && value <= state.maxRating && value !== state.hoverRating) {
        state.hoverRating = value;
        render();
      }
    });

    container.addEventListener("touchend", (e) => {
      if (state.hoverRating > 0) {
        setRating(state.hoverRating);
      }
    });

    // Keyboard support
    container.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        setRating(state.currentRating + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        setRating(state.currentRating - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        // Confirm current hover or current rating
        if (state.hoverRating > 0) {
          setRating(state.hoverRating);
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        setRating(1);
      } else if (e.key === "End") {
        e.preventDefault();
        setRating(state.maxRating);
      }
    });
  }

  // Initial render
  render();

  // Public API
  container._ratingStars = { setRating, getRating, render };

  return container;
}

/**
 * Update a star rating component's value programmatically.
 * @param {HTMLElement} element - The container returned by createRatingStars
 * @param {number} rating - New rating 0–5
 * @param {boolean} [silent=false] - Skip onChange callback
 */
export function updateRatingStars(element, rating, silent = false) {
  if (element && element._ratingStars) {
    element._ratingStars.setRating(rating, silent);
  }
}

/**
 * Get the current rating from a star component.
 * @param {HTMLElement} element
 * @returns {number}
 */
export function getRatingStarsValue(element) {
  if (element && element._ratingStars) {
    return element._ratingStars.getRating();
  }
  return 0;
}

