import { db, auth, storage } from "./firebase.js";
import { normalizePhone } from "./phoneUtils.js";

import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  ref,
  uploadBytesResumable,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";


// Keep post.js production-stable: avoid noisy global error logging.
// (Errors will still surface via the app's own try/catch.)

function watchdog(_name, _ms = 10000) {
  // No-op watchdog in production build.
  return () => {};
}


function formatMaybe(v) {
  try {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "object") {
      if (v instanceof Date) return v.toISOString();
      return JSON.stringify(v);
    }
    return String(v);
  } catch {
    return "<unstringifiable>";
  }
}


function setStatus(message) {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.innerText = message;
}


function isPlainObject(v) {
  return Object.prototype.toString.call(v) === "[object Object]";
}

function hasNaNorInfinity(n) {
  return typeof n === "number" && (!Number.isFinite(n) || Number.isNaN(n));
}

/**
 * Wait until Auth has a user (or we time out / determine it's missing).
 * Returns the user or null.
 */
async function getCurrentUserOrWait({ timeoutMs = 10000 } = {}) {
  // If already resolved, return immediately
  if (auth?.currentUser) return auth.currentUser;

  return await new Promise((resolve) => {
    let done = false;
    let timeoutId;

    const settle = (user) => {
      if (done) return;
      done = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(user || null);
    };

    timeoutId = setTimeout(() => {
      console.error(`Auth gate timed out after ${timeoutMs}ms (currentUser still null)`);
      // Log auth internals for diagnostics
      try {
        console.error("Auth gate debug:", {
          currentUser: auth?.currentUser || null,
          tenantId: auth?.tenantId,
          appName: auth?.app?.name
        });
      } catch {}
      settle(null);
    }, timeoutMs);


    try {
      let unsubscribe = null;
      unsubscribe = onAuthStateChanged(auth, (user) => {

        try {
          unsubscribe?.();
        } catch {}
        settle(user);
      });
    } catch (e) {
      console.error("getCurrentUserOrWait: onAuthStateChanged threw:", e);
      settle(null);
    }

  });
}


function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function formatBytes(bytes) {
  try {
    if (!Number.isFinite(bytes)) return "-";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)}MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)}KB`;
  } catch {
    return "-";
  }
}

function getSanitizedFilename(name) {
  const base = String(name || "").trim();
  // Keep extension but sanitize everything else.
  const lastDot = base.lastIndexOf(".");
  const namePart = lastDot >= 0 ? base.slice(0, lastDot) : base;
  const extPart = lastDot >= 0 ? base.slice(lastDot + 1) : "";
  const safeName = namePart.replace(/[^a-zA-Z0-9-_]/g, "_");
  const safeExt = extPart.replace(/[^a-zA-Z0-9]/g, "");
  return safeExt ? `${safeName}.${safeExt}` : safeName;
}

function validateImageFile(file, { maxBytes, allowedMimeTypes } = {}) {
  if (!file) return { ok: false, error: "Please select an image file." };
  if (!allowedMimeTypes?.length) return { ok: false, error: "No allowed image types configured." };
  if (!allowedMimeTypes.includes(file.type)) {
    return {
      ok: false,
      error: `Unsupported file type: ${file.type || "unknown"}. Allowed: ${allowedMimeTypes.join(", ")}`
    };
  }
  if (typeof maxBytes === "number" && file.size > maxBytes) {
    return {
      ok: false,
      error: `File too large. Max ${formatBytes(maxBytes)}. Yours: ${formatBytes(file.size)}`
    };
  }
  return { ok: true, error: null };
}


function validatePayloadForFirestore(payload) {
  if (!isPlainObject(payload)) return { ok: false, error: "Payload is not an object" };

  const problems = [];

  // No undefined fields
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) problems.push(`undefined field: ${k}`);
    if (hasNaNorInfinity(v)) problems.push(`invalid number field: ${k}`);
  }

  // Firestore generally supports: string, number, boolean, null, Date, Timestamp, arrays, plain objects.
  // We explicitly disallow functions.
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "function") problems.push(`unsupported function field: ${k}`);
  }

  // Critical fields (fail fast)
  if (!isNonEmptyString(payload.title)) problems.push("missing/empty title");
  if (!isNonEmptyString(payload.description)) problems.push("missing/empty description");
  if (!isNonEmptyString(payload.imageUrl)) problems.push("missing/empty imageUrl");
  if (!isNonEmptyString(payload.contact)) problems.push("missing/empty contact");
  if (!isNonEmptyString(payload.category)) problems.push("missing/empty category");
  if (payload.userId === undefined || payload.userId === null || !isNonEmptyString(payload.userId)) {
    problems.push("missing/empty userId");
  }
  if (payload.userEmail === undefined || payload.userEmail === null || !isNonEmptyString(payload.userEmail)) {
    problems.push("missing/empty userEmail");
  }
  if (payload.price !== null && payload.price !== undefined) {
    if (typeof payload.price !== "number" || !Number.isFinite(payload.price)) {
      problems.push("price must be a finite number or null");
    }
  }

  return problems.length
    ? { ok: false, error: problems.join("; ") }
    : { ok: true, error: null };
}


const init = () => {
  const form = document.getElementById("serviceForm");
  if (!form) {
    console.error("serviceForm NOT FOUND in DOM");
    return;
  }



  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    let clearWriteWatchdog = null;
    const submitBtn = form.querySelector("button[type=\"submit\"], button.btn[type=\"submit\"]");

    try {
// console.log("POST submit: start");

      setStatus("Preparing...");

      // Read inputs once (avoid race conditions with async)
      const title = document.getElementById("title")?.value?.trim();
      const description = document.getElementById("description")?.value?.trim();
      const contact = document.getElementById("contact")?.value;
      const category = document.getElementById("category")?.value;

      const imageFileEl = document.getElementById("imageFile");
      const imageFile = imageFileEl?.files?.[0] || null;

      const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
      const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

      const imageValidation = validateImageFile(imageFile, {
        maxBytes: MAX_IMAGE_BYTES,
        allowedMimeTypes: ALLOWED_MIME_TYPES
      });

      if (!imageValidation.ok) {
        setStatus(imageValidation.error);
        return;
      }

      const priceRaw = document.getElementById("price")?.value;
      const price = priceRaw === "" || priceRaw == null ? null : Number(priceRaw);

      const locationRaw = document.getElementById("location")?.value;
      const location = locationRaw?.trim() === "" ? null : locationRaw.trim();

      const deliveryAvailable = document.getElementById("deliveryAvailable")?.checked;

      console.log("POST submit: form values captured", {
        title,
        description,
        contactPresent: !!contact,
        category,
        price,
        location,
        deliveryAvailable
      });




      // Normalize/validate contact first
      const contactNormalized = normalizePhone(contact);
      if (!contactNormalized) {
        setStatus("Invalid WhatsApp number");
        console.error("POST submit: invalid WhatsApp number", { contact });
        return;
      }

      // Auth readiness gate (non-redirecting)
      console.log("POST submit: waiting for auth readiness...");
      const currentUser = await getCurrentUserOrWait({ timeoutMs: 10000 });
      console.log("POST submit: auth currentUser at write time:", {
        hasCurrentUser: !!auth?.currentUser,
        uid: auth?.currentUser?.uid
      });


      console.log("POST submit: auth readiness result", {
        hasUser: !!currentUser,
        uid: currentUser?.uid
      });

      if (!currentUser) {
        setStatus("Not logged in");
        return;
      }

      setStatus("Uploading image...");

      const timestamp = Date.now();
      const filename = getSanitizedFilename(imageFile?.name || "image");
      const storagePath = `services/${currentUser.uid}/${timestamp}_${filename}`;
      const storageRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(storageRef, imageFile);

      const uploadPromise = new Promise((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          () => {
            // Optional: progress handling could go here.
          },
          (err) => {
            reject(err);
          },
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(url);
            } catch (e) {
              reject(e);
            }
          }
        );
      });

      let imageUrl;
      try {
        imageUrl = await uploadPromise;
      } catch (uploadErr) {
        console.error("POST submit: image upload failed", uploadErr);
        setStatus(`Image upload failed: ${uploadErr?.message || uploadErr}`);

        const submitBtn = form.querySelector("button[type=\"submit\"], button.btn[type=\"submit\"]");
        if (submitBtn && submitBtn.dataset.prevDisabled !== undefined) {
          submitBtn.disabled = submitBtn.dataset.prevDisabled === "true";
        }

        return;
      }

      const payload = {
        title,
        description,
        imageUrl,
        contact: contactNormalized,
        category,
        price,
        location,
        deliveryAvailable: !!deliveryAvailable,
        createdAt: serverTimestamp(),
        userId: currentUser.uid,
        userEmail: currentUser.email
      };

      console.log("POST submit: payload built", payload);

      // Fail fast on unsupported/undefined payload parts
      const validation = validatePayloadForFirestore(payload);
      if (!validation.ok) {
        console.error("POST submit: payload validation failed:", validation.error);
        setStatus(`Add aborted: ${validation.error}`);
        return;
      }

      const servicesCollection = collection(db, "services");
      if (!servicesCollection) {
        console.error("POST submit: servicesCollection is falsy");
        setStatus("Internal error: Firestore collection not ready");
        return;
      }

      setStatus("Writing to Firestore...");
      console.log("POST submit: BEFORE addDoc", {
        servicesPath: "services",
        payloadPreview: {
          title: payload.title,
          userId: payload.userId,
          createdAt: "serverTimestamp"
        }
      });

      clearWriteWatchdog = watchdog("addDoc (pending)", 12000);

      // Best-effort Firestore debug logging to diagnose stalls.
      try {
        const mod = await import(
          "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
        );
        if (typeof mod?.setLogLevel === "function") mod.setLogLevel("debug");
      } catch {}

      const submitBtn = form.querySelector("button[type=\"submit\"], button.btn[type=\"submit\"]");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.prevDisabled = String(!!submitBtn.disabled);
      }

      setStatus("Saving service...");

      const addDocPromise = (async () => {
        try {
          const t0 = performance.now();
          const ref = await addDoc(servicesCollection, payload);
          console.log("POST submit: addDoc resolved", {
            docId: ref?.id,
            ms: Math.round(performance.now() - t0)
          });
          return ref;
        } catch (e) {
          console.error("POST submit: addDoc threw immediately", e);
          throw e;
        }
      })();

      console.log("POST submit: addDoc promise created (waiting)");

      let docRef;
      let addDocError = null;
      const writeTimeoutMs = 15000;

      const addDocPromiseWithCapture = addDocPromise.catch((e) => {
        addDocError = e;
        throw e;
      });

      try {
        docRef = await Promise.race([
          addDocPromiseWithCapture,
          new Promise((_, reject) => {
            setTimeout(() => {
              // If we timed out, capture current auth + db metadata for evidence
              console.error("POST submit: addDoc timeout firing", {
                writeTimeoutMs,
                authCurrentUser: auth?.currentUser ? { uid: auth.currentUser.uid, email: auth.currentUser.email } : null,
                firestoreAppProjectId: auth?.app?.options?.projectId || null,
                dbAppProjectId: db?.app?.options?.projectId || null,
                collection: "services",
                lastAddDocError: addDocError ? String(addDocError?.message || addDocError) : null,
              });

              reject(
                new Error(
                  `addDoc timed out after ${writeTimeoutMs}ms (no success or explicit failure captured in time). ` +
                    `This is not proof of permissions/network; check the logs and Firestore console.`
                )
              );
            }, writeTimeoutMs);
          }),
        ]);
      } finally {
        clearWriteWatchdog?.();
      }

      console.log("POST submit: AFTER addDoc resolved", { docId: docRef?.id });



      setStatus("Service posted!");
      console.log("Document created:", docRef?.id);

    } catch (err) {
      console.error("POST submit ERROR", err);
      clearWriteWatchdog?.();
      setStatus(`Add failed: ${err?.message || err}`);
    } finally {
      const submitBtn = form.querySelector("button[type=\"submit\"], button.btn[type=\"submit\"]");
      if (submitBtn && submitBtn.dataset.prevDisabled !== undefined) {
        submitBtn.disabled = submitBtn.dataset.prevDisabled === "true";
      }
    }

  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

