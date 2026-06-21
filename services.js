import { db } from "./firebase.js";

import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Public services listing

const servicesContainer = document.getElementById("servicesContainer");
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const sortFilter = document.getElementById("sortFilter");

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "<")
    .replaceAll(">", ">")
    .replaceAll('"', '"')
    .replaceAll("'", "&#039;");
}

async function loadServices() {
  if (!servicesContainer) return;

  servicesContainer.innerHTML = "<p>Loading...</p>";

  const category = categoryFilter?.value || "all";
  const sort = sortFilter?.value || "newest";
  const q = (searchInput?.value || "").trim().toLowerCase();

  try {
    let firestoreQuery = query(collection(db, "services"));

    if (category !== "all") {
      firestoreQuery = query(collection(db, "services"), where("category", "==", category));
    }

    if (sort === "newest") {
      firestoreQuery = query(firestoreQuery, orderBy("createdAt", "desc"));
    } else if (sort === "oldest") {
      firestoreQuery = query(firestoreQuery, orderBy("createdAt", "asc"));
    }

    const snap = await getDocs(firestoreQuery);

    const items = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const title = String(data?.title ?? "");
      const description = String(data?.description ?? "");

      const matchesSearch =
        !q || title.toLowerCase().includes(q) || description.toLowerCase().includes(q);

      if (!matchesSearch) return;

      items.push({ id: docSnap.id, ...data });
    });

    if (!items.length) {
      servicesContainer.innerHTML = `
        <div class="card">
          <h3>No services found</h3>
          <p>Try adjusting your search or filters.</p>
        </div>
      `;
      return;
    }

    servicesContainer.innerHTML = "";

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "card";
      const imageUrl = item.imageUrl ? String(item.imageUrl) : "";
      card.innerHTML = `
        ${imageUrl ? `<img class="service-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />` : ""}
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.description)}</p>
        <p><strong>Category:</strong> ${escapeHtml(item.category)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(item.contact)}</p>
        <div>
          <button class="btn" onclick="requestService(${JSON.stringify(item.title)})">Request</button>
        </div>
      `;
      servicesContainer.appendChild(card);
    }
  } catch (err) {
    console.error("loadServices error:", err);
    servicesContainer.innerHTML = `
      <div class="card">
        <h3>Error loading services</h3>
        <p>${escapeHtml(err?.message || err)}</p>
      </div>
    `;
  }
}

function init() {
  searchInput?.addEventListener("input", loadServices);
  categoryFilter?.addEventListener("change", loadServices);
  sortFilter?.addEventListener("change", loadServices);

  loadServices();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

