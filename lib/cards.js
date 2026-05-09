export const HAND_SIZE = 6;
export const CARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "plus-2",
    name: "+2 \u5206",
    type: "score",
    value: 2,
    effect: ""
  })
]);

export function cloneCard(card) {
  const value = Number(card.value);

  return {
    id: String(card.id || ""),
    name: String(card.name || ""),
    type: String(card.type || ""),
    value: Number.isFinite(value) ? value : 0,
    effect: String(card.effect || "")
  };
}

export function createDeck(cardDefinitions = CARD_DEFINITIONS, copiesPerCard = HAND_SIZE) {
  const deck = [];

  for (const card of cardDefinitions) {
    for (let copyIndex = 0; copyIndex < copiesPerCard; copyIndex += 1) {
      deck.push({
        ...cloneCard(card),
        instanceId: `${card.id}-${copyIndex + 1}`
      });
    }
  }

  return deck;
}

export function shuffleDeck(deck, random = Math.random) {
  const shuffled = deck.map((card) => ({ ...card }));

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(normalizeRandom(random) * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function drawCards(deck, count = HAND_SIZE) {
  const drawCount = Math.max(0, Math.min(count, deck.length));

  return {
    drawn: deck.slice(0, drawCount).map((card) => ({ ...card })),
    deck: deck.slice(drawCount).map((card) => ({ ...card }))
  };
}

export function drawHand(deck) {
  return drawCards(deck, HAND_SIZE);
}

export function createShuffledDeck(options = {}) {
  const {
    cardDefinitions = CARD_DEFINITIONS,
    copiesPerCard = HAND_SIZE,
    random = Math.random
  } = options;

  return shuffleDeck(createDeck(cardDefinitions, copiesPerCard), random);
}

export function createGameDeck(playerCount, options = {}) {
  const {
    cardDefinitions = CARD_DEFINITIONS,
    handSize = HAND_SIZE,
    random = Math.random
  } = options;
  const copiesPerCard = Math.max(0, Number(playerCount || 0)) * handSize;

  return createShuffledDeck({ cardDefinitions, copiesPerCard, random });
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
