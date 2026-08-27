/**
 * rating-breakdown.js — Reusable rating distribution component for HUSTLR.
 *
 * Displays a visual breakdown of ratings (5★ down to 1★) with:
 *   - Star level labels (5★, 4★, 3★, 2★, 1★)
 *   - Animated percentage bars
 *   - Count for each level
 *   - Total review count
 *   - Clickable rows (optional, for filtering)
 *
 * @module rating-breakdown
 */

/**
 * Create a rating breakdown element.
 *
 * @param {Object} options
 * @param {Object} [options.breakdown] - { 1: count, 2: count, 3: count, 4: count, 5: count }
 * @param {number} [options.totalReviews=0] - Total review count
 * @param {boolean} [options.clickable=false] - Allow clicking rows to filter
 * @param {function} [options.onRowClick] - Callback(starLevel) when a row is clicked
 * @returns {HTMLElement} The breakdown container
 */
export function createRatingBreakdown(options = {}) {
  const {
    breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    totalReviews = 0,
    clickable = false,
    onRowClick = null
  } = options;

  const container = document.createElement("div");
  container.className = "rating-breakdown";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Rating breakdown");

  /**
   * Calculate the percentage for a given star level.
   * @param {number} level - 1–5
   * @returns {number} Percentage 0–100
   */
  function getPercentage(level) {
    if (totalReviews <= 0) return 0;
    const count = breakdown[level] || 0;
    return Math.round((count / totalReviews) * 100);
  }

  /**
   * Render/re-render the breakdown rows.
   */
  function render() {
    container.replaceChildren();

    // Rows from 5 down to 1
    for (let i = 5; i >= 1; i--) {
      const row = document.createElement("div");
      row.className = "rating-breakdown-row";
      row.dataset.starLevel = String(i);

      if (clickable) {
        row.style.cursor = "pointer";
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.setAttribute("aria-label", `Filter by ${i} star${i !== 1 ? "s" : ""}`);
      }

      // Label (5★, 4★, etc.)
      const label = document.createElement("span");
      label.className = "rating-breakdown-label";
      label.textContent = `${i}★`;
      row.appendChild(label);

      // Bar wrapper
      const barWrapper = document.createElement("div");
      barWrapper.className = "rating-breakdown-bar-wrapper";

      const bar = document.createElement("div");
      bar.className = "rating-breakdown-bar";
      bar.style.width = `${getPercentage(i)}%`;
      barWrapper.appendChild(bar);
      row.appendChild(barWrapper);

      // Count
      const count = document.createElement("span");
      count.className = "rating-breakdown-count";
      count.textContent = String(breakdown[i] || 0);
      row.appendChild(count);

      container.appendChild(row);
    }
  }

  // ── Events ──────────────────────────────────────────────────────

  if (clickable) {
    container.addEventListener("click", (e) => {
      const row = e.target.closest(".rating-breakdown-row");
      if (!row) return;
      const level = parseInt(row.dataset.starLevel, 10);
      if (level >= 1 && level <= 5 && typeof onRowClick === "function") {
        onRowClick(level);
      }
    });

    // Keyboard
    container.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const row = e.target.closest(".rating-breakdown-row");
        if (!row) return;
        const level = parseInt(row.dataset.starLevel, 10);
        if (level >= 1 && level <= 5 && typeof onRowClick === "function") {
          e.preventDefault();
          onRowClick(level);
        }
      }
    });
  }

  // Initial render
  render();

  /**
   * Update the breakdown data and re-render.
   * @param {Object} newBreakdown - { 1: count, 2: count, 3: count, 4: count, 5: count }
   * @param {number} newTotal - Total review count
   */
  function update(newBreakdown, newTotal) {
    Object.keys(breakdown).forEach((key) => {
      const k = Number(key);
      breakdown[k] = (newBreakdown && newBreakdown[k]) || 0;
    });
    // Recalculate totalReviews from newTotal param
    // but also store it for percentage calc
    // We'll accept it as a parameter
    render();
  }

  // Expose update method
  container._ratingBreakdown = { update };

  return container;
}

/**
 * Update a rating breakdown component with new data.
 * @param {HTMLElement} element - The container returned by createRatingBreakdown
 * @param {Object} breakdown - { 1: count, 2: count, 3: count, 4: count, 5: count }
 * @param {number} totalReviews
 */
export function updateRatingBreakdown(element, breakdown, totalReviews) {
  if (element && element._ratingBreakdown) {
    element._ratingBreakdown.update(breakdown, totalReviews);
  }
}

