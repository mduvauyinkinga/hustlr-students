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

import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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

// ── Auth State Listener ───────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  // --- Become a Seller link ---
  const becomeSellerLink = document.getElementById("becomeSellerLink");
  if (becomeSellerLink) {
    becomeSellerLink.style.display = "none";
  }

  // --- Login ↔ Logout toggle ---
  const authLink = getAuthNavLink();

  if (user && authLink) {
    // Logged in → show "Logout" (click is handled via JS, href="#" prevents page jump)
    authLink.textContent = "Logout";
    authLink.href = "#";
    setupLogoutLink(authLink);

    // Determine role using roles.js (cache-first, Firestore fallback)
    const role = await getCurrentUserRole();

    // Show "Become a Seller" for customers only
    if (becomeSellerLink) {
      if (role === "customer") {
        becomeSellerLink.style.display = "inline";
      }
    }

    // --- Dynamic seller nav links ---
    // Inject seller-specific links (My Store, Products, Orders) into the nav.
    // Dashboard is already a static link on every page.
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
    // Logged out → show "Login"
    teardownLogoutLink(authLink);
    authLink.textContent = "Login";
    authLink.href = "auth.html";

    // Clear seller nav links when logged out
    const sellerNavLinks = document.getElementById("sellerNavLinks");
    if (sellerNavLinks) {
      sellerNavLinks.innerHTML = "";
      sellerNavLinks.style.display = "none";
    }
  }
});

// ── Inject Discover link into the nav ──────────────────────────────
ensureDiscoverLink();

// ── Listen for role changes from other modules (e.g. after upgrade) ──
// This ensures the nav updates without a page refresh when a user upgrades
// to seller via create-store.js.
window.addEventListener("roleChanged", async (event) => {
  const { role } = event.detail || {};

  const becomeSellerLink = document.getElementById("becomeSellerLink");
  if (becomeSellerLink) {
    becomeSellerLink.style.display = role === "customer" ? "inline" : "none";
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

