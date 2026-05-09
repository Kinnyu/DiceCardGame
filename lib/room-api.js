import {
  addOrUpdatePlayer,
  cleanCode,
  createEmptyRoom,
  errors,
  makeRoomCode,
  publicRoom,
  removePlayer,
  startRoom
} from "./rooms.js";

export function parseRoomRoute(input) {
  const parts = Array.isArray(input)
    ? input
    : String(input || "")
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);

  const [rawCode = "", rawAction = ""] = parts;
  return {
    code: cleanCode(rawCode),
    action: String(rawAction || "").trim().toLowerCase(),
    isValid: parts.length <= 2
  };
}

export async function handleRoomApi({ method, path = [], body = {}, store }) {
  if (!store.ready) {
    return {
      status: 503,
      payload: {
        error: errors.storageNotConfigured,
        warning: store.warning
      }
    };
  }

  const route = parseRoomRoute(path);

  if (!route.isValid) {
    return response(404, { error: errors.apiNotFound });
  }

  if (method === "POST" && !route.code && !route.action) {
    return createRoom({ body, store });
  }

  if (!route.code) {
    return response(404, { error: errors.apiNotFound });
  }

  if (!["", "join", "leave", "start"].includes(route.action)) {
    return response(404, { error: errors.apiNotFound });
  }

  const room = await store.getRoom(route.code);
  if (!room) {
    return response(404, { error: errors.roomNotFound });
  }

  if (method === "GET" && route.action === "") {
    return response(200, store.decorate({ room: publicRoom(room) }));
  }

  if (method === "POST" && route.action === "join") {
    return joinRoom({ room, body, store });
  }

  if (method === "POST" && route.action === "leave") {
    return leaveRoom({ room, body, store });
  }

  if (method === "POST" && route.action === "start") {
    return beginGame({ room, body, store });
  }

  return response(405, { error: errors.unsupportedAction });
}

async function createRoom({ body, store }) {
  const code = await makeRoomCode((roomCode) => store.hasRoom(roomCode));
  const room = createEmptyRoom(code);
  const result = addOrUpdatePlayer(room, body.playerId, body.name);

  if (result.error) {
    return response(400, { error: result.error });
  }

  await store.saveRoom(room);
  return response(201, store.decorate({ room: publicRoom(room), playerId: result.player.id }));
}

async function joinRoom({ room, body, store }) {
  if (room.status !== "waiting") {
    return response(409, { error: errors.gameAlreadyStarted });
  }

  const result = addOrUpdatePlayer(room, body.playerId, body.name);
  if (result.error) {
    return response(400, { error: result.error });
  }

  await store.saveRoom(room);
  return response(200, store.decorate({ room: publicRoom(room), playerId: result.player.id }));
}

async function leaveRoom({ room, body, store }) {
  removePlayer(room, body.playerId);
  if (room.players.length === 0) {
    await store.deleteRoom(room.code);
  } else {
    await store.saveRoom(room);
  }

  return response(200, store.decorate({ ok: true }));
}

async function beginGame({ room, body, store }) {
  const result = startRoom(room, body.playerId);
  if (result.error) {
    return response(result.status, { error: result.error });
  }

  await store.saveRoom(room);
  return response(200, store.decorate({ room: publicRoom(room) }));
}

function response(status, payload) {
  return { status, payload };
}
