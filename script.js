// ogwXblacklist - Firebase RTDB client (no server)
// NOTE: Admin mode here is client-side only (not secure). Protect admin actions with Firebase Auth/claims for real security.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, get, child, off
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// If you want analytics, uncomment (may fail on localhost depending on setup)
// import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1RYtiMf0Ybof4hF6NugGq8YQ7rlL-ppg",
  authDomain: "ogwxblacklist.firebaseapp.com",
  databaseURL: "https://ogwxblacklist-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ogwxblacklist",
  storageBucket: "ogwxblacklist.firebasestorage.app",
  messagingSenderId: "603127176098",
  appId: "1:603127176098:web:6ed416a2b07c1caa85b0fb",
  measurementId: "G-TL3Z6E0Z11"
};

const ADMIN_PASSWORD = "18185151";
const ADMIN_TOKEN = "cg0dtxZvkEtUpTAEJ854AnVzUkx5VUpsMmsvWnJhbTZHRkdBQjNVVzlsa2t2OUliYS9vL2tOWU1DMVE9";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ===== Refs =====
const postsRef = ref(db, "posts");
const votesRootRef = ref(db, "votes");
const reportsRootRef = ref(db, "reports");

// ===== Helpers =====
const $ = (id) => document.getElementById(id);
const fmtDate = (ms) => {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
};
const nowMs = () => Date.now();

function safeText(s) {
  if (s == null) return "";
  return String(s);
}

// ===== Client identity (device/browser) =====
function getClientId() {
  const key = "ogwxbl_clientId";
  let v = localStorage.getItem(key);
  if (!v) {
    v = (crypto?.randomUUID?.() || ("cid_" + Math.random().toString(16).slice(2) + Date.now().toString(16)));
    localStorage.setItem(key, v);
  }
  return v;
}
const clientId = getClientId();

// ===== UI state =====
let currentTab = "blacklist";
let currentCategory = "verified";
let adminMode = localStorage.getItem("ogwxbl_admin") === "1";

let postsById = {};          // { postId: postObj }
let reportCountsByPost = {}; // { postId: count }

// View modal live listeners
let viewVoteListenerRef = null;
let viewReportListenerRef = null;

// ===== Toasts =====
function toast(type, title, msg, ttl = 3200) {
  const wrap = $("toast-wrap");
  const el = document.createElement("div");
  el.className = `toast ${type || ""}`.trim();
  el.innerHTML = `
    <div class="t-ico">${type === "success" ? '<i class="fa-solid fa-circle-check"></i>' :
      type === "danger" ? '<i class="fa-solid fa-circle-xmark"></i>' :
      type === "warn" ? '<i class="fa-solid fa-triangle-exclamation"></i>' :
      '<i class="fa-solid fa-circle-info"></i>'}
    </div>
    <div>
      <div class="t-title">${safeText(title)}</div>
      <div class="t-msg">${safeText(msg)}</div>
    </div>
  `;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

// ===== Modals =====
function openModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.remove("hidden");
}
function closeModal(elOrId) {
  const m = typeof elOrId === "string" ? $(elOrId) : elOrId;
  if (!m) return;
  m.classList.add("hidden");
}
function setupModalClose() {
  document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.getAttribute("data-close") === "1") closeModal(m);
    });
  });
}

// ===== Tabs =====
function setActiveNav(tab) {
  document.querySelectorAll(".nav-btn[data-tab]").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tab);
  });
}
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const el = $("tab-" + tab);
  if (el) el.classList.add("active");

  setActiveNav(tab);

  // render relevant view
  if (tab === "blacklist") renderPostsGrid();
  if (tab === "yours") renderYourPosts();
  if (tab === "admin-reports") renderReportsAdmin();
  if (tab === "admin-requests") renderRequestsAdmin();
}

function setCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll(".subtab").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-category") === cat);
  });
  renderPostsGrid();
}

// ===== Render cards =====
function postBadge(category) {
  const c = category || "unverified";
  const icon = c === "verified" ? "fa-check" : c === "requested" ? "fa-user-check" : "fa-circle-question";
  return `<span class="badge ${c}"><i class="fa-solid ${icon}"></i> ${c}</span>`;
}

function makePostCard(postId, p, forAdmin = false) {
  const title = safeText(p.title || "Untitled");
  const username = safeText(p.username || "Unknown");
  const created = fmtDate(p.createdAt);
  const verified = p.verifiedAt ? fmtDate(p.verifiedAt) : null;
  const category = safeText(p.category || "unverified");

  const verifiedLine = verified ? `<span class="badge verified"><i class="fa-solid fa-check"></i> verified: ${verified}</span>` : "";
  const reportCount = reportCountsByPost[postId] || 0;
  const reportLine = forAdmin ? `<span class="badge requested"><i class="fa-solid fa-flag"></i> reports: ${reportCount}</span>` : "";

  return `
    <div class="card">
      <div class="card-title">${title}</div>
      <div class="card-meta">
        <span class="badge"><i class="fa-solid fa-user"></i> ${username}</span>
        <span class="badge"><i class="fa-solid fa-calendar"></i> ${created}</span>
        ${postBadge(category)}
        ${verifiedLine}
        ${reportLine}
      </div>
      <div class="card-actions">
        <button class="btn secondary" data-view="${postId}"><i class="fa-solid fa-eye"></i> View</button>
      </div>
    </div>
  `;
}

function renderPostsGrid() {
  const grid = $("posts-grid");
  const empty = $("posts-empty");
  const all = Object.entries(postsById)
    .map(([id, p]) => ({ id, p }))
    .filter(x => (x.p?.category || "unverified") === currentCategory)
    .sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));

  if (all.length === 0) {
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = all.map(x => makePostCard(x.id, x.p)).join("");
  grid.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view")));
  });
}

function renderYourPosts() {
  const grid = $("your-posts-grid");
  const empty = $("your-posts-empty");
  const all = Object.entries(postsById)
    .map(([id, p]) => ({ id, p }))
    .filter(x => x.p?.createdBy === clientId)
    .sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));

  if (all.length === 0) {
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = all.map(x => makePostCard(x.id, x.p)).join("");
  grid.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view")));
  });
}

// ===== Admin rendering =====
function renderReportsAdmin() {
  const grid = $("reports-grid");
  const empty = $("reports-empty");

  const items = Object.entries(reportCountsByPost)
    .map(([postId, count]) => ({ postId, count }))
    .filter(x => x.count > 0 && postsById[x.postId])
    .sort((a, b) => b.count - a.count);

  if (items.length === 0) {
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items.map(({ postId, count }) => {
    const p = postsById[postId];
    return `
      <div class="card">
        <div class="card-title">${safeText(p.title || "Untitled")}</div>
        <div class="card-meta">
          <span class="badge"><i class="fa-solid fa-user"></i> ${safeText(p.username || "Unknown")}</span>
          <span class="badge requested"><i class="fa-solid fa-flag"></i> reports: ${count}</span>
          ${postBadge(p.category)}
        </div>
        <div class="card-actions">
          <button class="btn secondary" data-view="${postId}"><i class="fa-solid fa-eye"></i> View</button>
          <button class="btn danger" data-dismiss="${postId}"><i class="fa-solid fa-broom"></i> Dismiss</button>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view")));
  });
  grid.querySelectorAll("[data-dismiss]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-dismiss");
      if (!id) return;
      if (!confirm("Dismiss all reports for this post?")) return;
      try {
        await remove(ref(db, `reports/${id}`));
        toast("success", "Dismissed", "Reports cleared.");
      } catch (e) {
        console.error(e);
        toast("danger", "Error", "Could not dismiss reports.");
      }
    });
  });
}

function renderRequestsAdmin() {
  const grid = $("requests-grid");
  const empty = $("requests-empty");

  const items = Object.entries(postsById)
    .map(([id, p]) => ({ id, p }))
    .filter(x => (x.p?.category || "") === "requested")
    .sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));

  if (items.length === 0) {
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items.map(({ id, p }) => {
    return `
      <div class="card">
        <div class="card-title">${safeText(p.title || "Untitled")}</div>
        <div class="card-meta">
          <span class="badge"><i class="fa-solid fa-user"></i> ${safeText(p.username || "Unknown")}</span>
          <span class="badge"><i class="fa-solid fa-calendar"></i> ${fmtDate(p.createdAt)}</span>
          ${postBadge(p.category)}
        </div>
        <div class="card-actions">
          <button class="btn secondary" data-view="${id}"><i class="fa-solid fa-eye"></i> View</button>
          <button class="btn danger" data-reject="${id}"><i class="fa-solid fa-xmark"></i> Reject</button>
          <button class="btn" data-verify="${id}"><i class="fa-solid fa-check"></i> Verify</button>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view")));
  });

  grid.querySelectorAll("[data-reject]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-reject");
      if (!id) return;
      if (!confirm("Reject this request? It will be moved to Unverified.")) return;
      try {
        await update(ref(db, `posts/${id}`), { category: "unverified", verifiedAt: null });
        toast("success", "Rejected", "Moved to Unverified.");
      } catch (e) {
        console.error(e);
        toast("danger", "Error", "Could not reject.");
      }
    });
  });

  grid.querySelectorAll("[data-verify]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-verify");
      if (!id) return;
      if (!confirm("Verify this post? It will be moved to Verified.")) return;
      try {
        await update(ref(db, `posts/${id}`), { category: "verified", verifiedAt: nowMs() });
        toast("success", "Verified", "Moved to Verified.");
      } catch (e) {
        console.error(e);
        toast("danger", "Error", "Could not verify.");
      }
    });
  });
}

// ===== Request flow =====
let pendingCategory = null;
let pendingMedia = []; // { name, type: 'image'|'video', mime, dataUrl, bytes }

function resetPostForm() {
  $("pf-username").value = "";
  $("pf-title").value = "";
  $("pf-description").value = "";
  $("pf-media").value = "";
  pendingMedia = [];
  renderMediaPreview();
}

function openRequestChoice() {
  openModal("modal-request-choice");
}

function openPostForm(category) {
  pendingCategory = category;
  resetPostForm();

  const title = category === "requested"
    ? "New Verified Request"
    : "New Unverified Post";

  $("post-form-title").innerHTML = `<i class="fa-solid fa-pen-to-square"></i> ${title}`;

  const hint = category === "requested"
    ? "(required)"
    : "(optional)";
  $("pf-media-hint").textContent = hint;

  openModal("modal-post-form");
}

function renderMediaPreview() {
  const wrap = $("pf-media-preview");
  if (!wrap) return;

  if (pendingMedia.length === 0) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = pendingMedia.map((m, idx) => {
    const icon = m.type === "video" ? "fa-video" : "fa-image";
    const thumb = m.type === "image"
      ? `<img src="${m.dataUrl}" alt="preview">`
      : `<i class="fa-solid fa-video"></i>`;
    const kb = Math.round((m.bytes || 0) / 1024);
    return `
      <div class="media-chip">
        <div class="media-thumb">${thumb}</div>
        <div class="media-info">
          <div class="media-name"><i class="fa-solid ${icon}"></i> ${safeText(m.name)}</div>
          <div class="media-sub">${m.mime} • ${kb} KB</div>
        </div>
        <button class="media-remove" data-remove="${idx}" title="Remove"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll("[data-remove]").forEach(b => {
    b.addEventListener("click", () => {
      const idx = Number(b.getAttribute("data-remove"));
      pendingMedia.splice(idx, 1);
      renderMediaPreview();
    });
  });
}

async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

async function onPickMedia(files) {
  const list = Array.from(files || []);
  if (list.length === 0) return;

  const totalCount = pendingMedia.length + list.length;
  if (totalCount > 5) {
    toast("warn", "Too many files", "Max 5 files total. Extra files were ignored.");
  }

  for (const f of list) {
    if (pendingMedia.length >= 5) break;

    const isVideo = (f.type || "").startsWith("video/");
    const isImage = (f.type || "").startsWith("image/");
    if (!isVideo && !isImage) continue;

    const maxBytes = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (f.size > maxBytes) {
      toast("warn", "File too large", `${f.name} exceeds the limit (${isVideo ? "10MB video" : "5MB image"}).`);
      continue;
    }

    const dataUrl = await fileToDataURL(f);

    pendingMedia.push({
      name: f.name,
      type: isVideo ? "video" : "image",
      mime: f.type,
      dataUrl,
      bytes: f.size
    });
  }

  renderMediaPreview();
}

function cooldownRemainingMs() {
  const key = "ogwxbl_lastRequestedAt";
  const last = Number(localStorage.getItem(key) || "0");
  const diff = nowMs() - last;
  const cd = 180000; // 3 minutes
  return Math.max(0, cd - diff);
}

function setCooldownNow() {
  localStorage.setItem("ogwxbl_lastRequestedAt", String(nowMs()));
}

async function submitPost() {
  const username = $("pf-username").value.trim();
  const title = $("pf-title").value.trim();
  const description = $("pf-description").value.trim();

  if (!username || username.length < 2) {
    toast("warn", "Missing username", "Enter the player's username.");
    return;
  }
  if (!title || title.length < 3) {
    toast("warn", "Missing post name", "Enter a post name.");
    return;
  }

  if (pendingCategory === "requested") {
    const rem = cooldownRemainingMs();
    if (rem > 0) {
      const sec = Math.ceil(rem / 1000);
      toast("warn", "Cooldown", `Wait ${sec}s before posting another verification request.`);
      return;
    }
    if (pendingMedia.length === 0) {
      toast("warn", "Proof required", "For Verified (Requested), you must upload at least one screenshot/video.");
      return;
    }
  }

  // Build media object with numeric keys (rules-friendly)
  const media = {};
  pendingMedia.forEach((m, idx) => {
    media[String(idx)] = {
      type: m.type,
      mime: m.mime,
      bytes: m.bytes,
      data: m.dataUrl // data:*/*;base64,...
    };
  });

  const post = {
    username,
    title,
    description: description || "",
    category: pendingCategory,
    createdAt: nowMs(),
    verifiedAt: null,
    createdBy: clientId,
    media: Object.keys(media).length ? media : null
  };

  try {
    const newRef = push(postsRef);
    await set(newRef, post);

    if (pendingCategory === "requested") setCooldownNow();

    closeModal("modal-post-form");
    closeModal("modal-request-choice");
    toast("success", "Posted", pendingCategory === "requested"
      ? "Sent to Requested for verification."
      : "Sent to Unverified.");

    // Jump to relevant blacklist category
    showTab("blacklist");
    setCategory(pendingCategory);

  } catch (e) {
    console.error(e);
    toast("danger", "Error", "Failed to post. Check Firebase rules/connection.");
  }
}

// ===== View post =====
let currentViewPostId = null;
let currentViewVote = 0;
let currentViewReportSent = false;

function clearViewListeners() {
  if (viewVoteListenerRef) {
    off(viewVoteListenerRef);
    viewVoteListenerRef = null;
  }
  if (viewReportListenerRef) {
    off(viewReportListenerRef);
    viewReportListenerRef = null;
  }
}

function setVoteButtonsState() {
  const likeBtn = $("vp-like");
  const dislikeBtn = $("vp-dislike");
  likeBtn.classList.toggle("active", currentViewVote === 1);
  dislikeBtn.classList.toggle("active", currentViewVote === -1);

  const reportBtn = $("vp-report");
  reportBtn.disabled = currentViewReportSent;
  reportBtn.title = currentViewReportSent ? "Already reported" : "Report";
}

function renderMediaGallery(p) {
  const wrap = $("vp-media");
  const mediaObj = p.media || {};
  const items = Object.keys(mediaObj || {})
    .sort((a, b) => Number(a) - Number(b))
    .map(k => mediaObj[k])
    .filter(Boolean);

  if (items.length === 0) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = items.map(m => {
    if (m.type === "video") {
      return `<div class="media-item"><video controls src="${m.data}"></video></div>`;
    }
    return `<div class="media-item"><img src="${m.data}" alt="screenshot"></div>`;
  }).join("");
}

async function openViewPost(postId) {
  const p = postsById[postId];
  if (!p) {
    toast("warn", "Not found", "This post no longer exists.");
    return;
  }
  currentViewPostId = postId;
  currentViewVote = 0;
  currentViewReportSent = false;

  $("vp-title").textContent = safeText(p.title || "Untitled");
  $("vp-username").textContent = safeText(p.username || "Unknown");
  $("vp-created").textContent = fmtDate(p.createdAt);
  $("vp-category").textContent = safeText(p.category || "unverified");
  $("vp-description").textContent = p.description ? safeText(p.description) : "—";

  const verifiedChip = $("vp-verified-chip");
  if (p.verifiedAt) {
    verifiedChip.classList.remove("hidden");
    $("vp-verified").textContent = fmtDate(p.verifiedAt);
  } else {
    verifiedChip.classList.add("hidden");
    $("vp-verified").textContent = "—";
  }

  // Delete button only in admin mode
  $("vp-delete").classList.toggle("hidden", !adminMode);

  renderMediaGallery(p);
  $("vp-vote-hint").textContent = "You can like/dislike (one choice) and undo anytime. Reporting is limited to once per post.";

  // Attach live listeners for vote + report + counts
  clearViewListeners();

  // votes/{postId} (counts)
  const votesRef = ref(db, `votes/${postId}`);
  viewVoteListenerRef = votesRef;
  onValue(votesRef, (snap) => {
    let likes = 0, dislikes = 0;
    let myVote = 0;
    snap.forEach(childSnap => {
      const v = childSnap.val();
      if (v === 1) likes++;
      if (v === -1) dislikes++;
      if (childSnap.key === clientId) myVote = v;
    });
    $("vp-like-count").textContent = String(likes);
    $("vp-dislike-count").textContent = String(dislikes);
    currentViewVote = myVote || 0;
    setVoteButtonsState();
  });

  // reports/{postId}/{clientId}
  const myReportRef = ref(db, `reports/${postId}/${clientId}`);
  viewReportListenerRef = myReportRef;
  onValue(myReportRef, (snap) => {
    currentViewReportSent = snap.exists();
    setVoteButtonsState();
  });

  openModal("modal-view-post");
}

async function toggleVote(value) {
  if (!currentViewPostId) return;
  const myVoteRef = ref(db, `votes/${currentViewPostId}/${clientId}`);
  try {
    if (currentViewVote === value) {
      await remove(myVoteRef);
      toast("success", "Vote removed", "Your vote was removed.");
    } else {
      await set(myVoteRef, value);
      toast("success", "Vote saved", value === 1 ? "Liked." : "Disliked.");
    }
  } catch (e) {
    console.error(e);
    toast("danger", "Error", "Could not update your vote.");
  }
}

async function sendReport() {
  if (!currentViewPostId) return;
  if (currentViewReportSent) {
    toast("warn", "Already reported", "You already reported this post.");
    return;
  }
  if (!confirm("Send a report for this post? You can only report once.")) return;

  const rRef = ref(db, `reports/${currentViewPostId}/${clientId}`);
  try {
    await set(rRef, { at: nowMs() });
    toast("success", "Report sent", "Thanks for helping keep it clean.");
  } catch (e) {
    console.error(e);
    toast("danger", "Error", "Could not send report.");
  }
}

async function deleteCurrentPost() {
  if (!adminMode) return;
  if (!currentViewPostId) return;
  if (!confirm("Delete this post? This will also remove votes and reports.")) return;

  const id = currentViewPostId;
  try {
    await remove(ref(db, `posts/${id}`));
    await remove(ref(db, `votes/${id}`));
    await remove(ref(db, `reports/${id}`));
    toast("success", "Deleted", "Post removed.");
    closeModal("modal-view-post");
  } catch (e) {
    console.error(e);
    toast("danger", "Error", "Could not delete post.");
  }
}

// ===== Admin mode =====
function applyAdminUi() {
  $("admin-shield").classList.toggle("admin", adminMode);
  $("nav-admin-reports").classList.toggle("hidden", !adminMode);
  $("nav-admin-requests").classList.toggle("hidden", !adminMode);
  $("admin-divider").classList.toggle("hidden", !adminMode);
}

function openAdminLogin() {
  $("ad-pass").value = "";
  $("ad-token").value = "";
  openModal("modal-admin-login");
}

function adminLogout() {
  adminMode = false;
  localStorage.removeItem("ogwxbl_admin");
  applyAdminUi();
  // If user is in admin tabs, bounce back
  if (currentTab.startsWith("admin")) showTab("blacklist");
  toast("success", "Logged out", "Admin mode disabled.");
}

function adminLogin() {
  const pass = $("ad-pass").value.trim();
  const tok = $("ad-token").value.trim();

  if (pass === ADMIN_PASSWORD && tok === ADMIN_TOKEN) {
    adminMode = true;
    localStorage.setItem("ogwxbl_admin", "1");
    closeModal("modal-admin-login");
    applyAdminUi();
    toast("success", "Admin mode", "Enabled.");
  } else {
    toast("danger", "Denied", "Wrong password or token.");
  }
}

// ===== Realtime listeners =====
onValue(postsRef, (snap) => {
  const out = {};
  snap.forEach(childSnap => {
    const v = childSnap.val();
    out[childSnap.key] = v;
  });
  postsById = out;

  // Re-render active tab
  if (currentTab === "blacklist") renderPostsGrid();
  if (currentTab === "yours") renderYourPosts();
  if (currentTab === "admin-requests") renderRequestsAdmin();
  if (currentTab === "admin-reports") renderReportsAdmin();
});

onValue(reportsRootRef, (snap) => {
  const counts = {};
  snap.forEach(postSnap => {
    let c = 0;
    postSnap.forEach(_ => c++);
    counts[postSnap.key] = c;
  });
  reportCountsByPost = counts;

  if (currentTab === "admin-reports") renderReportsAdmin();
});

// ===== Wire UI =====
document.addEventListener("DOMContentLoaded", () => {
  $("year").textContent = String(new Date().getFullYear());
  $("client-id-short").textContent = clientId.slice(0, 8);

  setupModalClose();
  applyAdminUi();

  // Nav tabs
  document.querySelectorAll(".nav-btn[data-tab]").forEach(b => {
    b.addEventListener("click", () => showTab(b.getAttribute("data-tab")));
  });

  // Request button
  $("nav-request").addEventListener("click", openRequestChoice);

  // Request choice buttons
  $("choice-unverified").addEventListener("click", () => {
    closeModal("modal-request-choice");
    openPostForm("unverified");
  });
  $("choice-requested").addEventListener("click", () => {
    closeModal("modal-request-choice");
    openPostForm("requested");
  });

  // Category subtabs
  document.querySelectorAll(".subtab").forEach(b => {
    b.addEventListener("click", () => setCategory(b.getAttribute("data-category")));
  });

  // Post form media picker
  $("pf-media").addEventListener("change", async (e) => {
    try {
      await onPickMedia(e.target.files);
    } catch (err) {
      console.error(err);
      toast("danger", "Error", "Failed to read file(s).");
    } finally {
      // allow re-picking same file
      e.target.value = "";
    }
  });

  // Submit post
  $("pf-submit").addEventListener("click", submitPost);

  // View post buttons
  $("vp-like").addEventListener("click", () => toggleVote(1));
  $("vp-dislike").addEventListener("click", () => toggleVote(-1));
  $("vp-report").addEventListener("click", sendReport);
  $("vp-delete").addEventListener("click", deleteCurrentPost);

  // When closing view modal, remove listeners
  $("modal-view-post").addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.getAttribute("data-close") === "1") {
      clearViewListeners();
      currentViewPostId = null;
    }
  });

  // Admin shield
  $("admin-shield").addEventListener("click", () => {
    if (adminMode) {
      if (!confirm("Log out of admin mode?")) return;
      adminLogout();
    } else {
      openAdminLogin();
    }
  });

  $("ad-login").addEventListener("click", adminLogin);

  // Start on blacklist
  showTab("blacklist");
  setCategory("verified");
});
