const memoryRooms = globalThis.__diceCardRooms || new Map();
globalThis.__diceCardRooms = memoryRooms;

const roomTtlSeconds = 60 * 60 * 6;

export default async function handler(req, res) {
  try {
    const path = getPath(req);

    if (req.method === "POST" && path.length === 0) {
      const body = req.body || {};
      const code = await makeRoomCode();
      const room = { code, hostId: "", status: "waiting", players: [] };
      const result = addOrUpdatePlayer(room, body.playerId, body.name);

      if (result.error) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      await saveRoom(room);
      sendJson(res, 201, { room: publicRoom(room), playerId: result.player.id });
      return;
    }

    const code = cleanCode(path[0]);
    const action = path[1] || "";

    if (!code) {
      sendJson(res, 404, { error: "找不到這個 API。" });
      return;
    }

    const room = await getRoom(code);

    if (!room) {
      sendJson(res, 404, { error: "找不到房間，請確認房號。" });
      return;
    }

    if (req.method === "GET" && action === "") {
      sendJson(res, 200, { room: publicRoom(room) });
      return;
    }

    const body = req.body || {};

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

      await saveRoom(room);
      sendJson(res, 200, { room: publicRoom(room), playerId: result.player.id });
      return;
    }

    if (req.method === "POST" && action === "leave") {
      removePlayer(room, String(body.playerId || ""));
      if (room.players.length === 0) {
        await deleteRoom(code);
      } else {
        await saveRoom(room);
      }
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
      await saveRoom(room);
      sendJson(res, 200, { room: publicRoom(room) });
      return;
    }

    sendJson(res, 405, { error: "這個操作不支援。" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

function getPath(req) {
  const rawPath = req.query?.path || "";
  const joined = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  return joined.split("/").map((part) => part.trim()).filter(Boolean);
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

async function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!(await getRoom(code))) {
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

function removePlayer(room, playerId) {
  room.players = room.players.filter((player) => player.id !== playerId);

  if (room.hostId === playerId) {
    room.hostId = room.players[0]?.id || "";
  }
}

async function getRoom(code) {
  if (hasRedis()) {
    const value = await redisCommand(["GET", roomKey(code)]);
    return value ? JSON.parse(value) : null;
  }

  return memoryRooms.get(code) || null;
}

async function saveRoom(room) {
  if (hasRedis()) {
    await redisCommand(["SET", roomKey(room.code), JSON.stringify(room), "EX", roomTtlSeconds]);
    return;
  }

  memoryRooms.set(room.code, room);
}

async function deleteRoom(code) {
  if (hasRedis()) {
    await redisCommand(["DEL", roomKey(code)]);
    return;
  }

  memoryRooms.delete(code);
}

function roomKey(code) {
  return `dice-card-game:room:${code}`;
}

function hasRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisCommand(command) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const payload = await response.json();

  if (!response.ok || payload.error) {
    throw new Error(payload.error || "Redis request failed.");
  }

  return payload.result;
}
