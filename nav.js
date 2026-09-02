/**
 * Nav Helper — Role-based navigation visibility & auth-aware nav links.
 *
 * Usage:
 *   import "./nav.js";
 *
 * This module listens for auth state changes and:
 * - Shows "Become a Seller" link for customers
 * - Hides "Become a Seller" link for sellers
 * - Swaps "Login" ↔ "Logout" in the nav based on auth state (across ALL pages)
 * - Dispatches 'roleChanged' custom event for cross-page UI synchronization
 *
 * It requires that an element with id="becomeSellerLink" exists in the nav.
 * It also requires that auth state listener runs on the page.
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getCurrentUserRole, isSeller, isCustomer, clearCachedRole } from "./roles.js";

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Centralized logout function.
 * Signs out of Firebase, clears cached role, redirects to auth page.
 */
export async function logoutUser() {
  try {
    await signOut(auth);
    clearCachedRole();
    window.location.href = "auth.html";
  } catch (err) {
    console.error("[HUSTLR:LOGOUT]", err);
    alert("Unable to log out right now. Please try again.");
  }
}

/**
 * Find the Login/Logout link in the nav.
 * Uses a stable ID: looks for <a id="authLink"> inside the <nav> element.
 */
function getAuthNavLink() {
  return document.getElementById("authLink");
}

let logoutHandler = null;

/**
 * Inject a "Discover" link into the nav (single source of truth).
 * Ensures every page's nav has a link to the global discovery page.
 * Idempotent — does nothing if a Discover link already exists.
 */
function ensureDiscoverLink() {
  const navLinkContainer = document.querySelector("nav > div:last-child");
  if (!navLinkContainer) return;

  // Detect any existing link pointing to discover.html (static or injected),
  // not just one tagged with data-nav="discover". This prevents duplicates.
  const existing = navLinkContainer.querySelector(
    'a[data-nav="discover"], a[href="discover.html"], a[href="./discover.html"]'
  );
  if (existing) return;

  const homeLink = navLinkContainer.querySelector('a[href="index.html"], a[href="./index.html"]');
  const discoverLink = document.createElement("a");
  discoverLink.href = "discover.html";
  discoverLink.dataset.nav = "discover";
  discoverLink.textContent = "Discover";

  if (homeLink) {
    homeLink.insertAdjacentElement("afterend", discoverLink);
  } else {
    navLinkContainer.prepend(discoverLink);
  }
}

function setupLogoutLink(link) {
  // Remove any previous handler to avoid duplicates
  if (logoutHandler) {
    link.removeEventListener("click", logoutHandler);
  }

  logoutHandler = async (e) => {
    e.preventDefault();
    await logoutUser();
  };

  link.addEventListener("click", logoutHandler);
}

function teardownLogoutLink(link) {
  if (logoutHandler) {
    link.removeEventListener("click", logoutHandler);
    logoutHandler = null;
  }
}

async function getPendingSellerStoreState(uid) {
  if (!uid) return null;

  try {
    const storeSnap = await getDoc(doc(db, "stores", uid));
    if (!storeSnap.exists()) return null;

    const store = storeSnap.data() || {};
    if (store.status === "pending_subscription" || store.status === "pending") {
      return store;
    }
    return null;
  } catch {
    return null;
  }
}

function applySellerLinkState(becomeSellerLink, role, pendingStore) {
  if (!becomeSellerLink) return;

  if (role === "customer") {
    becomeSellerLink.style.display = "inline";
    becomeSellerLink.href = pendingStore ? "subscription.html" : "create-store.html";
    becomeSellerLink.textContent = pendingStore ? "Complete Seller Setup" : "Create Store";
    return;
  }

  becomeSellerLink.style.display = "none";
  becomeSellerLink.textContent = "Create Store";
  becomeSellerLink.href = "create-store.html";
}

// ── Auth State Listener ───────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  const becomeSellerLink = document.getElementById("becomeSellerLink");
  if (becomeSellerLink) {
    becomeSellerLink.style.display = "none";
  }

  const authLink = getAuthNavLink();

  if (user && authLink) {
    authLink.textContent = "Logout";
    authLink.href = "#";
    setupLogoutLink(authLink);

    const role = await getCurrentUserRole();
    const pendingStore = role === "customer" ? await getPendingSellerStoreState(user.uid) : null;

    if (becomeSellerLink) {
      applySellerLinkState(becomeSellerLink, role, pendingStore);
    }

    const sellerNavLinks = document.getElementById("sellerNavLinks");
    if (sellerNavLinks) {
      if (role === "seller") {
        sellerNavLinks.innerHTML = `
          <a href="my-store.html">My Store</a>
          <a href="products.html">Products</a>
          <a href="seller-orders.html">Orders</a>
        `;
        sellerNavLinks.style.display = "inline";
      } else {
        sellerNavLinks.innerHTML = "";
        sellerNavLinks.style.display = "none";
      }
    }
  } else if (!user && authLink) {
    teardownLogoutLink(authLink);
    authLink.textContent = "Login";
    authLink.href = "auth.html";

    const sellerNavLinks = document.getElementById("sellerNavLinks");
    if (sellerNavLinks) {
      sellerNavLinks.innerHTML = "";
      sellerNavLinks.style.display = "none";
    }
  }
});

// ── Inject Discover link into the nav ──────────────────────────────
ensureDiscoverLink();

// ── Mobile Menu Toggle ─────────────────────────────────────────────

/**
 * Wire up the hamburger button for pages with a collapsible nav
 * (e.g. index.html).
 *
 * - Toggles .open on the #navLinks container (shows/hides the menu)
 * - Toggles .active on the button (animates the icon into an X)
 * - Keeps aria-expanded in sync for screen readers
 * - Closes the menu when a link inside is clicked or when tapping outside
 *
 * Idempotent / safe no-op on pages that don't have the toggle yet.
 */
function setupMobileMenuToggle() {
  const toggle = document.getElementById("menuToggle");
  const links = document.getElementById("navLinks");
  if (!toggle || !links) return;

  const setOpen = (open) => {
    links.classList.toggle("open", open);
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!links.classList.contains("open"));
  });

  // Close the menu after a link inside it is clicked (e.g. navigating)
  links.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  // Close when tapping anywhere outside the nav
  document.addEventListener("click", (e) => {
    if (
      links.classList.contains("open") &&
      !links.contains(e.target) &&
      !toggle.contains(e.target)
    ) {
      setOpen(false);
    }
  });
}

setupMobileMenuToggle();

window.addEventListener("roleChanged", async (event) => {
  const { role } = event.detail || {};

  const becomeSellerLink = document.getElementById("becomeSellerLink");
  if (becomeSellerLink) {
    const pendingStore = role === "customer" ? await getPendingSellerStoreState(auth.currentUser?.uid) : null;
    applySellerLinkState(becomeSellerLink, role, pendingStore);
  }

  const sellerNavLinks = document.getElementById("sellerNavLinks");
  if (sellerNavLinks) {
    if (role === "seller") {
      sellerNavLinks.innerHTML = `
        <a href="my-store.html">My Store</a>
        <a href="products.html">Products</a>
        <a href="seller-orders.html">Orders</a>
      `;
      sellerNavLinks.style.display = "inline";
    } else {
      sellerNavLinks.innerHTML = "";
      sellerNavLinks.style.display = "none";
    }
  }
});

