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
    totalRounds: game.totalRounds ?? 15,
    currentRound: game.currentRound ?? 1,
    turnPlayerId: game.turnPlayerId,
    firstPlayerId: game.firstPlayerId,
    direction: game.direction,
    dice: {
      lastRoll: game.dice?.lastRoll ?? null
    },
    players: game.players.map((player) => publicPlayerGameState(player, viewerId, { phase: game.phase })),
    winnerIds: [...game.winnerIds],
    log: game.log.map((entry) => publicGameLogEntry(entry))
  };
}

export function publicPlayerGameState(player, viewerPlayerId = "", options = {}) {
  const isViewer = Boolean(viewerPlayerId) && player.id === viewerPlayerId;
  const phase = String(options.phase || "");
  const exposePrivateDraft = isViewer && (!phase || phase === "setup" || phase === "drafting");
  const exposePrivateSelection = isViewer && (!phase || phase === "setup" || phase === "drafting" || phase === "arranging");
  const exposePrivateHand = isViewer && (!phase || phase === "setup" || phase === "arranging");
  const draftCards = Array.isArray(player.draftCards) ? player.draftCards : [];
  const hand = Array.isArray(player.hand) ? player.hand : [];
  const drawDeck = Array.isArray(player.drawDeck) ? player.drawDeck : [];
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
    drawDeckCount: drawDeck.length,
    handCount: hand.length,
    arrangedCards: arrangedCards.map((card) => publicCard(card, { revealFaceUp: true, revealHidden: isViewer })),
    receivedCards: receivedCards.map((card) => publicCard(card, { revealRevealed: isViewer, usedPositions })),
    usedPositions: [...usedPositions]
  };

  if (exposePrivateDraft) {
    view.draftCards = draftCards.map((card) => publicHandCard(card));
  }

  if (exposePrivateSelection) {
    view.selectedDraftCards = (Array.isArray(player.selectedDraftCards) ? player.selectedDraftCards : []).map((card) =>
      publicHandCard(card)
    );
  }

  if (exposePrivateHand) {
    view.hand = hand.map((card) => publicHandCard(card));
  }

  return view;
}

function publicCard(card, options = {}) {
  if (!card || typeof card !== "object") {
    return null;
  }

  const position = card.position ?? null;
  const usedFromPositions = Array.isArray(options.usedPositions) && options.usedPositions.includes(position);
  const used = Boolean(card.used) || usedFromPositions;
  const revealed = Boolean(
    used || options.revealHidden || (options.revealFaceUp && card.faceUp) || (options.revealRevealed && card.revealed)
  );
  const state = used ? "used" : revealed ? "revealed" : "hidden";
  const view = {
    position,
    used,
    revealed,
    state
  };

  if (revealed) {
    view.id = card.id ?? "";
    view.name = card.name ?? "";
    view.type = card.type ?? "";
    view.value = card.value ?? null;
    view.description = card.description ?? card.effect ?? "";
    copyPublicEffectMetadata(view, card);
  }

  return view;
}

function publicHandCard(card) {
  if (!card || typeof card !== "object") {
    return null;
  }

  const view = {
    id: card.id ?? "",
    instanceId: card.instanceId ?? "",
    name: card.name ?? "",
    type: card.type ?? "",
    value: card.value ?? null,
    description: card.description ?? card.effect ?? ""
  };
  copyPublicEffectMetadata(view, card);
  return view;
}

function copyPublicEffectMetadata(view, card) {
  for (const key of ["drawCount", "durationTurns", "stealAmount", "countdown", "damage"]) {
    if (Object.hasOwn(card, key)) {
      view[key] = card[key];
    }
  }
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
