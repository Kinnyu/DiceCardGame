export function publicGameState(game, viewerPlayerId = "") {
  return publicGame(game, viewerPlayerId);
}

export function publicGame(game, viewerPlayerId = "") {
  if (!game) {
    return null;
  }

  const viewerId = String(viewerPlayerId || "");

  return {
    phase: game.phase,
    turnPlayerId: game.turnPlayerId,
    firstPlayerId: game.firstPlayerId,
    direction: game.direction,
    dice: {
      lastRoll: game.dice?.lastRoll ?? null
    },
    players: game.players.map((player) => publicPlayerGameState(player, viewerId)),
    winnerIds: [...game.winnerIds],
    log: game.log.map((entry) => publicGameLogEntry(entry))
  };
}

export function publicPlayerGameState(player, viewerPlayerId = "") {
  const isViewer = Boolean(viewerPlayerId) && player.id === viewerPlayerId;
  const view = {
    id: player.id,
    name: player.name,
    score: player.score,
    eliminated: player.eliminated,
    deckCount: player.deckCount,
    handCount: player.hand.length,
    arrangedCards: player.arrangedCards.map((card) => publicCard(card, { revealHidden: isViewer })),
    receivedCards: player.receivedCards.map((card) => publicCard(card, { usedPositions: player.usedPositions })),
    usedPositions: [...player.usedPositions]
  };

  if (isViewer) {
    view.hand = player.hand.map((card) => publicHandCard(card));
  }

  return view;
}

function publicCard(card, options = {}) {
  if (!card || typeof card !== "object") {
    return null;
  }

  const revealed = Boolean(options.revealHidden || card.faceUp || card.revealed);
  const position = card.position ?? null;
  const view = {
    position,
    used: Array.isArray(options.usedPositions) ? options.usedPositions.includes(position) : Boolean(card.used),
    revealed
  };

  if (revealed) {
    view.id = card.id ?? "";
    view.name = card.name ?? "";
    view.type = card.type ?? "";
    view.value = card.value ?? null;
    view.effect = card.effect ?? "";
  }

  return view;
}

function publicHandCard(card) {
  if (!card || typeof card !== "object") {
    return null;
  }

  return {
    id: card.id ?? "",
    instanceId: card.instanceId ?? "",
    name: card.name ?? "",
    type: card.type ?? "",
    value: card.value ?? null,
    effect: card.effect ?? ""
  };
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
