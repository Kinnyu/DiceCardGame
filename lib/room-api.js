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
import { rollDie } from "./dice.js";
import {
  arrangePlayerCards,
  gameRuleErrors,
  passArrangedCardsRight,
  revealCardAtDiceResult,
  selectDraftCard
} from "./game-rules.js";

export const apiGameErrors = {
  playerIdRequired: "playerIdRequired",
  cardInstanceIdRequired: "cardInstanceIdRequired",
  cardInstanceIdsRequired: "cardInstanceIdsRequired",
  gameNotStarted: "gameNotStarted",
  alreadyArranged: "alreadyArranged"
};

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

export async function handleRoomApi({ method, path = [], body = {}, store, random = Math.random }) {
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

  if (!["", "join", "leave", "start", "draft", "arrange", "roll", "turn"].includes(route.action)) {
    return response(404, { error: errors.apiNotFound });
  }

  const room = await store.getRoom(route.code);
  if (!room) {
    return response(404, { error: errors.roomNotFound });
  }

  if (method === "GET" && route.action === "") {
    return response(200, store.decorate({ room: publicRoom(room, body.playerId) }));
  }

  if (method === "POST" && route.action === "join") {
    return joinRoom({ room, body, store });
  }

  if (method === "POST" && route.action === "leave") {
    return leaveRoom({ room, body, store });
  }

  if (method === "POST" && route.action === "start") {
    return beginGame({ room, body, store, random });
  }

  if (method === "POST" && route.action === "draft") {
    return draftCard({ room, body, store });
  }

  if (method === "POST" && route.action === "arrange") {
    return arrangeCards({ room, body, store });
  }

  if (method === "POST" && (route.action === "roll" || route.action === "turn")) {
    return rollTurn({ room, body, store, random });
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

async function beginGame({ room, body, store, random }) {
  const result = startRoom(room, body.playerId, { random });
  if (result.error) {
    return response(result.status, { error: result.error });
  }

  await store.saveRoom(room);
  return response(200, store.decorate({ room: publicRoom(room) }));
}

async function draftCard({ room, body, store }) {
  if (!room.game) {
    return response(409, { error: apiGameErrors.gameNotStarted });
  }

  const playerId = String(body.playerId || "");
  if (!playerId) {
    return response(400, { error: apiGameErrors.playerIdRequired });
  }

  const cardInstanceId = String(body.cardInstanceId || "");
  if (!cardInstanceId) {
    return response(400, { error: apiGameErrors.cardInstanceIdRequired });
  }

  const result = selectDraftCard(room.game, playerId, cardInstanceId);
  if (result.error) {
    return response(statusForRuleError(result.error), { error: result.error });
  }

  await store.saveRoom(room);
  return response(200, store.decorate({ room: publicRoom(room, playerId) }));
}

async function arrangeCards({ room, body, store }) {
  if (!room.game) {
    return response(409, { error: apiGameErrors.gameNotStarted });
  }

  const playerId = String(body.playerId || "");
  if (!playerId) {
    return response(400, { error: apiGameErrors.playerIdRequired });
  }

  const player = room.game.players.find((candidate) => candidate.id === playerId);
  if (player?.arrangedCards?.length) {
    return response(409, { error: apiGameErrors.alreadyArranged });
  }

  if (!Array.isArray(body.cardInstanceIds)) {
    return response(400, { error: apiGameErrors.cardInstanceIdsRequired });
  }

  const result = arrangePlayerCards(room.game, playerId, body.cardInstanceIds);
  if (result.error) {
    return response(statusForRuleError(result.error), { error: result.error });
  }

  const passResult = passArrangedCardsRight(room.game);
  if (passResult.error && passResult.error !== gameRuleErrors.playersNotReady) {
    return response(statusForRuleError(passResult.error), { error: passResult.error });
  }

  await store.saveRoom(room);
  return response(200, store.decorate({ room: publicRoom(room, playerId) }));
}

async function rollTurn({ room, body, store, random }) {
  if (!room.game) {
    return response(409, { error: apiGameErrors.gameNotStarted });
  }

  const playerId = String(body.playerId || "");
  if (!playerId) {
    return response(400, { error: apiGameErrors.playerIdRequired });
  }

  const diceResult = rollDie(random);
  const result = revealCardAtDiceResult(room.game, playerId, diceResult);
  if (result.error) {
    return response(statusForRuleError(result.error), { error: result.error });
  }

  room.game.dice.lastRoll = {
    playerId,
    result: diceResult,
    position: result.card.position
  };

  await store.saveRoom(room);
  return response(
    200,
    store.decorate({
      room: publicRoom(room, playerId),
      turn: {
        playerId,
        diceResult,
        position: result.card.position,
        scoreDelta: result.scoreDelta,
        eliminated: result.eliminated,
        finished: result.finished,
        winnerIds: result.winnerIds
      }
    })
  );
}

function statusForRuleError(error) {
  if (error === gameRuleErrors.playerNotFound) {
    return 404;
  }

  if (
    error === gameRuleErrors.notYourTurn ||
    error === gameRuleErrors.eliminatedPlayer ||
    error === gameRuleErrors.draftAlreadyComplete ||
    error === gameRuleErrors.positionAlreadyUsed ||
    error === gameRuleErrors.gameFinished
  ) {
    return 409;
  }

  return 400;
}

function response(status, payload) {
  return { status, payload };
}
