export function renderGame(room, context) {
  const { elements, callbacks } = context;
  const game = room.game;
  elements.gamePanel.classList.toggle("hidden", !game);
  elements.startGameButton.classList.toggle("hidden", Boolean(game));

  if (!game) {
    callbacks.resetArrangement();
    return;
  }

  const self = getSelfGamePlayer(game, context.playerId);
  const phase = game.phase || "";
  elements.gamePhaseTitle.textContent = context.getPhaseTitle(phase);
  renderTurnIndicator(game, self, room, context);
  renderDice(game, room, context);
  renderScores(game, room, context);

  elements.draftPanel.classList.toggle("hidden", phase !== "drafting");
  elements.arrangePanel.classList.toggle("hidden", phase !== "arranging");
  elements.turnPanel.classList.toggle("hidden", phase !== "playing");
  elements.finishedPanel.classList.toggle("hidden", phase !== "finished");

  if (phase === "drafting") {
    renderDraftPanel(self, game, context);
  }

  if (phase === "arranging") {
    renderArrangePanel(self, context);
  } else {
    callbacks.resetArrangement();
  }

  if (phase === "playing" || phase === "finished") {
    renderBoard(self, context);
  }

  if (phase === "finished") {
    renderFinished(game, room, context);
  }
}

function renderTurnIndicator(game, self, room, context) {
  const { elements, playerId, getPlayerNameById } = context;
  if (game.phase === "finished") {
    elements.turnIndicator.textContent = "已結束";
    return;
  }

  if (game.phase === "drafting") {
    const waiting = game.players.filter((player) => getSelectedDraftCount(player) < context.handSize).length;
    elements.turnIndicator.textContent = waiting > 0 ? `等待選牌：${waiting} 人` : "準備進入排序";
    return;
  }

  if (game.phase === "arranging") {
    const waiting = game.players.filter((player) => player.handCount > 0).length;
    elements.turnIndicator.textContent = waiting > 0 ? `等待排牌：${waiting} 人` : "準備進入回合";
    return;
  }

  const currentName = getPlayerNameById(game.turnPlayerId, room);
  if (!game.turnPlayerId) {
    elements.turnIndicator.textContent = "等待回合";
  } else if (game.turnPlayerId === playerId) {
    elements.turnIndicator.textContent = self?.eliminated ? "你已淘汰" : "輪到你";
  } else {
    elements.turnIndicator.textContent = `輪到 ${currentName}`;
  }
}

function renderDice(game, room, context) {
  const lastRoll = game.dice?.lastRoll;
  if (!lastRoll) {
    context.elements.diceResult.textContent = "骰子結果：尚無";
    return;
  }

  const rollerName = context.getPlayerNameById(lastRoll.playerId, room);
  context.elements.diceResult.textContent = `骰子結果：${rollerName} 擲出 ${lastRoll.result}，位置 ${lastRoll.position}`;
}

export function renderDraftPanel(self, game, context) {
  const { elements, handSize, pendingAction } = context;
  const draftCards = Array.isArray(self?.draftCards) ? self.draftCards.filter(Boolean) : [];
  const selectedCards = Array.isArray(self?.selectedDraftCards) ? self.selectedDraftCards.filter(Boolean) : [];
  const selectedIds = new Set(selectedCards.map((card) => card.instanceId || card.id).filter(Boolean));
  const selectedCount = selectedCards.length;
  const draftComplete = selectedCount >= handSize;
  const waitingOtherPlayers = draftComplete && game.players.some((player) => getSelectedDraftCount(player) < handSize);

  if (!draftCards.length) {
    elements.draftHint.textContent = "正在等待候選牌資料同步。";
    elements.draftCards.replaceChildren(emptyState("尚未取得候選牌"));
    return;
  }

  if (draftComplete) {
    elements.draftHint.textContent = waitingOtherPlayers
      ? "已選滿 6 張，等待其他玩家完成選牌。"
      : "已選滿 6 張，等待進入排序階段。";
  } else {
    elements.draftHint.textContent = `已選 ${selectedCount} / ${handSize} 張，請從候選牌中選擇。`;
  }

  elements.draftCards.replaceChildren(
    ...draftCards.map((card, index) =>
      renderDraftCard(card, {
        context,
        index,
        isSelected: selectedIds.has(card.instanceId || card.id),
        disabled: Boolean(pendingAction) || draftComplete
      })
    )
  );
}

function renderDraftCard(card, options) {
  const { context, index, isSelected, disabled } = options;
  const button = document.createElement("button");
  button.className = `draft-card${isSelected ? " selected revealed" : ""}`;
  button.type = "button";
  button.disabled = disabled || isSelected;
  button.setAttribute("aria-pressed", String(isSelected));
  button.addEventListener("click", () => context.callbacks.draftCard(card.instanceId));

  if (!isSelected) {
    const back = document.createElement("span");
    back.className = "draft-card-back";
    back.textContent = `候選 ${index + 1}`;
    button.append(back);
    return button;
  }

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = "已選取";
  button.append(label);

  const name = document.createElement("strong");
  name.textContent = card.name || "卡牌";
  button.append(name);

  const effect = document.createElement("span");
  effect.className = "card-effect";
  effect.textContent = describeScoreEffect(card);
  button.append(effect);

  if (card.description) {
    const description = document.createElement("span");
    description.className = "card-description";
    description.textContent = card.description;
    button.append(description);
  }

  return button;
}

export function renderArrangePanel(self, context) {
  const { elements, callbacks, arrangement, handSize, pendingAction } = context;
  const hand = Array.isArray(self?.hand) ? self.hand.filter(Boolean) : [];
  const arrangedCards = Array.isArray(self?.arrangedCards) ? self.arrangedCards.filter(Boolean) : [];
  const alreadyArranged = arrangedCards.length >= handSize && hand.length === 0;

  if (alreadyArranged) {
    elements.arrangeHint.textContent = "你已送出排列，等待其他玩家完成。";
    elements.submitArrangeButton.disabled = true;
    elements.arrangeSlots.replaceChildren(...renderArrangedPreview(arrangedCards, handSize));
    elements.handCards.replaceChildren(emptyState("已送出排列"));
    return;
  }

  if (!hand.length) {
    elements.arrangeHint.textContent = "正在等待伺服器同步你的手牌。";
    elements.submitArrangeButton.disabled = true;
    elements.arrangeSlots.replaceChildren(...renderEmptySlots(handSize));
    elements.handCards.replaceChildren(emptyState("尚未取得手牌"));
    return;
  }

  callbacks.syncArrangement(hand);
  elements.arrangeHint.textContent = "點選手牌會放入第一個空的位置；點位置可移除。";
  elements.arrangeSlots.replaceChildren(
    ...arrangement.map((card, index) => renderArrangeSlot(card, index, context))
  );
  elements.handCards.replaceChildren(...hand.map((card) => renderHandCard(card, context)));
  elements.submitArrangeButton.disabled = Boolean(pendingAction) || arrangement.some((card) => !card);
}

function renderArrangeSlot(card, index, context) {
  const button = document.createElement("button");
  button.className = `position-card arrange-slot${card ? " filled" : ""}`;
  button.type = "button";
  button.disabled = Boolean(context.pendingAction) || !card;
  button.addEventListener("click", () => context.callbacks.removeArrangementAt(index));

  const position = document.createElement("span");
  position.className = "card-position";
  position.textContent = `位置 ${index + 1}`;
  button.append(position);

  const name = document.createElement("strong");
  name.textContent = card?.name || "空位";
  button.append(name);

  const effect = document.createElement("span");
  effect.className = "card-effect";
  effect.textContent = card ? describeCard(card) : "尚未放牌";
  button.append(effect);

  return button;
}

function renderHandCard(card, context) {
  const used = context.arrangement.some((slotCard) => sameCard(slotCard, card));
  const button = document.createElement("button");
  button.className = "hand-card";
  button.type = "button";
  button.disabled = Boolean(context.pendingAction) || used;
  button.addEventListener("click", () => context.callbacks.placeCardInFirstSlot(card));

  const name = document.createElement("strong");
  name.textContent = card.name || "手牌";
  button.append(name);

  const effect = document.createElement("span");
  effect.className = "card-effect";
  effect.textContent = describeCard(card);
  button.append(effect);

  return button;
}

export function renderBoard(self, context) {
  const { elements, currentRoom, handSize, pendingAction, playerId } = context;
  const receivedCards = Array.isArray(self?.receivedCards) ? self.receivedCards.filter(Boolean) : [];
  const cardsByPosition = new Map(receivedCards.map((card) => [card.position, card]));

  elements.boardCards.replaceChildren(
    ...Array.from({ length: handSize }, (_, index) => {
      const position = index + 1;
      return renderBoardCard(cardsByPosition.get(position), position);
    })
  );

  const isMyTurn = currentRoom?.game?.turnPlayerId === playerId;
  const noCardLeft = receivedCards.length > 0 && receivedCards.every((card) => card.used);
  const eliminated = Boolean(self?.eliminated);
  elements.rollButton.disabled = Boolean(pendingAction) || !isMyTurn || eliminated || noCardLeft;

  if (eliminated) {
    elements.turnHint.textContent = "你已被淘汰，可以繼續觀看其他玩家完成遊戲。";
  } else if (noCardLeft) {
    elements.turnHint.textContent = "你沒有可用卡牌，等待遊戲結算或其他玩家行動。";
  } else if (isMyTurn) {
    elements.turnHint.textContent = "輪到你了，擲骰後會翻開對應位置。";
  } else {
    elements.turnHint.textContent = "等待目前玩家擲骰。";
  }
}

function renderBoardCard(card, position) {
  const item = document.createElement("div");
  item.className = `position-card board-card${card?.revealed ? " revealed" : ""}${card?.used ? " used" : ""}`;

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = `位置 ${position}`;
  item.append(label);

  const title = document.createElement("strong");
  title.textContent = card?.revealed ? card.name || "已翻開" : card?.used ? "已使用" : "未翻開";
  item.append(title);

  const detail = document.createElement("span");
  detail.className = "card-effect";
  detail.textContent = card?.revealed ? describeCard(card) : "效果保密";
  item.append(detail);

  return item;
}

export function renderScores(game, room, context) {
  context.elements.scoreList.replaceChildren(
    ...game.players.map((player) => {
      const item = document.createElement("li");
      item.className = `score-item${player.eliminated ? " eliminated" : ""}`;

      const name = document.createElement("span");
      name.textContent = `${context.getPlayerNameById(player.id, room)}${player.id === context.playerId ? "（你）" : ""}`;
      item.append(name);

      const state = document.createElement("span");
      const usedCount = Array.isArray(player.usedPositions) ? player.usedPositions.length : 0;
      const statusText = player.eliminated ? "淘汰" : usedCount >= context.handSize ? "沒有可用卡牌" : "等待中";
      state.textContent = `${player.score} 分 · ${statusText}`;
      item.append(state);

      return item;
    })
  );
}

export function renderFinished(game, room, context) {
  const winnerNames = game.winnerIds.map((id) => context.getPlayerNameById(id, room)).filter(Boolean);
  context.elements.winnerText.textContent = winnerNames.length ? `勝利者：${winnerNames.join("、")}` : "沒有勝利者資料。";
}

export function describeCard(card) {
  if (!card) {
    return "";
  }

  const parts = [];
  if (card.type) {
    parts.push(card.type);
  }
  if (card.value !== null && card.value !== undefined) {
    parts.push(`數值 ${card.value}`);
  }
  if (card.effect) {
    parts.push(card.effect);
  }
  return parts.join(" · ") || "無公開效果";
}

function describeScoreEffect(card) {
  const value = Number(card?.value);
  if (Number.isFinite(value) && value !== 0) {
    return `${value > 0 ? "+" : ""}${value} 分`;
  }
  return describeCard(card);
}

function getSelectedDraftCount(player) {
  return Array.isArray(player?.selectedDraftCards) ? player.selectedDraftCards.length : 0;
}

function renderArrangedPreview(cards, handSize) {
  const byPosition = new Map(cards.map((card) => [card.position, card]));
  return Array.from({ length: handSize }, (_, index) => {
    const card = byPosition.get(index + 1);
    return renderStaticPositionCard(card, index + 1, card ? describeCard(card) : "已送出");
  });
}

function renderEmptySlots(handSize) {
  return Array.from({ length: handSize }, (_, index) => renderStaticPositionCard(null, index + 1, "等待手牌"));
}

function renderStaticPositionCard(card, position, detailText) {
  const item = document.createElement("div");
  item.className = `position-card${card ? " filled" : ""}`;

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = `位置 ${position}`;
  item.append(label);

  const title = document.createElement("strong");
  title.textContent = card?.name || "空位";
  item.append(title);

  const detail = document.createElement("span");
  detail.className = "card-effect";
  detail.textContent = detailText;
  item.append(detail);

  return item;
}

function emptyState(text) {
  const item = document.createElement("p");
  item.className = "empty-state";
  item.textContent = text;
  return item;
}

function getSelfGamePlayer(game, playerId) {
  return game.players.find((player) => player.id === playerId) || null;
}

function sameCard(left, right) {
  if (!left || !right) {
    return false;
  }
  return (left.instanceId || left.id) === (right.instanceId || right.id);
}
