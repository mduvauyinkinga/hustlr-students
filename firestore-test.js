import {
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "./firebase.js";

console.log("Firebase initialized");

function getFirestoreInstance() {
  // db is the Firestore instance from firebase.js
  return db;
}

window.runFirestoreTest = async function runFirestoreTest() {
  const clearAllWatchdogs = [];

  function setWatchdog(name, ms = 30000) {
    const watchdog = setTimeout(() => {
      console.error(`WATCHDOG: ${name} still pending after ${ms}ms`);
    }, ms);
    clearAllWatchdogs.push(() => clearTimeout(watchdog));
  }

  function tlog(label, extra) {
    try {
      console.log(label, { perfNow: performance.now(), ...(extra || {}) });
    } catch {
      console.log(label, extra);
    }
  }

tlog("runFirestoreTest entry");

function perf(label, extra) {
  try {
    console.log(label, { perfNow: performance.now(), ...(extra || {}) });
  } catch {
    console.log(label, extra);
  }
}

function watchdog(name, ms = 30000) {
  const id = setTimeout(() => {
    console.error(`WATCHDOG: ${name} still pending after ${ms}ms`);
  }, ms);
  return () => clearTimeout(id);
}

window.onerror = function (message, source, lineno, colno, error) {
  perf("window.onerror");
  console.error("[window.onerror]", { message, source, lineno, colno, error });
};

window.onunhandledrejection = function (event) {
  perf("window.onunhandledrejection");
  console.error("[window.onunhandledrejection]", { reason: event?.reason, promise: event?.promise });
};

  // Firestore debug logging (best-effort; may not exist in all builds)
  try {
    const mod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const setLogLevel = mod?.setLogLevel;
    if (typeof setLogLevel === "function") {
      setLogLevel("debug");
      tlog("Firestore setLogLevel(debug) applied");
    } else {
      tlog("Firestore setLogLevel not found in module");
    }
  } catch (e) {
    console.warn("Firestore setLogLevel debug import failed (non-fatal)", e);
  }

  // Basic sanity log
  const firestore = getFirestoreInstance();

  console.log("Firestore instance:", firestore);

  try {
    perf("[setDoc] before promise creation");
    const clearSetDocWatchdog = watchdog("setDoc await", 30000);

    console.log("Before setDoc");
    perf("[setDoc] before setDoc() call");
    const setDocPromise = setDoc(doc(db, "services", "debug-test"), {
      test: true,
      timestamp: Date.now()
    });
    perf("[setDoc] after promise creation");

    await setDocPromise;
    perf("[setDoc] after await setDocPromise resolved");
    clearSetDocWatchdog();

    console.log("After setDoc");
    console.log("TEST WRITE SUCCESS");
  } catch (error) {
    perf("[setDoc] after await setDocPromise rejected", { err: String(error?.message || error) });
    clearSetDocWatchdog?.();
    console.error("TEST WRITE ERROR:", error);
    console.error("Full error object:", error);
  }
};


