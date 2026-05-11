import {
  CARD_DEFINITIONS,
  cloneCard,
  createDeck,
  createDraftCards,
  createGameDeck,
  DRAFT_CARD_COUNT,
  DRAFT_MINUS_CARD_COUNT,
  DRAFT_PLUS_CARD_COUNT,
  drawCards,
  HAND_SIZE,
  shuffleDeck
} from "../lib/cards.js";
import { rollDie } from "../lib/dice.js";
import { createGameState, GAME_PHASE_SETUP, INITIAL_SCORE } from "../lib/game-state.js";
import {
  applyCardEffect,
  arrangePlayerCards,
  dealInitialHands,
  determineWinnerIds,
  gameRuleErrors,
  GAME_PHASE_ARRANGING,
  GAME_PHASE_DRAFTING,
  GAME_PHASE_FINISHED,
  GAME_PHASE_PLAYING,
  passArrangedCardsRight,
  recordDiceRoll,
  revealCardAtDiceResult,
  revealCardAtPosition,
  resolveGameEnd,
  selectDraftCard,
  useCardAtPosition,
  updatePlayerScore
} from "../lib/game-rules.js";

testCardDefinitionsDeckAndDraw();
testSafeRandomRolls();
testSafeRandomShuffle();
testCreateDraftCardsBuildsShuffledPlusMinusChoices();
testDraftingGameStartsPlayersWithTenCandidateCards();
testDealInitialHandsDealsFullHandsAndAdvances();
testSelectDraftCardRecordsSixChoices();
testSelectDraftCardRejectsInvalidDuplicateAndExtraChoices();
testDealRequiresSetupPhaseWithoutMutating();
testDealRequiresEnoughCardsWithoutMutatingPhase();
testArrangePlayerCardsOrdersPositionsAndClearsHand();
testArrangeRequiresSelectedDraftCards();
testArrangePlayerCardsUsesSelectedDraftCardsOnly();
testPassRequiresArrangingAndReadyPlayers();
testArrangeRejectsDuplicatePhysicalCardsWithoutMutating();
testArrangeRequiresArrangingPhaseWithoutMutating();
testPassRightAssignsReceivedHandsAndStartsTurn();
testPassUsesActivePlayerRingOnly();
testPassRejectsZeroActivePlayersWithoutMutatingPhase();
testRevealDiceScoreAndTurn();
testRevealRequiresPlayingAndTurnPlayer();
testEliminationFinishesGameWithRemainingWinner();
testAllPositionsUsedFinishesGameAndDeterminesTie();
testInvalidScoreNumbersStayFinite();
testCloneCardKeepsDescriptionField();

console.log("Game rules test passed.");

function testCardDefinitionsDeckAndDraw() {
  assert(CARD_DEFINITIONS.length > 0, "card definitions should contain at least one card");
  assert(CARD_DEFINITIONS[0].type === "score", "default card should be a score card");

  const deck = createDeck([{ id: "gain", name: "Gain", type: "score", value: 2, description: "gain 2" }], 3);
  assert(deck.length === 3, "createDeck should create the requested number of copies");
  assert(new Set(deck.map((card) => card.instanceId)).size === 3, "deck cards should have unique instance ids");
  assert(deck.every((card) => card.description === "gain 2"), "deck cards should keep description text");
  assert(deck.every((card) => !Object.hasOwn(card, "effect")), "deck cards should use the stable description field");

  const result = drawCards(deck, 2);
  assert(result.drawn.length === 2, "drawCards should draw the requested count");
  assert(result.deck.length === 1, "drawCards should return the remaining deck");
  assert(result.drawn[0] !== deck[0], "drawCards should clone drawn cards");
  assert(result.deck[0] !== deck[2], "drawCards should clone remaining cards");

  const overdraw = drawCards(deck, 99);
  assert(overdraw.drawn.length === deck.length, "drawCards should clamp overdraw to deck length");
  assert(overdraw.deck.length === 0, "overdraw should leave an empty deck");
}

function testSafeRandomRolls() {
  assert(rollDie(() => 1) === 6, "random value 1 should clamp to die face 6");
  assert(rollDie(() => -0.25) === 1, "negative random value should clamp to die face 1");
  assert(rollDie(() => Number.NaN) === 1, "NaN random value should fall back to die face 1");
  assert(rollDie(() => "bad") === 1, "non-number random value should fall back to die face 1");
}

function testSafeRandomShuffle() {
  const deck = createDeck([{ id: "safe", name: "Safe", type: "score", value: 1, description: "gain" }], 6);
  const shuffled = shuffleDeck(deck, () => 1);

  assert(shuffled.length === deck.length, "shuffle should keep deck length");
  assert(shuffled.every(Boolean), "shuffle should not create undefined cards");
  assert(deck.every(Boolean), "shuffle should not break the original deck");
}

function testCreateDraftCardsBuildsShuffledPlusMinusChoices() {
  let randomCalls = 0;
  const originalOrder = createDraftCards("Player A", { random: () => 0.99 });
  const draftCards = createDraftCards("Player A", {
    uniquePrefix: "seat-1-Player A",
    random: () => {
      randomCalls += 1;
      return 0;
    }
  });

  assert(draftCards.length === DRAFT_CARD_COUNT, "draft cards should contain ten candidate cards");
  assert(
    draftCards.filter((card) => card.value > 0).length === DRAFT_PLUS_CARD_COUNT,
    "draft cards should contain five plus cards"
  );
  assert(
    draftCards.filter((card) => card.value < 0).length === DRAFT_MINUS_CARD_COUNT,
    "draft cards should contain five minus cards"
  );
  assert(
    new Set(draftCards.map((card) => card.instanceId)).size === DRAFT_CARD_COUNT,
    "draft cards should have unique instance ids"
  );
  assert(
    draftCards.every((card) => card.instanceId.startsWith("seat-1-player-a-")),
    "draft cards should support an injected unique instance id prefix"
  );
  assert(
    draftCards.every((card) => card.type === "score" && card.description),
    "draft cards should include score details and descriptions"
  );
  assert(
    draftCards.every((card) => hasStableCardShape(card)),
    "draft cards should use the stable card data shape"
  );
  assert(
    draftCards.map((card) => card.instanceId).join(",") !==
      originalOrder.map((card) => card.instanceId).join(","),
    "draft card order should be controlled by injected random"
  );
  assert(randomCalls > 0, "draft card shuffle should call the injected random function");
  assert(JSON.parse(JSON.stringify(draftCards)).length === DRAFT_CARD_COUNT, "draft cards should be JSON serializable");
}

function testDealInitialHandsDealsFullHandsAndAdvances() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ]);
  const deck = createGameDeck(game.players.length, { random: () => 0 });

  const result = dealInitialHands(game, deck);

  assert(!result.error, "dealInitialHands should deal in setup phase");
  assert(game.phase === GAME_PHASE_ARRANGING, "dealInitialHands should advance to arranging phase");
  assert(result.deck.length === 0, "dealInitialHands should consume the exact game deck");
  assert(game.players.every((player) => player.hand.length === HAND_SIZE), "each player should receive a full hand");
  assert(
    game.players.every((player) => player.hand.every((card) => card.faceUp === false && card.revealed === false)),
    "dealt cards should start hidden"
  );
  assert(game.players.every((player) => player.deckCount === 0), "dealInitialHands should reset deck count");
}

function testDraftingGameStartsPlayersWithTenCandidateCards() {
  const game = createDraftingGame();

  assert(game.phase === GAME_PHASE_DRAFTING, "drafting game should start in drafting phase");
  for (const player of game.players) {
    assert(player.draftCards.length === DRAFT_CARD_COUNT, "each player should have ten draft candidate cards");
    assert(
      player.draftCards.filter((card) => card.value > 0).length === DRAFT_PLUS_CARD_COUNT,
      "each player should have five plus draft cards"
    );
    assert(
      player.draftCards.filter((card) => card.value < 0).length === DRAFT_MINUS_CARD_COUNT,
      "each player should have five minus draft cards"
    );
    assert(
      new Set(player.draftCards.map((card) => card.instanceId)).size === DRAFT_CARD_COUNT,
      "each player's draft candidate cards should have unique instance ids"
    );
    assert(
      player.draftCards.every((card) => hasStableCardShape(card)),
      "each draft candidate card should include the required card fields"
    );
  }
}

function testSelectDraftCardRecordsSixChoices() {
  const game = createDraftingGame();
  const player = game.players[0];
  const selectedIds = player.draftCards.slice(0, HAND_SIZE).map((card) => card.instanceId);

  for (const cardInstanceId of selectedIds) {
    const result = selectDraftCard(game, player.id, cardInstanceId);
    assert(!result.error, "selectDraftCard should accept a player's own draft card");
  }

  assert(player.selectedDraftCards.length === HAND_SIZE, "selectDraftCard should record six selected draft cards");
  assert(game.phase === GAME_PHASE_DRAFTING, "game should stay drafting until every player selects six cards");
  assert(
    player.selectedDraftCards.map((card) => card.instanceId).join(",") === selectedIds.join(","),
    "selected draft cards should preserve selection order"
  );
  assert(
    player.hand.map((card) => card.instanceId).join(",") === selectedIds.join(","),
    "selecting six draft cards should sync the hand for arranging"
  );
  assert(
    player.selectedDraftCards.every((card) => card.faceUp === false && card.revealed === false),
    "selected draft cards should be prepared as hidden cards"
  );
  assert(JSON.parse(JSON.stringify(player.selectedDraftCards)).length === HAND_SIZE, "selected draft cards should serialize");
}

function testSelectDraftCardRejectsInvalidDuplicateAndExtraChoices() {
  const game = createDraftingGame();
  const [player, otherPlayer] = game.players;
  const originalSelectedCards = [...player.selectedDraftCards];
  const otherCardId = otherPlayer.draftCards[0].instanceId;

  const wrongOwner = selectDraftCard(game, player.id, otherCardId);
  assert(wrongOwner.error === gameRuleErrors.invalidDraftCard, "player should not select another player's draft card");
  assert(player.selectedDraftCards.length === originalSelectedCards.length, "wrong owner draft should not mutate selection");

  const missingCard = selectDraftCard(game, player.id, "missing-draft-card");
  assert(missingCard.error === gameRuleErrors.invalidDraftCard, "player should not select a missing draft card");
  assert(player.selectedDraftCards.length === originalSelectedCards.length, "missing draft card should not mutate selection");

  const firstCardId = player.draftCards[0].instanceId;
  const first = selectDraftCard(game, player.id, firstCardId);
  assert(!first.error, "first draft selection should succeed");

  const duplicate = selectDraftCard(game, player.id, firstCardId);
  assert(duplicate.error === gameRuleErrors.duplicateCard, "player should not select the same draft card twice");
  assert(player.selectedDraftCards.length === 1, "duplicate draft selection should not mutate selection");

  for (const card of player.draftCards.slice(1, HAND_SIZE)) {
    const result = selectDraftCard(game, player.id, card.instanceId);
    assert(!result.error, "remaining draft selections should succeed");
  }

  const seventh = selectDraftCard(game, player.id, player.draftCards[HAND_SIZE].instanceId);
  assert(seventh.error === gameRuleErrors.draftAlreadyComplete, "player should not select a seventh draft card");
  assert(player.selectedDraftCards.length === HAND_SIZE, "extra draft selection should not mutate selection");

  for (const card of otherPlayer.draftCards.slice(0, HAND_SIZE)) {
    const result = selectDraftCard(game, otherPlayer.id, card.instanceId);
    assert(!result.error, "other player should be able to complete draft");
  }
  assert(game.phase === GAME_PHASE_ARRANGING, "game should enter arranging after every player selects six cards");
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

function testArrangePlayerCardsOrdersPositionsAndClearsHand() {
  const game = createArrangingDraftedGame();
  const player = game.players[0];
  const orderedIds = player.hand.map((card) => card.instanceId).reverse();

  const result = arrangePlayerCards(game, player.id, orderedIds);

  assert(!result.error, "arrangePlayerCards should accept every physical hand card once");
  assert(player.hand.length === 0, "arrangePlayerCards should clear the private hand");
  assert(player.arrangedCards.length === HAND_SIZE, "arrangePlayerCards should place a full row");
  assert(
    player.arrangedCards.map((card) => card.instanceId).join(",") === orderedIds.join(","),
    "arranged cards should preserve requested order"
  );
  assert(
    player.arrangedCards.every((card, index) => card.position === index + 1),
    "arranged cards should receive one-based positions"
  );
}

function testArrangeRequiresSelectedDraftCards() {
  const game = createPreparedGame();
  const player = game.players[0];
  const originalHand = player.hand.map((card) => ({ ...card }));
  game.phase = GAME_PHASE_ARRANGING;

  const result = arrangePlayerCards(
    game,
    player.id,
    player.hand.map((card) => card.instanceId)
  );

  assert(result.error === gameRuleErrors.invalidHandSize, "arrange should require six selected draft cards");
  assert(player.hand.length === HAND_SIZE, "failed no-selected arrange should keep hand");
  assert(
    player.hand.map((card) => card.instanceId).join(",") === originalHand.map((card) => card.instanceId).join(","),
    "failed no-selected arrange should not replace hand"
  );
  assert(player.arrangedCards.length === 0, "failed no-selected arrange should not create arranged cards");
}

function testArrangePlayerCardsUsesSelectedDraftCardsOnly() {
  const game = createDraftingGame();
  const [player, otherPlayer] = game.players;
  const selectedIds = player.draftCards.slice(0, HAND_SIZE).map((card) => card.instanceId);
  const unselectedId = player.draftCards[HAND_SIZE].instanceId;

  for (const cardInstanceId of selectedIds) {
    const result = selectDraftCard(game, player.id, cardInstanceId);
    assert(!result.error, "selected-only arrange setup should draft player card");
  }

  for (const card of otherPlayer.draftCards.slice(0, HAND_SIZE)) {
    const result = selectDraftCard(game, otherPlayer.id, card.instanceId);
    assert(!result.error, "selected-only arrange setup should complete other player draft");
  }

  assert(game.phase === GAME_PHASE_ARRANGING, "selected-only arrange setup should enter arranging");

  const missingSelected = arrangePlayerCards(game, player.id, selectedIds.slice(0, HAND_SIZE - 1));
  assert(missingSelected.error === gameRuleErrors.invalidHandSize, "arrange should require all six selected cards");
  assert(player.arrangedCards.length === 0, "missing selected card arrange should not mutate arranged cards");

  const mixedUnselected = arrangePlayerCards(game, player.id, [...selectedIds.slice(0, HAND_SIZE - 1), unselectedId]);
  assert(mixedUnselected.error === gameRuleErrors.invalidArrangement, "arrange should reject unselected draft cards");
  assert(player.arrangedCards.length === 0, "unselected draft card arrange should not mutate arranged cards");

  const orderedIds = [...selectedIds].reverse();
  const result = arrangePlayerCards(game, player.id, orderedIds);

  assert(!result.error, "arrange should accept exactly the six selected draft card instance ids");
  assert(player.hand.length === 0, "selected draft arrange should clear the private hand");
  assert(
    player.arrangedCards.map((card) => card.instanceId).join(",") === orderedIds.join(","),
    "selected draft arrange should preserve requested selected-card order"
  );
}

function testArrangeRejectsDuplicatePhysicalCardsWithoutMutating() {
  const duplicateInstanceGame = createArrangingDraftedGame();
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
  mixedPlayer.selectedDraftCards = mixedPlayer.hand.map((card) => ({ ...card }));
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
  const game = createArrangingDraftedGame();
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

function testPassRightAssignsReceivedHandsAndStartsTurn() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" }
  ]);
  game.phase = GAME_PHASE_ARRANGING;
  game.players[0].arrangedCards = makePositionedCards("a");
  game.players[1].arrangedCards = makePositionedCards("b");
  game.players[2].arrangedCards = makePositionedCards("c");

  const result = passArrangedCardsRight(game);

  assert(!result.error, "passArrangedCardsRight should pass ready cards");
  assert(game.phase === GAME_PHASE_PLAYING, "passing should advance to playing phase");
  assert(game.firstPlayerId === "a", "first active player should be recorded");
  assert(game.turnPlayerId === "a", "first active player should take the first turn");
  assert(game.players[0].receivedCards.every((card) => card.instanceId.startsWith("c-")), "A should receive C cards");
  assert(game.players[1].receivedCards.every((card) => card.instanceId.startsWith("a-")), "B should receive A cards");
  assert(game.players[2].receivedCards.every((card) => card.instanceId.startsWith("b-")), "C should receive B cards");
  assert(game.players.every((player) => player.arrangedCards.length === 0), "passing should clear arranged cards");
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

function testRevealDiceScoreAndTurn() {
  const game = createReadyPassedGame();
  const player = game.players[0];
  const nextPlayer = game.players[1];
  const startingScore = player.score;
  const targetCard = player.receivedCards.find((card) => card.position === 1);

  const rollResult = recordDiceRoll(game, player.id, 1);

  assert(!rollResult.error, "valid dice result should record a pending turn");
  assert(game.dice.lastRoll.position === 1, "roll should record the target position");
  assert(game.dice.lastRoll.status === "pending", "roll should leave the card pending");
  assert(targetCard.revealed === false, "roll should not reveal the target card");
  assert(!player.usedPositions.includes(1), "roll should not mark the position used");
  assert(player.score === startingScore, "roll should not update score");
  assert(game.turnPlayerId === player.id, "roll should not advance the turn");

  const result = revealCardAtDiceResult(game, player.id, 1);
  assert(!result.error, "valid dice result should reveal a card");
  assert(result.card === targetCard, "reveal should return the card at the dice position");
  assert(targetCard.faceUp === true && targetCard.revealed === true, "revealed card should be face up");
  assert(!player.usedPositions.includes(1), "revealed position should not be marked used yet");
  assert(player.score === startingScore, "reveal should not update player score");
  assert(game.turnPlayerId === player.id, "reveal should not advance the turn");

  const useResult = useCardAtPosition(game, player.id, 1);
  assert(!useResult.error, "use should resolve a revealed target card");
  assert(player.usedPositions.includes(1), "use should mark the position used");
  assert(player.score === startingScore + targetCard.value, "use should update player score");
  assert(useResult.scoreDelta === targetCard.value, "use should report score delta");
  assert(game.turnPlayerId === nextPlayer.id, "turn should advance after use");

  const nextRoll = recordDiceRoll(game, nextPlayer.id, 1);
  assert(!nextRoll.error, "next player should be able to roll the same position on their own board");
  const repeated = revealCardAtPosition(game, nextPlayer.id, 1);
  assert(!repeated.error, "next player should be able to reveal the same position on their own board");

  const invalidDice = recordDiceRoll(game, game.turnPlayerId, 7);
  assert(invalidDice.error === "invalidDiceResult", "invalid dice result should be rejected");
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

function testEliminationFinishesGameWithRemainingWinner() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ]);
  const [player, winner] = game.players;
  game.phase = GAME_PHASE_PLAYING;
  game.turnPlayerId = player.id;
  player.score = 1;
  player.receivedCards = [
    { id: "drop", instanceId: "drop-1", type: "score", value: -2, position: 1, faceUp: false, revealed: false }
  ];
  winner.receivedCards = makePositionedCards("winner");

  const rollResult = recordDiceRoll(game, player.id, 1);
  assert(!rollResult.error, "negative score card roll should record pending target");
  const revealResult = revealCardAtPosition(game, player.id, 1);
  assert(!revealResult.error, "negative score card should reveal before use");
  assert(player.score === 1, "reveal should not eliminate before use");

  const result = useCardAtPosition(game, player.id, 1);

  assert(!result.error, "negative score card should resolve on use");
  assert(result.eliminated === true, "score at or below zero should eliminate player");
  assert(player.score === 0, "eliminated player's score should clamp to zero");
  assert(game.phase === GAME_PHASE_FINISHED, "single remaining active player should finish the game");
  assert(result.finished === true, "reveal result should report finished game");
  assert(result.winnerIds.length === 1 && result.winnerIds[0] === winner.id, "remaining active player should win");
}

function testAllPositionsUsedFinishesGameAndDeterminesTie() {
  const game = createGameState([
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ]);
  game.phase = GAME_PHASE_PLAYING;
  game.players[0].usedPositions = [1, 2, 3, 4, 5, 6];
  game.players[1].usedPositions = [1, 2, 3, 4, 5, 6];
  game.players[0].score = 12;
  game.players[1].score = 12;

  const result = resolveGameEnd(game);

  assert(result.finished === true, "all active players using all positions should finish the game");
  assert(game.phase === GAME_PHASE_FINISHED, "finished game should enter finished phase");
  assert(result.winnerIds.join(",") === "a,b", "equal best scores should produce tied winners");
  assert(determineWinnerIds(game).join(",") === "a,b", "winner determination should preserve ties");
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

function testCloneCardKeepsDescriptionField() {
  const source = {
    id: "description-card",
    name: "Description Card",
    type: "score",
    value: 3,
    description: "gain",
    debugPrivate: "do-not-copy"
  };
  const legacySource = {
    id: "legacy-effect-card",
    name: "Legacy Effect Card",
    type: "score",
    value: 1,
    effect: "legacy gain"
  };
  const card = cloneCard(source);
  const deck = createDeck([source], 1);
  const legacyCard = cloneCard(legacySource);

  assert(card.description === "gain", "cloneCard should keep description");
  assert(deck[0].description === "gain", "createDeck should keep description");
  assert(legacyCard.description === "legacy gain", "cloneCard should map legacy effect input to description");
  assert(!Object.hasOwn(card, "effect"), "cloneCard should not emit effect");
  assert(!Object.hasOwn(deck[0], "effect"), "createDeck should not emit effect");
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
  for (let playerIndex = 0; playerIndex < game.players.length; playerIndex += 1) {
    game.players[playerIndex].draftCards = createDraftCards(game.players[playerIndex].id, {
      random: () => 0,
      uniquePrefix: `test-player-${playerIndex + 1}`
    });
  }

  assert(!result.error, "prepared game should deal");
  return game;
}

function createDraftingGame() {
  const game = createPreparedGame();
  game.phase = GAME_PHASE_DRAFTING;
  game.players.forEach((player) => {
    player.hand = [];
  });
  return game;
}

function createReadyPassedGame() {
  const game = createArrangingDraftedGame();

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

function createArrangingDraftedGame() {
  const game = createDraftingGame();

  for (const player of game.players) {
    for (const card of player.draftCards.slice(0, HAND_SIZE)) {
      const result = selectDraftCard(game, player.id, card.instanceId);
      assert(!result.error, "drafted arranging game should select six cards per player");
    }
  }

  assert(game.phase === GAME_PHASE_ARRANGING, "drafted arranging game should enter arranging phase");
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

function hasStableCardShape(card) {
  return (
    card &&
    typeof card.id === "string" &&
    typeof card.instanceId === "string" &&
    typeof card.name === "string" &&
    typeof card.type === "string" &&
    typeof card.value === "number" &&
    typeof card.description === "string" &&
    !Object.hasOwn(card, "effect")
  );
}
