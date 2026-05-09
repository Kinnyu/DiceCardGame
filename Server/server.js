import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRoomApi } from "../lib/room-api.js";
import { createMemoryStore } from "../lib/stores.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = normalize(join(__dirname, ".."));
const clientDir = join(rootDir, "Client");
const port = Number(process.env.PORT || 3000);
const roomStore = createMemoryStore(new Map());

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be JSON."));
      }
    });
  });
}

async function handleApi(req, res, url) {
  const body = req.method === "GET" ? { playerId: url.searchParams.get("playerId") || "" } : await readBody(req);
  const path = url.pathname === "/api/rooms" ? [] : url.pathname.replace(/^\/api\/rooms\/?/, "").split("/");
  const result = await handleRoomApi({
    method: req.method,
    path,
    body,
    store: roomStore
  });

  sendJson(res, result.status, result.payload);
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(join(clientDir, requestedPath));
  const relativePath = relative(clientDir, safePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(safePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(safePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`Dice Card Game lobby is running at http://localhost:${port}`);
});
