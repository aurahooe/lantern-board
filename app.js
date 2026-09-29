const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
let session = null;
const profiles = new Map();
const $ = (sel) => document.querySelector(sel);
const views = { desk: $("#view-desk"), wall: $("#view-wall"), studio: $("#view-studio") };

function show(name) {
  Object.entries(views).forEach(([key, el]) => el.classList.toggle("is-on", key === name));
  document.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("is-current", b.dataset.nav === name));
  if (name === "wall") loadWall();
  if (name === "studio") loadMine();
}
document.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => show(el.dataset.nav)));

function tickClock() {
  const now = new Date();
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  $("#hand-h").style.transform = `translateX(-50%) rotate(${h * 30 + m * 0.5}deg)`;
  $("#hand-m").style.transform = `translateX(-50%) rotate(${m * 6 + s * 0.1}deg)`;
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  const left = next - now;
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  $("#countdown").textContent = `${mm}m ${String(ss).padStart(2, "0")}s`;
  $("#hour-label").textContent = now.toLocaleString(undefined, { weekday: "short", hour: "numeric" });
}

async function loadEdition() {
  const { data } = await sb.from("lantern_hours").select("*").order("created_at", { ascending: false }).limit(1);
  const ed = data && data[0];
  if (!ed) return;
  $("#edition-title").textContent = ed.title;
  $("#edition-body").textContent = ed.body;
  $("#edition-slot").textContent = ed.hour_key || "latest reprint";
}

function escapeHtml(s = "") {
  return String(s).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """);
}

function cardHTML(row, extra = "") {
  const when = new Date(row.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const handle = profiles.get(row.author_id)?.handle || "anon";
  return `<article class="slip" style="animation-delay:${Math.random() * 0.2}s"><h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.body)}</p><div class="meta"><span>@${escapeHtml(handle)}</span><span>${when}</span></div>${extra}</article>`;
}

async function hydrateProfiles(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !profiles.has(id));
  if (!missing.length) return;
  const { data } = await sb.from("profiles").select("id,handle,display_name").in("id", missing);
  (data || []).forEach((p) => profiles.set(p.id, p));
}

async function loadWall() {
  const { data, error } = await sb.from("lantern_slips").select("*").eq("is_public", true).order("created_at", { ascending: false }).limit(60);
  if (error) { $("#wall").innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; return; }
  await hydrateProfiles((data || []).map((r) => r.author_id));
  $("#wall").innerHTML = data?.length ? data.map((r) => cardHTML(r)).join("") : `<p class="empty">The wall is bare. Sign in and hang a slip.</p>`;
}

async function loadMine() {
  if (!session) { $("#mine").innerHTML = `<p class="empty">Sign in to keep a studio.</p>`; return; }
  const { data, error } = await sb.from("lantern_slips").select("*").eq("author_id", session.user.id).order("created_at", { ascending: false });
  if (error) { $("#mine").innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; return; }
  profiles.set(session.user.id, profiles.get(session.user.id) || { handle: "you" });
  $("#mine").innerHTML = data?.length
    ? data.map((r) => cardHTML(r, `<div class="row-actions"><button type="button" data-toggle="${r.id}" data-pub="${r.is_public ? "1" : "0"}">${r.is_public ? "Unhang" : "Hang public"}</button><button type="button" data-del="${r.id}">Burn</button></div>`)).join("")
    : `<p class="empty">No slips yet. Write one above.</p>`;
}

$("#mine").addEventListener("click", async (e) => {
  const t = e.target;
  if (t.dataset.toggle) {
    const pub = t.dataset.pub !== "1";
    await sb.from("lantern_slips").update({ is_public: pub, updated_at: new Date().toISOString() }).eq("id", t.dataset.toggle);
    loadMine(); loadWall();
  }
  if (t.dataset.del) {
    await sb.from("lantern_slips").delete().eq("id", t.dataset.del);
    loadMine(); loadWall();
  }
});

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#composer-msg");
  if (!session) { msg.textContent = "Sign in first."; msg.className = "form-msg bad"; return; }
  const fd = new FormData(e.target);
  const payload = { author_id: session.user.id, title: String(fd.get("title") || "").trim(), body: String(fd.get("body") || "").trim(), is_public: fd.get("is_public") === "on" };
  const { error } = await sb.from("lantern_slips").insert(payload);
  if (error) { msg.textContent = error.message; msg.className = "form-msg bad"; return; }
  e.target.reset();
  msg.textContent = payload.is_public ? "Hung on the wall." : "Filed in the studio.";
  msg.className = "form-msg ok";
  loadMine();
  if (payload.is_public) loadWall();
});

const dialog = $("#auth-dialog");
$("#auth-open").addEventListener("click", () => dialog.showModal());
$("#auth-form").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  e.preventDefault();
  await auth("in");
});
$("#auth-up").addEventListener("click", () => auth("up"));

async function auth(mode) {
  const fd = new FormData($("#auth-form"));
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  const handle = String(fd.get("handle") || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  const msg = $("#auth-msg");
  msg.textContent = "Working…";
  msg.className = "form-msg";
  let error;
  if (mode === "up") {
    const res = await sb.auth.signUp({ email, password });
    error = res.error;
    if (!error && res.data.user) {
      await sb.from("profiles").upsert({ id: res.data.user.id, handle: handle || `desk${res.data.user.id.slice(0, 6)}`, display_name: handle || "Desk hand" });
    }
  } else {
    const res = await sb.auth.signInWithPassword({ email, password });
    error = res.error;
  }
  if (error) { msg.textContent = error.message; msg.className = "form-msg bad"; return; }
  msg.textContent = mode === "up" ? "Desk opened. If email confirm is on, check your inbox." : "Welcome back.";
  msg.className = "form-msg ok";
  setTimeout(() => dialog.close(), 500);
}

$("#sign-out").addEventListener("click", () => sb.auth.signOut());
function applySession(s) {
  session = s;
  const ined = Boolean(s);
  $("#sign-out").classList.toggle("hidden", !ined);
  $("#auth-open").classList.toggle("hidden", ined);
  document.querySelectorAll(".needs-auth").forEach((el) => el.classList.toggle("hidden", !ined));
}
sb.auth.onAuthStateChange((_e, s) => applySession(s));
sb.auth.getSession().then(({ data }) => applySession(data.session));
loadEdition(); loadWall(); tickClock();
setInterval(tickClock, 1000);
setInterval(loadEdition, 60 * 1000);
show("desk");
