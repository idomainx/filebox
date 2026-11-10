"use strict";
// Simple file host. No dependencies. Files live in DATA_DIR/files.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = process.env.DATA_DIR || "/data";
const FILES_DIR = path.join(DATA_DIR, "files");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const NAME_RE = /^[A-Za-z0-9_-]{1,40}\.[A-Za-z0-9]{1,10}$/;

fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
for (const f of fs.readdirSync(TMP_DIR)) {
  try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch (e) { /* ignore */ }
}

const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".ogv": "video/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".zip": "application/zip",
  ".html": "text/plain; charset=utf-8", ".htm": "text/plain; charset=utf-8"
};
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/health.html": ["health.html", "text/html; charset=utf-8"]
};

function mimeOf(name) {
  return MIME[path.extname(name).toLowerCase()] || "application/octet-stream";
}
function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}
function readJson(req, res, cb) {
  let body = "";
  let big = false;
  req.setEncoding("utf8");
  req.on("data", (c) => {
    body += c;
    if (body.length > 1000000) { big = true; req.destroy(); }
  });
  req.on("end", () => {
    if (big) return;
    let data;
    try { data = JSON.parse(body || "{}"); } catch (e) { return sendJson(res, 400, { error: "Bad request" }); }
    cb(data);
  });
}

function freeName(ext) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  for (;;) {
    let id = "";
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) id += chars[bytes[i] % chars.length];
    const name = id + "." + ext;
    if (!fs.existsSync(path.join(FILES_DIR, name))) return name;
  }
}

function listFiles() {
  const out = [];
  for (const name of fs.readdirSync(FILES_DIR)) {
    if (!NAME_RE.test(name)) continue;
    try {
      const st = fs.statSync(path.join(FILES_DIR, name));
      if (st.isFile()) out.push({ name: name, size: st.size, time: st.mtimeMs });
    } catch (e) { /* skip */ }
  }
  out.sort((a, b) => b.time - a.time);
  return out;
}

function handleUpload(req, res, u) {
  let ext = (u.searchParams.get("ext") || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  if (!ext) ext = "bin";
  const name = freeName(ext);
  const tmp = path.join(TMP_DIR, crypto.randomBytes(8).toString("hex"));
  const out = fs.createWriteStream(tmp);
  let done = false;
  function fail(code, msg) {
    if (done) return;
    done = true;
    out.destroy();
    fs.unlink(tmp, () => {});
    if (!res.headersSent) sendJson(res, code, { error: msg });
  }
  req.on("error", () => fail(400, "Upload failed"));
  req.on("aborted", () => fail(400, "Upload aborted"));
  out.on("error", () => fail(500, "Could not save file"));
  out.on("finish", () => {
    if (done) return;
    done = true;
    fs.rename(tmp, path.join(FILES_DIR, name), (err) => {
      if (err) { fs.unlink(tmp, () => {}); return sendJson(res, 500, { error: "Could not save file" }); }
      sendJson(res, 200, { name: name });
    });
  });
  req.pipe(out);
}

function doRename(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 5000) return "Nothing to rename";
  const froms = new Set();
  const tos = new Set();
  for (const it of items) {
    if (!it || typeof it.from !== "string" || typeof it.to !== "string") return "Bad name";
    if (!NAME_RE.test(it.from) || !NAME_RE.test(it.to)) return "Bad name (use letters, numbers, - and _ only)";
    if (froms.has(it.from) || tos.has(it.to)) return "Duplicate name";
    froms.add(it.from);
    tos.add(it.to);
    if (!fs.existsSync(path.join(FILES_DIR, it.from))) return "Missing file: " + it.from;
  }
  for (const t of tos) {
    if (!froms.has(t) && fs.existsSync(path.join(FILES_DIR, t))) return "Name already used: " + t;
  }
  const step = [];
  for (const it of items) {
    const tmpName = ".r_" + crypto.randomBytes(6).toString("hex");
    fs.renameSync(path.join(FILES_DIR, it.from), path.join(FILES_DIR, tmpName));
    step.push([tmpName, it.to]);
  }
  for (const s of step) {
    fs.renameSync(path.join(FILES_DIR, s[0]), path.join(FILES_DIR, s[1]));
  }
  return null;
}

function serveFile(req, res, raw) {
  let name;
  try { name = decodeURIComponent(raw); } catch (e) { return notFound(res); }
  if (!NAME_RE.test(name)) return notFound(res);
  const fp = path.join(FILES_DIR, name);
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const size = st.size;
    const h = {
      "Content-Type": mimeOf(name),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*"
    };
    if (size === 0) {
      h["Content-Length"] = 0;
      res.writeHead(200, h);
      return res.end();
    }
    let start = 0;
    let end = size - 1;
    let code = 200;
    const r = req.headers.range;
    if (r) {
      const mm = /^bytes=(\d*)-(\d*)$/.exec(r);
      if (mm && (mm[1] !== "" || mm[2] !== "")) {
        if (mm[1] === "") {
          start = Math.max(0, size - parseInt(mm[2], 10));
        } else {
          start = parseInt(mm[1], 10);
          if (mm[2] !== "") end = Math.min(end, parseInt(mm[2], 10));
        }
        if (start > end || start >= size) {
          res.writeHead(416, { "Content-Range": "bytes */" + size });
          return res.end();
        }
        code = 206;
        h["Content-Range"] = "bytes " + start + "-" + end + "/" + size;
      }
    }
    h["Content-Length"] = end - start + 1;
    res.writeHead(code, h);
    if (req.method === "HEAD") return res.end();
    const rs = fs.createReadStream(fp, { start: start, end: end });
    rs.on("error", () => res.destroy());
    res.on("close", () => rs.destroy());
    rs.pipe(res);
  });
}

function route(req, res) {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  const m = req.method;

  if (p === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end("healthy");
  }
  if ((m === "GET" || m === "HEAD") && p.startsWith("/f/")) return serveFile(req, res, p.slice(3));
  if ((m === "GET" || m === "HEAD") && STATIC[p]) {
    return fs.readFile(path.join(__dirname, STATIC[p][0]), (err, buf) => {
      if (err) return notFound(res);
      res.writeHead(200, { "Content-Type": STATIC[p][1], "Cache-Control": "no-cache" });
      res.end(buf);
    });
  }
  if (m === "GET" && p === "/api/files") return sendJson(res, 200, { files: listFiles() });
  if (m === "POST" && p === "/api/upload") return handleUpload(req, res, u);
  if (m === "POST" && p === "/api/rename") {
    return readJson(req, res, (data) => {
      const err = doRename(data.items);
      if (err) return sendJson(res, 409, { error: err });
      sendJson(res, 200, { ok: true });
    });
  }
  if (m === "POST" && p === "/api/delete") {
    return readJson(req, res, (data) => {
      const names = Array.isArray(data.names) ? data.names : [];
      let n = 0;
      for (const name of names) {
        if (typeof name !== "string" || !NAME_RE.test(name)) continue;
        try { fs.unlinkSync(path.join(FILES_DIR, name)); n++; } catch (e) { /* ignore */ }
      }
      sendJson(res, 200, { deleted: n });
    });
  }
  notFound(res);
}

const server = http.createServer((req, res) => {
  try { route(req, res); } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: "Server error" });
  }
});
server.requestTimeout = 0; // allow very long uploads
server.timeout = 0;
server.listen(PORT, "0.0.0.0", () => console.log("Listening on " + PORT + ", data in " + DATA_DIR));
