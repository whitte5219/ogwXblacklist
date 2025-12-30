// ogwXblacklist - Full client app (Firebase Realtime Database)
// NOTE: Admin mode here is client-side only (not secure). Protect admin actions with Firebase Auth/claims for real security.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, off
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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

const $ = (id) => document.getElementById(id);
const nowMs = () => Date.now();
const fmtDate = (ms) => {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
};

function safeText(s){ return (s == null) ? "" : String(s); }

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

// ===== State =====
let currentTab = "blacklist";
let currentCategory = "verified";
let adminMode = localStorage.getItem("ogwxbl_admin") === "1";

let postsById = {};          // { postId: postObj }
let reportCountsByPost = {}; // { postId: count }

let pendingCategory = null;
let pendingMedia = []; // { name, type, mime, dataUrl, bytes }

// View modal
let currentViewPostId = null;
let currentViewVote = 0;
let currentViewReportSent = false;
let viewVoteListenerRef = null;
let viewReportListenerRef = null;

// ===== Toast =====
function toast(type, title, msg, ttl = 3200){
  const wrap = $("toast-wrap");
  const el = document.createElement("div");
  el.className = `toast ${type || ""}`.trim();
  const ico = type === "success" ? '<i class="fa-solid fa-circle-check"></i>' :
              type === "danger" ? '<i class="fa-solid fa-circle-xmark"></i>' :
              type === "warn" ? '<i class="fa-solid fa-triangle-exclamation"></i>' :
              '<i class="fa-solid fa-circle-info"></i>';
  el.innerHTML = `
    <div class="ico">${ico}</div>
    <div>
      <div class="title">${safeText(title)}</div>
      <div class="msg">${safeText(msg)}</div>
    </div>
  `;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

// ===== Modals =====
function openModal(id){ $(id).classList.remove("hidden"); }
function closeModal(id){ $(id).classList.add("hidden"); }

function setupModalClose(){
  document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.getAttribute("data-close") === "1") m.classList.add("hidden");
    });
  });
}

// ===== Tabs =====
function setActiveNav(tab){
  document.querySelectorAll(".nav-link[data-tab]").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tab);
  });
}
function showTab(tab){
  currentTab = tab;
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  const el = $("tab-" + tab);
  if (el) el.classList.add("active");
  setActiveNav(tab);

  if (tab === "blacklist") renderPostsGrid();
  if (tab === "yours") renderYourPosts();
  if (tab === "admin-reports") renderReportsAdmin();
  if (tab === "admin-requests") renderRequestsAdmin();
}

// ===== Category =====
function setCategory(cat){
  currentCategory = cat;
  document.querySelectorAll(".category-tab").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-category") === cat);
  });
  renderPostsGrid();
}

// ===== Admin UI =====
function applyAdminUi(){
  $("admin-shield").classList.toggle("admin", adminMode);
  document.querySelectorAll(".admin-only").forEach(li => li.classList.toggle("hidden", !adminMode));
  // delete button controlled per modal open
}
function openAdminLogin(){
  $("ad-pass").value = "";
  $("ad-token").value = "";
  openModal("modal-admin-login");
}
function adminLogout(){
  adminMode = false;
  localStorage.removeItem("ogwxbl_admin");
  applyAdminUi();
  if (currentTab.startsWith("admin")) showTab("blacklist");
  toast("success", "Logged out", "Admin mode disabled.");
}
function adminLogin(){
  const pass = $("ad-pass").value.trim();
  const tok = $("ad-token").value.trim();
  if (pass === ADMIN_PASSWORD && tok === ADMIN_TOKEN){
    adminMode = true;
    localStorage.setItem("ogwxbl_admin", "1");
    closeModal("modal-admin-login");
    applyAdminUi();
    toast("success", "Admin mode", "Enabled.");
  } else {
    toast("danger", "Denied", "Wrong password or token.");
  }
}

// ===== Cards =====
function categoryBadge(category){
  const c = category || "unverified";
  const icon = c === "verified" ? "fa-check" : c === "requested" ? "fa-user-check" : "fa-circle-question";
  return `<span class="badge ${c}"><i class="fa-solid ${icon}"></i> ${c}</span>`;
}
function declinedBadge(p){
  return p?.declined ? `<span class="badge declined"><i class="fa-solid fa-xmark"></i> declined</span>` : "";
}
function makePostCard(postId, p, extra = ""){
  const title = safeText(p.title || "Untitled");
  const username = safeText(p.username || "Unknown");
  const created = fmtDate(p.createdAt);
  const verified = p.verifiedAt ? fmtDate(p.verifiedAt) : null;

  return `
    <div class="card">
      <div class="post-title">${title}</div>
      <div class="post-meta">
        <span class="badge"><i class="fa-solid fa-user"></i> ${username}</span>
        <span class="badge"><i class="fa-solid fa-calendar"></i> ${created}</span>
        ${categoryBadge(p.category)}
        ${declinedBadge(p)}
        ${verified ? `<span class="badge verified"><i class="fa-solid fa-check"></i> verified: ${verified}</span>` : ""}
        ${extra}
      </div>
      <button class="btn btn-secondary" data-view="${postId}"><i class="fa-solid fa-eye"></i> View</button>
    </div>
  `;
}

// ===== Render grids =====
function renderPostsGrid(){
  const grid = $("posts-grid");
  const empty = $("posts-empty");

  const items = Object.entries(postsById)
    .map(([id,p]) => ({id,p}))
    .filter(x => (x.p?.category || "unverified") === currentCategory)
    .sort((a,b) => (b.p.createdAt||0) - (a.p.createdAt||0));

  if (items.length === 0){
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items.map(x => makePostCard(x.id, x.p)).join("");
  grid.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view"))));
}

function renderYourPosts(){
  const grid = $("your-posts-grid");
  const empty = $("your-posts-empty");

  const items = Object.entries(postsById)
    .map(([id,p]) => ({id,p}))
    .filter(x => x.p?.createdBy === clientId)
    .sort((a,b) => (b.p.createdAt||0) - (a.p.createdAt||0));

  if (items.length === 0){
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items.map(x => makePostCard(x.id, x.p)).join("");
  grid.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view"))));
}

function renderReportsAdmin(){
  const grid = $("reports-grid");
  const empty = $("reports-empty");

  const items = Object.entries(reportCountsByPost)
    .map(([postId,count]) => ({postId, count}))
    .filter(x => x.count > 0 && postsById[x.postId])
    .sort((a,b) => b.count - a.count);

  if (items.length === 0){
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items.map(({postId, count}) => {
    const p = postsById[postId];
    const extra = `<span class="badge reports"><i class="fa-solid fa-flag"></i> reports: ${count}</span>`;
    return `
      <div class="card">
        ${makePostCard(postId, p, extra)}
        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn btn-secondary" data-view="${postId}"><i class="fa-solid fa-eye"></i> View</button>
          <button class="btn btn-danger" data-dismiss="${postId}"><i class="fa-solid fa-broom"></i> Dismiss</button>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view"))));
  grid.querySelectorAll("[data-dismiss]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-dismiss");
      if (!id) return;
      if (!confirm("Dismiss all reports for this post?")) return;
      try{
        await remove(ref(db, `reports/${id}`));
        toast("success", "Dismissed", "Reports cleared.");
      }catch(e){
        console.error(e);
        toast("danger", "Error", "Could not dismiss reports.");
      }
    });
  });
}

function renderRequestsAdmin(){
  const grid = $("requests-grid");
  const empty = $("requests-empty");

  const items = Object.entries(postsById)
    .map(([id,p]) => ({id,p}))
    .filter(x => (x.p?.category || "") === "requested")
    .sort((a,b) => (b.p.createdAt||0) - (a.p.createdAt||0));

  if (items.length === 0){
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items.map(({id,p}) => {
    return `
      <div class="card">
        <div class="post-title">${safeText(p.title || "Untitled")}</div>
        <div class="post-meta">
          <span class="badge"><i class="fa-solid fa-user"></i> ${safeText(p.username || "Unknown")}</span>
          <span class="badge"><i class="fa-solid fa-calendar"></i> ${fmtDate(p.createdAt)}</span>
          ${categoryBadge(p.category)}
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn btn-secondary" data-view="${id}"><i class="fa-solid fa-eye"></i> View</button>
          <button class="btn btn-danger" data-reject="${id}"><i class="fa-solid fa-xmark"></i> Reject</button>
          <button class="btn" data-verify="${id}"><i class="fa-solid fa-check"></i> Verify</button>
        </div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => openViewPost(btn.getAttribute("data-view"))));

  grid.querySelectorAll("[data-reject]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-reject");
      if (!id) return;
      if (!confirm("Reject this request? It will be moved to Unverified and marked Declined.")) return;
      try{
        await update(ref(db, `posts/${id}`), {
          category: "unverified",
          verifiedAt: null,
          declined: true,
          declinedAt: nowMs()
        });
        toast("success", "Rejected", "Moved to Unverified (Declined).");
      }catch(e){
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
      try{
        await update(ref(db, `posts/${id}`), {
          category: "verified",
          verifiedAt: nowMs(),
          declined: false,
          declinedAt: null
        });
        toast("success", "Verified", "Moved to Verified.");
      }catch(e){
        console.error(e);
        toast("danger", "Error", "Could not verify.");
      }
    });
  });
}

// ===== Request flow =====
function openRequestChoice(){ openModal("modal-request-choice"); }

function resetPostForm(){
  $("pf-username").value = "";
  $("pf-title").value = "";
  $("pf-description").value = "";
  $("pf-media").value = "";
  pendingMedia = [];
  renderMediaPreview();
}

function openPostForm(category){
  pendingCategory = category;
  resetPostForm();

  $("post-form-title").innerHTML = category === "requested"
    ? `<i class="fa-solid fa-user-check"></i> New Verified Request`
    : `<i class="fa-solid fa-circle-question"></i> New Unverified Post`;

  $("pf-media-hint").textContent = category === "requested" ? "(required)" : "(optional)";
  openModal("modal-post-form");
}

async function fileToDataURL(file){
  return new Promise((resolve,reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

async function onPickMedia(files){
  const list = Array.from(files || []);
  if (list.length === 0) return;

  const totalCount = pendingMedia.length + list.length;
  if (totalCount > 5){
    toast("warn", "Too many files", "Max 5 files total. Extra files were ignored.");
  }

  for (const f of list){
    if (pendingMedia.length >= 5) break;

    const isVideo = (f.type || "").startsWith("video/");
    const isImage = (f.type || "").startsWith("image/");
    if (!isVideo && !isImage) continue;

    const maxBytes = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (f.size > maxBytes){
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

function renderMediaPreview(){
  const wrap = $("pf-media-preview");
  if (!wrap) return;
  if (pendingMedia.length === 0){ wrap.innerHTML = ""; return; }

  wrap.innerHTML = pendingMedia.map((m, idx) => {
    const thumb = m.type === "image" ? `<img src="${m.dataUrl}" alt="preview">` : `<i class="fa-solid fa-video"></i>`;
    const kb = Math.round((m.bytes || 0) / 1024);
    return `
      <div class="media-chip">
        <div class="media-thumb">${thumb}</div>
        <div class="media-info">
          <div class="media-name">${safeText(m.name)}</div>
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

function cooldownRemainingMs(){
  const key = "ogwxbl_lastRequestedAt";
  const last = Number(localStorage.getItem(key) || "0");
  const diff = nowMs() - last;
  const cd = 180000; // 3 minutes
  return Math.max(0, cd - diff);
}
function setCooldownNow(){ localStorage.setItem("ogwxbl_lastRequestedAt", String(nowMs())); }

async function submitPost(){
  const username = $("pf-username").value.trim();
  const title = $("pf-title").value.trim();
  const description = $("pf-description").value.trim();

  if (!username || username.length < 2){
    toast("warn", "Missing username", "Enter the player's username.");
    return;
  }
  if (!title || title.length < 3){
    toast("warn", "Missing post name", "Enter a post name.");
    return;
  }

  if (pendingCategory === "requested"){
    const rem = cooldownRemainingMs();
    if (rem > 0){
      toast("warn", "Cooldown", `Wait ${Math.ceil(rem/1000)}s before posting another verification request.`);
      return;
    }
    if (pendingMedia.length === 0){
      toast("warn", "Proof required", "For Verified (Requested), you must upload at least one screenshot/video.");
      return;
    }
  }

  // media as object with numeric keys
  const media = {};
  pendingMedia.forEach((m, idx) => {
    media[String(idx)] = { type: m.type, mime: m.mime, bytes: m.bytes, data: m.dataUrl };
  });

  const post = {
    username,
    title,
    description: description || "",
    category: pendingCategory,
    createdAt: nowMs(),
    verifiedAt: null,
    declined: false,
    declinedAt: null,
    createdBy: clientId,
    media: Object.keys(media).length ? media : null
  };

  try{
    const newRef = push(ref(db, "posts"));
    await set(newRef, post);

    if (pendingCategory === "requested") setCooldownNow();

    closeModal("modal-post-form");
    closeModal("modal-request-choice");
    toast("success", "Posted", pendingCategory === "requested" ? "Sent to Requested for verification." : "Sent to Unverified.");

    showTab("blacklist");
    setCategory(pendingCategory);

  }catch(e){
    console.error(e);
    toast("danger", "Error", "Failed to post. Check Firebase rules/connection.");
  }
}

// ===== View post =====
function clearViewListeners(){
  if (viewVoteListenerRef){ off(viewVoteListenerRef); viewVoteListenerRef = null; }
  if (viewReportListenerRef){ off(viewReportListenerRef); viewReportListenerRef = null; }
}

function setVoteButtonsState(){
  $("vp-like").classList.toggle("active", currentViewVote === 1);
  $("vp-dislike").classList.toggle("active", currentViewVote === -1);
  $("vp-report").disabled = currentViewReportSent;
  $("vp-report").title = currentViewReportSent ? "Already reported" : "Report";
}

function renderMediaGallery(p){
  const wrap = $("vp-media");
  const mediaObj = p.media || {};
  const items = Object.keys(mediaObj || {}).sort((a,b) => Number(a)-Number(b)).map(k => mediaObj[k]).filter(Boolean);

  if (items.length === 0){ wrap.innerHTML = ""; return; }

  wrap.innerHTML = items.map(m => {
    if (m.type === "video") return `<div class="media-item"><video controls src="${m.data}"></video></div>`;
    return `<div class="media-item"><img src="${m.data}" alt="screenshot"></div>`;
  }).join("");
}

async function openViewPost(postId){
  const p = postsById[postId];
  if (!p){ toast("warn", "Not found", "This post no longer exists."); return; }

  currentViewPostId = postId;
  currentViewVote = 0;
  currentViewReportSent = false;

  $("vp-title").textContent = safeText(p.title || "Untitled");
  $("vp-username").textContent = safeText(p.username || "Unknown");
  $("vp-created").textContent = fmtDate(p.createdAt);
  $("vp-category").textContent = safeText(p.category || "unverified");
  $("vp-description").textContent = p.description ? safeText(p.description) : "—";

  // category chip
  $("vp-category-chip").className = "chip";
  $("vp-category-chip").id = "vp-category-chip";

  // verified chip
  const vchip = $("vp-verified-chip");
  if (p.verifiedAt){
    vchip.classList.remove("hidden");
    $("vp-verified").textContent = fmtDate(p.verifiedAt);
  } else {
    vchip.classList.add("hidden");
    $("vp-verified").textContent = "—";
  }

  // declined chip
  $("vp-declined-chip").classList.toggle("hidden", !p.declined);

  // delete button
  $("vp-delete").classList.toggle("hidden", !adminMode);

  renderMediaGallery(p);
  $("vp-vote-hint").textContent = "You can like/dislike (one choice) and undo anytime. Reporting is limited to once per post.";

  clearViewListeners();

  // votes/{postId}
  const votesRef = ref(db, `votes/${postId}`);
  viewVoteListenerRef = votesRef;
  onValue(votesRef, (snap) => {
    let likes = 0, dislikes = 0, myVote = 0;
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

async function toggleVote(value){
  if (!currentViewPostId) return;
  const myVoteRef = ref(db, `votes/${currentViewPostId}/${clientId}`);
  try{
    if (currentViewVote === value){
      await remove(myVoteRef);
      toast("success", "Vote removed", "Your vote was removed.");
    } else {
      await set(myVoteRef, value);
      toast("success", "Vote saved", value === 1 ? "Liked." : "Disliked.");
    }
  }catch(e){
    console.error(e);
    toast("danger", "Error", "Could not update your vote.");
  }
}

async function sendReport(){
  if (!currentViewPostId) return;
  if (currentViewReportSent){
    toast("warn", "Already reported", "You already reported this post.");
    return;
  }
  if (!confirm("Send a report for this post? You can only report once.")) return;

  try{
    await set(ref(db, `reports/${currentViewPostId}/${clientId}`), { at: nowMs() });
    toast("success", "Report sent", "Report sent.");
  }catch(e){
    console.error(e);
    toast("danger", "Error", "Could not send report.");
  }
}

async function deleteCurrentPost(){
  if (!adminMode || !currentViewPostId) return;
  if (!confirm("Delete this post? This will also remove votes and reports.")) return;

  const id = currentViewPostId;
  try{
    await remove(ref(db, `posts/${id}`));
    await remove(ref(db, `votes/${id}`));
    await remove(ref(db, `reports/${id}`));
    toast("success", "Deleted", "Post removed.");
    closeModal("modal-view-post");
  }catch(e){
    console.error(e);
    toast("danger", "Error", "Could not delete post.");
  }
}

// ===== Realtime listeners =====
onValue(ref(db, "posts"), (snap) => {
  const out = {};
  snap.forEach(childSnap => out[childSnap.key] = childSnap.val());
  postsById = out;

  if (currentTab === "blacklist") renderPostsGrid();
  if (currentTab === "yours") renderYourPosts();
  if (currentTab === "admin-requests") renderRequestsAdmin();
  if (currentTab === "admin-reports") renderReportsAdmin();
});

onValue(ref(db, "reports"), (snap) => {
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
  document.querySelectorAll(".nav-link[data-tab]").forEach(b => {
    b.addEventListener("click", () => showTab(b.getAttribute("data-tab")));
  });

  // Request button
  $("nav-request").addEventListener("click", openRequestChoice);

  // Choice buttons
  $("choice-unverified").addEventListener("click", () => {
    closeModal("modal-request-choice");
    openPostForm("unverified");
  });
  $("choice-requested").addEventListener("click", () => {
    closeModal("modal-request-choice");
    openPostForm("requested");
  });

  // Category tabs
  document.querySelectorAll(".category-tab").forEach(b => {
    b.addEventListener("click", () => setCategory(b.getAttribute("data-category")));
  });

  // Media pick
  $("pf-media").addEventListener("change", async (e) => {
    try{
      await onPickMedia(e.target.files);
    }catch(err){
      console.error(err);
      toast("danger", "Error", "Failed to read file(s).");
    }finally{
      e.target.value = "";
    }
  });

  // Post submit
  $("pf-submit").addEventListener("click", submitPost);

  // View buttons
  $("vp-like").addEventListener("click", () => toggleVote(1));
  $("vp-dislike").addEventListener("click", () => toggleVote(-1));
  $("vp-report").addEventListener("click", sendReport);
  $("vp-delete").addEventListener("click", deleteCurrentPost);

  // When closing view modal, remove listeners
  $("modal-view-post").addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.getAttribute("data-close") === "1"){
      clearViewListeners();
      currentViewPostId = null;
    }
  });

  // Admin shield
  $("admin-shield").addEventListener("click", () => {
    if (adminMode){
      if (!confirm("Log out of admin mode?")) return;
      adminLogout();
    }else{
      openAdminLogin();
    }
  });
  $("ad-login").addEventListener("click", adminLogin);

  // Start state
  showTab("blacklist");
  setCategory("verified");
});
