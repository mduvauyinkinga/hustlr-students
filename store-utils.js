import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getCurrentUserRole } from "./roles.js";

/**
 * Check whether a store document exists for the given user UID.
 * Uses direct document lookup — no collection query.
 *
 * @param {string} uid - The authenticated user's Firebase UID.
 * @returns {Promise<boolean>} - True if the store document exists.
 */
export async function checkStoreExists(uid) {
  if (!uid) return false;

  try {
    const storeRef = doc(db, "stores", uid);
    const storeSnap = await getDoc(storeRef);
    return storeSnap.exists();
  } catch {
    // Silently fail — treat as "no store" so the user can attempt creation.
    return false;
  }
}

/**
 * Legacy wrapper for backward compatibility.
 * Delegates to the centralized getCurrentUserRole() from roles.js.
 *
 * @param {string} uid - The authenticated user's Firebase UID (ignored, uses auth.currentUser).
 * @param {boolean} [forceRefresh=false] - If true, calls refreshUserRole() instead.
 * @returns {Promise<string|null>} - "customer", "seller", or null.
 */
export async function getUserRole(uid, forceRefresh = false) {
  // The uid parameter is accepted for backward compatibility but roles.js
  // handles it internally via auth.currentUser.
  if (forceRefresh) {
    const { refreshUserRole } = await import("./roles.js");
    return await refreshUserRole();
  }
  return await getCurrentUserRole();
}

// Re-export for convenience
export { getCurrentUserRole } from "./roles.js";

