export const DICE_MIN = 1;
export const DICE_MAX = 6;

export function rollDie(random = Math.random) {
  return DICE_MIN + Math.floor(normalizeRandom(random) * DICE_MAX);
}

export function diceResultToPosition(result) {
  const position = Number(result);

  if (!Number.isInteger(position) || position < DICE_MIN || position > DICE_MAX) {
    return { error: "invalidDiceResult" };
  }

  return { position };
}

function normalizeRandom(random) {
  const value = typeof random === "function" ? Number(random()) : Number.NaN;

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1 - Number.EPSILON;
  }

  return value;
}
