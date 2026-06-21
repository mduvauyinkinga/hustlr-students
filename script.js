import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

function normalizeWhatsAppNumber(value) {
  if (!value) return "";
  // Keep digits only (strip +, spaces, dashes)
  return String(value).replace(/\D/g, "");
}

function requestService(name) {
  const message = encodeURIComponent(
    `Hi! I want to request this HUSTLR service: ${name}`
  );

  const hustlrNumber = normalizeWhatsAppNumber("+27637919877");

  window.open(
    `https://wa.me/${hustlrNumber}?text=${message}`,
    "_blank"
  );
}

// Keep compatibility with inline onclick handlers
window.requestService = requestService;

window.logoutUser = function () {
  signOut(auth).then(() => {
    alert("Logged out");
  });
};

// Auth guard (redirect to auth.html if not signed in)
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "auth.html";
  }
});

