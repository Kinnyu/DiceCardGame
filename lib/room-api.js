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
  recordDiceRoll,
  revealCardAtPosition,
  selectDraftCard,
  useCardAtPosition
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

  if (!["", "join", "leave", "settings", "start", "draft", "arrange", "roll", "reveal", "use", "turn"].includes(route.action)) {
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

  if (method === "POST" && route.action === "settings") {
    return updateRoomSettings({ room, body, store });
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

  if (method === "POST" && route.action === "reveal") {
    return revealTurn({ room, body, store });
  }

  if (method === "POST" && route.action === "use") {
    return useTurn({ room, body, store });
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

async function updateRoomSettings({ room, body, store }) {
  if (room.hostId !== String(body.playerId || "")) {
    return response(403, { error: errors.hostOnly });
  }

  if (room.status !== "waiting") {
    return response(409, { error: errors.gameAlreadyStarted });
  }

  const totalRounds = Number(body.totalRounds);
  if (![15, 20].includes(totalRounds)) {
    return response(400, { error: errors.invalidTotalRounds });
  }

  room.totalRounds = totalRounds;
  await store.saveRoom(room);
  return response(200, store.decorate({ room: publicRoom(room, body.playerId) }));
}

async function beginGame({ room, body, store, random }) {
  const result = startRoom(room, body.playerId, { random, totalRounds: body.totalRounds ?? room.totalRounds });
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
  const result = recordDiceRoll(room.game, playerId, diceResult);
  if (result.error) {
    return response(statusForRuleError(result.error), { error: result.error });
  }

  await store.saveRoom(room);
  return response(
    200,
    store.decorate({
      room: publicRoom(room, playerId),
      turn: {
        playerId,
        diceResult,
        position: result.position,
        status: "pending"
      }
    })
  );
}

async function revealTurn({ room, body, store }) {
  if (!room.game) {
    return response(409, { error: apiGameErrors.gameNotStarted });
  }

  const playerId = String(body.playerId || "");
  if (!playerId) {
    return response(400, { error: apiGameErrors.playerIdRequired });
  }

  const result = revealCardAtPosition(room.game, playerId, Number(body.position));
  if (result.error) {
    return response(statusForRuleError(result.error), { error: result.error });
  }

  await store.saveRoom(room);
  return response(
    200,
    store.decorate({
      room: publicRoom(room, playerId),
      turn: {
        playerId,
        position: result.card.position,
        status: "revealed"
      }
    })
  );
}

async function useTurn({ room, body, store }) {
  if (!room.game) {
    return response(409, { error: apiGameErrors.gameNotStarted });
  }

  const playerId = String(body.playerId || "");
  if (!playerId) {
    return response(400, { error: apiGameErrors.playerIdRequired });
  }

  const result = useCardAtPosition(room.game, playerId, Number(body.position));
  if (result.error) {
    return response(statusForRuleError(result.error), { error: result.error });
  }

  await store.saveRoom(room);
  return response(
    200,
    store.decorate({
      room: publicRoom(room, playerId),
      turn: {
        playerId,
        position: result.card.position,
        status: "used",
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
    error === gameRuleErrors.pendingTurnExists ||
    error === gameRuleErrors.noPendingTurn ||
    error === gameRuleErrors.targetPositionMismatch ||
    error === gameRuleErrors.cardNotRevealed ||
    error === gameRuleErrors.gameFinished
  ) {
    return 409;
  }

  return 400;
}

function response(status, payload) {
  return { status, payload };
}
