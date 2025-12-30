// OGW Xblacklist - static client + Firebase Realtime Database (v9 modular)
// No accounts: per-device anonId stored in localStorage.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, push, set, update, remove, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

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

const IMAGE_LIMIT = 5 * 1024 * 1024; // 5MB
const VIDEO_LIMIT = 10 * 1024 * 1024; // 10MB
const VERIFIED_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const els = {
  year: document.getElementById("year"),
  mainTabs: document.getElementById("mainTabs"),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  requestBtn: document.getElementById("requestBtn"),
  adminShieldBtn: document.getElementById("adminShieldBtn"),

  blacklistSegment: document.getElementById("blacklistSegment"),
  searchInput: document.getElementById("searchInput"),

  postsPillars: document.getElementById("postsPillars"),
  emptyState: document.getElementById("emptyState"),

  yourPostsPillars: document.getElementById("yourPostsPillars"),
  yourEmptyState: document.getElementById("yourEmptyState"),

  adminRequestsList: document.getElementById("adminRequestsList"),
  adminRequestsEmpty: document.getElementById("adminRequestsEmpty"),
  adminReportsList: document.getElementById("adminReportsList"),
  adminReportsEmpty: document.getElementById("adminReportsEmpty"),

  overlayRoot: document.getElementById("overlayRoot"),
};

els.year.textContent = new Date().getFullYear();

function getAnonId() {
  const k = "ogwXblacklist_anonId";
  let v = localStorage.getItem(k);
  if (!v || v.length < 10) {
    v = "anon_" + crypto.getRandomValues(new Uint32Array(4)).join("");
    localStorage.setItem(k, v);
  }
  return v;
}
const anonId = getAnonId();

let isAdmin = false;
let currentCategory = "verified";
let searchQuery = "";

let postsCache = {};
let reportsCache = {};
let reactionsCache = {};

function setActiveTab(tabId) {
  Array.from(els.mainTabs.querySelectorAll(".tab")).forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  els.tabPanels.forEach(p => p.classList.toggle("active", p.id === tabId));
}

els.mainTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

function setAdminUI(on) {
  isAdmin = on;
  els.adminShieldBtn.classList.toggle("admin-on", on);
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !on));
}

els.blacklistSegment.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  currentCategory = btn.dataset.seg;
  Array.from(els.blacklistSegment.querySelectorAll(".seg")).forEach(b => b.classList.toggle("active", b === btn));
  renderAll();
});

els.searchInput.addEventListener("input", () => {
  searchQuery = (els.searchInput.value || "").trim().toLowerCase();
  renderAll();
});

// ---------- Overlay / modal ----------
function showOverlay(innerEl) {
  els.overlayRoot.innerHTML = "";
  els.overlayRoot.classList.remove("hidden");
  els.overlayRoot.setAttribute("aria-hidden", "false");
  els.overlayRoot.appendChild(innerEl);

  els.overlayRoot.addEventListener("click", (ev) => {
    if (ev.target === els.overlayRoot) hideOverlay();
  }, { once: true });
}
function hideOverlay() {
  els.overlayRoot.classList.add("hidden");
  els.overlayRoot.setAttribute("aria-hidden", "true");
  els.overlayRoot.innerHTML = "";
}

function modalShell(titleText) {
  const modal = document.createElement("div");
  modal.className = "modal";

  const header = document.createElement("div");
  header.className = "modal-header";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = titleText;

  const close = document.createElement("button");
  close.className = "modal-close";
  close.textContent = "✕";
  close.addEventListener("click", hideOverlay);

  header.appendChild(title);
  header.appendChild(close);

  const body = document.createElement("div");
  body.className = "modal-body";

  modal.appendChild(header);
  modal.appendChild(body);

  return { modal, body };
}

function toastModal(message, sub = "") {
  const { modal, body } = modalShell(message);
  if (sub) {
    const p = document.createElement("div");
    p.className = "muted";
    p.style.marginTop = "8px";
    p.textContent = sub;
    body.appendChild(p);
  }
  const actions = document.createElement("div");
  actions.className = "form-actions";
  const ok = document.createElement("button");
  ok.className = "btn primary";
  ok.textContent = "OK";
  ok.addEventListener("click", hideOverlay);
  actions.appendChild(ok);
  body.appendChild(actions);
  showOverlay(modal);
}

function confirmModal(title, message, confirmText = "Confirm", danger = false) {
  return new Promise((resolve) => {
    const { modal, body } = modalShell(title);
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = message;
    body.appendChild(p);

    const actions = document.createElement("div");
    actions.className = "form-actions";

    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { hideOverlay(); resolve(false); });

    const yes = document.createElement("button");
    yes.className = "btn " + (danger ? "danger" : "primary");
    yes.textContent = confirmText;
    yes.addEventListener("click", () => { hideOverlay(); resolve(true); });

    actions.appendChild(cancel);
    actions.appendChild(yes);
    body.appendChild(actions);

    showOverlay(modal);
  });
}

// ---------- Request flow ----------
els.requestBtn.addEventListener("click", () => openRequestChooser());

function openRequestChooser() {
  const { modal, body } = modalShell("Request");
  const row = document.createElement("div");
  row.className = "choice-row";

  const unv = document.createElement("div");
  unv.className = "choice";
  unv.innerHTML = "<h3>Post to unverified</h3><p>Quick post. Proof is optional. Appears in Unverified.</p>";
  unv.addEventListener("click", () => openPostForm("unverified"));

  const req = document.createElement("div");
  req.className = "choice";
  req.innerHTML = "<h3>Post to verified</h3><p>Requires proof. Goes to Requested (verify queue).</p>";
  req.addEventListener("click", () => openPostForm("requested"));

  row.appendChild(unv);
  row.appendChild(req);
  body.appendChild(row);

  showOverlay(modal);
}

function openPostForm(targetCategory) {
  if (targetCategory === "requested") {
    const last = Number(localStorage.getItem("ogwXblacklist_lastVerifiedPost") || "0");
    const left = (last + VERIFIED_COOLDOWN_MS) - Date.now();
    if (left > 0) {
      toastModal("Cooldown", `You can request another verified post in ${Math.ceil(left/1000)}s.`);
      return;
    }
  }

  const titleText = targetCategory === "requested" ? "Post to verified (requested)" : "Post to unverified";
  const { modal, body } = modalShell(titleText);

  const form = document.createElement("div");
  form.className = "form-grid";

  const fUser = fieldInput("Player username", "text", "e.g. SomeRobloxUser");
  const fName = fieldInput("Post name", "text", "e.g. Exploiting in TSB");
  const fDesc = fieldTextarea("Description (optional)", "Add context (optional)...");
  const fFiles = fieldFile("Screenshots / videos", true);

  const leftCol = document.createElement("div");
  leftCol.style.display = "flex";
  leftCol.style.flexDirection = "column";
  leftCol.style.gap = "12px";
  leftCol.appendChild(fUser);
  leftCol.appendChild(fName);

  const rightCol = document.createElement("div");
  rightCol.style.display = "flex";
  rightCol.style.flexDirection = "column";
  rightCol.style.gap = "12px";
  rightCol.appendChild(fDesc);
  rightCol.appendChild(fFiles);

  form.appendChild(leftCol);
  form.appendChild(rightCol);
  body.appendChild(form);

  const mediaPreview = document.createElement("div");
  mediaPreview.className = "media-preview";
  body.appendChild(mediaPreview);

  let media = [];

  fFiles.querySelector("input").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    media = [];
    mediaPreview.innerHTML = "";

    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) continue;

      const limit = isVideo ? VIDEO_LIMIT : IMAGE_LIMIT;
      if (file.size > limit) {
        toastModal("File too large", `${file.name} exceeds ${isVideo ? "10MB" : "5MB"}.`);
        continue;
      }

      try{
        const dataUrl = await readFileAsDataURL(file);
        const item = { kind: isVideo ? "video" : "image", dataUrl, name: file.name, size: file.size };
        media.push(item);
      }catch(err){
        console.error(err);
      }
    }

    renderMediaPreview();

    function renderMediaPreview() {
      mediaPreview.innerHTML = "";
      for (const item of media) {
        const chip = mediaChip(item, () => {
          media = media.filter(m => m !== item);
          renderMediaPreview();
        });
        mediaPreview.appendChild(chip);
      }
    }
  });

  const note = document.createElement("div");
  note.className = "muted";
  note.style.marginTop = "8px";
  note.textContent = targetCategory === "requested"
    ? "Proof is required: include a profile screenshot/video + evidence."
    : "Proof is optional for unverified posts.";
  body.appendChild(note);

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", hideOverlay);

  const postBtn = document.createElement("button");
  postBtn.className = "btn primary";
  postBtn.textContent = "Post";

  postBtn.addEventListener("click", async () => {
    const username = (fUser.querySelector("input").value || "").trim();
    const postName = (fName.querySelector("input").value || "").trim();
    const desc = (fDesc.querySelector("textarea").value || "").trim();

    if (!username || !postName) return toastModal("Missing fields", "Username and post name are required.");
    if (targetCategory === "requested" && media.length === 0) return toastModal("Proof required", "Attach at least one screenshot/video.");

    postBtn.disabled = true;
    postBtn.textContent = "Posting...";

    try {
      const now = Date.now();
      const newRef = push(ref(db, "posts"));
      await set(newRef, {
        title: postName,
        username,
        description: desc || "",
        category: targetCategory,
        createdAt: now,
        verifiedAt: null,
        authorId: anonId,
        deleted: false,
        media: media.map(m => ({ kind: m.kind, dataUrl: m.dataUrl, name: m.name, size: m.size })),
        likes: 0,
        dislikes: 0,
        reports: 0
      });

      if (targetCategory === "requested") localStorage.setItem("ogwXblacklist_lastVerifiedPost", String(now));

      hideOverlay();
      toastModal("Posted", targetCategory === "requested" ? "Sent to Requests." : "Posted to Unverified.");
    } catch (err) {
      console.error(err);
      toastModal("Error", "Could not post. Check console and Firebase rules.");
    } finally {
      postBtn.disabled = false;
      postBtn.textContent = "Post";
    }
  });

  actions.appendChild(cancel);
  actions.appendChild(postBtn);
  body.appendChild(actions);

  showOverlay(modal);
}

function fieldInput(label, type, placeholder = "") {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const i = document.createElement("input");
  i.type = type;
  i.placeholder = placeholder;
  wrap.appendChild(l);
  wrap.appendChild(i);
  return wrap;
}
function fieldTextarea(label, placeholder = "") {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const t = document.createElement("textarea");
  t.placeholder = placeholder;
  wrap.appendChild(l);
  wrap.appendChild(t);
  return wrap;
}
function fieldFile(label, multiple) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const i = document.createElement("input");
  i.type = "file";
  i.accept = "image/*,video/*";
  i.multiple = !!multiple;
  wrap.appendChild(l);
  wrap.appendChild(i);
  return wrap;
}

function mediaChip(item, onRemove) {
  const chip = document.createElement("div");
  chip.className = "media-chip";

  if (item.kind === "image") {
    const img = document.createElement("img");
    img.src = item.dataUrl;
    chip.appendChild(img);
  } else {
    const vid = document.createElement("video");
    vid.src = item.dataUrl;
    vid.controls = true;
    chip.appendChild(vid);
  }

  const small = document.createElement("small");
  small.textContent = item.name;

  const rm = document.createElement("button");
  rm.className = "remove";
  rm.textContent = "Remove";
  rm.addEventListener("click", onRemove);

  chip.appendChild(small);
  chip.appendChild(rm);
  return chip;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// ---------- Admin mode ----------
els.adminShieldBtn.addEventListener("click", () => {
  if (isAdmin) {
    setAdminUI(false);
    toastModal("Admin mode", "Logged out.");
    const active = els.mainTabs.querySelector(".tab.active");
    if (active && active.classList.contains("admin-only")) setActiveTab("blacklistTab");
    return;
  }
  openAdminLogin();
});

function openAdminLogin() {
  const { modal, body } = modalShell("Admin login");

  const grid = document.createElement("div");
  grid.className = "form-grid";

  const fPass = fieldInput("Password", "password", "Enter password");
  const fTok = fieldTextarea("Token", "Paste token");
  fTok.querySelector("textarea").style.minHeight = "120px";

  grid.appendChild(fPass);
  grid.appendChild(fTok);
  body.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", hideOverlay);

  const login = document.createElement("button");
  login.className = "btn primary";
  login.textContent = "Login";
  login.addEventListener("click", () => {
    const p = (fPass.querySelector("input").value || "").trim();
    const t = (fTok.querySelector("textarea").value || "").trim();
    if (p === ADMIN_PASSWORD && t === ADMIN_TOKEN) {
      hideOverlay();
      setAdminUI(true);
      toastModal("Admin mode", "Logged in. Use the red shield to log out.");
    } else {
      toastModal("Invalid", "Wrong password or token.");
    }
  });

  actions.appendChild(cancel);
  actions.appendChild(login);
  body.appendChild(actions);

  showOverlay(modal);
}

// ---------- Rendering ----------
function clearPillars(pillarsRoot) {
  pillarsRoot.querySelectorAll(".pillar").forEach(p => p.innerHTML = "");
}
function distribute(cards, root) {
  const cols = Array.from(root.querySelectorAll(".pillar"));
  let i = 0;
  for (const c of cards) cols[(i++ % cols.length)].appendChild(c);
}
function postMatchesSearch(p) {
  if (!searchQuery) return true;
  const a = (p.title || "").toLowerCase();
  const b = (p.username || "").toLowerCase();
  return a.includes(searchQuery) || b.includes(searchQuery);
}
function formatDate(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}
function badgeForCategory(cat) {
  if (cat === "verified") return { text: "Verified", cls: "verified" };
  if (cat === "requested") return { text: "Requested", cls: "requested" };
  return { text: "Unverified", cls: "unverified" };
}
function badgeEl(text, cls) {
  const b = document.createElement("span");
  b.className = "badge " + cls;
  b.textContent = text;
  return b;
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function buildPostCard(postId, p) {
  const card = document.createElement("div");
  card.className = "card";

  const head = document.createElement("div");
  head.className = "card-head";

  const left = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = p.title || "(no title)";

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.innerHTML =
    `<div><b>@${escapeHtml(p.username || "")}</b></div>` +
    `<div>Created: ${escapeHtml(formatDate(p.createdAt))}</div>` +
    (p.category === "verified" ? `<div>Verified: ${escapeHtml(formatDate(p.verifiedAt))}</div>` : "");

  left.appendChild(title);
  left.appendChild(meta);

  const badges = document.createElement("div");
  badges.className = "badges";
  const b = badgeForCategory(p.category);
  badges.appendChild(badgeEl(b.text, b.cls));
  if ((p.reports || 0) > 0) badges.appendChild(badgeEl(`Reported: ${p.reports}`, "reported"));
  left.appendChild(badges);

  head.appendChild(left);
  card.appendChild(head);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const view = document.createElement("button");
  view.className = "btn primary";
  view.textContent = "View";
  view.addEventListener("click", () => openPostView(postId, p));
  actions.appendChild(view);

  card.appendChild(actions);
  return card;
}

function renderBlacklist() {
  const list = Object.entries(postsCache)
    .filter(([_, p]) => p && !p.deleted)
    .map(([id, p]) => ({ id, p }))
    .filter(({ p }) => p.category === currentCategory)
    .filter(({ p }) => postMatchesSearch(p))
    .sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));

  clearPillars(els.postsPillars);
  const cards = list.map(({ id, p }) => buildPostCard(id, p));
  distribute(cards, els.postsPillars);
  els.emptyState.classList.toggle("hidden", cards.length !== 0);
}

function renderYourPosts() {
  const list = Object.entries(postsCache)
    .filter(([_, p]) => p && !p.deleted)
    .map(([id, p]) => ({ id, p }))
    .filter(({ p }) => p.authorId === anonId)
    .sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));

  clearPillars(els.yourPostsPillars);
  const cards = list.map(({ id, p }) => buildPostCard(id, p));
  distribute(cards, els.yourPostsPillars);
  els.yourEmptyState.classList.toggle("hidden", cards.length !== 0);
}

function adminRow(postId, p, kind) {
  const row = document.createElement("div");
  row.className = "row";

  const left = document.createElement("div");
  left.className = "left";
  left.innerHTML = `<div class="title">${escapeHtml(p.title || "(no title)")}</div><div class="sub">@${escapeHtml(p.username || "")} • created ${escapeHtml(formatDate(p.createdAt))} • ${kind === "reports" ? `reports: ${(p.reports||0)}` : "requested"}</div>`;

  const right = document.createElement("div");
  right.className = "right";

  const view = document.createElement("button");
  view.className = "btn primary";
  view.textContent = "View";
  view.addEventListener("click", () => openPostView(postId, p));
  right.appendChild(view);

  if (kind === "requests") {
    const reject = document.createElement("button");
    reject.className = "btn";
    reject.textContent = "Reject → Unverified";
    reject.addEventListener("click", async () => {
      const ok = await confirmModal("Reject request", "Send this post to Unverified?", "Reject", true);
      if (!ok) return;
      await adminUpdatePost(postId, { category: "unverified", verifiedAt: null });
    });

    const verify = document.createElement("button");
    verify.className = "btn primary";
    verify.textContent = "Verify";
    verify.addEventListener("click", async () => {
      const ok = await confirmModal("Verify post", "Move this post to Verified?", "Verify");
      if (!ok) return;
      await adminUpdatePost(postId, { category: "verified", verifiedAt: Date.now() });
    });

    right.appendChild(reject);
    right.appendChild(verify);
  }

  if (kind === "reports") {
    const dismiss = document.createElement("button");
    dismiss.className = "btn";
    dismiss.textContent = "Dismiss reports";
    dismiss.addEventListener("click", async () => {
      const ok = await confirmModal("Dismiss reports", "Clear all reports for this post?", "Dismiss", true);
      if (!ok) return;
      await dismissReports(postId);
    });
    right.appendChild(dismiss);
  }

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function renderAdminRequests() {
  els.adminRequestsList.innerHTML = "";
  const list = Object.entries(postsCache)
    .filter(([_, p]) => p && !p.deleted && p.category === "requested")
    .map(([id, p]) => ({ id, p }))
    .sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));

  for (const { id, p } of list) els.adminRequestsList.appendChild(adminRow(id, p, "requests"));
  els.adminRequestsEmpty.classList.toggle("hidden", list.length !== 0);
}

function renderAdminReports() {
  els.adminReportsList.innerHTML = "";
  const list = Object.entries(postsCache)
    .filter(([_, p]) => p && !p.deleted && (p.reports || 0) > 0)
    .map(([id, p]) => ({ id, p }))
    .sort((a, b) => (b.p.reports || 0) - (a.p.reports || 0));

  for (const { id, p } of list) els.adminReportsList.appendChild(adminRow(id, p, "reports"));
  els.adminReportsEmpty.classList.toggle("hidden", list.length !== 0);
}

function renderAll() {
  renderBlacklist();
  renderYourPosts();
  if (isAdmin) {
    renderAdminRequests();
    renderAdminReports();
  }
}

// ---------- Post view ----------
function openPostView(postId, p) {
  const { modal, body } = modalShell("Post");

  const top = document.createElement("div");
  top.className = "post-view-top";

  const left = document.createElement("div");
  const h = document.createElement("div");
  h.style.fontWeight = "950";
  h.style.fontSize = "18px";
  h.textContent = p.title || "(no title)";

  const meta = document.createElement("div");
  meta.className = "post-view-meta";
  meta.innerHTML =
    `<div><b>@${escapeHtml(p.username || "")}</b></div>` +
    `<div>Created: ${escapeHtml(formatDate(p.createdAt))}</div>` +
    (p.category === "verified" ? `<div>Verified: ${escapeHtml(formatDate(p.verifiedAt))}</div>` : "") +
    `<div class="muted">Category: ${escapeHtml(p.category || "")}</div>`;

  left.appendChild(h);
  left.appendChild(meta);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "8px";
  right.style.flexWrap = "wrap";
  right.style.justifyContent = "flex-end";

  if (isAdmin) {
    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "Delete post";
    del.addEventListener("click", async () => {
      const ok = await confirmModal("Delete post", "Soft delete this post?", "Delete", true);
      if (!ok) return;
      await adminUpdatePost(postId, { deleted: true });
      hideOverlay();
      toastModal("Deleted", "Post deleted.");
    });
    right.appendChild(del);
  }

  top.appendChild(left);
  top.appendChild(right);
  body.appendChild(top);

  if (p.description) {
    const desc = document.createElement("div");
    desc.className = "post-view-desc";
    desc.textContent = p.description;
    body.appendChild(desc);
  }

  if (Array.isArray(p.media) && p.media.length) {
    const gallery = document.createElement("div");
    gallery.className = "media-preview";
    gallery.style.marginTop = "12px";

    for (const m of p.media) {
      const chip = document.createElement("div");
      chip.className = "media-chip";
      if (m.kind === "video") {
        const v = document.createElement("video");
        v.src = m.dataUrl;
        v.controls = true;
        chip.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.src = m.dataUrl;
        chip.appendChild(img);
      }
      const s = document.createElement("small");
      s.textContent = m.name || "";
      chip.appendChild(s);
      gallery.appendChild(chip);
    }
    body.appendChild(gallery);
  }

  const voteRow = document.createElement("div");
  voteRow.className = "vote-row";

  const likeBtn = document.createElement("button");
  likeBtn.className = "vote";
  likeBtn.innerHTML = `👍 Like <small>${Number(p.likes || 0)}</small>`;

  const dislikeBtn = document.createElement("button");
  dislikeBtn.className = "vote";
  dislikeBtn.innerHTML = `👎 Dislike <small>${Number(p.dislikes || 0)}</small>`;

  const reportBtn = document.createElement("button");
  reportBtn.className = "btn report-btn";
  reportBtn.textContent = "Report";

  voteRow.appendChild(likeBtn);
  voteRow.appendChild(dislikeBtn);
  voteRow.appendChild(reportBtn);
  body.appendChild(voteRow);

  const myReaction = (reactionsCache[postId] && reactionsCache[postId][anonId]) || null;
  likeBtn.classList.toggle("active", myReaction === "like");
  dislikeBtn.classList.toggle("active", myReaction === "dislike");

  const alreadyReported = !!(reportsCache[postId] && reportsCache[postId][anonId]);
  reportBtn.classList.toggle("sent", alreadyReported);
  reportBtn.disabled = alreadyReported;
  if (alreadyReported) reportBtn.textContent = "Reported";

  likeBtn.addEventListener("click", async () => { await toggleReaction(postId, "like"); });
  dislikeBtn.addEventListener("click", async () => { await toggleReaction(postId, "dislike"); });

  reportBtn.addEventListener("click", async () => {
    const ok = await confirmModal("Report post", "Send a report for this post? Only once per device.", "Report", true);
    if (!ok) return;
    await sendReport(postId);
    toastModal("Report sent", "Thanks. The report was sent.");
  });

  showOverlay(modal);
}

// ---------- Reactions / Reports ----------
async function toggleReaction(postId, type) {
  const rPath = ref(db, `reactions/${postId}/${anonId}`);
  const current = (reactionsCache[postId] && reactionsCache[postId][anonId]) || null;
  const next = (current === type) ? null : type;

  try {
    if (next === null) await remove(rPath);
    else await set(rPath, next);
  } catch (err) {
    console.error(err);
    toastModal("Error", "Could not update reaction. Check Firebase rules.");
  }
}

async function sendReport(postId) {
  if (reportsCache[postId] && reportsCache[postId][anonId]) return;
  try {
    await set(ref(db, `moderation/reports/${postId}/${anonId}`), Date.now());
  } catch (err) {
    console.error(err);
    toastModal("Error", "Could not send report. Check Firebase rules.");
  }
}

async function dismissReports(postId) {
  try {
    await remove(ref(db, `moderation/reports/${postId}`));
  } catch (err) {
    console.error(err);
    toastModal("Error", "Could not dismiss reports. Check Firebase rules.");
  }
}

// ---------- Admin updates ----------
async function adminUpdatePost(postId, patch) {
  if (!isAdmin) return;
  try {
    await update(ref(db, `posts/${postId}`), { ...patch, adminSig: ADMIN_TOKEN });
  } catch (err) {
    console.error(err);
    toastModal("Error", "Admin update failed. Check Firebase rules.");
  }
}

// ---------- Firebase listeners ----------
onValue(ref(db, "posts"), (snap) => {
  postsCache = snap.val() || {};
  recomputeCounts();
  renderAll();
});
onValue(ref(db, "reactions"), (snap) => {
  reactionsCache = snap.val() || {};
  recomputeCounts();
  renderAll();
});
onValue(ref(db, "moderation/reports"), (snap) => {
  reportsCache = snap.val() || {};
  recomputeCounts();
  renderAll();
});

function recomputeCounts() {
  for (const [postId, p] of Object.entries(postsCache)) {
    if (!p) continue;
    const reacts = reactionsCache[postId] || {};
    let likes = 0, dislikes = 0;
    for (const v of Object.values(reacts)) {
      if (v === "like") likes++;
      else if (v === "dislike") dislikes++;
    }
    const reps = reportsCache[postId] ? Object.keys(reportsCache[postId]).length : 0;
    p.likes = likes;
    p.dislikes = dislikes;
    p.reports = reps;
  }
}

// init
setAdminUI(false);
setActiveTab("blacklistTab");
