import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const baseUrl = "http://localhost:3000";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = 9333;
const outDir = path.resolve("mobile-check-artifacts");
const userDataDir = path.resolve(".tmp-mobile-chrome");

async function main() {
  await waitForServer();
  await fs.mkdir(outDir, { recursive: true });
  await fs.rm(userDataDir, { recursive: true, force: true });
  console.log("server ready");

  const chrome = spawn(chromePath, [
    "--headless=chrome",
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "about:blank"
  ], { stdio: "ignore" });

  try {
  await waitPort(cdpPort);
  console.log("chrome ready");
  const rooms = await prepareRooms();
  console.log("rooms ready", rooms);
  const results = [];

  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    results.push(await scenario("entry", viewport, "entry-player", `${baseUrl}/`));
    results.push(await scenario("lobby", viewport, "lobby-player", `${baseUrl}/`, async (cdp) => {
      await evaluate(cdp, "document.querySelector('#entryStartButton').click(), true");
      await delay(200);
    }));
    results.push(await scenario("room", viewport, "mobile-one", `${baseUrl}/#room=${rooms.waitingCode}`));
    results.push(await scenario("settings", viewport, "mobile-one", `${baseUrl}/#room=${rooms.waitingCode}`, async (cdp) => {
      await evaluate(cdp, "document.querySelector('#settingsButton').click(), true");
      await delay(150);
    }));
    results.push(await scenario("drafting", viewport, "draft-one", `${baseUrl}/#room=${rooms.draftCode}`));
    results.push(await scenario("arranging", viewport, "arr-one", `${baseUrl}/#room=${rooms.arrangeCode}`));
    results.push(await scenario("playing", viewport, rooms.turnPlayer, `${baseUrl}/#room=${rooms.playCode}`));
    results.push(await scenario("card-modal", viewport, rooms.turnPlayer, `${baseUrl}/#room=${rooms.playCode}`, async (cdp) => {
      await evaluate(cdp, "document.querySelector('.target-card.clickable')?.click(), true");
      await delay(200);
    }));
  }

  await fs.writeFile(path.join(outDir, "mobile-overflow-report.json"), `${JSON.stringify({ rooms, results }, null, 2)}\n`);
  console.log(JSON.stringify(summarize(results), null, 2));
  } finally {
    chrome.kill();
    await onceExit(chrome);
    try {
      await fs.rm(userDataDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
    }
  }
}

async function scenario(label, viewport, playerId, url, beforeAudit = null) {
  console.log("scenario", `${viewport.width}x${viewport.height}`, label);
  const { cdp, close } = await newPage(playerId, viewport);
  try {
    await navigate(cdp, url);
    if (beforeAudit) {
      await beforeAudit(cdp);
    }
    const audit = await evaluate(cdp, auditExpression);
    await screenshot(cdp, `${viewport.width}x${viewport.height}-${label}`);
    return { label, viewport, audit };
  } finally {
    close();
  }
}

function summarize(results) {
  return results.map(({ label, viewport, audit }) => ({
    label,
    viewport,
    hasHorizontalOverflow: audit.hasHorizontalOverflow,
    docScrollWidth: audit.docScrollWidth,
    badButtons: audit.badButtons.length,
    overflowing: audit.overflowing.map((item) => `${item.tag}${item.id ? `#${item.id}` : ""}${item.cls ? `.${item.cls}` : ""}`)
  }));
}

async function prepareRooms() {
  const waitingCode = (await post("/api/rooms", { playerId: "mobile-one", name: "VeryLongMobilePlayerNameOne" })).room.code;

  const draftCode = (await post("/api/rooms", { playerId: "draft-one", name: "DraftLongNameOne" })).room.code;
  await post(`/api/rooms/${draftCode}/join`, { playerId: "draft-two", name: "DraftLongNameTwo" });
  await post(`/api/rooms/${draftCode}/start`, { playerId: "draft-one" });

  const arrangeCode = (await post("/api/rooms", { playerId: "arr-one", name: "ArrangeLongNameOne" })).room.code;
  await post(`/api/rooms/${arrangeCode}/join`, { playerId: "arr-two", name: "ArrangeLongNameTwo" });
  await post(`/api/rooms/${arrangeCode}/start`, { playerId: "arr-one" });
  await draftSix(arrangeCode, "arr-one");
  await draftSix(arrangeCode, "arr-two");

  const playCode = (await post("/api/rooms", { playerId: "play-one", name: "PlayLongNameOne" })).room.code;
  await post(`/api/rooms/${playCode}/join`, { playerId: "play-two", name: "PlayLongNameTwo" });
  await post(`/api/rooms/${playCode}/start`, { playerId: "play-one" });
  await draftSix(playCode, "play-one");
  await draftSix(playCode, "play-two");
  await arrange(playCode, "play-one");
  await arrange(playCode, "play-two");
  const beforeTurn = await get(`/api/rooms/${playCode}?playerId=play-one`);
  const turnPlayer = beforeTurn.room.game.turnPlayerId;
  await post(`/api/rooms/${playCode}/turn`, { playerId: turnPlayer });

  return { waitingCode, draftCode, arrangeCode, playCode, turnPlayer };
}

async function draftSix(code, playerId) {
  const view = await get(`/api/rooms/${code}?playerId=${encodeURIComponent(playerId)}`);
  const player = view.room.game.players.find((candidate) => candidate.id === playerId);
  for (const card of player.draftCards.slice(0, 6)) {
    await post(`/api/rooms/${code}/draft`, { playerId, cardInstanceId: card.instanceId });
  }
}

async function arrange(code, playerId) {
  const view = await get(`/api/rooms/${code}?playerId=${encodeURIComponent(playerId)}`);
  const player = view.room.game.players.find((candidate) => candidate.id === playerId);
  await post(`/api/rooms/${code}/arrange`, {
    playerId,
    cardInstanceIds: player.hand.map((card) => card.instanceId)
  });
}

async function post(url, body) {
  const response = await fetch(baseUrl + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function get(url) {
  const response = await fetch(baseUrl + url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

class CdpSession {
  constructor(socket) {
    this.id = 0;
    this.socket = socket;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
    });
  }
}

async function newPage(playerId, viewport) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" });
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const cdp = new CdpSession(socket);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    mobile: true
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `sessionStorage.setItem('dice-card-player-id', ${JSON.stringify(playerId)}); localStorage.setItem('dice-card-player-name', ${JSON.stringify(playerId)});`
  });
  return { cdp, close: () => socket.close() };
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await delay(900);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function screenshot(cdp, name) {
  const data = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  await fs.writeFile(path.join(outDir, `${name}.png`), Buffer.from(data.data, "base64"));
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(150);
    }
  }
  throw new Error("local server not reachable");
}

function waitPort(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const tryOnce = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error("CDP port not reachable"));
        } else {
          setTimeout(tryOnce, 100);
        }
      });
    };
    tryOnce();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceExit(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    childProcess.once("exit", resolve);
  });
}

const auditExpression = `(() => {
  const selectors = [
    'body',
    '.shell',
    '.entry-view',
    '.lobby-panel',
    '.room-panel',
    '.game-panel',
    '.tabletop-board',
    '.settings-menu',
    '.card-modal',
    '#draftPanel .draft-grid',
    '#arrangePanel .slot-grid',
    '#turnPanel'
  ];
  const dims = selectors.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      selector,
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowX: getComputedStyle(element).overflowX,
      overflowY: getComputedStyle(element).overflowY
    };
  }).filter(Boolean);
  const overflowing = Array.from(document.querySelectorAll('body *')).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      cls: String(element.className || ''),
      text: (element.textContent || '').trim().slice(0, 40),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    };
  }).filter((item) => item.right > innerWidth + 1 || item.left < -1 || item.scrollWidth > item.clientWidth + 1).slice(0, 20);
  const badButtons = Array.from(document.querySelectorAll('button')).map((element) => ({
    text: (element.textContent || '').trim().slice(0, 50),
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight
  })).filter((item) => item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 4);
  return {
    innerWidth,
    innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
    dims,
    overflowing,
    badButtons
  };
})()`;

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
