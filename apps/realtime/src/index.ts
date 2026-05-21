import path from "node:path";
import fs from "node:fs";
import { config } from "dotenv";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { and, asc, eq, gt } from "drizzle-orm";
import { resolveApiKey } from "@storeai/auth";
import { events, getDb } from "@storeai/db";
import { getAppConnection } from "@storeai/queue";

function loadRepoRootEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  config();
}
loadRepoRootEnv();

const port = Number(process.env.REALTIME_PORT ?? 3010);
const host = process.env.REALTIME_HOST ?? "127.0.0.1";
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server });

interface AuthMessage {
  type: "auth";
  token: string;
  lastEventId?: string;
}

wss.on("connection", (socket) => {
  let authed = false;
  let unsubscribe: (() => Promise<void>) | null = null;
  const authTimer = setTimeout(() => {
    if (!authed) socket.close(4001, "auth required");
  }, 10_000);

  socket.once("message", async (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as Partial<AuthMessage>;
      if (msg.type !== "auth" || !msg.token) throw new Error("auth message required");
      const resolved = await resolveApiKey(msg.token);
      if (!resolved) throw new Error("invalid api key");
      if (resolved.scopes && !resolved.scopes.includes("realtime:connect")) {
        throw new Error("missing realtime:connect scope");
      }

      authed = true;
      clearTimeout(authTimer);
      send(socket, { type: "ready", tenantId: resolved.apiKey.tenantId });
      await replayEvents(socket, resolved.apiKey.tenantId, msg.lastEventId);
      unsubscribe = await subscribeTenant(socket, resolved.apiKey.tenantId);
    } catch (err) {
      send(socket, { type: "error", message: (err as Error).message });
      socket.close(4003, "auth failed");
    }
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    if (unsubscribe) void unsubscribe();
  });
});

async function replayEvents(socket: WebSocket, tenantId: string, lastEventId?: string) {
  const db = getDb();
  let afterDate: Date | null = null;
  if (lastEventId) {
    const rows = await db
      .select({ createdAt: events.createdAt })
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.id, lastEventId)))
      .limit(1);
    afterDate = rows[0]?.createdAt ?? null;
  }

  const conds = [eq(events.tenantId, tenantId)];
  if (afterDate) conds.push(gt(events.createdAt, afterDate));
  const rows = await db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(asc(events.createdAt))
    .limit(500);
  for (const event of rows) send(socket, { type: "event", event });
}

async function subscribeTenant(socket: WebSocket, tenantId: string): Promise<() => Promise<void>> {
  const sub = getAppConnection().duplicate();
  const channel = `storeai:tenant:${tenantId}:events`;
  sub.on("message", async (_channel, eventId) => {
    const rows = await getDb()
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.id, eventId)))
      .limit(1);
    if (rows[0]) send(socket, { type: "event", event: rows[0] });
  });
  await sub.subscribe(channel);
  return async () => {
    await sub.unsubscribe(channel).catch(() => undefined);
    await sub.quit().catch(() => undefined);
  };
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

server.listen(port, host, () => {
  console.log(`[realtime] listening on ${host}:${port}`);
});

async function shutdown() {
  console.log("[realtime] shutting down...");
  wss.close();
  server.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
