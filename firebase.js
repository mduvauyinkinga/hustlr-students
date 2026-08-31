import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
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

// Firebase App Check (anti-abuse) - reCAPTCHA Enterprise.
const RECAPTCHA_ENTERPRISE_SITE_KEY = "6LfQtSstAAAAAJhirUm2O6sGFpsJ75AbwSNYvmzf";

// Initialize App Check before creating Firebase service clients.
// Do not continue if App Check cannot initialize; that would silently bypass this layer.
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);


