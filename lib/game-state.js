export const INITIAL_SCORE = 10;
export const GAME_PHASE_SETUP = "setup";
export const GAME_DIRECTION_CLOCKWISE = "clockwise";

export function createGameState(players) {
  return {
    phase: GAME_PHASE_SETUP,
    turnPlayerId: "",
    firstPlayerId: "",
    direction: GAME_DIRECTION_CLOCKWISE,
    dice: {
      lastRoll: null
    },
    players: players.map((player) => createGamePlayer(player)),
    winnerIds: [],
    log: []
  };
}

export function createGamePlayer(player) {
  return {
    id: String(player.id || ""),
    name: String(player.name || ""),
    score: INITIAL_SCORE,
    eliminated: false,
    deckCount: 0,
    hand: [],
    arrangedCards: [],
    receivedCards: [],
    usedPositions: []
  };
}

export function publicGameState(game) {
  if (!game) {
    return null;
  }

  return {
    phase: game.phase,
    turnPlayerId: game.turnPlayerId,
    firstPlayerId: game.firstPlayerId,
    direction: game.direction,
    dice: {
      lastRoll: game.dice?.lastRoll ?? null
    },
    players: game.players.map((player) => publicGamePlayer(player)),
    winnerIds: [...game.winnerIds],
    log: game.log.map((entry) => publicGameLogEntry(entry))
  };
}

function publicGamePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    eliminated: player.eliminated,
    deckCount: player.deckCount,
    handCount: player.hand.length,
    arrangedCards: player.arrangedCards.map((card) => publicCard(card)),
    receivedCards: player.receivedCards.map((card) => publicCard(card)),
    usedPositions: [...player.usedPositions]
  };
}

function publicCard(card) {
  if (!card || typeof card !== "object") {
    return null;
  }

  const view = {
    id: card.id ?? "",
    position: card.position ?? null,
    faceUp: Boolean(card.faceUp || card.revealed)
  };

  if (view.faceUp) {
    view.type = card.type ?? "";
    view.value = card.value ?? null;
    view.effect = card.effect ?? "";
  }

  return view;
}

function publicGameLogEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return entry ?? null;
  }

  return {
    id: entry.id ?? "",
    type: entry.type ?? "",
    message: entry.message ?? "",
    playerId: entry.playerId ?? "",
    createdAt: entry.createdAt ?? ""
  };
}
