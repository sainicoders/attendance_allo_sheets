#!/usr/bin/env node
/**
 * Static file server + image proxy for the attendance sheet generator.
 * Usage: node server.js [port]
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || process.argv[2] || "8080", 10);
const ROOT = __dirname;

const ALLOWED_IMAGE_HOSTS = [
  "ubro-space.blr1.cdn.digitaloceanspaces.com",
  "ubro-space.blr1.digitaloceanspaces.com"
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

function isAllowedImageUrl(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === "https:" && ALLOWED_IMAGE_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function proxyImage(imageUrl, res) {
  const request = https.get(imageUrl, { timeout: 10000 }, (proxyRes) => {
    // Follow one redirect
    if (
      proxyRes.statusCode >= 300 &&
      proxyRes.statusCode < 400 &&
      proxyRes.headers.location
    ) {
      proxyRes.resume();
      return proxyImage(proxyRes.headers.location, res);
    }
    if (proxyRes.statusCode !== 200) {
      send(res, proxyRes.statusCode || 502, "Failed to fetch image");
      return;
    }
    const chunks = [];
    proxyRes.on("data", (chunk) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);
      const type = proxyRes.headers["content-type"] || "image/jpeg";
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(body);
    });
  });

  request.on("timeout", () => {
    request.destroy();
    if (!res.headersSent) send(res, 504, "Image fetch timeout");
  });
  request.on("error", () => {
    if (!res.headersSent) send(res, 502, "Failed to fetch image");
  });
}

function serveStatic(filePath, res) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, "Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) return send(res, 500, "Internal Server Error");
      send(res, 200, data, type);
    });
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === "/api/image") {
    const imageUrl = reqUrl.searchParams.get("url");
    if (!imageUrl || !isAllowedImageUrl(imageUrl)) {
      return send(res, 400, "Invalid image URL");
    }
    return proxyImage(imageUrl, res);
  }

  const urlPath = decodeURIComponent(reqUrl.pathname);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const filePath = path.normalize(path.join(ROOT, rel));

  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, "Forbidden");
  }

  serveStatic(filePath, res);
});

server.listen(PORT, () => {
  console.log(`Attendance sheet server running at http://localhost:${PORT}`);
});
