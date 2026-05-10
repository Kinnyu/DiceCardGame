export const HAND_SIZE = 6;
export const DRAFT_PLUS_CARD_COUNT = 5;
export const DRAFT_MINUS_CARD_COUNT = 5;
export const DRAFT_CARD_COUNT = DRAFT_PLUS_CARD_COUNT + DRAFT_MINUS_CARD_COUNT;
export const CARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "plus-2",
    name: "+2 \u5206",
    type: "score",
    value: 2,
    description: ""
  })
]);

export function cloneCard(card) {
  const value = Number(card.value);
  const description = card.description ?? card.effect ?? "";

  return {
    id: String(card.id || ""),
    name: String(card.name || ""),
    type: String(card.type || ""),
    value: Number.isFinite(value) ? value : 0,
    description: String(description)
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

export function createDraftCards(playerId, options = {}) {
  const {
    plusCount = DRAFT_PLUS_CARD_COUNT,
    minusCount = DRAFT_MINUS_CARD_COUNT,
    uniquePrefix = "",
    random = Math.random
  } = options;
  const ownerPrefix = sanitizeInstanceIdPart(uniquePrefix || playerId || "player");
  const draftCards = [
    ...createDraftCardCopies({
      definition: {
        id: "plus-1",
        name: "+1 \u5206",
        type: "score",
        value: 1,
        description: "\u7372\u5f97 1 \u5206"
      },
      count: plusCount,
      ownerPrefix
    }),
    ...createDraftCardCopies({
      definition: {
        id: "minus-1",
        name: "-1 \u5206",
        type: "score",
        value: -1,
        description: "\u6263\u9664 1 \u5206"
      },
      count: minusCount,
      ownerPrefix
    })
  ];

  return shuffleDeck(draftCards, random);
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

function createDraftCardCopies({ definition, count, ownerPrefix }) {
  const copyCount = Math.max(0, Math.floor(Number(count || 0)));
  const copies = [];

  for (let index = 0; index < copyCount; index += 1) {
    const card = cloneCard(definition);
    copies.push({
      ...card,
      instanceId: `${ownerPrefix}-${card.id}-${String(index + 1).padStart(3, "0")}`
    });
  }

  return copies;
}

function sanitizeInstanceIdPart(value) {
  const safeValue = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safeValue || "player";
}
