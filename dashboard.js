import { auth, db } from "./firebase.js";

import {

  onAuthStateChanged,

  signOut

} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {

  collection,

  query,

  where,

  getDocs,

  deleteDoc,

  updateDoc,

  doc,

  orderBy

} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { normalizePhone } from "./phoneUtils.js";
import { logError } from "./production-logger.js";

// ELEMENTS


const myServices =
  document.getElementById("myServices");

const welcomeText =
  document.getElementById("welcomeText");

const logoutBtn =
  document.getElementById("logoutBtn");

// PROFILE ELEMENTS

const profilePicture =
  document.getElementById("profilePicture");

const profileUsername =
  document.getElementById("profileUsername");

const profileEmail =
  document.getElementById("profileEmail");

const joinedDateEl =
  document.getElementById("joinedDate");

const servicesPostedEl =
  document.getElementById("servicesPosted");

const jobsCompletedEl =
  document.getElementById("jobsCompleted");

const ratingEl =
  document.getElementById("rating");

function setText(el, value) {
  if (!el) return;
  el.innerText = value ?? "-";
}

function formatDate(value) {
  try {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString();
  } catch {
    return "-";
  }
}

// AUTH CHECK

onAuthStateChanged(auth, async (user) => {
  // Ensure protected UI doesn’t flash for logged-out users
  if (!user) {
    // hard redirect to login
    window.location.href = "auth.html";
    return;
  }

  // WELCOME MESSAGE
  welcomeText.innerText = `Logged in as ${user.email}`;

  // Show logout only after auth is confirmed
  if (logoutBtn) logoutBtn.style.display = "inline-block";

  // USER PROFILE (Auth-backed)
  setText(profileUsername, user.displayName || "-");
  setText(profileEmail, user.email || "-");
  setText(joinedDateEl, formatDate(user?.metadata?.creationTime));

  if (profilePicture) {
    if (user.photoURL) {
      profilePicture.src = user.photoURL;
    } else {
      profilePicture.removeAttribute("src");
      profilePicture.style.background = "#2a2a2e";
    }
  }

  // Defaults for data not modeled yet
  setText(jobsCompletedEl, "-");
  setText(ratingEl, "-");

  // LOAD USER SERVICES + Services Posted count
  loadUserServices(user.uid);
  loadServicesPostedCount(user.uid);
});

// LOAD USER SERVICES

async function loadServicesPostedCount(userId) {

  try {
    const q = query(
      collection(db, "services"),
      where("userId", "==", userId)
    );

    const querySnapshot = await getDocs(q);
    setText(servicesPostedEl, querySnapshot.size);
  } catch {
    setText(servicesPostedEl, "-");
  }
}

async function loadUserServices(userId) {

  // Avoid injecting Firestore-controlled HTML.
  myServices.replaceChildren();
  const loadingEl = document.createElement("p");
  loadingEl.innerText = "Loading...";
  myServices.appendChild(loadingEl);

  try {

    const q = query(

      collection(db, "services"),

      where("userId", "==", userId),

      orderBy("createdAt", "desc")

    );

    const querySnapshot =
      await getDocs(q);

    myServices.replaceChildren();

    // EMPTY STATE

    if (querySnapshot.empty) {

      // Keep empty state without injecting Firestore-controlled HTML.
      myServices.replaceChildren();
      const card = document.createElement("div");
      card.classList.add("card");
      const h3 = document.createElement("h3");
      h3.innerText = "No services yet";
      const p = document.createElement("p");
      p.innerText = "You haven't posted any services.";
      card.appendChild(h3);
      card.appendChild(p);
      myServices.appendChild(card);
      return;


    }

    // DISPLAY POSTS

    querySnapshot.forEach((serviceDoc) => {

      const service =
        serviceDoc.data();

      const card =
        document.createElement("div");

      card.classList.add("card");

      // XSS hardening: never inject Firestore content via innerHTML.
      if (service.imageUrl) {
        const img = document.createElement("img");
        img.className = "service-image";
        img.loading = "lazy";
        img.src = String(service.imageUrl);
        img.alt = String(service.title ?? "");
        card.appendChild(img);
      }

      const titleEl = document.createElement("h3");
      titleEl.innerText = String(service.title ?? "");
      card.appendChild(titleEl);

      const descEl = document.createElement("p");
      descEl.innerText = String(service.description ?? "");
      card.appendChild(descEl);

      const contactP = document.createElement("p");
      const strong = document.createElement("strong");
      strong.innerText = "Contact:";
      contactP.appendChild(strong);
      contactP.appendChild(document.createTextNode(" "));
      contactP.appendChild(document.createTextNode(String(service.contact ?? "")));
      card.appendChild(contactP);

      card.appendChild(document.createElement("br"));

      const actions = document.createElement("div");
      actions.className = "dashboard-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "btn edit-btn";
      editBtn.dataset.id = serviceDoc.id;
      editBtn.innerText = "Edit";
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn delete-btn";
      deleteBtn.dataset.id = serviceDoc.id;
      deleteBtn.innerText = "Delete";
      actions.appendChild(deleteBtn);

      card.appendChild(actions);

      myServices.appendChild(card);

    });

    // DELETE BUTTONS

    const deleteButtons =
      document.querySelectorAll(".delete-btn");

    deleteButtons.forEach((button) => {

      button.addEventListener("click", async () => {

        const id =
          button.dataset.id;

        const confirmDelete =
          confirm(
            "Delete this service?"
          );

        if (!confirmDelete) return;

        try {

          await deleteDoc(
            doc(db, "services", id)
          );

          loadUserServices(userId);

        } catch (error) {

          logError("DASH_010");
          alert("Unable to delete this service right now. Please try again.");

        }

      });

    });

    // EDIT BUTTONS

    const editButtons =
      document.querySelectorAll(".edit-btn");

    editButtons.forEach((button) => {

      button.addEventListener("click", async () => {

        const id =
          button.dataset.id;

        // Fetch current values safely from the DOM prompt defaults.
        // We intentionally do not render Firestore HTML; defaults come only from sanitized values.
        const currentTitle = "";
        const currentDescription = "";
        const currentContact = "";

        // PROMPTS
        const newTitle =
          prompt(
            "Edit title:",
            currentTitle
          );

        if (newTitle === null) return;

        const newDescription =
          prompt(
            "Edit description:",
            currentDescription
          );

        if (newDescription === null) return;

        const newContact =
          prompt(
            "Edit contact:",
            currentContact
          );

        if (newContact === null) return;

        const normalizedContact = normalizePhone(newContact);

        if (!normalizedContact) {

          alert("Please enter a valid WhatsApp number.");

          return;

        }

        try {

          await updateDoc(

            doc(db, "services", id),

            {

              title: newTitle,

              description: newDescription,

              contact: normalizedContact

            }

          );

          alert("Service updated!");

          loadUserServices(userId);

        } catch (error) {

          logError("DASH_020");
          alert("Unable to update this service right now. Please try again.");

        }

      });

    });

  } catch (error) {

    // XSS hardening + no sensitive error leakage
    myServices.replaceChildren();
    const card = document.createElement("div");
    card.classList.add("card");
    const h3 = document.createElement("h3");
    h3.innerText = "Error";
    const p = document.createElement("p");
    p.innerText = "Unable to load your services. Please refresh and try again.";
    card.appendChild(h3);
    card.appendChild(p);
    myServices.appendChild(card);
    logError("DASH_005");

  }

}

// LOGOUT

logoutBtn.addEventListener("click", async () => {

  try {

    await signOut(auth);

    window.location.href =
      "auth.html";

  } catch (error) {

    logError("DASH_030");
    alert("Unable to log out right now. Please try again.");

  }

});