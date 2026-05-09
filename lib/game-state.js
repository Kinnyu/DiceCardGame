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
