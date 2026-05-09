import { cloneCard, createDeck, createGameDeck, HAND_SIZE, shuffleDeck } from "../lib/cards.js";
import { rollDie } from "../lib/dice.js";
import { createGameState, GAME_PHASE_SETUP, INITIAL_SCORE } from "../lib/game-state.js";
import {
  arrangePlayerCards,
  dealInitialHands,
  gameRuleErrors,
  GAME_PHASE_ARRANGING,
  GAME_PHASE_FINISHED,
  GAME_PHASE_PLAYING,
  passArrangedCardsRight,
  revealCardAtPosition,
  updatePlayerScore,
  applyCardEffect
} from "../lib/game-rules.js";

testSafeRandomRolls();
testSafeRandomShuffle();
testDealRequiresSetupPhaseWithoutMutating();
testPassRequiresArrangingAndReadyPlayers();
testArrangeRejectsDuplicatePhysicalCardsWithoutMutating();
testArrangeRequiresArrangingPhaseWithoutMutating();
testPassUsesActivePlayerRingOnly();
testPassRejectsZeroActivePlayersWithoutMutatingPhase();
testRevealRequiresPlayingAndTurnPlayer();
testDealRequiresEnoughCardsWithoutMutatingPhase();
testInvalidScoreNumbersStayFinite();
testCloneCardKeepsPublicEffectField();

console.log("Game rules test passed.");

function testSafeRandomRolls() {
  assert(rollDie(() => 1) === 6, "random value 1 should clamp to die face 6");
  assert(rollDie(() => -0.25) === 1, "negative random value should clamp to die face 1");
  assert(rollDie(() => Number.NaN) === 1, "NaN random value should fall back to die face 1");
  assert(rollDie(() => "bad") === 1, "non-number random value should fall back to die face 1");
}

function testSafeRandomShuffle() {
  const deck = createDeck([{ id: "safe", name: "Safe", type: "score", value: 1, effect: "gain" }], 6);
  const shuffled = shuffleDeck(deck, () => 1);

  assert(shuffled.length === deck.length, "shuffle should keep deck length");
  assert(shuffled.every(Boolean), "shuffle should not create undefined cards");
  assert(deck.every(Boolean), "shuffle should not break the original deck");
}

function testPassRequiresArrangingAndReadyPlayers() {
  const notReadyGame = createPreparedGame();
  notReadyGame.phase = GAME_PHASE_ARRANGING;
  const notReady = passArrangedCardsRight(notReadyGame);
  assert(notReady.error === gameRuleErrors.playersNotReady, "unarranged players should not pass cards right");

  const wrongPhaseGame = createPreparedGame();
  wrongPhaseGame.phase = GAME_PHASE_SETUP;
  const wrongPhase = passArrangedCardsRight(wrongPhaseGame);
  assert(wrongPhase.error === gameRuleErrors.invalidPhase, "non-arranging phase should not pass cards right");
}

function testDealRequiresSetupPhaseWithoutMutating() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ]);
  const originalHand = [{ instanceId: "kept-card" }];
  game.phase = GAME_PHASE_PLAYING;
  game.players[0].hand = originalHand.map((card) => ({ ...card }));
  const deck = createGameDeck(game.players.length, { random: () => 0 });

  const result = dealInitialHands(game, deck);

  assert(result.error === gameRuleErrors.invalidPhase, "playing phase should not deal initial hands");
  assert(game.phase === GAME_PHASE_PLAYING, "failed phase deal should not change phase");
  assert(game.players[0].hand[0]?.instanceId === "kept-card", "failed phase deal should not replace hand");
  assert(deck.length === HAND_SIZE * game.players.length, "failed phase deal should not consume deck");
}

function testArrangeRejectsDuplicatePhysicalCardsWithoutMutating() {
  const duplicateInstanceGame = createPreparedGame();
  const duplicatePlayer = duplicateInstanceGame.players[0];
  const originalHand = duplicatePlayer.hand.map((card) => ({ ...card }));
  duplicatePlayer.arrangedCards = [{ instanceId: "existing-card", position: 1 }];

  const duplicateInstanceIds = duplicatePlayer.hand.map((card) => card.instanceId);
  duplicateInstanceIds[1] = duplicateInstanceIds[0];
  const duplicateResult = arrangePlayerCards(duplicateInstanceGame, duplicatePlayer.id, duplicateInstanceIds);

  assert(
    [gameRuleErrors.duplicateCard, gameRuleErrors.invalidArrangement].includes(duplicateResult.error),
    "duplicate instanceId should fail arrangement"
  );
  assert(duplicatePlayer.hand.length === HAND_SIZE, "failed duplicate instance arrange should keep hand");
  assert(
    duplicatePlayer.arrangedCards[0]?.instanceId === "existing-card",
    "failed duplicate instance arrange should not overwrite arranged cards"
  );
  assert(
    duplicatePlayer.hand.map((card) => card.instanceId).join(",") ===
      originalHand.map((card) => card.instanceId).join(","),
    "failed duplicate instance arrange should keep the same physical hand cards"
  );

  const mixedIdGame = createGameState([{ id: "a", name: "A" }]);
  mixedIdGame.phase = GAME_PHASE_ARRANGING;
  const mixedPlayer = mixedIdGame.players[0];
  mixedPlayer.hand = createMixedFallbackHand();
  mixedPlayer.arrangedCards = [{ instanceId: "previous-card", position: 1 }];

  const mixedResult = arrangePlayerCards(mixedIdGame, mixedPlayer.id, [
    mixedPlayer.hand[0].instanceId,
    mixedPlayer.hand[0].id,
    ...mixedPlayer.hand.slice(1, HAND_SIZE - 1).map((card) => card.instanceId)
  ]);

  assert(mixedResult.error === gameRuleErrors.invalidArrangement, "mixed instanceId/card id should not reuse one card");
  assert(mixedPlayer.hand.length === HAND_SIZE, "failed mixed id arrange should keep hand");
  assert(
    mixedPlayer.arrangedCards[0]?.instanceId === "previous-card",
    "failed mixed id arrange should not overwrite arranged cards"
  );
}

function testArrangeRequiresArrangingPhaseWithoutMutating() {
  const game = createPreparedGame();
  const player = game.players[0];
  const originalHand = player.hand.map((card) => ({ ...card }));
  player.arrangedCards = [{ instanceId: "existing-card", position: 1 }];
  game.phase = GAME_PHASE_FINISHED;

  const result = arrangePlayerCards(
    game,
    player.id,
    player.hand.map((card) => card.instanceId)
  );

  assert(result.error === gameRuleErrors.invalidPhase, "finished phase should not arrange cards");
  assert(player.hand.length === HAND_SIZE, "failed phase arrange should keep hand");
  assert(player.hand[0].instanceId === originalHand[0].instanceId, "failed phase arrange should not replace hand");
  assert(player.arrangedCards[0]?.instanceId === "existing-card", "failed phase arrange should keep arranged cards");
}

function testPassUsesActivePlayerRingOnly() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" }
  ]);
  const [left, eliminated, right] = game.players;
  game.phase = GAME_PHASE_ARRANGING;
  eliminated.eliminated = true;
  eliminated.arrangedCards = makePositionedCards("eliminated");
  eliminated.receivedCards = makePositionedCards("stale");
  left.arrangedCards = makePositionedCards("left");
  right.arrangedCards = makePositionedCards("right");

  const result = passArrangedCardsRight(game);

  assert(!result.error, "active players should pass around eliminated players");
  assert(left.receivedCards.length === HAND_SIZE, "left active player should receive a full hand");
  assert(right.receivedCards.length === HAND_SIZE, "right active player should receive a full hand");
  assert(left.receivedCards.every((card) => card.instanceId.startsWith("right-")), "left should receive right cards");
  assert(right.receivedCards.every((card) => card.instanceId.startsWith("left-")), "right should receive left cards");
  assert(eliminated.receivedCards.length === 0, "eliminated player should not receive active cards");
}

function testPassRejectsZeroActivePlayersWithoutMutatingPhase() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ]);
  game.phase = GAME_PHASE_ARRANGING;
  game.players.forEach((player) => {
    player.eliminated = true;
    player.arrangedCards = makePositionedCards(player.id);
  });

  const result = passArrangedCardsRight(game);

  assert(result.error === gameRuleErrors.noActivePlayers, "zero active players should not pass cards right");
  assert(game.phase === GAME_PHASE_ARRANGING, "zero active players should not advance phase");
}

function testRevealRequiresPlayingAndTurnPlayer() {
  const game = createReadyPassedGame();
  game.phase = GAME_PHASE_ARRANGING;
  const wrongPhase = revealCardAtPosition(game, "a", 1);
  assert(wrongPhase.error === gameRuleErrors.invalidPhase, "non-playing phase should not reveal cards");

  game.phase = GAME_PHASE_PLAYING;
  game.turnPlayerId = "a";
  const wrongTurn = revealCardAtPosition(game, "b", 1);
  assert(wrongTurn.error === gameRuleErrors.notYourTurn, "player should not reveal outside their turn");
}

function testDealRequiresEnoughCardsWithoutMutatingPhase() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ]);
  const originalPhase = game.phase;
  const result = dealInitialHands(game, createDeck(undefined, 2));

  assert(result.error === gameRuleErrors.deckTooSmall, "short deck should return a clear error");
  assert(game.phase === originalPhase, "short deck should not advance phase");
  assert(game.players.every((player) => player.hand.length === 0), "short deck should not partially deal hands");
}

function testInvalidScoreNumbersStayFinite() {
  const game = createGameState([{ id: "a", name: "A" }]);
  const player = game.players[0];

  updatePlayerScore(game, "a", Number.NaN);
  assert(Number.isFinite(player.score), "NaN score delta should not make score NaN");
  assert(player.score === INITIAL_SCORE, "NaN score delta should apply as zero");

  applyCardEffect(game, "a", { type: "score", value: "bad" });
  assert(Number.isFinite(player.score), "non-number card value should not make score NaN");
  assert(player.score === INITIAL_SCORE, "non-number card value should apply as zero");
}

function testCloneCardKeepsPublicEffectField() {
  const source = {
    id: "effect-card",
    name: "Effect Card",
    type: "score",
    value: 3,
    effect: "gain",
    debugPrivate: "do-not-copy"
  };
  const card = cloneCard(source);
  const deck = createDeck([source], 1);

  assert(card.effect === "gain", "cloneCard should keep effect");
  assert(deck[0].effect === "gain", "createDeck should keep effect");
  assert(!Object.hasOwn(card, "debugPrivate"), "cloneCard should not keep private debug fields");
  assert(!Object.hasOwn(deck[0], "debugPrivate"), "createDeck should not keep private debug fields");
}

function createPreparedGame() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ]);
  const deck = createGameDeck(game.players.length, { random: () => 0 });
  const result = dealInitialHands(game, deck);

  assert(!result.error, "prepared game should deal");
  return game;
}

function createReadyPassedGame() {
  const game = createPreparedGame();

  for (const player of game.players) {
    const result = arrangePlayerCards(
      game,
      player.id,
      player.hand.map((card) => card.instanceId)
    );
    assert(!result.error, "prepared game should arrange");
  }

  const passResult = passArrangedCardsRight(game);
  assert(!passResult.error, "prepared game should pass cards right");
  return game;
}

function createMixedFallbackHand() {
  return [
    { id: "shared", instanceId: "shared-1", type: "score", value: 1 },
    { id: "unique-2", instanceId: "unique-2", type: "score", value: 1 },
    { id: "unique-3", instanceId: "unique-3", type: "score", value: 1 },
    { id: "unique-4", instanceId: "unique-4", type: "score", value: 1 },
    { id: "unique-5", instanceId: "unique-5", type: "score", value: 1 },
    { id: "unique-6", instanceId: "unique-6", type: "score", value: 1 }
  ];
}

function makePositionedCards(prefix) {
  return Array.from({ length: HAND_SIZE }, (_, index) => ({
    id: prefix,
    instanceId: `${prefix}-${index + 1}`,
    type: "score",
    value: 1,
    position: index + 1,
    faceUp: false,
    revealed: false
  }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
