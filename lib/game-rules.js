import { drawCards, drawHand, HAND_SIZE } from "./cards.js";
import { diceResultToPosition } from "./dice.js";
import { GAME_PHASE_SETUP, INITIAL_SCORE } from "./game-state.js";

export const GAME_PHASE_ARRANGING = "arranging";
export const GAME_PHASE_DRAFTING = "drafting";
export const GAME_PHASE_PLAYING = "playing";
export const GAME_PHASE_FINISHED = "finished";
export const RIGHT_PASS_DIRECTION = 1;

export const gameRuleErrors = {
  playerNotFound: "playerNotFound",
  eliminatedPlayer: "eliminatedPlayer",
  invalidHandSize: "invalidHandSize",
  invalidArrangement: "invalidArrangement",
  duplicateCard: "duplicateCard",
  draftAlreadyComplete: "draftAlreadyComplete",
  invalidDraftCard: "invalidDraftCard",
  invalidPosition: "invalidPosition",
  positionAlreadyUsed: "positionAlreadyUsed",
  noCardAtPosition: "noCardAtPosition",
  pendingTurnExists: "pendingTurnExists",
  noPendingTurn: "noPendingTurn",
  targetPositionMismatch: "targetPositionMismatch",
  cardNotRevealed: "cardNotRevealed",
  gameFinished: "gameFinished",
  invalidPhase: "invalidPhase",
  playersNotReady: "playersNotReady",
  notYourTurn: "notYourTurn",
  deckTooSmall: "deckTooSmall",
  invalidScoreDelta: "invalidScoreDelta",
  noActivePlayers: "noActivePlayers"
};

export function dealInitialHands(game, deck, handSize = HAND_SIZE) {
  if (game.phase !== GAME_PHASE_SETUP) {
    return { error: gameRuleErrors.invalidPhase };
  }

  const drawSize = Number(handSize);
  if (!Number.isInteger(drawSize) || drawSize <= 0) {
    return { error: gameRuleErrors.invalidHandSize };
  }

  const players = getActivePlayers(game);
  const requiredCards = players.length * drawSize;
  if (!Array.isArray(deck) || deck.length < requiredCards) {
    return {
      error: gameRuleErrors.deckTooSmall,
      requiredCards,
      availableCards: Array.isArray(deck) ? deck.length : 0
    };
  }

  for (const player of players) {
    const result = drawSize === HAND_SIZE ? drawHand(deck) : drawCards(deck, drawSize);
    player.hand = result.drawn.map((card) => prepareHandCard(card));
    player.deckCount = 0;
    deck = result.deck;
  }

  game.phase = GAME_PHASE_ARRANGING;
  return { game, deck };
}

export function selectDraftCard(game, playerId, cardInstanceId) {
  if (game.phase === GAME_PHASE_FINISHED) {
    return { error: gameRuleErrors.gameFinished };
  }

  if (game.phase !== GAME_PHASE_DRAFTING) {
    return { error: gameRuleErrors.invalidPhase };
  }

  const player = findPlayer(game, playerId);
  if (!player) {
    return { error: gameRuleErrors.playerNotFound };
  }

  if (player.eliminated) {
    return { error: gameRuleErrors.eliminatedPlayer };
  }

  const selectedDraftCards = Array.isArray(player.selectedDraftCards) ? player.selectedDraftCards : [];
  if (selectedDraftCards.length >= HAND_SIZE) {
    return { error: gameRuleErrors.draftAlreadyComplete };
  }

  const instanceId = String(cardInstanceId || "");
  const draftCards = Array.isArray(player.draftCards) ? player.draftCards : [];
  const card = draftCards.find((candidate) => candidate?.instanceId === instanceId);
  if (!card) {
    return { error: gameRuleErrors.invalidDraftCard };
  }

  if (selectedDraftCards.some((selectedCard) => selectedCard?.instanceId === instanceId)) {
    return { error: gameRuleErrors.duplicateCard };
  }

  player.selectedDraftCards = [...selectedDraftCards, prepareHandCard(card)];
  if (player.selectedDraftCards.length === HAND_SIZE) {
    player.hand = player.selectedDraftCards.map((selectedCard) => prepareHandCard(selectedCard));
  }

  if (
    getActivePlayers(game).every(
      (candidate) => Array.isArray(candidate.selectedDraftCards) && candidate.selectedDraftCards.length === HAND_SIZE
    )
  ) {
    game.phase = GAME_PHASE_ARRANGING;
  }

  return { game, player, card: player.selectedDraftCards.at(-1) };
}

export function arrangePlayerCards(game, playerId, orderedCardInstanceIds) {
  if (game.phase !== GAME_PHASE_ARRANGING) {
    return { error: gameRuleErrors.invalidPhase };
  }

  const player = findPlayer(game, playerId);

  if (!player) {
    return { error: gameRuleErrors.playerNotFound };
  }

  if (player.eliminated) {
    return { error: gameRuleErrors.eliminatedPlayer };
  }

  const sourceCards = Array.isArray(player.selectedDraftCards) ? player.selectedDraftCards : [];

  if (
    !Array.isArray(orderedCardInstanceIds) ||
    orderedCardInstanceIds.length !== HAND_SIZE ||
    sourceCards.length !== HAND_SIZE
  ) {
    return { error: gameRuleErrors.invalidHandSize };
  }

  const ids = orderedCardInstanceIds.map((id) => String(id || ""));
  if (new Set(ids).size !== HAND_SIZE) {
    return { error: gameRuleErrors.duplicateCard };
  }

  const arrangedCards = [];
  const usedCardIndexes = new Set();
  for (let index = 0; index < ids.length; index += 1) {
    const cardIndex = findUnusedCardInstanceIndex(sourceCards, ids[index], usedCardIndexes);

    if (cardIndex === -1) {
      return { error: gameRuleErrors.invalidArrangement };
    }

    usedCardIndexes.add(cardIndex);
    arrangedCards.push(prepareArrangedCard(sourceCards[cardIndex], index + 1));
  }

  player.arrangedCards = arrangedCards;
  player.hand = [];
  return { game, player };
}

export function passArrangedCardsRight(game) {
  if (game.phase !== GAME_PHASE_ARRANGING) {
    return { error: gameRuleErrors.invalidPhase };
  }

  const activePlayers = getActivePlayers(game);
  if (activePlayers.length === 0) {
    return { error: gameRuleErrors.noActivePlayers };
  }

  const allPlayersReady = activePlayers.every((player) => player.arrangedCards.length === HAND_SIZE);
  if (!allPlayersReady) {
    return { error: gameRuleErrors.playersNotReady };
  }

  const passedCards = activePlayers.map((player) => player.arrangedCards.map((card) => ({ ...card })));

  for (let index = 0; index < activePlayers.length; index += 1) {
    const receiverIndex = wrapIndex(index + RIGHT_PASS_DIRECTION, activePlayers.length);
    activePlayers[receiverIndex].receivedCards = passedCards[index];
    activePlayers[index].arrangedCards = [];
  }

  for (const player of game.players) {
    if (player.eliminated) {
      player.receivedCards = [];
    }
  }

  const firstActivePlayer = getActivePlayers(game)[0] || null;
  game.turnPlayerId = firstActivePlayer?.id || "";
  game.firstPlayerId = firstActivePlayer?.id || "";
  game.phase = GAME_PHASE_PLAYING;

  return { game };
}

export function revealCardAtDiceResult(game, playerId, diceResult) {
  const positionResult = diceResultToPosition(diceResult);
  if (positionResult.error) {
    return positionResult;
  }

  return revealCardAtPosition(game, playerId, positionResult.position);
}

export function recordDiceRoll(game, playerId, diceResult) {
  const positionResult = diceResultToPosition(diceResult);
  if (positionResult.error) {
    return positionResult;
  }

  const turnResult = validatePlayableTurn(game, playerId, positionResult.position);
  if (turnResult.error) {
    return turnResult;
  }

  const pendingTurn = getPendingTurn(game);
  if (pendingTurn && pendingTurn.playerId === turnResult.player.id) {
    return { error: gameRuleErrors.pendingTurnExists };
  }

  game.dice.lastRoll = {
    playerId: turnResult.player.id,
    result: diceResult,
    position: positionResult.position,
    status: "pending"
  };

  return {
    game,
    player: turnResult.player,
    card: turnResult.card,
    diceResult,
    position: positionResult.position
  };
}

export function revealCardAtPosition(game, playerId, position) {
  const turnResult = validatePlayableTurn(game, playerId, position);
  if (turnResult.error) {
    return turnResult;
  }

  const pendingTurn = getPendingTurn(game);
  if (!pendingTurn || pendingTurn.playerId !== turnResult.player.id) {
    return { error: gameRuleErrors.noPendingTurn };
  }

  if (pendingTurn.position !== position) {
    return { error: gameRuleErrors.targetPositionMismatch };
  }

  const { player, card } = turnResult;
  card.faceUp = true;
  card.revealed = true;
  game.dice.lastRoll = {
    ...pendingTurn,
    status: "revealed"
  };

  return {
    game,
    player,
    card,
    finished: false,
    winnerIds: []
  };
}

export function useCardAtPosition(game, playerId, position) {
  const turnResult = validatePlayableTurn(game, playerId, position);
  if (turnResult.error) {
    return turnResult;
  }

  const pendingTurn = getPendingTurn(game);
  if (!pendingTurn || pendingTurn.playerId !== turnResult.player.id) {
    return { error: gameRuleErrors.noPendingTurn };
  }

  if (pendingTurn.position !== position) {
    return { error: gameRuleErrors.targetPositionMismatch };
  }

  const { player, card } = turnResult;
  if (!card.revealed) {
    return { error: gameRuleErrors.cardNotRevealed };
  }

  card.used = true;
  if (!player.usedPositions.includes(position)) {
    player.usedPositions.push(position);
  }

  const effectResult = applyCardEffect(game, player, card);
  const endResult = resolveGameEnd(game);
  if (!endResult.finished) {
    game.turnPlayerId = getNextPlayerId(game, player.id);
  }

  game.dice.lastRoll = {
    ...pendingTurn,
    status: "used",
    scoreDelta: effectResult.scoreDelta,
    eliminated: player.eliminated,
    finished: endResult.finished,
    winnerIds: endResult.winnerIds
  };

  return {
    game,
    player,
    card,
    scoreDelta: effectResult.scoreDelta,
    eliminated: player.eliminated,
    finished: endResult.finished,
    winnerIds: endResult.winnerIds
  };
}

export function usePendingCard(game, playerId) {
  const pendingTurn = getPendingTurn(game);
  if (!pendingTurn) {
    return { error: gameRuleErrors.noPendingTurn };
  }

  return useCardAtPosition(game, playerId, pendingTurn.position);
}

export function applyCardEffect(game, playerOrId, card) {
  const player = typeof playerOrId === "string" ? findPlayer(game, playerOrId) : playerOrId;

  if (!player) {
    return { error: gameRuleErrors.playerNotFound };
  }

  if (!card || card.type !== "score") {
    return { game, player, scoreDelta: 0 };
  }

  return updatePlayerScore(game, player.id, finiteNumber(card.value, 0));
}

export function updatePlayerScore(game, playerId, scoreDelta) {
  const player = findPlayer(game, playerId);

  if (!player) {
    return { error: gameRuleErrors.playerNotFound };
  }

  const safeScoreDelta = finiteNumber(scoreDelta, 0);
  const currentScore = finiteNumber(player.score, INITIAL_SCORE);

  player.score = currentScore + safeScoreDelta;
  if (player.score <= 0) {
    player.score = 0;
    player.eliminated = true;
  }

  return { game, player, scoreDelta: safeScoreDelta, eliminated: player.eliminated };
}

export function getNextPlayerId(game, currentPlayerId) {
  const activePlayers = getActivePlayers(game);

  if (activePlayers.length === 0) {
    return "";
  }

  const currentIndex = game.players.findIndex((player) => player.id === currentPlayerId);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;

  for (let offset = 1; offset <= game.players.length; offset += 1) {
    const candidate = game.players[wrapIndex(startIndex + offset, game.players.length)];
    if (candidate && !candidate.eliminated) {
      return candidate.id;
    }
  }

  return activePlayers[0].id;
}

export function resolveGameEnd(game) {
  const activePlayers = getActivePlayers(game);
  const allPositionsUsed = activePlayers.every((player) => player.usedPositions.length >= HAND_SIZE);
  const finished = activePlayers.length <= 1 || (activePlayers.length > 0 && allPositionsUsed);

  if (!finished) {
    game.winnerIds = [];
    return { finished: false, winnerIds: [] };
  }

  const winnerIds = determineWinnerIds(game);
  game.phase = GAME_PHASE_FINISHED;
  game.turnPlayerId = "";
  game.winnerIds = winnerIds;

  return { finished: true, winnerIds };
}

export function determineWinnerIds(game) {
  const activePlayers = getActivePlayers(game);
  const candidates = activePlayers.length > 0 ? activePlayers : game.players;
  const bestScore = Math.max(...candidates.map((player) => finiteNumber(player.score, 0)));

  return candidates.filter((player) => finiteNumber(player.score, 0) === bestScore).map((player) => player.id);
}

export function getActivePlayers(game) {
  return game.players.filter((player) => !player.eliminated);
}

function findPlayer(game, playerId) {
  return game.players.find((player) => player.id === playerId) || null;
}

function validatePlayableTurn(game, playerId, position) {
  if (game.phase === GAME_PHASE_FINISHED) {
    return { error: gameRuleErrors.gameFinished };
  }

  if (game.phase !== GAME_PHASE_PLAYING) {
    return { error: gameRuleErrors.invalidPhase };
  }

  const player = findPlayer(game, playerId);
  if (!player) {
    return { error: gameRuleErrors.playerNotFound };
  }

  if (game.turnPlayerId && game.turnPlayerId !== player.id) {
    return { error: gameRuleErrors.notYourTurn };
  }

  if (player.eliminated) {
    return { error: gameRuleErrors.eliminatedPlayer };
  }

  if (!Number.isInteger(position) || position < 1 || position > HAND_SIZE) {
    return { error: gameRuleErrors.invalidPosition };
  }

  if (player.usedPositions.includes(position)) {
    return { error: gameRuleErrors.positionAlreadyUsed };
  }

  const card = player.receivedCards.find((candidate) => candidate.position === position);
  if (!card) {
    return { error: gameRuleErrors.noCardAtPosition };
  }

  return { player, card };
}

function getPendingTurn(game) {
  const lastRoll = game?.dice?.lastRoll;
  if (!lastRoll || !["pending", "revealed"].includes(lastRoll.status)) {
    return null;
  }

  return {
    playerId: String(lastRoll.playerId || ""),
    result: lastRoll.result,
    position: Number(lastRoll.position),
    status: lastRoll.status
  };
}

function findUnusedCardInstanceIndex(cards, cardInstanceId, usedCardIndexes) {
  return cards.findIndex((card, index) => !usedCardIndexes.has(index) && card.instanceId === cardInstanceId);
}

function prepareHandCard(card) {
  return {
    ...card,
    faceUp: false,
    revealed: false
  };
}

function prepareArrangedCard(card, position) {
  return {
    ...prepareHandCard(card),
    position
  };
}

function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
