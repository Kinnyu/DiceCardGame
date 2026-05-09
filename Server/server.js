import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = normalize(join(__dirname, ".."));
const clientDir = join(rootDir, "Client");
const port = Number(process.env.PORT || 3000);

const rooms = new Map();
const streams = new Map();

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

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }

  throw new Error("Could not create a unique room code.");
}

function cleanName(name) {
  const value = String(name || "").trim().replace(/\s+/g, " ");
  return value.slice(0, 18);
}

function cleanCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId
    }))
  };
}

function addOrUpdatePlayer(room, playerId, name) {
  const playerName = cleanName(name);
  if (!playerId || !playerName) {
    return { error: "請輸入暱稱後再進房。" };
  }

  const existing = room.players.find((player) => player.id === playerId);
  if (existing) {
    existing.name = playerName;
    return { player: existing };
  }

  if (room.players.length >= 4) {
    return { error: "這個房間已經滿了。" };
  }

  const player = { id: String(playerId), name: playerName };
  room.players.push(player);

  if (!room.hostId) {
    room.hostId = player.id;
  }

  return { player };
}

function broadcast(roomCode) {
  const room = rooms.get(roomCode);
  const subscribers = streams.get(roomCode);
  if (!room || !subscribers) {
    return;
  }

  const payload = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const response of subscribers) {
    response.write(payload);
  }
}

function subscribe(roomCode, res) {
  if (!streams.has(roomCode)) {
    streams.set(roomCode, new Set());
  }

  streams.get(roomCode).add(res);
  res.on("close", () => {
    const subscribers = streams.get(roomCode);
    subscribers?.delete(res);
    if (subscribers?.size === 0) {
      streams.delete(roomCode);
    }
  });
}

function removePlayer(room, playerId) {
  room.players = room.players.filter((player) => player.id !== playerId);

  if (room.hostId === playerId) {
    room.hostId = room.players[0]?.id || "";
  }

  if (room.players.length === 0) {
    rooms.delete(room.code);
    streams.delete(room.code);
  }
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const code = makeRoomCode();
    const room = { code, hostId: "", status: "waiting", players: [] };
    const result = addOrUpdatePlayer(room, body.playerId, body.name);

    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    rooms.set(code, room);
    sendJson(res, 201, { room: publicRoom(room), playerId: result.player.id });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|leave|start|events))?$/);
  if (!roomMatch) {
    sendJson(res, 404, { error: "找不到這個 API。" });
    return;
  }

  const code = cleanCode(roomMatch[1]);
  const action = roomMatch[2] || "";
  const room = rooms.get(code);

  if (!room) {
    sendJson(res, 404, { error: "找不到房間，請確認房號。" });
    return;
  }

  if (req.method === "GET" && action === "") {
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "GET" && action === "events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
    subscribe(code, res);
    return;
  }

  const body = await readBody(req);

  if (req.method === "POST" && action === "join") {
    if (room.status !== "waiting") {
      sendJson(res, 409, { error: "遊戲已經開始，暫時不能加入。" });
      return;
    }

    const result = addOrUpdatePlayer(room, body.playerId, body.name);
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    broadcast(code);
    sendJson(res, 200, { room: publicRoom(room), playerId: result.player.id });
    return;
  }

  if (req.method === "POST" && action === "leave") {
    removePlayer(room, String(body.playerId || ""));
    broadcast(code);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && action === "start") {
    if (room.hostId !== body.playerId) {
      sendJson(res, 403, { error: "只有房主可以開始遊戲。" });
      return;
    }

    if (room.players.length < 2) {
      sendJson(res, 400, { error: "至少需要兩位玩家才能開始。" });
      return;
    }

    room.status = "playing";
    broadcast(code);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  sendJson(res, 405, { error: "這個操作不支援。" });
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(join(clientDir, requestedPath));

  if (!safePath.startsWith(clientDir)) {
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
