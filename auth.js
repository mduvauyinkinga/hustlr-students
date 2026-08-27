import { auth } from "./firebase.js";

// Firebase auth functions
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  ensureUserDocument
} from "./user-initialization.js";

// TODO: Re-enable reCAPTCHA before production.
// Removed temporarily during development to focus on core features.
// ── Backend URL Configuration ──────────────────────────────────────────────
// During local development, the reCAPTCHA verification server runs on port 3001.
// In production (Firebase Hosting / GitHub Pages), the endpoint is served via
// Cloud Functions or a reverse proxy, so we use a relative path.
//
// To change the production URL, edit PRODUCTION_BACKEND_URL below.
// const BACKEND_BASE_URL = (() => {
//   const PRODUCTION_BACKEND_URL = ""; // e.g. "https://your-api.example.com"
//
//   const { hostname } = window.location;
//   if (hostname === "localhost" || hostname === "127.0.0.1") {
//     return "http://localhost:3001";
//   }
//   return PRODUCTION_BACKEND_URL;
// })();

function getRememberMePreference() {
  const rememberMeEl = document.getElementById("rememberMe");
  return !!(rememberMeEl && rememberMeEl.checked);
}

async function applyAuthPersistence() {
  const rememberMe = getRememberMePreference();
  const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
  await setPersistence(auth, persistence);
}

function getEmailAndPassword() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  return { email, password };
}

// TODO: Re-enable reCAPTCHA before production.
// Removed temporarily during development to focus on core features.
// SIGN UP
// reCAPTCHA Enterprise (client-side): requires the enterprise.js script on the page.
// const RECAPTCHA_ENTERPRISE_SITE_KEY =
//   "6LfQtSstAAAAAJhirUm2O6sGFpsJ75AbwSNYvmzf";
//
// async function getRecaptchaToken(action) {
//   const enterprise = window.grecaptcha?.enterprise;
//   if (!enterprise) {
//     // When the reCAPTCHA enterprise script is deferred, this can happen briefly.
//     // Throwing a clear error is still better than failing silently.
//     throw new Error(
//       "reCAPTCHA failed to load. Please refresh the page and try again."
//     );
//   }
//
//   const waitForReady = async ({ timeoutMs = 8000 } = {}) => {
//     // enterprise.ready returns a Promise, but we still add a guard timeout.
//     return await Promise.race([
//       enterprise.ready(() => true),
//       new Promise((_, reject) =>
//         setTimeout(() => reject(new Error("reCAPTCHA ready() timed out")), timeoutMs)
//       )
//     ]);
//   };
//
//   const executeWithTimeout = ({ timeoutMs = 6000 } = {}) => {
//     return new Promise((resolve, reject) => {
//       const timeoutId = setTimeout(
//         () => reject(new Error(`reCAPTCHA execute timed out after ${timeoutMs}ms`)),
//         timeoutMs
//       );
//
//       Promise.resolve()
//         .then(async () => {
//           const token = await enterprise.execute(
//             RECAPTCHA_ENTERPRISE_SITE_KEY,
//             { action }
//           );
//           resolve(token);
//         })
//         .catch((err) => {
//           reject(err);
//         })
//         .finally(() => clearTimeout(timeoutId));
//     });
//   };
//
//   const maxAttempts = 3;
//   let lastErr;
//
//   // Ensure the enterprise API is ready before attempting execute.
//   // If the enterprise.js script was deferred, it should still be available by now.
//   await waitForReady({ timeoutMs: 8000 }).catch((e) => {
//     lastErr = e;
//     throw e;
//   });
//
//   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//     try {
//       const token = await executeWithTimeout({ timeoutMs: 6000 });
//       if (!token || typeof token !== "string") {
//         throw new Error("reCAPTCHA returned an empty token");
//       }
//       return token;
//     } catch (err) {
//       lastErr = err;
//
//       // If BROWSER_ERROR happened, retry.
//       // We treat any execute failure as retryable, because the goal is to avoid
//       // returning a bad token that fails backend verification.
//       const statusEl = document.getElementById("status");
//       if (statusEl) {
//         statusEl.innerText =
//           attempt < maxAttempts
//             ? "reCAPTCHA is having network trouble—retrying..."
//             : "reCAPTCHA verification failed. Please try again.";
//       }
//
//       // Wait a short backoff before retrying execute.
//       if (attempt < maxAttempts) {
//         const backoffMs = 500 * attempt;
//         await new Promise((r) => setTimeout(r, backoffMs));
//       }
//     }
//   }
//
//   throw lastErr || new Error("reCAPTCHA token generation failed");
// }
//
//
// async function verifyTokenWithBackend({ token, action }) {
//   // No backend endpoint exists in this repo yet.
//   // This is intentionally a placeholder fetch so you can wire it later.
//   const verifyUrl = `${BACKEND_BASE_URL}/api/recaptcha-verify`;
//
//   const res = await fetch(verifyUrl, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ token, action })
//   });
//
//   // Expected backend response (you will implement server-side later):
//   // { ok: boolean, reason?: string }
//   if (!res.ok) {
//     throw new Error(
//       `reCAPTCHA verification failed (HTTP ${res.status}).` // keep it generic
//     );
//   }
//
//   const data = await res.json().catch(() => ({}));
//   if (!data?.ok) {
//     throw new Error(data?.reason || "reCAPTCHA verification was rejected.");
//   }
//
//   return true;
// }

function getAuthButtons() {
  return {
    signupBtn: document.querySelector("button[onclick='signup()']"),
    loginBtn: document.querySelector("button[onclick='login()']")
  };
}

function setAuthButtonsDisabled(disabled) {
  const { signupBtn, loginBtn } = getAuthButtons();
  if (signupBtn) signupBtn.disabled = disabled;
  if (loginBtn) loginBtn.disabled = disabled;
}

// SIGN UP
window.signup = async function () {
  const { email, password } = getEmailAndPassword();
  if (!email || !password) {
    document.getElementById("status").innerText = "Enter your email and password.";
    return;
  }

  const statusEl = document.getElementById("status");
  setAuthButtonsDisabled(true);
  try {
    // TODO: Re-enable reCAPTCHA before production.
    // Removed temporarily during development to focus on core features.
    // statusEl.innerText = "Checking you're not a bot...";
    //
    // const token = await getRecaptchaToken("SIGNUP");
    // await verifyTokenWithBackend({ token, action: "SIGNUP" });

    await applyAuthPersistence();
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await ensureUserDocument(credential.user);
    statusEl.innerText = "Account created!";
    window.location.href = "index.html";
  } catch (err) {
    statusEl.innerText = err?.message || String(err);
  } finally {
    setAuthButtonsDisabled(false);
  }
};

// LOGIN
window.login = async function () {
  const { email, password } = getEmailAndPassword();
  if (!email || !password) {
    document.getElementById("status").innerText = "Enter your email and password.";
    return;
  }

  const statusEl = document.getElementById("status");
  setAuthButtonsDisabled(true);
  try {
    // TODO: Re-enable reCAPTCHA before production.
    // Removed temporarily during development to focus on core features.
    // statusEl.innerText = "Checking you're not a bot...";
    //
    // const token = await getRecaptchaToken("LOGIN");
    // await verifyTokenWithBackend({ token, action: "LOGIN" });

    await applyAuthPersistence();
    await signInWithEmailAndPassword(auth, email, password);
    statusEl.innerText = "Logged in!";
    window.location.href = "index.html";
  } catch (err) {
    statusEl.innerText = err?.message || String(err);
  } finally {
    setAuthButtonsDisabled(false);
  }
};

