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
  const draftCards = Array.isArray(player.draftCards) ? player.draftCards : [];
  const hand = Array.isArray(player.hand) ? player.hand : [];
  const arrangedCards = Array.isArray(player.arrangedCards) ? player.arrangedCards : [];
  const receivedCards = Array.isArray(player.receivedCards) ? player.receivedCards : [];
  const usedPositions = Array.isArray(player.usedPositions) ? player.usedPositions : [];
  const view = {
    id: player.id,
    name: player.name,
    score: player.score,
    eliminated: player.eliminated,
    deckCount: player.deckCount,
    draftCardCount: draftCards.length,
    handCount: hand.length,
    arrangedCards: arrangedCards.map((card) => publicCard(card, { revealHidden: isViewer })),
    receivedCards: receivedCards.map((card) => publicCard(card, { usedPositions })),
    usedPositions: [...usedPositions]
  };

  if (isViewer) {
    view.draftCards = draftCards.map((card) => publicHandCard(card));
    view.hand = hand.map((card) => publicHandCard(card));
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
    effect: card.effect ?? "",
    description: card.description ?? ""
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
