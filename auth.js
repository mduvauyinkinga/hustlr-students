import { auth } from "./firebase.js";

// Firebase auth functions
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";



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

// SIGN UP
window.signup = async function () {
  const { email, password } = getEmailAndPassword();
  if (!email || !password) {
    document.getElementById("status").innerText = "Enter your email and password.";
    return;
  }

  try {
    await applyAuthPersistence();
    await createUserWithEmailAndPassword(auth, email, password);
    document.getElementById("status").innerText = "Account created!";
    window.location.href = "index.html";
  } catch (err) {
    document.getElementById("status").innerText = err.message;
  }
};

// LOGIN
window.login = async function () {
  const { email, password } = getEmailAndPassword();
  if (!email || !password) {
    document.getElementById("status").innerText = "Enter your email and password.";
    return;
  }

  try {
    await applyAuthPersistence();
    await signInWithEmailAndPassword(auth, email, password);
    document.getElementById("status").innerText = "Logged in!";
    window.location.href = "index.html";
  } catch (err) {
    document.getElementById("status").innerText = err.message;
  }
};

// FORGOT PASSWORD
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
if (forgotPasswordLink) {
  forgotPasswordLink.addEventListener("click", async (e) => {
    e.preventDefault();

    const emailEl = document.getElementById("email");
    const email = (emailEl?.value || "").trim();
    if (!email) {
      document.getElementById("status").innerText = "Enter your email to reset your password.";
      emailEl?.focus();
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      document.getElementById("status").innerText = "Password reset email sent! Check your inbox.";
    } catch (err) {
      document.getElementById("status").innerText = err.message;
    }
  });
}
