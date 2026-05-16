export const INITIAL_SCORE = 10;
export const GAME_PHASE_SETUP = "setup";
export const GAME_DIRECTION_CLOCKWISE = "clockwise";
export const DEFAULT_TOTAL_ROUNDS = 15;
export const ALLOWED_TOTAL_ROUNDS = Object.freeze([15, 20]);

export function normalizeTotalRounds(value) {
  const totalRounds = Number(value);
  return ALLOWED_TOTAL_ROUNDS.includes(totalRounds) ? totalRounds : DEFAULT_TOTAL_ROUNDS;
}

export function isAllowedTotalRounds(value) {
  return ALLOWED_TOTAL_ROUNDS.includes(Number(value));
}

export function createGameState(players, options = {}) {
  return {
    phase: GAME_PHASE_SETUP,
    totalRounds: normalizeTotalRounds(options.totalRounds),
    currentRound: 1,
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
    draftCards: [],
    selectedDraftCards: [],
    drawDeck: [],
    hand: [],
    arrangedCards: [],
    receivedCards: [],
    usedPositions: []
  };
}
