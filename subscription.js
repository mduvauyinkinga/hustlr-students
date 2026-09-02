import { auth, db, functions } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const renewalText = document.getElementById("renewalText");
const message = document.getElementById("subscriptionMessage");
const buttons = [...document.querySelectorAll(".plan-button")];
const studentPlanCard = document.querySelector('[data-plan-card="student"]');
const config = window.HUSTLR_PAYPAL_CONFIG || {};
let currentUser = null;
let paypalReady = null;

function setMessage(text) {
  if (message) message.textContent = text;
}

function renderStatus(data) {
  const state = data?.status || "NOT_SUBSCRIBED";
  const labels = {
    ACTIVE: "Active",
    APPROVAL_PENDING: "Approval pending",
    SUSPENDED: "Suspended",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
    NOT_SUBSCRIBED: "Not subscribed"
  };

  statusBadge.textContent = labels[state] || state;
  statusBadge.dataset.state = state.toLowerCase();
  statusText.textContent = state === "ACTIVE"
    ? "Your seller subscription has been verified by Hustlr."
    : state === "APPROVAL_PENDING"
    ? "PayPal approval was received. Hustlr is waiting for verified billing confirmation."
    : "Choose a recurring plan to enable seller tools.";
  renewalText.textContent = data?.nextBillingTime
    ? `Next billing date: ${new Date(data.nextBillingTime).toLocaleDateString()}`
    : "";
}

async function ensureSellerActivationIfEligible() {
  if (!currentUser) return;
  try {
    const fn = httpsCallable(functions, "activateSellerIfEligible");
    const result = await fn({});
    if (result?.data?.activated) {
      window.location.href = "dashboard.html";
    }
  } catch {
    // Silent: the backend remembers eligibility and the page will continue to display status.
  }
}

function disableButtons() {
  buttons.forEach((button) => {
    button.disabled = true;
    button.title = "You need a valid store before paying for the seller subscription.";
  });
}

function enableButtons() {
  buttons.forEach((button) => {
    button.disabled = false;
    button.title = "";
  });
}

function hideStudentPlanIfIneligible(user) {
  const eligible = (user.email || "").toLowerCase().endsWith("@tut4life.ac.za");
  if (!eligible) studentPlanCard?.remove();
  return eligible;
}

function loadPayPalSdk() {
  if (paypalReady) return paypalReady;
  if (!config.clientId || config.clientId.includes("YOUR_PAYPAL")) {
    return Promise.reject(new Error("PayPal Sandbox client ID is not configured in paypal-config.js."));
  }
  paypalReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&vault=true&intent=subscription&components=buttons`;
    script.onload = () => resolve(window.paypal);
    script.onerror = () => reject(new Error("PayPal Sandbox failed to load."));
    document.head.appendChild(script);
  });
  return paypalReady;
}

async function beginSubscription(planKey, container) {
  if (!currentUser) throw new Error("Please sign in to begin the seller subscription process.");

  const prepare = httpsCallable(functions, "preparePayPalSubscription");
  const { data } = await prepare({ planKey });
  const paypal = await loadPayPalSdk();
  container.replaceChildren();

  await paypal.Buttons({
    style: { layout: "vertical", label: "subscribe" },
    createSubscription(_data, actions) {
      return actions.subscription.create({
        plan_id: data.paypalPlanId,
        custom_id: data.intentToken
      });
    },
    async onApprove(paypalData) {
      try {
        const register = httpsCallable(functions, "registerPayPalApproval");
        await register({ intentToken: data.intentToken, subscriptionId: paypalData.subscriptionID });
        setMessage("PayPal approval received. Hustlr is waiting for backend verification before activation.");
      } catch (error) {
        console.error("PayPal approval registration failed", error);
        setMessage("PayPal approval was received, but verification failed. Please contact support.");
      }
    },
    onCancel() {
      setMessage("PayPal checkout was cancelled. No seller access was activated.");
    },
    onError(error) {
      console.error("PayPal subscription error", error);
      setMessage("PayPal could not start the subscription. Please try again.");
    }
  }).render(container);
}

function renderButton(planKey, button) {
  const container = document.createElement("div");
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.replaceWith(container);
    container.replaceChildren();
    try {
      await beginSubscription(planKey, container);
    } catch (error) {
      setMessage(error?.message || "Subscription could not be started.");
      button.disabled = false;
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  currentUser = user;
  hideStudentPlanIfIneligible(user);

  const userSnapshot = await getDoc(doc(db, "users", user.uid));
  const role = userSnapshot.data()?.role || "customer";
  const storeSnapshot = await getDoc(doc(db, "stores", user.uid));
  const storeData = storeSnapshot.exists() ? storeSnapshot.data() : null;
  const hasPendingStore = !!storeData && (storeData.status === "pending_subscription" || storeData.status === "pending");
  const canAccessSubscription = role === "seller" || hasPendingStore;

  if (!canAccessSubscription) {
    setMessage("Create a store first, then complete the seller subscription to activate your account.");
    disableButtons();
    return;
  }

  onSnapshot(doc(db, "sellerSubscriptionPublic", user.uid), async (snapshot) => {
    const data = snapshot.data();
    renderStatus(data);

    const publicStatus = data?.status || "NOT_SUBSCRIBED";
    if (publicStatus === "ACTIVE") {
      await ensureSellerActivationIfEligible();
    }
  });

  enableButtons();
  document.querySelectorAll(".plan-button").forEach((button) => renderButton(button.dataset.planKey, button));
});
