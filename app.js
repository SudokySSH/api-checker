/* api-checker — проверка доступности API из браузера */

const STORAGE_KEY = "api-checker:endpoints";
const TIMEOUT_MS = 10000;

const $ = (sel) => document.querySelector(sel);
const listEl = $("#endpoint-list");
const emptyEl = $("#empty");
const logEl = $("#log");
const logEmptyEl = $("#log-empty");
const statsEl = $("#stats");
const form = $("#add-form");
const input = $("#url-input");
const checkAllBtn = $("#check-all");

let endpoints = load();
let running = 0;
let backend = false; // true, когда фронт отдаёт Node/Go-бэкенд (проверки без CORS)

(async () => {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    backend = r.ok;
  } catch {
    backend = false;
  }
})();

/* ---------- живые часы в шапке ---------- */

function tickClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("ru-RU", { hour12: false });
}
const tzOffset = -new Date().getTimezoneOffset() / 60;
$("#tz").textContent = `GMT${tzOffset >= 0 ? "+" : ""}${tzOffset}`;
tickClock();
setInterval(tickClock, 1000);

/* ---------- хранилище ---------- */

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
}

/* ---------- лог ---------- */

function log(url, statusText, cls) {
  const t = new Date().toLocaleTimeString("ru-RU", { hour12: false });
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML =
    `<span class="t">${t}</span>` +
    `<span class="${cls || ""}">${statusText}</span>` +
    `<span class="u">${escapeHtml(url)}</span>`;
  logEl.prepend(line);
  logEmptyEl.style.display = "none";
  while (logEl.children.length > 100) logEl.lastChild.remove();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ---------- проверка ---------- */

function statusClass(code) {
  if (code >= 200 && code < 300) return "ok";
  if (code >= 300 && code < 400) return "redirect";
  if (code >= 400 && code < 500) return "client";
  return "server";
}

function statusLabel(code) {
  return `${code} ${({ 200: "OK", 301: "Moved", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    429: "Too Many Requests", 500: "Internal Error", 502: "Bad Gateway",
    503: "Unavailable" })[code] || ""}`.trim();
}

async function checkEndpoint(ep) {
  ep.state = "pending";
  render();

  if (backend) {
    try {
      const r = await fetch("/api/check?url=" + encodeURIComponent(ep.url), { cache: "no-store" });
      const data = await r.json();
      ep.latency = data.latencyMs;
      ep.checkedAt = Date.now();
      if (data.ok) {
        ep.state = statusClass(data.status);
        ep.status = data.status;
        ep.note = "";
        log(ep.url, `${data.status} · ${data.latencyMs} ms`, data.status < 400 ? "code-ok" : "code-mid");
      } else {
        ep.state = "down";
        ep.status = null;
        ep.note = `${data.error} · ${data.latencyMs} ms`;
        log(ep.url, `DOWN · ${data.latencyMs} ms`, "code-bad");
      }
      save();
      render();
      return;
    } catch {
      // бэкенд пропал mid-flight — проверяем из браузера
      backend = false;
    }
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ep.url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      mode: "cors",
    });
    clearTimeout(timer);
    const ms = Math.round(performance.now() - started);
    ep.state = statusClass(res.status);
    ep.status = res.status;
    ep.latency = ms;
    ep.checkedAt = Date.now();
    ep.note = "";
    const cls = res.status < 400 ? "code-ok" : res.status < 500 ? "code-mid" : "code-bad";
    log(ep.url, `${res.status} · ${ms} ms`, cls);
  } catch (err) {
    clearTimeout(timer);
    const ms = Math.round(performance.now() - started);

    if (err.name === "AbortError") {
      ep.state = "down";
      ep.status = null;
      ep.note = `таймаут ${TIMEOUT_MS / 1000} с`;
      log(ep.url, `TIMEOUT · ${ms} ms`, "code-bad");
    } else {
      // TypeError: либо CORS, либо сеть недоступна. Пробуем no-cors, чтобы отличить.
      try {
        await fetch(ep.url, { method: "HEAD", mode: "no-cors", cache: "no-store" });
        ep.state = "cors";
        ep.status = null;
        ep.note = `online, но CORS блокирует чтение (${ms} ms)`;
        log(ep.url, `CORS · ${ms} ms`, "code-mid");
      } catch {
        ep.state = "down";
        ep.status = null;
        ep.note = `не отвечает · ${ms} ms`;
        log(ep.url, `DOWN · ${ms} ms`, "code-bad");
      }
    }
    ep.latency = ms;
    ep.checkedAt = Date.now();
  }

  save();
  render();
}

/* ---------- рендер ---------- */

function render() {
  emptyEl.style.display = endpoints.length ? "none" : "block";
  listEl.innerHTML = "";

  let ok = 0, bad = 0;
  for (const ep of endpoints) {
    if (ep.state === "ok") ok++;
    if (ep.state === "down" || ep.state === "server") bad++;

    const row = document.createElement("div");
    row.className = "endpoint";

    const stateText = {
      pending: '<span class="badge pending spin">···</span>',
      ok: `<span class="badge ok">${ep.status}</span> ${statusLabel(ep.status)}`,
      redirect: `<span class="badge redirect">${ep.status}</span> ${statusLabel(ep.status)}`,
      client: `<span class="badge client">${ep.status}</span> ${statusLabel(ep.status)}`,
      server: `<span class="badge server">${ep.status}</span> ${statusLabel(ep.status)}`,
      cors: '<span class="badge cors">CORS</span>',
      down: '<span class="badge down">DOWN</span>',
    }[ep.state] || '<span class="badge pending">—</span>';

    const when = ep.checkedAt
      ? new Date(ep.checkedAt).toLocaleTimeString("ru-RU", { hour12: false })
      : "";

    row.innerHTML = `
      <span class="method">GET</span>
      <span class="url">${escapeHtml(ep.url)}</span>
      <span class="controls">
        <button class="icon-btn" data-act="check" title="проверить">↻</button>
        <button class="icon-btn danger" data-act="del" title="удалить">✕</button>
      </span>
      <span class="status">${stateText}<span>${ep.note || ""}</span><span>${when}</span></span>
    `;

    row.querySelector('[data-act="check"]').addEventListener("click", () => checkEndpoint(ep));
    row.querySelector('[data-act="del"]').addEventListener("click", () => {
      endpoints = endpoints.filter((e) => e !== ep);
      save();
      render();
    });

    listEl.appendChild(row);
  }

  statsEl.textContent = endpoints.length
    ? `всего: ${endpoints.length} · ок: ${ok} · проблемы: ${bad}${running ? ` · проверяется: ${running}` : ""}`
    : "";
}

/* ---------- события ---------- */

form.addEventListener("submit", (e) => {
  e.preventDefault();
  let url = input.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    new URL(url);
  } catch {
    log(input.value.trim(), "некорректный URL", "code-bad");
    return;
  }
  if (endpoints.some((ep) => ep.url === url)) {
    log(url, "уже добавлен", "code-mid");
    input.value = "";
    return;
  }
  const ep = { url, state: "idle", status: null, latency: null, note: "", checkedAt: null };
  endpoints.push(ep);
  input.value = "";
  save();
  render();
  checkEndpoint(ep);
});

checkAllBtn.addEventListener("click", async () => {
  if (running > 0) return;
  running = endpoints.length;
  render();
  // по очереди, чтобы не упереться в лимиты браузера
  for (const ep of endpoints) {
    await checkEndpoint(ep);
    running--;
  }
  running = 0;
  render();
});

render();
