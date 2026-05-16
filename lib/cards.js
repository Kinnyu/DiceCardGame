export const HAND_SIZE = 6;
export const DRAFT_PLUS_CARD_COUNT = 3;
export const DRAFT_MINUS_CARD_COUNT = 3;
export const CARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "plus-1",
    name: "+1 \u5206",
    type: "score",
    value: 1,
    description: "\u7372\u5f97 1 \u5206"
  }),
  Object.freeze({
    id: "plus-2",
    name: "+2 \u5206",
    type: "score",
    value: 2,
    description: "\u7372\u5f97 2 \u5206"
  }),
  Object.freeze({
    id: "plus-3",
    name: "+3 \u5206",
    type: "score",
    value: 3,
    description: "\u7372\u5f97 3 \u5206"
  }),
  Object.freeze({
    id: "minus-1",
    name: "-1 \u5206",
    type: "score",
    value: -1,
    description: "\u6263\u9664 1 \u5206"
  }),
  Object.freeze({
    id: "minus-2",
    name: "-2 \u5206",
    type: "score",
    value: -2,
    description: "\u6263\u9664 2 \u5206"
  }),
  Object.freeze({
    id: "minus-3",
    name: "-3 \u5206",
    type: "score",
    value: -3,
    description: "\u6263\u9664 3 \u5206"
  }),
  Object.freeze({
    id: "invert",
    name: "\u6b63\u8ca0\u53cd\u8f49",
    type: "invert",
    value: 0,
    description: "\u672c\u56de\u5408\u5c07\u5206\u6578\u724c\u7684\u52a0\u5206\u8207\u6263\u5206\u53cd\u8f49"
  }),
  Object.freeze({
    id: "refill-two",
    name: "\u88dc\u5169\u5f35\u724c",
    type: "refillTwo",
    value: 0,
    drawCount: 2,
    description: "\u5f9e\u81ea\u5df1\u7684\u88dc\u724c\u724c\u5eab\u6700\u591a\u88dc 2 \u5f35\u724c"
  }),
  Object.freeze({
    id: "seal",
    name: "\u5c01\u5370",
    type: "seal",
    value: 0,
    durationTurns: 2,
    description: "\u5c01\u5370\u4e00\u5f35\u5834\u4e0a\u724c 2 \u56de\u5408"
  }),
  Object.freeze({
    id: "swap",
    name: "\u4ea4\u63db\u724c",
    type: "swap",
    value: 0,
    description: "\u4ea4\u63db\u5834\u4e0a\u6307\u5b9a\u7684\u724c"
  }),
  Object.freeze({
    id: "clear",
    name: "\u6e05\u9664\u724c",
    type: "clear",
    value: 0,
    description: "\u6e05\u9664\u81ea\u5df1\u5834\u4e0a\u4e00\u5f35\u724c"
  }),
  Object.freeze({
    id: "steal",
    name: "\u5077\u5206\u724c",
    type: "steal",
    value: 0,
    stealAmount: 1,
    description: "\u5f9e\u6307\u5b9a\u73a9\u5bb6\u5077\u53d6 1 \u5206"
  }),
  Object.freeze({
    id: "bomb",
    name: "\u70b8\u5f48\u724c",
    type: "bomb",
    value: 0,
    countdown: 3,
    damage: -5,
    description: "\u7ffb\u958b\u5f8c\u9032\u5165 3 \u56de\u5408\u5012\u6578\uff0c\u7206\u70b8\u6642\u6263 5 \u5206"
  })
]);
export const DRAFT_CARD_COUNT = CARD_DEFINITIONS.length;

export function cloneCard(card) {
  const value = Number(card.value);
  const description = card.description ?? card.effect ?? "";
  const cloned = {
    id: String(card.id || ""),
    name: String(card.name || ""),
    type: String(card.type || ""),
    value: Number.isFinite(value) ? value : 0,
    description: String(description)
  };

  for (const key of ["drawCount", "durationTurns", "stealAmount", "countdown", "damage"]) {
    if (Object.hasOwn(card, key)) {
      const number = Number(card[key]);
      if (Number.isFinite(number)) {
        cloned[key] = number;
      }
    }
  }

  return cloned;
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
  const requiredCards = Math.max(0, Number(playerCount || 0)) * handSize;
  const definitions = cardDefinitions.length > 0 ? cardDefinitions : CARD_DEFINITIONS;
  const copiesPerCard = Math.ceil(requiredCards / definitions.length);

  return createShuffledDeck({ cardDefinitions: definitions, copiesPerCard, random }).slice(0, requiredCards);
}

export function createDraftCards(playerId, options = {}) {
  const {
    cardDefinitions = CARD_DEFINITIONS,
    uniquePrefix = "",
    random = Math.random
  } = options;
  const ownerPrefix = sanitizeInstanceIdPart(uniquePrefix || playerId || "player");
  const sourcePlayerId = String(playerId || "");
  const sourceSetId = ownerPrefix;
  const draftCards = cardDefinitions.flatMap((definition) =>
    createDraftCardCopies({
      definition,
      count: 1,
      ownerPrefix,
      sourcePlayerId,
      sourceSetId
    })
  );

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

function createDraftCardCopies({ definition, count, ownerPrefix, sourcePlayerId = "", sourceSetId = ownerPrefix }) {
  const copyCount = Math.max(0, Math.floor(Number(count || 0)));
  const copies = [];

  for (let index = 0; index < copyCount; index += 1) {
    const card = cloneCard(definition);
    copies.push({
      ...card,
      instanceId: `${ownerPrefix}-${card.id}-${String(index + 1).padStart(3, "0")}`,
      sourcePlayerId,
      sourceSetId
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
