/**
 * The socket to a lobby, kept open for as long as the game runs.
 *
 * Reconnects on its own, backing off, because the relay drops every connection whenever it is
 * redeployed and a player should not have to restart their game for that. Each new connection says
 * hello again, and the lobby answers with everyone in it, so nothing has to be replayed from here.
 *
 * Positions are sent at most `SEND_EVERY_MS` apart, always the newest one, and repeated every
 * `REPEAT_MS` even when nothing moved: the relay forgets positions when it goes idle, and a player
 * standing still would otherwise be invisible to anyone who joined after them. "No player" is
 * repeated too, more slowly: the relay drops anyone it has not heard from in thirty seconds.
 *
 * `pause` closes the socket and stops it coming back until `resume`. The mod pauses when its game
 * has gone quiet, so a player whose game is gone does not linger in everyone else's.
 */

import type { ClientMessage, ServerMessage, State } from "./protocol";

const SEND_EVERY_MS = 50;
const REPEAT_MS = 1000;
/** How often "no player" is repeated. Well inside the relay's thirty seconds of allowed silence. */
const IDLE_REPEAT_MS = 10_000;
const PING_MS = 20_000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

export interface Connection {
  /** The newest position of the local player, or null while there is none. Sent when due. */
  setState(state: State | null): void;
  send(message: Exclude<ClientMessage, { t: "hello" } | { t: "state" }>): void;
  /** Drop the connection and open a new one, e.g. to introduce this player under a new name. */
  reconnect(): void;
  /** Close, and stay closed until `resume`. */
  pause(): void;
  resume(): void;
}

export const connect = function (options: {
  /** Asked again on every (re)connect, so a change of lobby takes effect on the next one. */
  url: () => string;
  hello: () => Extract<ClientMessage, { t: "hello" }>;
  onMessage: (message: ServerMessage) => void;
  onOpen: () => void;
  /** `retrying` is false when the relay refused this client for good (an outdated mod). */
  onClose: (retrying: boolean) => void;
}): Connection {
  let socket: WebSocket | null = null;
  let retry = RETRY_MIN_MS;
  let stopped = false;
  let paused = false;

  let state: State | null = null;
  let sent: string | null = null;
  let sentAt = 0;

  const open = () => {
    // A retry scheduled before a pause must not reopen what the pause closed.
    if (paused || stopped || socket) return;
    const ws = new WebSocket(options.url());
    socket = ws;
    ws.addEventListener("open", () => {
      retry = RETRY_MIN_MS;
      sent = null;
      ws.send(JSON.stringify(options.hello()));
      options.onOpen();
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === "error" && message.reason === "version") stopped = true;
      options.onMessage(message);
    });
    ws.addEventListener("close", () => {
      if (socket !== ws) return;
      socket = null;
      options.onClose(!stopped && !paused);
      if (stopped || paused) return;
      setTimeout(open, retry);
      retry = Math.min(RETRY_MAX_MS, retry * 2);
    });
  };

  const raw = (message: ClientMessage) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(state);
    const now = Date.now();
    if (text === sent && now - sentAt < (state === null ? IDLE_REPEAT_MS : REPEAT_MS)) return;
    sent = text;
    sentAt = now;
    raw({ t: "state", s: state });
  }, SEND_EVERY_MS);

  // Plain text, answered by the relay's runtime without waking the lobby. Keeps proxies from
  // deciding an idle socket is dead.
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
  }, PING_MS);

  open();

  return {
    setState(next) {
      state = next;
    },
    send: raw,
    reconnect() {
      socket?.close();
    },
    pause() {
      if (paused) return;
      paused = true;
      socket?.close();
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (!socket && !stopped) open();
    },
  };
};
