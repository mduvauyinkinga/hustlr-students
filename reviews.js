/**
 * reviews.js — Single Source of Truth for HUSTLR Reviews & Ratings.
 *
 * Architecture:
 *   - All Firestore review operations live ONLY in this module.
 *   - No other file creates, reads, updates, or deletes review documents.
 *   - Aggregation logic (average rating, breakdown, counts) lives ONLY here.
 *   - Eligibility checks are centralized (canReviewOrder).
 *
 * Firestore Schema:
 *   reviews/{orderId} (public-facing review content):
 *     orderId (doc id) — deterministic (prevents duplicates at document level)
 *     storeId, productId (future), customerName, customerPhoto,
 *     rating (1–5), comment, images (future), verifiedPurchase,
 *     sellerReply, sellerReplyAt, status ("active"|"deleted"),
 *     createdAt, updatedAt
 *
 *   reviewPrivate/{orderId} (private ownership metadata):
 *     orderId, customerId, sellerId, verifiedPurchase, status,
 *     createdAt, updatedAt
 *
 * Store Aggregates (stores/{storeId}):
 *   averageRating, reviewCount, ratingBreakdown, lastReviewOrderId
 *
 * All review mutations use atomic batch writes to keep review + store
 * aggregates transactionally consistent.
 *
 * @module reviews
 */

import { auth, db } from "./firebase.js";
import { logError } from "./production-logger.js";

import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ────────────────────────────────────────────────────────────
// 1. CONSTANTS
// ────────────────────────────────────────────────────────────

export const REVIEW_STATUS = Object.freeze({
  ACTIVE: "active",
  DELETED: "deleted"
});

export const REVIEW_SORT = Object.freeze({
  NEWEST: "newest",
  OLDEST: "oldest",
  HIGHEST_RATING: "highest",
  LOWEST_RATING: "lowest"
});

const REVIEWS_COLLECTION = "reviews";
const REVIEW_PRIVATE_COLLECTION = "reviewPrivate";

// ────────────────────────────────────────────────────────────
// 2. INTERNAL HELPERS
// ────────────────────────────────────────────────────────────

/**
 * Get the current auth user safely.
 * @returns {{ uid: string, displayName?: string, photoURL?: string }|null}
 */
function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Build a Firestore query for reviews with optional sort.
 * @param {string} field - Field to filter on (e.g. "storeId", "productId")
 * @param {string} value - Filter value
 * @param {string} [sort=REVIEW_SORT.NEWEST] - Sort order
 * @param {number} [maxResults] - Optional limit
 * @returns {Object} { query, fieldOrders }
 */
function buildReviewsQuery(field, value, sort = REVIEW_SORT.NEWEST, maxResults) {
  const reviewsRef = collection(db, REVIEWS_COLLECTION);

  // Always filter active reviews (soft-deleted reviews excluded from UI)
  const constraints = [
    where(field, "==", value),
    where("status", "==", REVIEW_STATUS.ACTIVE)
  ];

  // Add sort
  switch (sort) {
    case REVIEW_SORT.NEWEST:
      constraints.push(orderBy("createdAt", "desc"));
      break;
    case REVIEW_SORT.OLDEST:
      constraints.push(orderBy("createdAt", "asc"));
      break;
    case REVIEW_SORT.HIGHEST_RATING:
      constraints.push(orderBy("rating", "desc"), orderBy("createdAt", "desc"));
      break;
    case REVIEW_SORT.LOWEST_RATING:
      constraints.push(orderBy("rating", "asc"), orderBy("createdAt", "desc"));
      break;
    default:
      constraints.push(orderBy("createdAt", "desc"));
  }

  if (typeof maxResults === "number" && maxResults > 0) {
    constraints.push(limit(maxResults));
  }

  return query(reviewsRef, ...constraints);
}

/**
 * Build a Firestore composite index query for reviews filtered by multiple
 * fields. Used for product reviews (storeId + productId) in future.
 * @param {Array<{field: string, value: string}>} filters
 * @param {string} [sort=REVIEW_SORT.NEWEST]
 * @param {number} [maxResults]
 * @returns {Object}
 */
function buildCompositeQuery(filters, sort = REVIEW_SORT.NEWEST, maxResults) {
  const reviewsRef = collection(db, REVIEWS_COLLECTION);
  const constraints = [];

  filters.forEach((f) => {
    constraints.push(where(f.field, "==", f.value));
  });

  // Always filter active
  constraints.push(where("status", "==", REVIEW_STATUS.ACTIVE));

  switch (sort) {
    case REVIEW_SORT.NEWEST:
      constraints.push(orderBy("createdAt", "desc"));
      break;
    case REVIEW_SORT.OLDEST:
      constraints.push(orderBy("createdAt", "asc"));
      break;
    case REVIEW_SORT.HIGHEST_RATING:
      constraints.push(orderBy("rating", "desc"), orderBy("createdAt", "desc"));
      break;
    case REVIEW_SORT.LOWEST_RATING:
      constraints.push(orderBy("rating", "asc"), orderBy("createdAt", "desc"));
      break;
    default:
      constraints.push(orderBy("createdAt", "desc"));
  }

  if (typeof maxResults === "number" && maxResults > 0) {
    constraints.push(limit(maxResults));
  }

  return query(reviewsRef, ...constraints);
}

// ────────────────────────────────────────────────────────────
// 3. AGGREGATION (pure functions — no Firestore calls)
// ────────────────────────────────────────────────────────────

/**
 * Calculate the average rating from an array of ratings.
 * @param {number[]} ratings - Array of ratings (1–5)
 * @returns {number} Average rounded to 1 decimal place, or 0
 */
export function calculateAverageRating(ratings) {
  if (!Array.isArray(ratings) || ratings.length === 0) return 0;
  const sum = ratings.reduce((acc, r) => acc + r, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}

/**
 * Calculate rating breakdown from an array of ratings.
 * Returns counts for each star level 1–5.
 * @param {number[]} ratings - Array of ratings (1–5)
 * @returns {{ 1: number, 2: number, 3: number, 4: number, 5: number }}
 */
export function calculateRatingBreakdown(ratings) {
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (!Array.isArray(ratings)) return breakdown;
  ratings.forEach((r) => {
    const key = Number(r);
    if (key >= 1 && key <= 5) {
      breakdown[key] = (breakdown[key] || 0) + 1;
    }
  });
  return breakdown;
}

/**
 * Calculate comprehensive review statistics from an array of ratings.
 * @param {number[]} ratings
 * @returns {Object} { averageRating, reviewCount, ratingBreakdown }
 */
export function calculateReviewStatistics(ratings) {
  const reviewCount = Array.isArray(ratings) ? ratings.length : 0;
  const ratingBreakdown = calculateRatingBreakdown(ratings);
  const averageRating = calculateAverageRating(ratings);
  return { averageRating, reviewCount, ratingBreakdown };
}

// ────────────────────────────────────────────────────────────
// 4. AGGREGATION DELTA CALCULATORS (internal)
// ────────────────────────────────────────────────────────────

/**
 * Calculate new store aggregates when adding a new review.
 * @param {Object} currentStore - Store data with averageRating, reviewCount, ratingBreakdown
 * @param {number} newRating - The new review's rating (1–5)
 * @returns {Object} Updated aggregates
 */
function calculateAggregatesOnCreate(currentStore, newRating) {
  const oldCount = Number(currentStore.reviewCount) || 0;
  const oldAvg = Number(currentStore.averageRating) || 0;
  const oldBreakdown = currentStore.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  const newCount = oldCount + 1;
  const newAvg = Math.round(((oldAvg * oldCount) + newRating) / newCount * 10) / 10;
  const newBreakdown = { ...oldBreakdown };
  const key = Number(newRating);
  if (key >= 1 && key <= 5) {
    newBreakdown[key] = (newBreakdown[key] || 0) + 1;
  }

  return { averageRating: newAvg, reviewCount: newCount, ratingBreakdown: newBreakdown };
}

/**
 * Calculate new store aggregates when updating a review (rating changed).
 * @param {Object} currentStore
 * @param {number} oldRating - Previous rating
 * @param {number} newRating - New rating
 * @returns {Object} Updated aggregates
 */
function calculateAggregatesOnUpdate(currentStore, oldRating, newRating) {
  const count = Number(currentStore.reviewCount) || 0;
  const oldAvg = Number(currentStore.averageRating) || 0;
  const oldBreakdown = currentStore.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  if (count === 0) return { averageRating: newRating, reviewCount: 1, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, [newRating]: 1 } };

  const newAvg = Math.round(((oldAvg * count) - oldRating + newRating) / count * 10) / 10;
  const newBreakdown = { ...oldBreakdown };
  const oldKey = Number(oldRating);
  const newKey = Number(newRating);
  if (oldKey >= 1 && oldKey <= 5) {
    newBreakdown[oldKey] = Math.max(0, (newBreakdown[oldKey] || 0) - 1);
  }
  if (newKey >= 1 && newKey <= 5) {
    newBreakdown[newKey] = (newBreakdown[newKey] || 0) + 1;
  }

  return { averageRating: newAvg, reviewCount: count, ratingBreakdown: newBreakdown };
}

/**
 * Calculate new store aggregates when soft-deleting a review.
 * @param {Object} currentStore
 * @param {number} removedRating - The deleted review's rating
 * @returns {Object} Updated aggregates
 */
function calculateAggregatesOnDelete(currentStore, removedRating) {
  const oldCount = Number(currentStore.reviewCount) || 0;
  const oldAvg = Number(currentStore.averageRating) || 0;
  const oldBreakdown = currentStore.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  if (oldCount <= 1) {
    return { averageRating: 0, reviewCount: 0, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  }

  const newCount = oldCount - 1;
  const newAvg = Math.round(((oldAvg * oldCount) - removedRating) / newCount * 10) / 10;
  const newBreakdown = { ...oldBreakdown };
  const key = Number(removedRating);
  if (key >= 1 && key <= 5) {
    newBreakdown[key] = Math.max(0, (newBreakdown[key] || 0) - 1);
  }

  return { averageRating: newAvg, reviewCount: newCount, ratingBreakdown: newBreakdown };
}

/**
 * Read store aggregates from Firestore.
 * @param {string} storeId
 * @returns {Promise<Object>} Store data with aggregate fields
 */
async function getStoreAggregates(storeId) {
  try {
    const storeRef = doc(db, "stores", storeId);
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      const data = storeSnap.data();
      return {
        averageRating: Number(data.averageRating) || 0,
        reviewCount: Number(data.reviewCount) || 0,
        ratingBreakdown: data.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
    }
  } catch {
    // Silently fail — return defaults
  }
  return { averageRating: 0, reviewCount: 0, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
}

// ────────────────────────────────────────────────────────────
// 5. ELIGIBILITY
// ────────────────────────────────────────────────────────────

/**
 * Check whether the current user can review a specific order.
 *
 * Verifies:
 *   1. Order exists
 *   2. Order belongs to current user
 *   3. Order status is "completed"
 *   4. No review already exists for this order
 *
 * @param {string} orderId - The order document ID
 * @returns {Promise<{canReview: boolean, reason?: string, order?: Object}>}
 */
export async function canReviewOrder(orderId) {
  if (!orderId) {
    return { canReview: false, reason: "Order ID is required." };
  }

  const user = getCurrentUser();
  if (!user) {
    return { canReview: false, reason: "You must be logged in to leave a review." };
  }

  try {
    // Read order
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      return { canReview: false, reason: "Order not found." };
    }

    const order = orderSnap.data();

    // Order must belong to current user
    if (order.customerId !== user.uid) {
      return { canReview: false, reason: "This order does not belong to you." };
    }

    // Order must be completed
    if (order.status !== "completed") {
      return { canReview: false, reason: "You can only review completed orders." };
    }

    // Check for existing review (deterministic doc ID = orderId)
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const reviewSnap = await getDoc(reviewRef);

    if (reviewSnap.exists()) {
      const reviewData = reviewSnap.data();
      if (reviewData.status === REVIEW_STATUS.ACTIVE) {
        return { canReview: false, reason: "You have already reviewed this order.", review: { id: orderId, ...reviewData } };
      }
      // Soft-deleted review exists — allow re-review? For now, prevent.
      return { canReview: false, reason: "A review for this order was previously removed.", review: { id: orderId, ...reviewData } };
    }

    return { canReview: true, order };
  } catch (err) {
    logError("CAN_REVIEW_ORDER_FAILED");
    return { canReview: false, reason: "Unable to verify review eligibility. Please try again." };
  }
}

/**
 * Check if an existing active review exists for this order.
 * @param {string} orderId
 * @returns {Promise<boolean>}
 */
export async function hasExistingReview(orderId) {
  if (!orderId) return false;
  try {
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const snap = await getDoc(reviewRef);
    if (!snap.exists()) return false;
    return snap.data().status === REVIEW_STATUS.ACTIVE;
  } catch {
    return false;
  }
}

/**
 * Get all completed orders for the current user that don't have reviews yet.
 * @param {string} customerId
 * @returns {Promise<Array<{id: string, ...}>>} Array of eligible orders
 */
export async function getPendingReviews(customerId) {
  if (!customerId) return [];

  try {
    const ordersRef = collection(db, "orders");
    const q = query(
      ordersRef,
      where("customerId", "==", customerId),
      where("status", "==", "completed"),
      orderBy("createdAt", "desc")
    );

    const snap = await getDocs(q);
    const pending = [];

    for (const docSnap of snap.docs) {
      const orderId = docSnap.id;
      // Check no active review exists
      const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
      const reviewSnap = await getDoc(reviewRef);

      if (!reviewSnap.exists() || reviewSnap.data().status !== REVIEW_STATUS.ACTIVE) {
        pending.push({ id: orderId, ...docSnap.data() });
      }
    }

    return pending;
  } catch (err) {
    logError("GET_PENDING_REVIEWS_FAILED");
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// 6. CREATE REVIEW
// ────────────────────────────────────────────────────────────

/**
 * Create a new review for a completed order.
 *
 * Uses an atomic batch write:
 *   1. Create review document at reviews/{orderId}
 *   2. Update store aggregates (averageRating, reviewCount, ratingBreakdown)
 *
 * @param {Object} params
 * @param {string} params.orderId - The completed order ID
 * @param {number} params.rating - Rating 1–5
 * @param {string} params.comment - Review text
 * @param {string} [params.productId] - Optional product ID (future product reviews)
 * @returns {Promise<{success: boolean, reviewId?: string, error?: string}>}
 */
export async function createReview(params) {
  const { orderId, rating, comment, productId = null } = params || {};

  if (!orderId) {
    return { success: false, error: "Order ID is required." };
  }

  if (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return { success: false, error: "Rating must be an integer between 1 and 5." };
  }

  if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
    return { success: false, error: "Comment is required." };
  }

  if (comment.trim().length < 10 || comment.trim().length > 500) {
    return { success: false, error: "Review comment must be between 10 and 500 characters." };
  }

  if (productId !== null && productId !== undefined) {
    return { success: false, error: "Product reviews are not supported for this order." };
  }

  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be logged in to leave a review." };
  }

  try {
    // Fetch the order to get store + seller info
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      return { success: false, error: "Order not found." };
    }

    const order = orderSnap.data();

    // Verify ownership
    if (order.customerId !== user.uid) {
      return { success: false, error: "You can only review your own orders." };
    }

    // Verify completed
    if (order.status !== "completed") {
      return { success: false, error: "You can only review completed orders." };
    }

    // Verify no duplicate
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const existingSnap = await getDoc(reviewRef);
    if (existingSnap.exists() && existingSnap.data().status === REVIEW_STATUS.ACTIVE) {
      return { success: false, error: "You have already reviewed this order." };
    }

    const storeId = order.storeId;
    const sellerId = order.storeId; // Store ID = Seller UID in this architecture
    const customerName = user.displayName || order.customerName || "Anonymous";
    const customerPhoto = user.photoURL || "";

    // Get current store aggregates
    const currentAggregates = await getStoreAggregates(storeId);

    // Calculate new aggregates
    const newAggregates = calculateAggregatesOnCreate(currentAggregates, rating);

    // Atomic batch write
    const batch = writeBatch(db);

    // Public review document (customer/seller identity kept private)
    const reviewData = {
      storeId,
      productId: null,
      orderId,
      customerName,
      customerPhoto,
      rating,
      comment: comment.trim(),
      images: [],          // future-ready
      verifiedPurchase: true,
      sellerReply: null,
      sellerReplyAt: null,
      status: REVIEW_STATUS.ACTIVE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    batch.set(reviewRef, reviewData);

    const reviewPrivateRef = doc(db, REVIEW_PRIVATE_COLLECTION, orderId);
    batch.set(reviewPrivateRef, {
      customerId: user.uid,
      sellerId,
      orderId,
      verifiedPurchase: true,
      status: REVIEW_STATUS.ACTIVE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Update store aggregates
    const storeRef = doc(db, "stores", storeId);
    batch.update(storeRef, {
      ...newAggregates,
      lastReviewOrderId: orderId,
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    return { success: true, reviewId: orderId };
  } catch (err) {
    logError("CREATE_REVIEW_FAILED");
    const message = err?.code === "permission-denied"
      ? "You don't have permission to create a review."
      : "Failed to submit your review. Please try again.";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// 7. UPDATE REVIEW
// ────────────────────────────────────────────────────────────

/**
 * Update an existing review (rating and/or comment).
 *
 * Uses atomic batch write:
 *   1. Update review document
 *   2. Recalculate and update store aggregates (delta-based)
 *
 * @param {string} orderId - The review document ID (same as order ID)
 * @param {Object} updates
 * @param {number} [updates.rating] - New rating 1–5
 * @param {string} [updates.comment] - New comment
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateReview(orderId, updates) {
  if (!orderId) {
    return { success: false, error: "Review ID is required." };
  }

  const { rating, comment } = updates || {};

  if (rating !== undefined && (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating))) {
    return { success: false, error: "Rating must be an integer between 1 and 5." };
  }

  if (comment !== undefined && (typeof comment !== "string" || comment.trim().length === 0)) {
    return { success: false, error: "Comment cannot be empty." };
  }

  if (comment !== undefined && (comment.trim().length < 10 || comment.trim().length > 500)) {
    return { success: false, error: "Review comment must be between 10 and 500 characters." };
  }

  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be logged in to update a review." };
  }

  try {
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const reviewSnap = await getDoc(reviewRef);

    if (!reviewSnap.exists()) {
      return { success: false, error: "Review not found." };
    }

    const review = reviewSnap.data();
    const reviewPrivateRef = doc(db, REVIEW_PRIVATE_COLLECTION, orderId);
    const reviewPrivateSnap = await getDoc(reviewPrivateRef);

    if (!reviewPrivateSnap.exists()) {
      return { success: false, error: "Review ownership record not found." };
    }

    const reviewPrivate = reviewPrivateSnap.data();

    // Own review check
    if (reviewPrivate.customerId !== user.uid) {
      return { success: false, error: "You can only update your own reviews." };
    }

    if (review.status !== REVIEW_STATUS.ACTIVE) {
      return { success: false, error: "Cannot update a deleted review." };
    }

    const batch = writeBatch(db);

    // Build update payload for review doc
    const reviewUpdate = {
      updatedAt: serverTimestamp()
    };

    let ratingChanged = false;
    let oldRating = review.rating;
    let newRating = oldRating;

    if (rating !== undefined && rating !== oldRating) {
      reviewUpdate.rating = rating;
      ratingChanged = true;
      newRating = rating;
    }

    if (comment !== undefined) {
      reviewUpdate.comment = comment.trim();
    }

    batch.update(reviewRef, reviewUpdate);

    // Recalculate store aggregates if rating changed
    if (ratingChanged) {
      const currentAggregates = await getStoreAggregates(review.storeId);
      const newAggregates = calculateAggregatesOnUpdate(currentAggregates, oldRating, newRating);

      const storeRef = doc(db, "stores", review.storeId);
      batch.update(storeRef, {
        ...newAggregates,
        lastReviewOrderId: orderId,
        updatedAt: serverTimestamp()
      });
    }

    await batch.commit();

    return { success: true };
  } catch (err) {
    logError("UPDATE_REVIEW_FAILED");
    const message = err?.code === "permission-denied"
      ? "You don't have permission to update this review."
      : "Failed to update your review. Please try again.";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// 8. SOFT DELETE REVIEW
// ────────────────────────────────────────────────────────────

/**
 * Soft-delete a review by setting status to "deleted".
 *
 * The document is NOT physically removed — this ensures:
 *   1. Deterministic doc ID remains valid for store aggregate binding
 *   2. Audit trail is preserved
 *   3. Batch writes for store aggregate updates always resolve
 *
 * Uses atomic batch write:
 *   1. Update review status to "deleted"
 *   2. Recalculate and update store aggregates
 *
 * @param {string} orderId - The review document ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function softDeleteReview(orderId) {
  if (!orderId) {
    return { success: false, error: "Review ID is required." };
  }

  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be logged in to delete a review." };
  }

  try {
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const reviewSnap = await getDoc(reviewRef);

    if (!reviewSnap.exists()) {
      return { success: false, error: "Review not found." };
    }

    const review = reviewSnap.data();
    const reviewPrivateRef = doc(db, REVIEW_PRIVATE_COLLECTION, orderId);
    const reviewPrivateSnap = await getDoc(reviewPrivateRef);

    if (!reviewPrivateSnap.exists()) {
      return { success: false, error: "Review ownership record not found." };
    }

    const reviewPrivate = reviewPrivateSnap.data();

    // Ownership check
    if (reviewPrivate.customerId !== user.uid) {
      return { success: false, error: "You can only delete your own reviews." };
    }

    if (review.status !== REVIEW_STATUS.ACTIVE) {
      return { success: false, error: "Review is already deleted or inactive." };
    }

    const batch = writeBatch(db);

    // Soft-delete the review
    batch.update(reviewRef, {
      status: REVIEW_STATUS.DELETED,
      updatedAt: serverTimestamp()
    });
    batch.update(reviewPrivateRef, {
      status: REVIEW_STATUS.DELETED,
      updatedAt: serverTimestamp()
    });

    // Recalculate store aggregates
    const currentAggregates = await getStoreAggregates(review.storeId);
    const newAggregates = calculateAggregatesOnDelete(currentAggregates, review.rating);

    const storeRef = doc(db, "stores", review.storeId);
    batch.update(storeRef, {
      ...newAggregates,
      lastReviewOrderId: orderId,
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    return { success: true };
  } catch (err) {
    logError("SOFT_DELETE_REVIEW_FAILED");
    const message = err?.code === "permission-denied"
      ? "You don't have permission to delete this review."
      : "Failed to delete your review. Please try again.";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// 9. SELLER REPLY
// ────────────────────────────────────────────────────────────

/**
 * Reply to a review as a seller (store owner).
 *
 * Rules:
 *   - Only the store owner (sellerId == auth.uid) may reply
 *   - One reply per review (overwrites previous reply)
 *   - Customer rating/comment is preserved
 *
 * @param {string} orderId - The review document ID
 * @param {string} replyText - The seller's reply text
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function replyToReview(orderId, replyText) {
  if (!orderId) {
    return { success: false, error: "Review ID is required." };
  }

  if (!replyText || typeof replyText !== "string" || replyText.trim().length === 0) {
    return { success: false, error: "Reply text is required." };
  }

  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be logged in to reply to a review." };
  }

  try {
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const reviewSnap = await getDoc(reviewRef);

    if (!reviewSnap.exists()) {
      return { success: false, error: "Review not found." };
    }

    const review = reviewSnap.data();
    const reviewPrivateRef = doc(db, REVIEW_PRIVATE_COLLECTION, orderId);
    const reviewPrivateSnap = await getDoc(reviewPrivateRef);

    if (!reviewPrivateSnap.exists()) {
      return { success: false, error: "Review ownership record not found." };
    }

    const reviewPrivate = reviewPrivateSnap.data();

    // Only store owner can reply (sellerId == user.uid in this architecture)
    if (reviewPrivate.sellerId !== user.uid) {
      return { success: false, error: "Only the store owner can reply to this review." };
    }

    if (review.status !== REVIEW_STATUS.ACTIVE) {
      return { success: false, error: "Cannot reply to a deleted review." };
    }

    await updateDoc(reviewRef, {
      sellerReply: replyText.trim(),
      sellerReplyAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { success: true };
  } catch (err) {
    logError("REPLY_TO_REVIEW_FAILED");
    const message = err?.code === "permission-denied"
      ? "You don't have permission to reply to this review."
      : "Failed to submit your reply. Please try again.";
    return { success: false, error: message };
  }
}

/**
 * Remove or edit a seller reply.
 * @param {string} orderId - The review document ID
 * @param {string|null} replyText - New reply text, or null to clear
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function editSellerReply(orderId, replyText) {
  if (!orderId) {
    return { success: false, error: "Review ID is required." };
  }

  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be logged in." };
  }

  try {
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const reviewSnap = await getDoc(reviewRef);

    if (!reviewSnap.exists()) {
      return { success: false, error: "Review not found." };
    }

    const review = reviewSnap.data();
    const reviewPrivateRef = doc(db, REVIEW_PRIVATE_COLLECTION, orderId);
    const reviewPrivateSnap = await getDoc(reviewPrivateRef);

    if (!reviewPrivateSnap.exists()) {
      return { success: false, error: "Review ownership record not found." };
    }

    const reviewPrivate = reviewPrivateSnap.data();

    if (reviewPrivate.sellerId !== user.uid) {
      return { success: false, error: "Only the store owner can edit replies." };
    }

    const updatePayload = {
      updatedAt: serverTimestamp()
    };

    if (replyText && replyText.trim().length > 0) {
      updatePayload.sellerReply = replyText.trim();
      updatePayload.sellerReplyAt = serverTimestamp();
    } else {
      updatePayload.sellerReply = null;
      updatePayload.sellerReplyAt = null;
    }

    await updateDoc(reviewRef, updatePayload);

    return { success: true };
  } catch (err) {
    logError("EDIT_SELLER_REPLY_FAILED");
    return { success: false, error: "Failed to update reply. Please try again." };
  }
}

// ────────────────────────────────────────────────────────────
// 10. READ OPERATIONS
// ────────────────────────────────────────────────────────────

/**
 * Get a single review by its document ID (orderId).
 * @param {string} orderId
 * @returns {Promise<{success: boolean, review?: Object, error?: string}>}
 */
export async function getReview(orderId) {
  if (!orderId) {
    return { success: false, error: "Review ID is required." };
  }

  try {
    const reviewRef = doc(db, REVIEWS_COLLECTION, orderId);
    const snap = await getDoc(reviewRef);

    if (!snap.exists()) {
      return { success: false, error: "Review not found." };
    }

    return { success: true, review: { id: snap.id, ...snap.data() } };
  } catch (err) {
    logError("GET_REVIEW_FAILED");
    return { success: false, error: "Failed to load review." };
  }
}

/**
 * Fetch store reviews (one-time read, not a listener).
 * @param {string} storeId
 * @param {Object} [options]
 * @param {string} [options.sort=REVIEW_SORT.NEWEST]
 * @param {number} [options.maxResults]
 * @returns {Promise<{success: boolean, reviews?: Array, error?: string}>}
 */
export async function getStoreReviews(storeId, options = {}) {
  if (!storeId) {
    return { success: false, error: "Store ID is required." };
  }

  const { sort = REVIEW_SORT.NEWEST, maxResults } = options;

  try {
    const q = buildReviewsQuery("storeId", storeId, sort, maxResults);
    const snap = await getDocs(q);

    const reviews = [];
    snap.forEach((docSnap) => {
      reviews.push({ id: docSnap.id, ...docSnap.data() });
    });

    return { success: true, reviews };
  } catch (err) {
    logError("GET_STORE_REVIEWS_FAILED");
    return { success: false, error: "Failed to load reviews." };
  }
}

/**
 * Fetch product reviews (future-ready, one-time read).
 * Requires a composite index in Firestore when productId + status are used.
 * @param {string} productId
 * @param {Object} [options]
 * @param {string} [options.sort=REVIEW_SORT.NEWEST]
 * @param {number} [options.maxResults]
 * @returns {Promise<{success: boolean, reviews?: Array, error?: string}>}
 */
export async function getProductReviews(productId, options = {}) {
  if (!productId) {
    return { success: false, error: "Product ID is required." };
  }

  const { sort = REVIEW_SORT.NEWEST, maxResults } = options;

  try {
    const q = buildReviewsQuery("productId", productId, sort, maxResults);
    const snap = await getDocs(q);

    const reviews = [];
    snap.forEach((docSnap) => {
      reviews.push({ id: docSnap.id, ...docSnap.data() });
    });

    return { success: true, reviews };
  } catch (err) {
    logError("GET_PRODUCT_REVIEWS_FAILED");
    return { success: false, error: "Failed to load product reviews." };
  }
}

// ────────────────────────────────────────────────────────────
// 11. REAL-TIME LISTENERS
// ────────────────────────────────────────────────────────────

/**
 * Subscribe to store reviews in real-time.
 *
 * @param {string} storeId
 * @param {function} onReviews - Callback with Array of review objects
 * @param {Object} [options]
 * @param {string} [options.sort=REVIEW_SORT.NEWEST]
 * @param {number} [options.maxResults] - Limit results
 * @param {function} [onError] - Error callback
 * @returns {function} Unsubscribe function
 */
export function subscribeToStoreReviews(storeId, onReviews, options = {}, onError) {
  if (!storeId) {
    if (typeof onError === "function") onError(new Error("Store ID is required."));
    return () => {};
  }

  // Extract sort from options or use default
  const sortParam = (options && options.sort) || REVIEW_SORT.NEWEST;
  const maxResults = (options && options.maxResults) || undefined;

  try {
    const q = buildReviewsQuery("storeId", storeId, sortParam, maxResults);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const reviews = [];
        snapshot.forEach((docSnap) => {
          reviews.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (typeof onReviews === "function") {
          onReviews(reviews);
        }
      },
      (err) => {
        logError("STORE_REVIEWS_LISTENER_FAILED");
        if (typeof onError === "function") onError(err);
      }
    );

    return unsubscribe;
  } catch (err) {
    logError("STORE_REVIEWS_LISTENER_SETUP_FAILED");
    if (typeof onError === "function") onError(err);
    return () => {};
  }
}

/**
 * Subscribe to product reviews in real-time (future-ready).
 *
 * @param {string} productId
 * @param {function} onReviews - Callback with Array of review objects
 * @param {Object} [options]
 * @param {string} [options.sort=REVIEW_SORT.NEWEST]
 * @param {number} [options.maxResults]
 * @param {function} [onError] - Error callback
 * @returns {function} Unsubscribe function
 */
export function subscribeToProductReviews(productId, onReviews, options = {}, onError) {
  if (!productId) {
    if (typeof onError === "function") onError(new Error("Product ID is required."));
    return () => {};
  }

  const sortParam = (options && options.sort) || REVIEW_SORT.NEWEST;
  const maxResults = (options && options.maxResults) || undefined;

  try {
    const q = buildReviewsQuery("productId", productId, sortParam, maxResults);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const reviews = [];
        snapshot.forEach((docSnap) => {
          reviews.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (typeof onReviews === "function") {
          onReviews(reviews);
        }
      },
      (err) => {
        logError("PRODUCT_REVIEWS_LISTENER_FAILED");
        if (typeof onError === "function") onError(err);
      }
    );

    return unsubscribe;
  } catch (err) {
    logError("PRODUCT_REVIEWS_LISTENER_SETUP_FAILED");
    if (typeof onError === "function") onError(err);
    return () => {};
  }
}

// ────────────────────────────────────────────────────────────
// 12. STORE RATING REFRESH (full recalculation)
// ────────────────────────────────────────────────────────────

/**
 * Fully recalculate and update store rating aggregates from scratch.
 *
 * This is a fallback/recovery function — under normal operation,
 * aggregates are maintained via delta updates in create/update/delete.
 * Use this if aggregate data becomes inconsistent (e.g. manual Firestore
 * changes, bug recovery, or initial migration).
 *
 * @param {string} storeId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function refreshStoreRating(storeId) {
  if (!storeId) {
    return { success: false, error: "Store ID is required." };
  }

  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be logged in." };
  }

  try {
    // Read all active reviews for this store
    const reviewsRef = collection(db, REVIEWS_COLLECTION);
    const q = query(
      reviewsRef,
      where("storeId", "==", storeId),
      where("status", "==", REVIEW_STATUS.ACTIVE)
    );

    const snap = await getDocs(q);
    const ratings = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (typeof data.rating === "number" && data.rating >= 1 && data.rating <= 5) {
        ratings.push(data.rating);
      }
    });

    const statistics = calculateReviewStatistics(ratings);

    // Update store document
    const storeRef = doc(db, "stores", storeId);
    await updateDoc(storeRef, {
      averageRating: statistics.averageRating,
      reviewCount: statistics.reviewCount,
      ratingBreakdown: statistics.ratingBreakdown,
      updatedAt: serverTimestamp()
    });

    return { success: true, ...statistics };
  } catch (err) {
    logError("REFRESH_STORE_RATING_FAILED");
    return { success: false, error: "Failed to refresh store rating." };
  }
}

// ────────────────────────────────────────────────────────────
// 13. RECENTLY REVIEWED (Customer Dashboard)
// ────────────────────────────────────────────────────────────

/**
 * Get the current user's recently submitted reviews.
 * @param {string} customerId
 * @param {number} [maxResults=5]
 * @returns {Promise<Array>} Array of review objects
 */
export async function getCustomerRecentReviews(customerId, maxResults = 5) {
  if (!customerId) return [];

  try {
    const reviewPrivateRef = collection(db, REVIEW_PRIVATE_COLLECTION);
    const privateQuery = query(
      reviewPrivateRef,
      where("customerId", "==", customerId),
      where("status", "==", REVIEW_STATUS.ACTIVE),
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );

    const privateSnap = await getDocs(privateQuery);
    const reviews = [];

    for (const docSnap of privateSnap.docs) {
      const privateData = docSnap.data();
      const reviewRef = doc(db, REVIEWS_COLLECTION, privateData.orderId);
      const reviewSnap = await getDoc(reviewRef);
      if (reviewSnap.exists()) {
        reviews.push({ id: reviewSnap.id, ...reviewSnap.data() });
      }
    }

    return reviews;
  } catch (err) {
    logError("GET_CUSTOMER_RECENT_REVIEWS_FAILED");
    return [];
  }
}

/**
 * Subscribe to a customer's reviews in real-time.
 * @param {string} customerId
 * @param {function} onReviews - Callback with Array of reviews
 * @param {number} [maxResults=10]
 * @param {function} [onError]
 * @returns {function} Unsubscribe function
 */
export function subscribeToCustomerReviews(customerId, onReviews, maxResults = 10, onError) {
  if (!customerId) {
    if (typeof onError === "function") onError(new Error("Customer ID is required."));
    return () => {};
  }

  try {
    const reviewPrivateRef = collection(db, REVIEW_PRIVATE_COLLECTION);
    const q = query(
      reviewPrivateRef,
      where("customerId", "==", customerId),
      where("status", "==", REVIEW_STATUS.ACTIVE),
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const reviews = [];
        for (const docSnap of snapshot.docs) {
          const privateData = docSnap.data();
          const reviewRef = doc(db, REVIEWS_COLLECTION, privateData.orderId);
          const reviewSnap = await getDoc(reviewRef);
          if (reviewSnap.exists()) {
            reviews.push({ id: reviewSnap.id, ...reviewSnap.data() });
          }
        }
        if (typeof onReviews === "function") onReviews(reviews);
      },
      (err) => {
        logError("CUSTOMER_REVIEWS_LISTENER_FAILED");
        if (typeof onError === "function") onError(err);
      }
    );

    return unsubscribe;
  } catch (err) {
    logError("CUSTOMER_REVIEWS_LISTENER_SETUP_FAILED");
    if (typeof onError === "function") onError(err);
    return () => {};
  }
}

/**
 * Subscribe to seller reviews (reviews for a seller's store) in real-time
 * with aggregate statistics.
 *
 * @param {string} storeId
 * @param {function} onData - Callback with { reviews, metrics }
 * @param {Object} [options]
 * @param {number} [options.maxResults=10]
 * @param {function} [onError]
 * @returns {function} Unsubscribe function
 */
export function subscribeToSellerReviews(storeId, onData, options = {}, onError) {
  if (!storeId) {
    if (typeof onError === "function") onError(new Error("Store ID is required."));
    return () => {};
  }

  const maxResults = (options && options.maxResults) || 10;

  try {
    const reviewsRef = collection(db, REVIEWS_COLLECTION);
    const q = query(
      reviewsRef,
      where("storeId", "==", storeId),
      where("status", "==", REVIEW_STATUS.ACTIVE),
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const reviews = [];
        const allRatings = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          reviews.push({ id: docSnap.id, ...data });
          if (typeof data.rating === "number" && data.rating >= 1 && data.rating <= 5) {
            allRatings.push(data.rating);
          }
        });

        const statistics = calculateReviewStatistics(allRatings);

        if (typeof onData === "function") {
          onData({
            reviews,
            metrics: {
              averageRating: statistics.averageRating,
              reviewCount: statistics.reviewCount,
              ratingBreakdown: statistics.ratingBreakdown
            }
          });
        }
      },
      (err) => {
        logError("SELLER_REVIEWS_LISTENER_FAILED");
        if (typeof onError === "function") onError(err);
      }
    );

    return unsubscribe;
  } catch (err) {
    logError("SELLER_REVIEWS_LISTENER_SETUP_FAILED");
    if (typeof onError === "function") onError(err);
    return () => {};
  }
}

// ────────────────────────────────────────────────────────────
// 14. FORMATTING HELPERS
// ────────────────────────────────────────────────────────────

/**
 * Format a Firestore timestamp or date value for review display.
 * @param {any} ts
 * @returns {string}
 */
export function formatReviewDate(ts) {
  if (!ts) return "";
  try {
    let date;
    if (typeof ts === "object" && ts.toDate) {
      date = ts.toDate();
    } else if (typeof ts === "string") {
      date = new Date(ts);
    } else if (typeof ts === "number") {
      date = new Date(ts);
    } else {
      return "";
    }
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  } catch {
    return "";
  }
}

