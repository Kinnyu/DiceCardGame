import { createGameDeck } from "./cards.js";
import { createGameState, publicGameState } from "./game-state.js";
import { dealInitialHands } from "./game-rules.js";

export const ROOM_CODE_LENGTH = 5;
export const MAX_PLAYERS = 4;
export const ROOM_TTL_SECONDS = 60 * 60 * 6;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const errors = {
  invalidName: "請輸入暱稱後再進房。",
  roomFull: "這個房間已經滿了。",
  roomNotFound: "找不到房間，請確認房號。",
  apiNotFound: "找不到這個 API。",
  gameAlreadyStarted: "遊戲已經開始，暫時不能加入。",
  hostOnly: "只有房主可以開始遊戲。",
  notEnoughPlayers: "至少需要兩位玩家才能開始。",
  unsupportedAction: "這個操作不支援。",
  storageNotConfigured:
    "雲端房間儲存尚未設定。正式 Vercel 部署需要 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN。"
};

export function createEmptyRoom(code) {
  return {
    code,
    hostId: "",
    status: "waiting",
    players: [],
    game: null
  };
}

export async function makeRoomCode(roomExists) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }

    if (!(await roomExists(code))) {
      return code;
    }
  }

  throw new Error("Could not create a unique room code.");
}

export function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 18);
}

export function cleanCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function publicRoom(room, options = {}) {
  const view = {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId
    }))
  };

  if (room.game) {
    view.game = publicGameStateForPlayer(room.game, options.playerId);
  }

  return view;
}

function publicGameStateForPlayer(game, playerId) {
  const view = publicGameState(game);
  const id = String(playerId || "");

  if (!id) {
    return view;
  }

  const privatePlayer = game.players.find((player) => player.id === id);
  const publicPlayer = view.players.find((player) => player.id === id);

  if (privatePlayer && publicPlayer) {
    publicPlayer.hand = privatePlayer.hand.map((card) => publicOwnHandCard(card));
  }

  return view;
}

function publicOwnHandCard(card) {
  return {
    id: card.id ?? "",
    instanceId: card.instanceId ?? "",
    name: card.name ?? "",
    type: card.type ?? "",
    value: card.value ?? null,
    effect: card.effect ?? ""
  };
}

export function addOrUpdatePlayer(room, playerId, name) {
  const playerName = cleanName(name);
  const id = String(playerId || "");

  if (!id || !playerName) {
    return { error: errors.invalidName };
  }

  const existing = room.players.find((player) => player.id === id);
  if (existing) {
    existing.name = playerName;
    return { player: existing };
  }

  if (room.players.length >= MAX_PLAYERS) {
    return { error: errors.roomFull };
  }

  const player = { id, name: playerName };
  room.players.push(player);

  if (!room.hostId) {
    room.hostId = player.id;
  }

  return { player };
}

export function removePlayer(room, playerId) {
  const id = String(playerId || "");
  room.players = room.players.filter((player) => player.id !== id);

  if (room.hostId === id) {
    room.hostId = room.players[0]?.id || "";
  }

  return room;
}

export function startRoom(room, playerId) {
  if (room.hostId !== playerId) {
    return { error: errors.hostOnly, status: 403 };
  }

  if (room.status !== "waiting") {
    return { error: errors.gameAlreadyStarted, status: 409 };
  }

  if (room.players.length < 2) {
    return { error: errors.notEnoughPlayers, status: 400 };
  }

  const game = createGameState(room.players);
  const deck = createGameDeck(room.players.length);
  const dealResult = dealInitialHands(game, deck);

  if (dealResult.error) {
    return { error: dealResult.error, status: 500 };
  }

  room.status = "playing";
  room.game = game;
  return { room };
}
