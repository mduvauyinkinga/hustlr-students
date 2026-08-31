/**
 * roles.js — Centralized Role Management Module for HUSTLR.
 *
 * All role-related logic lives here. No other module should duplicate
 * Firestore queries for role checking, caching, or upgrading.
 *
 * Architecture:
 *   Authentication → Firestore role → Continue
 *
 * Seller activation is backend-authoritative. Browser code may request
 * verification but must never directly write the seller role.
 */

import { auth, db, functions } from "./firebase.js";
import { ensureUserDocument } from "./user-initialization.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import {
  doc,
  getDoc
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

export async function getCurrentUserRole() {
  const user = auth.currentUser;
  if (!user) return null;

  await ensureUserDocument(user);

  return await fetchRoleFromFirestore(user.uid);
}

export async function refreshUserRole() {
  const user = auth.currentUser;
  if (!user) return null;

  const role = await fetchRoleFromFirestore(user.uid);

  if (role) {
    window.dispatchEvent(new CustomEvent("roleChanged", { detail: { role } }));
  }

  return role;
}

export async function isCustomer() {
  const role = await getCurrentUserRole();
  return role === CUSTOMER_ROLE;
}

export async function isSeller() {
  const role = await getCurrentUserRole();
  return role === SELLER_ROLE;
}

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

export async function requireSeller() {
  const role = await getCurrentUserRole();

  if (role === SELLER_ROLE) return true;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage !== "dashboard.html") {
    window.location.href = "dashboard.html";
  }
  return false;
}

export async function requireCustomer() {
  const role = await getCurrentUserRole();

  if (role === CUSTOMER_ROLE) return true;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage !== "dashboard.html") {
    window.location.href = "dashboard.html";
  }
  return false;
}

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
 * Seller activation is only permitted through the trusted backend
 * after a verified PayPal subscription is active.
 */
export async function upgradeToSeller() {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: "User is not authenticated." };
  }

  try {
    const fn = httpsCallable(functions, "activateSellerIfEligible");
    const result = await fn({});

    if (result?.data?.activated) {
      window.dispatchEvent(new CustomEvent("roleChanged", { detail: { role: SELLER_ROLE } }));
      return { success: true };
    }

    return {
      success: false,
      error: result?.data?.message || "Seller activation is still pending verified subscription status."
    };
  } catch (err) {
    const message =
      err?.message || "Failed to activate the seller account. Please try again.";

    return { success: false, error: message };
  }
}

export function onRoleChanged(callback) {
  const handler = (event) => {
    if (callback) callback(event.detail);
  };

  window.addEventListener("roleChanged", handler);

  return () => {
    window.removeEventListener("roleChanged", handler);
  };
}
