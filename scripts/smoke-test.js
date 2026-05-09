import { spawn } from "node:child_process";

const port = 3123;
const baseUrl = `http://localhost:${port}`;

const server = spawn(process.execPath, ["Server/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
server.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForServer();

  const created = await post("/api/rooms", { playerId: "player-one", name: "AA" });
  assert(created.room?.code, "create room should return a room code");

  const code = created.room.code;
  const joined = await post(`/api/rooms/${code}/join`, { playerId: "player-two", name: "BBB" });
  assert(joined.room.players.length === 2, "join room should add the second player");

  const started = await post(`/api/rooms/${code}/start`, { playerId: "player-one" });
  assert(started.room.status === "playing", "host should be able to start the game");
  assert(started.room.game?.phase === "arranging", "start should create an arranging game state");

  await post(`/api/rooms/${code}/leave`, { playerId: "player-two" });
  const afterLeave = await get(`/api/rooms/${code}`);
  assert(afterLeave.room.players.length === 1, "leave room should remove the player");

  console.log("Smoke test passed.");
} finally {
  server.kill();
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server did not start in time. ${stderr}`.trim());
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return readJson(response);
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readJson(response);
}

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
