/* api-checker — Node.js бэкенд (без зависимостей)
 *
 * Служит статический фронтенд из этой же папки и добавляет /api/check,
 * который проверяет эндпоинты серверной стороной — без ограничений CORS.
 *
 *   node server.js          # порт из env PORT, по умолчанию 7300
 *
 * API:
 *   GET /api/health        -> { "ok": true }
 *   GET /api/check?url=... -> { "url", "status", "latencyMs", "ok" }
 *                          | { "url", "error", "latencyMs", "ok": false }
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 7300);
const ROOT = __dirname;
const TIMEOUT_MS = 10_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function handleCheck(url, res) {
  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error("bad protocol");
  } catch {
    return sendJson(res, 400, { ok: false, url, error: "invalid url" });
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "api-checker/1.0" },
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - started);
    sendJson(res, 200, { ok: r.status < 400, url, status: r.status, latencyMs });
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - started);
    const error =
      err.name === "AbortError" ? `timeout ${TIMEOUT_MS / 1000}s` : String(err.cause || err.message);
    sendJson(res, 200, { ok: false, url, error, latencyMs });
  }
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(ROOT, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-fallback на index.html
      filePath = path.join(ROOT, "index.html");
    }
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (u.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "api-checker", runtime: process.version });
  }
  if (u.pathname === "/api/check") {
    return handleCheck(u.searchParams.get("url"), res);
  }
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "method not allowed" });
  }
  serveStatic(req, res, decodeURIComponent(u.pathname));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`api-checker (node) слушает http://127.0.0.1:${PORT}`);
});
