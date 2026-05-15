export function renderGame(room, context) {
  const { elements, callbacks } = context;
  const game = room.game;
  elements.gamePanel.classList.toggle("hidden", !game);
  elements.startGameButton.classList.toggle("hidden", Boolean(game));

  if (!game) {
    callbacks.resetArrangement();
    elements.gamePanel.querySelector(".card-modal-backdrop")?.remove();
    elements.roomView.dataset.phase = "waiting";
    return;
  }

  const self = getSelfGamePlayer(game, context.playerId);
  const phase = game.phase || "";
  elements.roomView.dataset.phase = phase || "waiting";
  elements.gamePanel.dataset.phase = phase || "waiting";
  elements.gamePhaseTitle.textContent = `Game / ${context.getPhaseTitle(phase)}`;
  renderTurnIndicator(game, self, room, context);
  if (phase === "drafting") {
    elements.turnIndicator.textContent = `已選 ${Math.min(getSelectedDraftCount(self), context.handSize)} / ${context.handSize}`;
  }
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

  renderRevealedCardModal(game, context);
}

function renderTurnIndicator(game, self, room, context) {
  const { elements, playerId, getPlayerNameById } = context;
  if (game.phase === "finished") {
    elements.turnIndicator.textContent = "已結束";
    return;
  }

  if (game.phase === "drafting") {
    const waiting = game.players.filter((player) => getSelectedDraftCount(player) < context.handSize).length;
    elements.turnIndicator.textContent = waiting > 0 ? `等待 ${waiting} 人` : "準備排牌";
    return;
  }

  if (game.phase === "arranging") {
    const waiting = game.players.filter((player) => player.handCount > 0).length;
    elements.turnIndicator.textContent = waiting > 0 ? `等待 ${waiting} 人` : "準備回合";
    return;
  }

  const currentName = getPlayerNameById(game.turnPlayerId, room);
  const lastRoll = game.dice?.lastRoll;
  const opponentIsHandlingCard =
    game.turnPlayerId !== playerId &&
    lastRoll?.playerId === game.turnPlayerId &&
    ["pending", "revealed"].includes(lastRoll?.status);
  if (!game.turnPlayerId) {
    elements.turnIndicator.textContent = "等待對手";
  } else if (game.turnPlayerId === playerId) {
    elements.turnIndicator.textContent = self?.eliminated ? "你已淘汰" : "輪到你";
  } else if (opponentIsHandlingCard) {
    elements.turnIndicator.textContent = "等待對手";
  } else {
    elements.turnIndicator.textContent = `輪到 ${currentName}`;
  }
}

function renderDice(game, room, context) {
  if (game.phase === "drafting") {
    renderDraftWaiting(game, context);
    return;
  }

  const lastRoll = game.dice?.lastRoll;
  if (!lastRoll) {
    context.elements.diceResult.textContent = "等待第一擲";
    return;
  }

  const isSelfRoll = lastRoll.playerId === context.playerId;
  const rollerName = isSelfRoll ? "你" : context.getPlayerNameById(lastRoll.playerId, room);
  const position = Number(lastRoll.position ?? lastRoll.result);
  const positionText = Number.isInteger(position) && position >= 1 && position <= context.handSize ? position : "未知";
  context.elements.diceResult.textContent = isSelfRoll
    ? `你擲出 ${lastRoll.result}，指向第 ${positionText} 張`
    : `${rollerName} 擲出 ${lastRoll.result}，指向第 ${positionText} 張`;
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
    renderDraftActions(selectedCount, handSize, draftComplete, context);
    elements.draftHint.textContent = "正在等待候選牌資料同步。";
    elements.draftCards.replaceChildren(emptyState("尚未取得候選牌"));
    return;
  }

  if (draftComplete) {
    elements.draftHint.textContent = waitingOtherPlayers
      ? "已選滿 6 張，等待其他玩家完成選牌。"
      : "已選滿 6 張，等待進入排牌階段。";
  } else {
    elements.draftHint.textContent = `已選 ${selectedCount} / ${handSize} 張，挑選要帶上牌桌的手牌。`;
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
  renderDraftActions(selectedCount, handSize, draftComplete, context);
}

function renderDraftWaiting(game, context) {
  const readyCount = game.players.filter((player) => getSelectedDraftCount(player) >= context.handSize).length;
  const allReady = readyCount >= game.players.length;
  const label = document.createElement("span");
  label.className = "draft-waiting-label";
  label.textContent = allReady ? "選牌完成，準備進入排牌" : "等待其他玩家選牌";

  const dots = document.createElement("span");
  dots.className = "draft-progress-dots";
  dots.setAttribute("aria-label", `${readyCount} / ${game.players.length} 位玩家完成選牌`);
  dots.append(
    ...game.players.map((player) => {
      const dot = document.createElement("span");
      dot.className = `draft-progress-dot${getSelectedDraftCount(player) >= context.handSize ? " ready" : ""}`;
      return dot;
    })
  );

  context.elements.diceResult.replaceChildren(label, dots);
}

function renderDraftActions(selectedCount, handSize, draftComplete, context) {
  context.elements.draftPanel.querySelector(".draft-actions")?.remove();

  const actions = document.createElement("div");
  actions.className = "draft-actions";

  const button = document.createElement("button");
  button.className = "primary-button draft-confirm-button";
  button.type = "button";
  button.disabled = true;
  button.textContent = draftComplete ? "已確認選牌" : "確認選牌";
  actions.append(button);

  const hint = document.createElement("p");
  hint.className = "draft-confirm-hint";
  hint.textContent = `從 10 張候選牌中選出 ${handSize} 張`;
  actions.append(hint);

  context.elements.draftPanel.dataset.selectedCount = String(selectedCount);
  context.elements.draftPanel.append(actions);
}

function renderDraftCard(card, options) {
  const { context, index, isSelected, disabled } = options;
  const cardId = card.instanceId || card.id || "";
  const isRecentlySelected = Boolean(isSelected && cardId && cardId === context.recentDraftCardId);
  const button = document.createElement("button");
  button.className = `draft-card${isSelected ? ` selected revealed ${getCardVisualClass(card)}` : ""}${isRecentlySelected ? " just-selected" : ""}`;
  button.type = "button";
  button.disabled = disabled || isSelected;
  button.setAttribute("aria-pressed", String(isSelected));
  button.addEventListener("click", () => context.callbacks.draftCard(card.instanceId));

  if (!isSelected) {
    const back = document.createElement("span");
    back.className = "draft-card-back";
    back.textContent = `${index + 1}`;
    button.append(back);
    return button;
  }

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = "已選";
  button.append(label);

  const icon = document.createElement("span");
  icon.className = `card-art-icon ${getCardVisualClass(card)}`;
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);

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
    elements.arrangePanel.dataset.arrangeState = "submitted";
    elements.arrangePanel.dataset.arrangedCount = String(handSize);
    elements.arrangeHint.textContent = "你已送出牌序，等待其他玩家。";
    elements.turnIndicator.textContent = `${handSize}/${handSize} 已排`;
    elements.submitArrangeButton.disabled = true;
    elements.submitArrangeButton.hidden = false;
    elements.submitArrangeButton.textContent = "已送出排列，等待中";
    elements.resetArrangeButton.disabled = true;
    elements.resetArrangeButton.hidden = true;
    elements.arrangeSlots.replaceChildren(...renderArrangedPreview(arrangedCards, handSize));
    elements.handCards.replaceChildren(...renderArrangeOrderSlots(arrangedCards, handSize));
    return;
  }

  elements.arrangePanel.dataset.arrangeState = hand.length ? "editing" : "syncing";
  elements.submitArrangeButton.hidden = false;
  elements.resetArrangeButton.hidden = false;

  if (!hand.length) {
    elements.arrangeHint.textContent = "正在等待手牌同步。";
    elements.turnIndicator.textContent = `0/${handSize} 已排`;
    elements.arrangePanel.dataset.arrangedCount = "0";
    elements.submitArrangeButton.disabled = true;
    elements.submitArrangeButton.textContent = "送出排列";
    elements.resetArrangeButton.disabled = true;
    elements.arrangeSlots.replaceChildren(...renderEmptySlots(handSize));
    elements.handCards.replaceChildren(...renderArrangeOrderSlots([], handSize));
    return;
  }

  callbacks.syncArrangement(hand);
  const arrangedCount = arrangement.filter(Boolean).length;
  elements.arrangeHint.textContent = "調整 1 到 6 的牌序，送出後會給右側玩家。";
  elements.turnIndicator.textContent = `${arrangedCount}/${handSize} 已排`;
  elements.arrangePanel.dataset.arrangedCount = String(arrangedCount);
  elements.arrangeSlots.replaceChildren(
    ...arrangement.map((card, index) => renderArrangeSlot(card, index, context))
  );
  elements.handCards.replaceChildren(...renderArrangeOrderSlots(arrangement, handSize));
  elements.submitArrangeButton.disabled =
    Boolean(pendingAction) ||
    arrangement.length !== handSize ||
    arrangement.some((card) => !card) ||
    new Set(arrangement.map((card) => card?.instanceId).filter(Boolean)).size !== handSize;
  elements.submitArrangeButton.textContent = pendingAction === "arrange" ? "送出中..." : "送出排列";
  elements.resetArrangeButton.disabled = Boolean(pendingAction);
}

function renderArrangeSlot(card, index, context) {
  const item = document.createElement("div");
  const cardId = card?.instanceId || card?.id || "";
  const isActive = Boolean(cardId && cardId === context.movedArrangementCardId);
  const moveClass = isActive && context.movedArrangementDirection ? ` move-${context.movedArrangementDirection}` : "";
  item.className = `position-card arrange-slot arrange-order-card${card ? ` filled ${getCardVisualClass(card)}` : ""}${isActive ? " is-active" : ""}${moveClass}`;

  const position = document.createElement("span");
  position.className = "card-position";
  position.textContent = String(index + 1);
  item.append(position);

  const icon = document.createElement("span");
  icon.className = `arrange-card-icon card-art-icon ${card ? getCardVisualClass(card) : "card-art-empty"}`;
  icon.setAttribute("aria-hidden", "true");
  item.append(icon);

  const name = document.createElement("strong");
  name.textContent = card?.name || "空位";
  item.append(name);

  const effect = document.createElement("span");
  effect.className = "card-effect";
  effect.textContent = card ? describeScoreEffect(card) : "尚未放入卡牌";
  item.append(effect);

  if (card?.description) {
    const description = document.createElement("span");
    description.className = "card-description";
    description.textContent = card.description;
    item.append(description);
  }

  item.append(renderArrangeCardControls(index, context));

  return item;
}

function renderArrangeCardControls(index, context) {
  const controls = document.createElement("div");
  controls.className = "arrange-controls";

  const upButton = document.createElement("button");
  upButton.className = "secondary-button compact-button arrange-move-button";
  upButton.type = "button";
  upButton.textContent = "↑";
  upButton.setAttribute("aria-label", `將第 ${index + 1} 張上移`);
  upButton.disabled = Boolean(context.pendingAction) || index === 0;
  upButton.addEventListener("click", () => context.callbacks.moveArrangementCard(index, index - 1));
  controls.append(upButton);

  const downButton = document.createElement("button");
  downButton.className = "secondary-button compact-button arrange-move-button";
  downButton.type = "button";
  downButton.textContent = "↓";
  downButton.setAttribute("aria-label", `將第 ${index + 1} 張下移`);
  downButton.disabled = Boolean(context.pendingAction) || index >= context.handSize - 1;
  downButton.addEventListener("click", () => context.callbacks.moveArrangementCard(index, index + 1));
  controls.append(downButton);

  return controls;
}

function renderArrangeOrderSlots(cards, handSize) {
  const hasStoredPositions = cards.some((card) => Number.isInteger(Number(card?.position)));
  const cardsByPosition = hasStoredPositions
    ? new Map(cards.map((card) => [Number(card?.position), card]).filter(([, card]) => card))
    : new Map(cards.map((card, index) => [index + 1, card]).filter(([, card]) => card));

  return Array.from({ length: handSize }, (_, index) => {
    const position = index + 1;
    const card = cardsByPosition.get(position);
    const slot = document.createElement("div");
    slot.className = `arrange-mini-slot${card ? " filled" : ""}`;
    slot.setAttribute("aria-label", card ? `第 ${position} 張：${card.name || "卡牌"}` : `第 ${position} 張空位`);

    const number = document.createElement("span");
    number.textContent = String(position);
    slot.append(number);

    if (card?.name) {
      const title = document.createElement("strong");
      title.textContent = card.name;
      slot.append(title);
    }

    return slot;
  });
}

function getCardVisualClass(card) {
  return `card-art-${getCardVisualType(card)}`;
}

function getCardVisualType(card) {
  const text = normalizeCardVisualText(card);
  const value = Number(card?.value);

  if (includesAny(text, ["reverse", "rotate", "turn", "\u9006\u8f49", "\u56de\u8f49"])) {
    return "reverse";
  }
  if (includesAny(text, ["guard", "shield", "defense", "protect", "\u9632\u79a6", "\u9632\u8b77", "\u8b77\u76fe"])) {
    return "defense";
  }
  if (includesAny(text, ["double", "multiply", "multiplier", "times", "\u500d\u6578", "\u52a0\u500d", "\u96d9\u500d"])) {
    return "multiply";
  }
  if (includesAny(text, ["final", "finish", "endgame", "\u7d42\u5c40", "\u7d42\u5834", "\u7d50\u7b97"])) {
    return "finale";
  }
  if (includesAny(text, ["attack", "damage", "\u653b\u64ca", "\u6263\u5206"])) {
    return "minus";
  }
  if (Number.isFinite(value) && value < 0) {
    return "minus";
  }
  if (Number.isFinite(value) && value > 0) {
    return "plus";
  }
  if (card?.type === "action") {
    return "action";
  }
  if (card?.type === "special") {
    return "special";
  }
  return "neutral";
}

function normalizeCardVisualText(card) {
  return [card?.id, card?.name, card?.type, card?.description, card?.effect]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function renderBoard(self, context) {
  const { elements, currentRoom, handSize, pendingAction, playerId } = context;
  const game = currentRoom?.game;
  const players = Array.isArray(game?.players) ? game.players : [];
  const receivedCards = Array.isArray(self?.receivedCards) ? self.receivedCards.filter(Boolean) : [];
  const targetHint = getTargetHint(game, context);
  const opponents = getOpponentSeats(players, playerId);
  const actionState = getTurnActionState(game, self, targetHint, context);

  elements.boardCards.dataset.playerCount = String(players.length);
  elements.boardCards.dataset.opponentCount = String(opponents.length);
  elements.boardCards.replaceChildren(
    renderTableScoreStrip(game, currentRoom, context),
    renderTableCenter(game, currentRoom, context, targetHint, actionState),
    ...opponents.map((seat, index, seats) =>
      renderPlayerSeat(seat, index, seats.length, context, targetHint)
    ),
    renderPlayerSeat(self, -1, players.length - 1, context, targetHint)
  );

  const isMyTurn = game?.turnPlayerId === playerId;
  const noCardLeft = receivedCards.length > 0 && receivedCards.every((card) => card.used);
  const eliminated = Boolean(self?.eliminated);
  elements.rollButton.disabled = actionState.disabled;
  elements.rollButton.textContent = actionState.label;

  if (eliminated) {
    elements.turnHint.textContent = "你已被淘汰，可以繼續觀看其他玩家。";
  } else if (noCardLeft) {
    elements.turnHint.textContent = "你沒有可用卡牌，等待遊戲結束。";
  } else if (targetHint?.isUsed) {
    elements.turnHint.textContent = `第 ${targetHint.position} 張已使用。`;
  } else if (targetHint?.isViewerTarget && targetHint.isOpen && targetHint.needsAction) {
    elements.turnHint.textContent = `先處理第 ${targetHint.position} 張牌，再進入下一步。`;
  } else if (targetHint?.isViewerTarget && targetHint.needsAction) {
    elements.turnHint.textContent = `先翻開指定位置的牌：第 ${targetHint.position} 張。`;
  } else if (targetHint?.needsAction) {
    elements.turnHint.textContent = `等待對手處理第 ${targetHint.position} 張牌。`;
  } else if (isMyTurn) {
    elements.turnHint.textContent = "輪到你了，請擲骰。";
  } else {
    const turnName = game?.turnPlayerId ? context.getPlayerNameById(game.turnPlayerId, currentRoom) : "對手";
    elements.turnHint.textContent = `等待 ${turnName} 擲骰。`;
  }
}

function renderTableScoreStrip(game, room, context) {
  const strip = document.createElement("ol");
  strip.className = "table-score-strip";
  strip.setAttribute("aria-label", "邇ｩ螳ｶ蛻・丙邵ｽ隕ｽ");

  strip.replaceChildren(
    ...game.players.map((player) => {
      const playerName = context.getPlayerNameById(player.id, room);
      const item = document.createElement("li");
      item.className = `table-score-item${player.id === context.playerId ? " self-score" : ""}${player.eliminated ? " eliminated" : ""}`;

      const avatar = document.createElement("span");
      avatar.className = "seat-avatar score-avatar";
      avatar.textContent = getInitials(playerName);
      item.append(avatar);

      const name = document.createElement("span");
      name.className = "score-name";
      name.textContent = player.id === context.playerId ? `${playerName} (你)` : playerName;
      item.append(name);

      const score = document.createElement("strong");
      score.textContent = formatScore(player.score);
      item.append(score);

      return item;
    })
  );

  return strip;
}

function renderTableCenter(game, room, context, targetHint, actionState) {
  const lastRoll = game?.dice?.lastRoll;
  const displayValue = context.rollAnimation?.active ? context.rollAnimation.displayValue : lastRoll?.result;
  const center = document.createElement("div");
  center.className = "table-center";

  const title = document.createElement("strong");
  title.textContent = "牌桌中心";
  center.append(title);

  const dice = document.createElement("div");
  dice.className = `central-die${context.rollAnimation?.active ? " rolling" : ""}${context.rollAnimation?.justSettled ? " roll-settled" : ""}`;
  dice.setAttribute("aria-live", "polite");
  dice.textContent = displayValue ?? "·";
  center.append(dice);

  const currentTurn = document.createElement("span");
  const turnName = game?.turnPlayerId ? context.getPlayerNameById(game.turnPlayerId, room) : "";
  currentTurn.textContent = game?.turnPlayerId === context.playerId ? "你的回合" : turnName ? `${turnName} 的回合` : "等待對手";
  center.append(currentTurn);

  const reserve = document.createElement("p");
  reserve.textContent = actionState.message;
  center.append(reserve);

  if (targetHint?.needsAction) {
    const target = document.createElement("p");
    target.className = `target-card-hint${targetHint.canClick ? " actionable" : ""}`;
    target.textContent = getTargetHintText(targetHint);
    center.append(target);
  }

  const rollButton = context.elements.rollButton;
  rollButton.className = "primary-button central-roll-button";
  rollButton.textContent = actionState.label;
  rollButton.disabled = actionState.disabled;
  center.append(rollButton);

  return center;
}

function getTargetHint(game, context) {
  const lastRoll = game?.dice?.lastRoll;
  const position = Number(lastRoll?.position ?? lastRoll?.result);
  if (!Number.isInteger(position) || position < 1 || position > context.handSize || context.rollAnimation?.active) {
    return null;
  }

  const targetPlayerId = lastRoll?.playerId || "";
  const targetPlayer = game.players.find((player) => player.id === targetPlayerId) || null;
  const targetCard = Array.isArray(targetPlayer?.receivedCards)
    ? targetPlayer.receivedCards.find((card) => card?.position === position) || null
    : null;
  const isViewerTarget = targetPlayerId === context.playerId;
  const isUsed = lastRoll?.status === "used" || Boolean(targetCard?.used);
  const isOpen = Boolean(targetCard?.used || targetCard?.revealed);
  const cardKey = getRevealedCardKey(context.currentRoom?.code, targetPlayerId, position, targetCard, lastRoll);
  const isAcknowledged = Boolean(cardKey && context.acknowledgedRevealedCards?.has(cardKey));
  const needsAction = ["pending", "revealed"].includes(lastRoll?.status) && !isUsed && !isAcknowledged;
  const canClick =
    isViewerTarget &&
    game.turnPlayerId === context.playerId &&
    needsAction &&
    Boolean(targetCard && !targetCard.used) &&
    !targetPlayer?.eliminated &&
    !context.pendingAction;

  return {
    cardKey,
    canClick,
    isAcknowledged,
    isOpen,
    isUsed,
    needsAction,
    isViewerTarget,
    playerId: targetPlayerId,
    position,
    result: lastRoll.result,
    status: lastRoll.status
  };
}

function getRevealedCardKey(roomCode, targetPlayerId, position, card, lastRoll) {
  if (!roomCode || !targetPlayerId || !card) {
    return "";
  }

  const cardId = card.instanceId || card.id || "card";
  const rollResult = lastRoll?.result ?? lastRoll?.position ?? "roll";
  return `${roomCode}:${targetPlayerId}:${position}:${cardId}:${rollResult}`;
}

function getTargetHintText(targetHint) {
  if (targetHint.isUsed || targetHint.isAcknowledged) {
    return `第 ${targetHint.position} 張已使用`;
  }
  if (targetHint.isViewerTarget && !targetHint.isOpen) {
    return `翻開第 ${targetHint.position} 張`;
  }
  if (targetHint.isViewerTarget) {
    return `處理第 ${targetHint.position} 張`;
  }
  if (targetHint.isOpen) {
    return `第 ${targetHint.position} 張已翻開`;
  }
  return `等待對手處理第 ${targetHint.position} 張`;
}

function getTurnActionState(game, self, targetHint, context) {
  const receivedCards = Array.isArray(self?.receivedCards) ? self.receivedCards.filter(Boolean) : [];
  const noCardLeft = receivedCards.length > 0 && receivedCards.every((card) => card.used);
  const isMyTurn = game?.turnPlayerId === context.playerId;

  if (context.rollAnimation?.active) {
    return { disabled: true, label: "擲骰中...", message: "骰子跳動中，等待結果。" };
  }
  if (context.pendingAction || context.cardUsePending) {
    const label = targetHint?.isViewerTarget && targetHint.needsAction ? "處理中..." : "擲骰中...";
    return { disabled: true, label, message: "正在同步回合操作。" };
  }
  if (self?.eliminated) {
    return { disabled: true, label: "已淘汰", message: "你已淘汰，保留觀戰視角。" };
  }
  if (noCardLeft) {
    return { disabled: true, label: "無可用牌", message: "你已沒有可用卡牌。" };
  }
  if (!isMyTurn) {
    const turnName = game?.turnPlayerId ? context.getPlayerNameById(game.turnPlayerId, context.currentRoom) : "對手";
    return { disabled: true, label: "等待對手", message: `輪到 ${turnName}，等待對手行動。` };
  }
  if (targetHint?.isViewerTarget && targetHint.needsAction) {
    const resultText = Number.isInteger(Number(targetHint.result)) ? targetHint.result : "?";
    return {
      disabled: false,
      label: targetHint.isOpen ? `處理第 ${targetHint.position} 張` : `翻開第 ${targetHint.position} 張`,
      message: `你擲出 ${resultText}，指向第 ${targetHint.position} 張`
    };
  }
  return { disabled: false, label: "擲骰", message: "輪到你，擲骰決定要翻的牌。" };
}

function getOpponentSeats(players, playerId) {
  const selfIndex = players.findIndex((player) => player.id === playerId);
  if (selfIndex === -1) {
    return players.filter((player) => player.id !== playerId);
  }

  return players
    .slice(selfIndex + 1)
    .concat(players.slice(0, selfIndex))
    .filter((player) => player.id !== playerId);
}

function renderPlayerSeat(player, opponentIndex, opponentCount, context, targetHint) {
  const isSelf = player?.id === context.playerId;
  const isTurn = Boolean(player?.id && context.currentRoom?.game?.turnPlayerId === player.id);
  const eliminated = Boolean(player?.eliminated);
  const seatPosition = isSelf ? "self" : getOpponentSeatPosition(opponentIndex, opponentCount);
  const seat = document.createElement("section");
  seat.className = [
    "player-seat",
    isSelf ? "self-seat" : `opponent-seat ${seatPosition}-seat`,
    isTurn ? "current-turn" : "",
    eliminated ? "eliminated" : ""
  ]
    .filter(Boolean)
    .join(" ");
  seat.dataset.seat = seatPosition;

  const header = document.createElement("div");
  header.className = "seat-header";

  const avatar = document.createElement("span");
  avatar.className = "seat-avatar";
  avatar.textContent = getInitials(player?.name);
  header.append(avatar);

  const identity = document.createElement("div");
  identity.className = "seat-identity";

  const name = document.createElement("strong");
  name.textContent = player?.name || "未知玩家";
  identity.append(name);

  const meta = document.createElement("span");
  meta.textContent = `${formatScore(player?.score)} 分`;
  identity.append(meta);
  header.append(identity);

  const badges = document.createElement("div");
  badges.className = "seat-badges";
  if (isSelf) {
    badges.append(renderSeatBadge("你"));
  }
  if (isTurn) {
    badges.append(renderSeatBadge("回合中"));
  }
  if (eliminated) {
    badges.append(renderSeatBadge("淘汰"));
  }
  header.append(badges);
  seat.append(header);

  const cards = document.createElement("div");
  cards.className = "seat-card-row";
  cards.replaceChildren(...renderSeatCards(player, context.handSize, isSelf, targetHint, context));
  seat.append(cards);

  return seat;
}

function getOpponentSeatPosition(index, count) {
  if (count <= 1) {
    return "top";
  }
  if (count === 2) {
    return index === 0 ? "left" : "right";
  }
  return ["left", "top", "right"][index] || "top";
}

function renderSeatBadge(text) {
  const badge = document.createElement("span");
  badge.className = "seat-badge";
  badge.textContent = text;
  return badge;
}

function renderSeatCards(player, handSize, isSelf, targetHint, context) {
  const receivedCards = Array.isArray(player?.receivedCards) ? player.receivedCards.filter(Boolean) : [];
  const cardsByPosition = new Map(receivedCards.map((card) => [card.position, card]));
  const ownerPlayerId = player?.id || "";

  return Array.from({ length: handSize }, (_, index) => {
    const position = index + 1;
    const isTarget = targetHint?.playerId === player?.id && targetHint.position === position;
    return renderBoardCard(cardsByPosition.get(position), position, {
      canClick: Boolean(isTarget && targetHint?.canClick),
      canOpenDetails: Boolean(cardsByPosition.get(position)?.revealed),
      isSelf,
      isTarget,
      isRecentlyRevealed: Boolean(isTarget && targetHint?.cardKey && targetHint.cardKey === context.recentlyRevealedCardKey),
      ownerPlayerId,
      targetHint: isTarget ? targetHint : null,
      onClick: context.callbacks.handleTargetCardClick,
      onOpenDetails: context.callbacks.openCardDetail
    });
  });
}

function renderBoardCard(card, position, options = {}) {
  const {
    canClick = false,
    canOpenDetails = false,
    isSelf = false,
    isTarget = false,
    isRecentlyRevealed = false,
    ownerPlayerId = "",
    targetHint = null,
    onClick,
    onOpenDetails
  } = options;
  const interactive = canClick || canOpenDetails;
  const item = document.createElement(interactive ? "button" : "div");
  item.className = `position-card board-card table-card${card?.revealed ? ` revealed ${getCardVisualClass(card)}` : ""}${card?.used ? " used" : ""}${!card ? " missing" : ""}${isTarget ? " target-card" : ""}${canClick ? " clickable" : ""}${isRecentlyRevealed ? " just-revealed" : ""}`;
  if (interactive) {
    item.type = "button";
    item.setAttribute("aria-label", canClick ? getBoardCardActionLabel(position, targetHint) : getBoardCardDetailLabel(card, position));
    item.addEventListener("click", () => {
      if (canClick) {
        onClick(position);
        return;
      }
      onOpenDetails(ownerPlayerId, position);
    });
  }

  const label = document.createElement("span");
  label.className = "card-position";
  label.textContent = String(position);
  item.append(label);

  const isUsed = Boolean(card?.used);

  if (card?.revealed) {
    const icon = document.createElement("span");
    icon.className = `card-art-icon ${getCardVisualClass(card)}`;
    icon.setAttribute("aria-hidden", "true");
    item.append(icon);
  }

  if (!isUsed) {
    const title = document.createElement("strong");
    title.textContent = canClick ? getBoardCardActionLabel(position, targetHint) : getBoardCardTitle(card);
    item.append(title);

    const detail = document.createElement("span");
    detail.className = "card-effect";
    detail.textContent = canClick ? "指定位置" : getBoardCardDetail(card, isSelf);
    item.append(detail);
  }

  if (isUsed) {
    const used = document.createElement("span");
    used.className = "used-marker";
    used.textContent = "已使用";
    item.append(used);
  }

  return item;
}

function getBoardCardActionLabel(position, targetHint) {
  if (targetHint?.isOpen) {
    return `處理第 ${position} 張`;
  }
  return `翻開第 ${position} 張`;
}

function getBoardCardDetailLabel(card, position) {
  return `查看第 ${position} 張${card?.name ? `，${card.name}` : ""}詳情`;
}

function getBoardCardTitle(card) {
  if (!card) {
    return "未收牌";
  }
  if (card.revealed) {
    return card.name || "已翻開";
  }
  return "牌背";
}

function getBoardCardDetail(card, isSelf) {
  if (!card) {
    return "等待牌";
  }
  if (card.revealed) {
    return describeCard(card);
  }
  return isSelf ? "尚未翻開" : "未公開";
}

function renderRevealedCardModal(game, context) {
  const existing = context.elements.gamePanel.querySelector(".card-modal-backdrop");
  const modal = context.revealedCardModal;
  const player = modal
    ? game?.players?.find((candidate) => candidate.id === modal.playerId) || null
    : null;
  const card = Array.isArray(player?.receivedCards)
    ? player.receivedCards.find((candidate) => candidate?.position === modal.position) || null
    : null;

  if (!modal || !card?.revealed) {
    closeRenderedModal(existing);
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = `card-modal-backdrop${existing && !existing.classList.contains("is-closing") ? " is-stable" : ""}`;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      context.callbacks.closeRevealedCardModal();
    }
  });

  const dialog = document.createElement("section");
  dialog.className = `card-modal${existing && !existing.classList.contains("is-closing") ? " is-stable" : ""}`;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "卡牌詳情");

  const closeButton = document.createElement("button");
  closeButton.className = "card-modal-close";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.disabled = Boolean(context.cardUsePending);
  closeButton.addEventListener("click", context.callbacks.closeRevealedCardModal);
  dialog.append(closeButton);

  const modalTitle = document.createElement("h3");
  modalTitle.className = "modal-title";
  modalTitle.textContent = "卡牌詳情";
  dialog.append(modalTitle);

  const largeCard = document.createElement("article");
  largeCard.className = `large-card ${Number(card.value) >= 0 ? "score-positive" : "score-negative"} ${getCardVisualClass(card)}`;

  const position = document.createElement("span");
  position.className = "card-position";
  position.textContent = `第 ${modal.position} 張`;
  largeCard.append(position);

  const art = document.createElement("div");
  art.className = "large-card-art";
  art.setAttribute("aria-hidden", "true");

  const valueBadge = document.createElement("span");
  valueBadge.className = "large-card-value";
  valueBadge.textContent = formatCardValue(card);
  art.append(valueBadge);

  const diceArt = document.createElement("span");
  diceArt.className = "large-card-dice";
  diceArt.textContent = "⚂";
  diceArt.className = `large-card-icon card-art-icon ${getCardVisualClass(card)}`;
  diceArt.textContent = "";
  diceArt.setAttribute("aria-hidden", "true");
  art.append(diceArt);

  const motion = document.createElement("span");
  motion.className = "large-card-motion";
  motion.textContent = "↻";
  motion.textContent = "";
  motion.setAttribute("aria-hidden", "true");
  art.append(motion);

  largeCard.append(art);

  const title = document.createElement("h3");
  title.textContent = card.name || "已翻開卡牌";
  largeCard.append(title);

  const effect = document.createElement("strong");
  effect.className = "large-card-effect";
  effect.textContent = card.type === "score" ? describeScoreEffect(card) : describeCard(card);
  largeCard.append(effect);

  dialog.append(largeCard);

  const metaList = document.createElement("dl");
  metaList.className = "card-modal-meta";
  metaList.append(renderMetaItem("位置", `第 ${modal.position} 張`));
  metaList.append(renderMetaItem("來源", getCardSourceText(game, modal, context)));
  metaList.append(renderMetaItem("狀態", getCardStatusText(card)));
  dialog.append(metaList);

  const effectPanel = document.createElement("section");
  effectPanel.className = "card-modal-effect-panel";

  const effectTitle = document.createElement("h4");
  effectTitle.textContent = "效果";
  effectPanel.append(effectTitle);

  const effectDescription = document.createElement("p");
  effectDescription.textContent = getCardEffectDescription(card);
  effectPanel.append(effectDescription);
  dialog.append(effectPanel);

  const canUseEffect = canUseRevealedCardEffect(game, modal, card, player, context);
  const actions = document.createElement("div");
  actions.className = `card-modal-actions${canUseEffect ? "" : " single-action"}`;

  const closeAction = document.createElement("button");
  closeAction.className = "secondary-button card-cancel-button";
  closeAction.type = "button";
  closeAction.textContent = "關閉";
  closeAction.disabled = Boolean(context.cardUsePending);
  if (!canUseEffect) {
    closeAction.classList.add("full-width");
  }
  closeAction.addEventListener("click", context.callbacks.closeRevealedCardModal);
  actions.append(closeAction);

  if (canUseEffect) {
    const useButton = document.createElement("button");
    useButton.className = "primary-button card-use-button";
    useButton.type = "button";
    useButton.textContent = context.cardUsePending ? "使用中..." : "使用效果";
    useButton.disabled = Boolean(context.cardUsePending);
    useButton.addEventListener("click", context.callbacks.useRevealedCard);
    actions.append(useButton);
  }

  dialog.append(actions);
  backdrop.append(dialog);
  existing?.replaceWith(backdrop);
  if (!existing) {
    context.elements.gamePanel.append(backdrop);
  }
}

function closeRenderedModal(existing) {
  if (!existing || existing.classList.contains("is-closing")) {
    return;
  }

  existing.classList.add("is-closing");
  window.setTimeout(() => existing.remove(), 140);
}

function canUseRevealedCardEffect(game, modal, card, player, context) {
  const position = Number(modal?.position);
  const lastRoll = game?.dice?.lastRoll;
  const isOwnCard = modal?.playerId === context.playerId && player?.id === context.playerId;
  const isMyTurn = game?.turnPlayerId === context.playerId;
  const isPendingCard =
    lastRoll?.playerId === context.playerId &&
    Number(lastRoll?.position ?? lastRoll?.result) === position &&
    ["pending", "revealed"].includes(lastRoll?.status);
  const cardKey = getRevealedCardKey(context.currentRoom?.code, modal?.playerId, position, card, lastRoll);
  const acknowledged = Boolean(cardKey && context.acknowledgedRevealedCards?.has(cardKey));

  return Boolean(
    isOwnCard &&
      isMyTurn &&
      isPendingCard &&
      card?.revealed &&
      !card.used &&
      !player?.eliminated &&
      !acknowledged
  );
}

function formatCardValue(card) {
  const value = Number(card?.value);
  if (!Number.isFinite(value)) {
    return "•";
  }
  return value > 0 ? `+${value}` : String(value);
}

function getCardSourceText(game, modal, context) {
  const sourcePlayer = getCardSourcePlayer(game, modal?.playerId);
  if (!sourcePlayer) {
    return "未知來源";
  }

  const sourceName = context.getPlayerNameById(sourcePlayer.id, context.currentRoom);
  return sourcePlayer.id === context.playerId ? "由你傳來" : `${sourceName} 傳來`;
}

function getCardSourcePlayer(game, ownerPlayerId) {
  const players = Array.isArray(game?.players) ? game.players.filter(Boolean) : [];
  if (!players.length || !ownerPlayerId) {
    return null;
  }

  const ownerIndex = players.findIndex((player) => player.id === ownerPlayerId);
  if (ownerIndex === -1) {
    return null;
  }

  return players[(ownerIndex - 1 + players.length) % players.length] || null;
}

function getCardStatusText(card) {
  if (card?.used) {
    return "已使用";
  }
  if (card?.revealed) {
    return "已翻開";
  }
  return "未公開";
}

function getCardEffectDescription(card) {
  if (card?.description) {
    return card.description;
  }
  if (card?.type === "score") {
    return `使用後，${describeScoreEffect(card)}。`;
  }
  return describeCard(card);
}

function renderMetaItem(label, value) {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  item.append(term, description);
  return item;
}

function getInitials(name) {
  const text = String(name || "?").trim();
  if (!text) {
    return "?";
  }
  const compact = text.replace(/\s+/g, "");
  return Array.from(compact).slice(0, 2).join("").toUpperCase();
}

function formatScore(score) {
  const number = Number(score);
  return Number.isFinite(number) ? number : "·";
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
      const statusText = player.eliminated ? "淘汰" : usedCount >= context.handSize ? "無可用牌" : "等待中";
      state.textContent = `${player.score} 分 · ${statusText}`;
      item.append(state);

      return item;
    })
  );
}

export function renderFinished(game, room, context) {
  const winnerNames = game.winnerIds.map((id) => context.getPlayerNameById(id, room)).filter(Boolean);
  context.elements.winnerText.textContent = winnerNames.length ? `勝利者：${winnerNames.join("、")}` : "沒有勝利者。";
}

export function describeCard(card) {
  if (!card) {
    return "";
  }

  const parts = [];
  if (card.type) {
    parts.push(formatCardType(card.type));
  }
  if (card.value !== null && card.value !== undefined) {
    parts.push(`數值 ${card.value}`);
  }
  if (card.effect) {
    parts.push(card.effect);
  }
  return parts.join(" · ") || "沒有公開效果";
}

function describeScoreEffect(card) {
  const value = Number(card?.value);
  if (Number.isFinite(value) && value !== 0) {
    return `${value > 0 ? "+" : ""}${value} 分`;
  }
  return describeCard(card);
}

function formatCardType(type) {
  const labels = {
    score: "分數",
    action: "效果",
    special: "特殊"
  };
  return labels[type] || type;
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
