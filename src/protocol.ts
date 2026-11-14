/**
 * What crosses the socket between this mod and a lobby. JSON text frames, one message each.
 *
 * A copy of the relay's own `protocol.ts`, which is the
 * contract: the two are kept identical by hand. `VERSION` is what lets the relay tell an outdated
 * copy of this mod so, rather than both sides quietly misreading each other.
 */

export const VERSION = 1;

/**
 * Where a player is and how to draw them, as the sender's game sees it:
 * `[room, x, y, facing, flipped, angle, pose]`.
 *
 * `x`/`y` are where the character's feet go -- the bottom centre of its sprite, whatever the game's
 * own sprite origin was -- so a receiver can draw a skin there without knowing anything about the
 * sender's sprites. `facing` and `flipped` are ±1. `pose` indexes idle, run, jump, fall.
 *
 * A tuple rather than an object because it is the one message sent many times a second.
 */
export type State = [
  room: number,
  x: number,
  y: number,
  facing: number,
  flipped: number,
  angle: number,
  pose: number,
];

export type ClientMessage =
  /** First message on a socket. `skin` is the character's sheet as base64 PNG, or null for none. */
  | { t: "hello"; v: number; name: string; skin: string | null }
  /** null: this player has no player instance right now (dead, a menu, a cutscene). */
  | { t: "state"; s: State | null }
  | { t: "skin"; skin: string | null }
  | { t: "chat"; text: string }
  /**
   * The game really saved (its own save routine, never a mod's), here. Other players are sent to it
   * on their next reload, once. `g` is the save's gravity: the values of whichever of the game's
   * globals say which way is down, in the order the game's code names them.
   */
  | { t: "saved"; room: number; x: number; y: number; g: number[] };

export interface Peer {
  id: string;
  name: string;
  skin: string | null;
  state: State | null;
}

export type ServerMessage =
  | { t: "welcome"; id: string; peers: Peer[] }
  | { t: "join"; id: string; name: string; skin: string | null }
  | { t: "leave"; id: string }
  | { t: "state"; id: string; s: State | null }
  | { t: "skin"; id: string; skin: string | null }
  | { t: "chat"; id: string; text: string }
  | { t: "saved"; id: string; room: number; x: number; y: number; g: number[] }
  /** Sent right before the lobby closes the socket, so the mod can say why. */
  | { t: "error"; reason: "version" | "full" | "invalid" | "flood" };
