import { db } from "./firebase.js";

import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function isTransientFirestoreError(err) {
  const code = err?.code || "";
  return (
    code === "unavailable" ||
    code === "network-request-failed" ||
    code === "deadline-exceeded" ||
    code === "resource-exhausted" ||
    code === "internal" ||
    code === "server-unavailable"
  );
}

const MAX_USER_DOC_RETRIES = 3;
const USER_DOC_RETRY_BACKOFF_MS = [0, 800, 2000];
const userInitializationPromises = new Map();

export async function ensureUserDocument(user) {
  if (!user?.uid) {
    throw new Error("Unable to initialize an unauthenticated user.");
  }

  const existingInitialization = userInitializationPromises.get(user.uid);
  if (existingInitialization) return existingInitialization;

  const initialization = initializeUserDocument(user);
  userInitializationPromises.set(user.uid, initialization);

  try {
    return await initialization;
  } finally {
    userInitializationPromises.delete(user.uid);
  }
}

async function initializeUserDocument(user) {
  for (let attempt = 0; attempt <= MAX_USER_DOC_RETRIES; attempt++) {
    try {
      const userRef = doc(db, "users", user.uid);
      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (userSnap.exists()) return;

        transaction.set(userRef, {
          name: user.displayName || "",
          email: user.email || "",
          phone: user.phoneNumber || "",
          photoURL: user.photoURL || "",
          role: "customer",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      return true;
    } catch (err) {
      const code = err?.code || "unknown";
      if (!isTransientFirestoreError(err)) {
        console.error(`[HUSTLR:USER_DOC_SYNC] Non-retryable error (code=${code})`);
        throw err;
      }

      const backoffMs = USER_DOC_RETRY_BACKOFF_MS[attempt] ?? 2000;
      if (attempt < MAX_USER_DOC_RETRIES) {
        console.error(
          `[HUSTLR:USER_DOC_SYNC] Transient error (code=${code}); retry ${attempt + 1}/${MAX_USER_DOC_RETRIES}`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } else {
        console.error(`[HUSTLR:USER_DOC_SYNC] Transient error (code=${code}); giving up after ${MAX_USER_DOC_RETRIES} retries`);
        throw err;
      }
    }
  }
}
