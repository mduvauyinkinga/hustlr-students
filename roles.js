/**
 * roles.js — Centralized Role Management Module for HUSTLR.
 *
 * All role-related logic lives here. No other module should duplicate
 * Firestore queries for role checking, caching, or upgrading.
 *
 * Architecture:
 *   Authentication → Firestore role → Continue
 *
 * Usage:
 *   import { isSeller, requireSeller, upgradeToSeller, ... } from "./roles.js";
 */

import { auth, db } from "./firebase.js";
import { ensureUserDocument } from "./user-initialization.js";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Constants ─────────────────────────────────────────────────────

export const CUSTOMER_ROLE = "customer";
export const SELLER_ROLE = "seller";
export const ADMIN_ROLE = "admin";

/**
 * Clear legacy role cache entries. Called on logout.
 */
export function clearCachedRole() {
  try {
    localStorage.removeItem("hustlr_user_role");
    localStorage.removeItem("hustlr_role_cache_time");
  } catch {
    // silently fail
  }
}

// ── Firestore Role Fetch ──────────────────────────────────────────

/**
 * Fetch the user's role from Firestore.
 * Returns null if the authoritative role cannot be read.
 *
 * @param {string} uid
 * @returns {Promise<string|null>}
 */
async function fetchRoleFromFirestore(uid) {
  if (!uid) return null;

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return null;
    }

    const data = userSnap.data();
    const role = data.role || null;

    return role || null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Get the current user's role.
 * Reads the role from Firestore after ensuring the user document exists.
 * @returns {Promise<string|null>}
 */
export async function getCurrentUserRole() {
  const user = auth.currentUser;
  if (!user) return null;

  await ensureUserDocument(user);

  return await fetchRoleFromFirestore(user.uid);
}

/**
 * Force-refresh the role from Firestore.
 * Updates the cache and dispatches a 'roleChanged' event.
 * @returns {Promise<string|null>}
 */
export async function refreshUserRole() {
  const user = auth.currentUser;
  if (!user) return null;

  const role = await fetchRoleFromFirestore(user.uid);

  // Dispatch a custom event so other modules can react
  if (role) {
    window.dispatchEvent(new CustomEvent("roleChanged", { detail: { role } }));
  }

  return role;
}

/**
 * Check if the current user is a customer.
 * @returns {Promise<boolean>}
 */
export async function isCustomer() {
  const role = await getCurrentUserRole();
  return role === CUSTOMER_ROLE;
}

/**
 * Check if the current user is a seller.
 * @returns {Promise<boolean>}
 */
export async function isSeller() {
  const role = await getCurrentUserRole();
  return role === SELLER_ROLE;
}

/**
 * Check if the current user is an admin.
 * @returns {Promise<boolean>}
 */
export async function isAdmin() {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    const tokenResult = await user.getIdTokenResult();
    return tokenResult.claims.admin === true;
  } catch {
    return false;
  }
}

/**
 * Require the user to be a seller.
 * Redirects to dashboard if not a seller.
 * @returns {Promise<boolean>} — true if seller, false if redirected
 */
export async function requireSeller() {
  const role = await getCurrentUserRole();

  if (role === SELLER_ROLE) return true;

  // Prevent redirect loops: if already on dashboard, don't redirect again
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage !== "dashboard.html") {
    window.location.href = "dashboard.html";
  }
  return false;
}

/**
 * Require the user to be a customer.
 * Redirects to dashboard if not a customer.
 * @returns {Promise<boolean>} — true if customer, false if redirected
 */
export async function requireCustomer() {
  const role = await getCurrentUserRole();

  if (role === CUSTOMER_ROLE) return true;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage !== "dashboard.html") {
    window.location.href = "dashboard.html";
  }
  return false;
}

/**
 * Require the user to be authenticated (any role).
 * Redirects to auth page if not logged in.
 * @returns {Promise<boolean>} — true if authenticated, false if redirected
 */
export async function requireAuthenticatedUser() {
  const user = auth.currentUser;
  if (user) {
    await ensureUserDocument(user);
    return true;
  }

  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage !== "auth.html") {
    window.location.href = "auth.html";
  }
  return false;
}

/**
 * Upgrade the current user to seller role.
 * Updates Firestore, refreshes cache, and dispatches roleChanged event.
 *
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function upgradeToSeller() {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: "User is not authenticated." };
  }

  try {
    const userRef = doc(db, "users", user.uid);

    await ensureUserDocument(user);

    // First check if document exists
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      // Update existing document with merge to preserve other fields
      await updateDoc(userRef, {
        role: SELLER_ROLE,
        updatedAt: serverTimestamp()
      });
    }

    // Dispatch role change event
    window.dispatchEvent(new CustomEvent("roleChanged", { detail: { role: SELLER_ROLE } }));

    return { success: true };
  } catch (err) {
    const message =
      err?.code === "permission-denied"
        ? "You don't have permission to upgrade your role."
        : err?.code === "unavailable"
        ? "The service is temporarily unavailable. Please try again."
        : "Failed to upgrade your account. Please try again.";

    return { success: false, error: message };
  }
}

/**
 * Listen for role changes and execute a callback.
 * @param {function} callback — Called with { role } on role change
 * @returns {function} — Unsubscribe function
 */
export function onRoleChanged(callback) {
  const handler = (event) => {
    if (callback) callback(event.detail);
  };

  window.addEventListener("roleChanged", handler);

  // Return unsubscribe function
  return () => {
    window.removeEventListener("roleChanged", handler);
  };
}
