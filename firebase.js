import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAi6RJokQMnO4r4iwii3f-Ds_VTyiId8dk",
  authDomain: "hustlr-students.firebaseapp.com",
  databaseURL: "https://hustlr-students-default-rtdb.firebaseio.com",
  projectId: "hustlr-students",
  storageBucket: "hustlr-students.firebasestorage.app",
  messagingSenderId: "519405199721",
  appId: "1:519405199721:web:d520e220855414f4671df8",
  measurementId: "G-LHP39GGQWR"
};

// Guard against multiple app instances across modules/pages.
// This prevents Firestore write streams from hanging due to duplicated initialization.
const apps = getApps();
const app = apps.length ? apps[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Firebase App Check (anti-abuse) - ReCaptcha v3
// NOTE: Replace the placeholder with your actual App Check reCAPTCHA v3 site key.
const RECAPTCHA_V3_SITE_KEY = "6Le5ICstAAAAAAadjylbuHL9zsl_fbz5ReQDJ2nr";

try {
  // Avoid double-initialization across modules/pages.
  // If another module already called initializeAppCheck(app, ...), this will throw.
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
} catch (e) {
  // Intentionally no console debug logs (requirement: remove debug logs from firebase.js).
}


