/**
 * empty-state.js — Reusable empty-state UI builder for HUSTLR.
 *
 * Used for: no products, no stores, no search results, no category matches,
 * empty store, empty favorites (future-ready).
 *
 * DOM-based (returns HTMLElement), but reusable across every page.
 *
 * Usage:
 *   import { renderEmptyState } from "./empty-state.js";
 *   renderEmptyState(containerEl, {
 *     icon: "🔍",
 *     title: "No results found",
 *     message: "Try adjusting your search or filters.",
 *     actionLabel: "Clear Filters",
 *     actionHref: "#",
 *     onAction: () => clearFilters()
 *   });
 */

/**
 * Build an empty-state element.
 * @param {Object} [options]
 * @param {string} [options.icon] - Emoji/icon character
 * @param {string} [options.title] - Heading text
 * @param {string} [options.message] - Supporting text
 * @param {string} [options.actionLabel] - CTA button label (omit to hide)
 * @param {string} [options.actionHref] - CTA href (defaults to "#")
 * @param {function} [options.onAction] - CTA click handler (overrides href navigation)
 * @returns {HTMLElement}
 */
export function createEmptyState(options = {}) {
  const {
    icon = "📦",
    title = "Nothing here yet",
    message = "",
    actionLabel = "",
    actionHref = "#",
    onAction = null
  } = options;

  const container = document.createElement("div");
  container.className = "empty-state-block";

  const iconEl = document.createElement("span");
  iconEl.className = "empty-state-icon";
  iconEl.textContent = icon;
  container.appendChild(iconEl);

  const titleEl = document.createElement("h3");
  titleEl.className = "empty-state-title";
  titleEl.textContent = title;
  container.appendChild(titleEl);

  if (message) {
    const msgEl = document.createElement("p");
    msgEl.className = "empty-state-message";
    msgEl.textContent = message;
    container.appendChild(msgEl);
  }

  if (actionLabel) {
    const action = document.createElement("a");
    action.className = "btn empty-state-action";
    action.href = actionHref || "#";
    action.textContent = actionLabel;
    if (typeof onAction === "function") {
      action.addEventListener("click", (e) => {
        e.preventDefault();
        onAction();
      });
    }
    container.appendChild(action);
  }

  return container;
}

/**
 * Replace a container's children with an empty-state element.
 * @param {HTMLElement|null} container
 * @param {Object} [options]
 * @returns {HTMLElement|null} The created element (or null if no container).
 */
export function renderEmptyState(container, options = {}) {
  if (!container) return null;
  const el = createEmptyState(options);
  container.replaceChildren(el);
  return el;
}

