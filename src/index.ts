import {
  createMod,
  gameMakerKey,
  type Mod,
  type Ref,
  type Sprite,
  type UiTone,
} from "@sculptr/sdk";
import { findSaveModel, type SaveModel } from "@sculptr/detect";
import { initText } from "@sculptr/text";
import { lobbyKey, roomLobbyKey } from "./fingerprint";
import { text, type Text } from "./i18n";
import { connect, type Connection } from "./net";
import { findPlayer, type PlayerModel } from "./player";
import { poseOf } from "./pose";
import type { Peer, ServerMessage, State } from "./protocol";
import { VERSION } from "./protocol";
import { fromBase64, POSES, sliceSheet, toBase64 } from "./sheet";
import { installSharedSaves, type SharedSaves } from "./shared";
import defaultSheet from "./sprites/default.png?inline";

/**
 * Everyone playing the same game, in the same game: I Wanna Play Online, as a sculptr mod.
 *
 * ## What travels
 *
 * Each player's copy of this mod reports where its player is -- room, feet position, facing,
 * pose -- to a lobby on the relay, and draws whoever
 * else the lobby says is in the same room. Chat and shared saves (`shared.ts`) ride the same socket.
 *
 * ## How other players look
 *
 * As the character *they* picked in the host, drawn from their own sheet, which their copy of the
 * mod sends when it joins. Nothing about it depends on the game's sprites, so it is the same picture
 * whether or not anyone involved uses the Skin mod: that mod swaps the game's own player sprites,
 * and a ghost drawn from those would wear whatever the *viewer's* game has in them. Somebody who
 * never picked a character appears as the Kid.
 *
 * Each ghost is one sprite holding all four poses (see `sheet.ts`). Sprites are declared up front,
 * so there is a fixed number of them: `SLOTS` players in view at once, a slot freed whenever a
 * player leaves, and anyone beyond that waiting for one.
 */

const SLOTS = 16;
/** How tall the chat box is, in pixels -- the same whether it is empty or full. */
const CHAT_HEIGHT = 180;
/** Chat lines the panel keeps. Old enough to scroll back through, bounded so a long session cannot
 *  grow the panel's tree without limit. */
const CHAT_HISTORY = 100;
/** Steps a chat bubble stays up, and a notice. */
const CHAT_STEPS = 250;
const NOTE_STEPS = 150;
/** A save writes its position several times over (x and y, each gravity branch); one share. */
const SAVE_DEBOUNCE_MS = 2000;
/** Moving further than this in one message is a teleport: jump there instead of gliding. */
const SNAP = 48;
/** The game says where its player is at least this often, even standing still. */
const HEARTBEAT_STEPS = 25;
/**
 * Silence from the game this long means it is gone -- quit, crashed, or a browser tab put in the
 * background -- and the player leaves the lobby until it speaks again. Without this, a mod that
 * outlived its game (an installed game's mods used to) kept its player standing in everyone else's
 * game forever, repeating a position nobody was at.
 */
const GAME_SILENCE_MS = 10_000;
/** How often, and how far apart, to retry sending a player's picture to the game. */
const SHOW_ATTEMPTS = 5;
const SHOW_RETRY_MS = 3000;

/** One row of the panel's roster. */
interface PanelPlayer {
  id: string;
  name: string;
  you: boolean;
}

interface ChatLine {
  id: number;
  who: string;
  text: string;
  mine: boolean;
}

/** How the lobby is going, for the badge at the top of the panel. */
type Status = "offline" | "live" | "lost";

/**
 * The panel's state, handed to `install` rather than built by it.
 *
 * Declared before the game is inspected (see the default export) so the controls and the roster
 * exist even in a game this mod turns out not to support -- a panel that vanishes when something
 * goes wrong is one the player cannot use to find out what.
 */
interface OnlinePanel {
  chatKey: Ref<string>;
  shareSaves: Ref<boolean>;
  /** Whether this game has a save routine to share at all. The toggle is shown either way, so the
   *  answer is visible rather than the control simply missing. */
  sharing: Ref<boolean>;
  status: Ref<Status>;
  players: Ref<PanelPlayer[]>;
  history: Ref<ChatLine[]>;
  /** What the notices drawn over the game say, in the language the player is reading the host in. */
  t: () => Text;
  /** Told when that language changes, so the one string the game holds as text can be resent. */
  onLanguageChanged: (handler: () => void) => void;
  /** Told when the player rebinds the chat key. `install` owns the channel to the game. */
  onChatKeyChanged: (handler: () => void) => void;
  /** Told when the player moves the save-sharing toggle. */
  onShareSavesChanged: (handler: (on: boolean) => void) => void;
}

interface Remote {
  id: string;
  name: string;
  skin: string | null;
  state: State | null;
  slot: number | null;
  /** The slot's sprite holds this player's character and the game has been told about them. */
  shown: boolean;
}

/** A `#` is a line break to GameMaker and to the text renderer alike; nobody's name or message
 *  means that. */
const printable = (text: string): string => text.replaceAll(/[\p{Cc}#]/gu, " ");

/** A number as GML's `real()` reads it: never in exponent form, which JavaScript uses for tiny
 *  values and GameMaker 8 does not understand. */
const gmlNumber = (value: number): string => String(Math.round(value * 100) / 100);

const serverUrl = function (key: string): string {
  let base = import.meta.env.VITE_ONLINE_SERVER;
  try {
    base = localStorage.getItem("fruitPie.online.server") || base;
  } catch {
    // No storage here; the built-in address it is.
  }
  return `${base.replace(/\/$/u, "")}/lobby/${key}`;
};

const install = function (
  mod: Mod,
  key: string,
  player: PlayerModel,
  /** How the game saves and loads, for shared saves; null when detect could not tell. */
  saves: SaveModel | null,
  panel: OnlinePanel,
): void {
  /**
   * Names and chat, drawn by the app instead of by the game.
   *
   * `draw_text` draws with the *game's* font, which in a fangame holds the characters its author
   * needed and little else -- so a Japanese name or a Russian message came out blank, and in the
   * GameMaker 8 emulator silently blank rather than visibly broken. Everything a player typed or
   * called themselves goes through this instead.
   *
   * No font is shipped with the mod: a face that covered every script anyone might chat in would
   * weigh megabytes, so this asks for the player's own system font, which has the scripts their
   * machine can display.
   */
  const { drawText, createText, textWidth, textHeight } = initText(mod);
  /**
   * Over a ghost's head, centred on it.
   *
   * Larger than the 12 the game's own font would use, because these are pixels rather than a
   * bitmap face: the game draws at its own resolution and the player's window magnifies that whole
   * picture, so a letter only looks as good as the number of game pixels it was drawn into. Twelve
   * is enough for a face designed for twelve and not for one that is merely shrunk to it.
   */
  const NAME = { size: 16, align: "center", valign: "middle" } as const;
  /** In a speech bubble, which is centred too and wraps the way the bubble is measured. */
  const SAID = { size: 16, align: "center", wrap: 240 } as const;

  const sprites: Sprite[] = [];
  for (let slot = 0; slot < SLOTS; slot += 1) {
    // Bottom centre: the position a sender reports is where the feet go.
    sprites.push(mod.resource.sprite.create(`p${slot}`, { origin: { x: 16, y: 32 } }));
  }

  // -- GML ---------------------------------------------------------------------------------------

  mod.resource.script.create({
    name: "field",
    args: ["text", "n"],
    body: ({ a }) => `var ol_s, ol_n, ol_at;
ol_s = ${a.text};
ol_n = ${a.n};
while (ol_n > 1) {
  ol_at = string_pos(" ", ol_s);
  if (ol_at == 0) return "";
  ol_s = string_delete(ol_s, 1, ol_at);
  ol_n -= 1;
}
ol_at = string_pos(" ", ol_s);
if (ol_at > 0) ol_s = string_copy(ol_s, 1, ol_at - 1);
return ol_s;`,
  });

  /** Field n and everything after it: the free text at the end of a message. */
  mod.resource.script.create({
    name: "rest",
    args: ["text", "n"],
    body: ({ a }) => `var ol_s, ol_n, ol_at;
ol_s = ${a.text};
ol_n = ${a.n};
while (ol_n > 1) {
  ol_at = string_pos(" ", ol_s);
  if (ol_at == 0) return "";
  ol_s = string_delete(ol_s, 1, ol_at);
  ol_n -= 1;
}
return ol_s;`,
  });

  // The newest instance: a respawn that destroys the player and makes a new one leaves both alive
  // for the rest of the step, and `with` skips only the destroyed one.
  mod.resource.script.create({
    name: "me",
    body: () => `global.online_found = noone;
${player.objects
  .map(
    (object) => `with (${object}) {
  if (global.online_found == noone || id > global.online_found) global.online_found = id;
}`,
  )
  .join("\n")}
return global.online_found;`,
  });

  mod.resource.script.create({
    name: "label",
    args: ["x", "y", "text", "alpha"],
    // One picture, blitted five times: the four black offsets are an outline, so a white name
    // stays readable over whatever the game is drawing behind it. Nothing sets halign here any
    // more -- the centring is part of the picture.
    body: ({ a }) => `var ol_c, ol_a;
ol_c = draw_get_color();
ol_a = draw_get_alpha();
draw_set_alpha(${a.alpha});
draw_set_color(c_black);
${drawText(`${a.x} + 1`, a.y, a.text)}
${drawText(`${a.x} - 1`, a.y, a.text)}
${drawText(a.x, `${a.y} + 1`, a.text)}
${drawText(a.x, `${a.y} - 1`, a.text)}
draw_set_color(c_white);
${drawText(a.x, a.y, a.text)}
draw_set_color(ol_c);
draw_set_alpha(ol_a);`,
  });

  /** A speech bubble whose bottom edge is centred on (x, y). */
  mod.resource.script.create({
    name: "bubble",
    args: ["x", "y", "text", "alpha"],
    body: ({ a }) => `var ol_c, ol_a, ol_w, ol_h, ol_l, ol_t;
ol_w = ${textWidth(a.text)};
// The box is the picture's size, so there is no box until there is a picture -- a tenth of a
// second after a line is said, and never at all for one that could not be drawn.
if (ol_w <= 0) exit;
ol_h = ${textHeight(a.text)};
ol_c = draw_get_color();
ol_a = draw_get_alpha();
ol_w += 10;
ol_h += 6;
ol_l = ${a.x} - ol_w / 2;
ol_t = ${a.y} - ol_h;
draw_set_alpha(${a.alpha});
draw_set_color(c_white);
draw_rectangle(ol_l, ol_t, ol_l + ol_w, ol_t + ol_h, false);
draw_set_color(c_black);
draw_rectangle(ol_l, ol_t, ol_l + ol_w, ol_t + ol_h, true);
${drawText(a.x, "ol_t + 3", a.text)}
draw_set_color(ol_c);
draw_set_alpha(ol_a);`,
  });

  const flippedObject =
    player.flippedObjects.length === 0
      ? "0"
      : player.flippedObjects.map((object) => `object_index == ${object}`).join(" || ");

  const poseSwitch = (pose: string, out: { first: string; count: string; speed: string }) =>
    POSES.map(
      (one, index) =>
        `${index === 0 ? "" : "else "}if (${pose} == ${index}) { ${out.first} = ${one.first}; ${out.count} = ${one.count}; ${out.speed} = ${one.speed}; }`,
    ).join("\n");

  mod.resource.object.create({
    name: "online",
    persistent: true,
    // In front of everything, so a name or a speech bubble is never hidden behind the scenery. The
    // ghosts themselves are faded, and fade further as they come close to the player.
    depth: -100000,
    vars: [
      // Per slot.
      "on",
      "seen",
      "room",
      "tx",
      "ty",
      "dx",
      "dy",
      "fx",
      "fy",
      "ang",
      "pose",
      "name",
      "chat",
      "chatT",
      "spr",
      // This player.
      "who",
      "last",
      "tick",
      "myChat",
      "myChatT",
      "note",
      "noteT",
      /** The chat key, as a virtual-key code. A variable because the player can rebind it, and this
       *  GML is written before they have said which key they want. */
      "chatKey",
      /** The prompt of the chat box. Text rather than a picture, because GameMaker's own input box
       *  draws it; English until the app says otherwise, since that much is ASCII whatever the
       *  game's encoding is. */
      "prompt",
      /** Frames left before the chat key is listened to again. See the step event. */
      "chatCool",
      "i",
      "txt",
      "s",
      "w",
      "h",
      "xo",
      "yo",
      "xs",
      "ys",
      "flipObj",
      "sfx",
      "sfy",
      "sax",
      "say",
      "nm",
      "first",
      "count",
      "speed",
      "alpha",
      "ly",
      "l",
      "t",
    ],
    events: {
      create: ({ v, send }) => `
        for (${v.i} = 0; ${v.i} < ${SLOTS}; ${v.i} += 1) {
          ${v.on}[${v.i}] = 0;
          ${v.seen}[${v.i}] = 0;
          ${v.room}[${v.i}] = -1;
          ${v.tx}[${v.i}] = 0;
          ${v.ty}[${v.i}] = 0;
          ${v.dx}[${v.i}] = 0;
          ${v.dy}[${v.i}] = 0;
          ${v.fx}[${v.i}] = 1;
          ${v.fy}[${v.i}] = 1;
          ${v.ang}[${v.i}] = 0;
          ${v.pose}[${v.i}] = 0;
          ${v.name}[${v.i}] = "";
          ${v.chat}[${v.i}] = "";
          ${v.chatT}[${v.i}] = 0;
          ${v.spr}[${v.i}] = -1;
        }
        ${v.who} = noone;
        ${v.last} = "";
        ${v.tick} = 0;
        ${v.myChat} = "";
        ${v.prompt} = "Say something:";
        ${v.myChatT} = 0;
        ${v.note} = "";
        ${v.noteT} = 0;
        ${v.chatKey} = ${gameMakerKey("Space")};
        ${v.chatCool} = 0;
        ${send("ready")}
      `,
      step: ({ v, call, send }) => `
        ${v.who} = ${call("me")};

        for (${v.i} = 0; ${v.i} < ${SLOTS}; ${v.i} += 1) {
          if (${v.seen}[${v.i}]) {
            if (abs(${v.tx}[${v.i}] - ${v.dx}[${v.i}]) > ${SNAP} || abs(${v.ty}[${v.i}] - ${v.dy}[${v.i}]) > ${SNAP}) {
              ${v.dx}[${v.i}] = ${v.tx}[${v.i}];
              ${v.dy}[${v.i}] = ${v.ty}[${v.i}];
            } else {
              ${v.dx}[${v.i}] += (${v.tx}[${v.i}] - ${v.dx}[${v.i}]) * 0.5;
              ${v.dy}[${v.i}] += (${v.ty}[${v.i}] - ${v.dy}[${v.i}]) * 0.5;
            }
          }
          if (${v.chatT}[${v.i}] > 0) ${v.chatT}[${v.i}] -= 1;
        }
        if (${v.myChatT} > 0) ${v.myChatT} -= 1;
        if (${v.noteT} > 0) ${v.noteT} -= 1;

        // Space by default, as in I Wanna Play Online, which is what its players will reach for.
        // Read from a variable rather than baked in, because the panel can rebind it: 0 is unbound.
        //
        // The cooldown is not politeness, it is correctness. get_string suspends the game mid-step,
        // and a key still held when the frame resumes reads as pressed again -- so one ordinary
        // press of a key held for a fifth of a second opened the prompt five or six times and sent
        // the same line as many. io_clear below is not enough on its own, and a burst that used to
        // be invisible now fills the panel's chat history.
        if (${v.chatCool} > 0) ${v.chatCool} -= 1;
        if (${v.who} != noone && ${v.chatKey} > 0 && ${v.chatCool} == 0
            && keyboard_check_pressed(${v.chatKey})) {
          ${v.chatCool} = 15;
          ${v.txt} = get_string(${v.prompt}, "");
          io_clear();
          // Only sent: the bubble over this player's own head is the app's answer to it, so what
          // they see is the same picture everyone else gets, in whatever script they typed.
          if (${v.txt} != "") ${send("chat", v.txt)}
        }
      `,
      // End Step: after this frame's movement, so the position sent is the one about to be drawn.
      endStep: ({ v, call, send }) => `
        ${v.who} = ${call("me")};
        ${v.tick} += 1;
        if (${v.who} == noone) {
          // Repeated now and then even when nothing changed: the JavaScript side takes silence to
          // mean the game is gone (see GAME_SILENCE_MS).
          if (${v.last} != "-" || ${v.tick} mod ${HEARTBEAT_STEPS} == 0) {
            ${v.last} = "-";
            ${send("me")}
          }
        } else {
          with (${v.who}) {
            other.${v.xs} = ${player.xscale};
            other.${v.ys} = ${player.yscale};
            other.${v.flipObj} = (${flippedObject});
          }
          ${v.s} = ${v.who}.sprite_index;
          if (sprite_exists(${v.s})) {
            ${v.w} = sprite_get_width(${v.s});
            ${v.h} = sprite_get_height(${v.s});
            ${v.xo} = sprite_get_xoffset(${v.s});
            ${v.yo} = sprite_get_yoffset(${v.s});
            ${v.nm} = sprite_get_name(${v.s});
          } else {
            ${v.w} = 32;
            ${v.h} = 32;
            ${v.xo} = 16;
            ${v.yo} = 32;
            ${v.nm} = "";
          }
          ${v.sfx} = 1;
          if (${v.xs} < 0) ${v.sfx} = -1;
          if (${v.flipObj} && ${v.ys} > 0) {
            // Drawn upside down by its own sprites: the feet are the top of the box.
            ${v.sfy} = -1;
            ${v.say} = ${v.who}.y - ${v.yo} * ${v.ys};
          } else {
            ${v.sfy} = 1;
            if (${v.ys} < 0) ${v.sfy} = -1;
            ${v.say} = ${v.who}.y + (${v.h} - ${v.yo}) * ${v.ys};
          }
          ${v.sax} = ${v.who}.x + (${v.w} / 2 - ${v.xo}) * ${v.xs};
          ${v.txt} = string(room) + " " + string(${v.sax}) + " " + string(${v.say})
            + " " + string(${v.sfx}) + " " + string(${v.sfy}) + " " + string(${v.who}.image_angle)
            + " " + string(${v.who}.hspeed) + " " + string(${v.who}.vspeed) + " " + ${v.nm};
          if (${v.txt} != ${v.last} || ${v.tick} mod ${HEARTBEAT_STEPS} == 0) {
            ${v.last} = ${v.txt};
            ${send("me", v.txt)}
          }
        }
      `,
      draw: ({ v, call }) => `
        ${sprites.map((sprite, slot) => `${v.spr}[${slot}] = ${sprite.id};`).join("\n        ")}
        ${v.who} = ${call("me")};
        for (${v.i} = 0; ${v.i} < ${SLOTS}; ${v.i} += 1) {
          if (${v.on}[${v.i}] && ${v.seen}[${v.i}] && ${v.room}[${v.i}] == room && ${v.spr}[${v.i}] >= 0) {
            ${poseSwitch(`${v.pose}[${v.i}]`, { first: v.first, count: v.count, speed: v.speed })}
            ${v.alpha} = 0.85;
            if (${v.who} != noone) {
              // Fade out as they come close, so a ghost never hides the game's own player.
              ${v.alpha} = max(0.2, min(0.85, point_distance(${v.dx}[${v.i}], ${v.dy}[${v.i}], ${v.who}.x, ${v.who}.y) / 100));
            }
            draw_sprite_ext(
              ${v.spr}[${v.i}],
              ${v.first} + floor(current_time / 20 * ${v.speed}) mod ${v.count},
              ${v.dx}[${v.i}], ${v.dy}[${v.i}],
              ${v.fx}[${v.i}], ${v.fy}[${v.i}], ${v.ang}[${v.i}],
              c_white, ${v.alpha}
            );
            ${v.ly} = ${v.dy}[${v.i}] - 42 * ${v.fy}[${v.i}];
            ${call("label", `${v.dx}[${v.i}]`, v.ly, `${v.name}[${v.i}]`, `max(0.5, ${v.alpha})`)};
            if (${v.chatT}[${v.i}] > 0) {
              ${call("bubble", `${v.dx}[${v.i}]`, `${v.ly} - 10`, `${v.chat}[${v.i}]`, `min(1, ${v.chatT}[${v.i}] / 25)`)};
            }
          }
        }
        if (${v.myChatT} > 0 && ${v.who} != noone) {
          ${call("bubble", `${v.who}.x`, `${v.who}.bbox_top - 12`, v.myChat, `min(1, ${v.myChatT} / 25)`)};
        }
        if (${v.noteT} > 0) {
          if (view_enabled) {
            ${v.l} = view_xview[0] + view_wview[0] / 2;
            ${v.t} = view_yview[0] + 16;
          } else {
            ${v.l} = room_width / 2;
            ${v.t} = 16;
          }
          ${call("label", v.l, v.t, v.note, `min(1, ${v.noteT} / 25)`)};
        }
      `,
    },
    receive: {
      // "<slot> <name>": the slot's sprite now holds this player.
      peer: ({ v, payload, call }) => `
        ${v.i} = real(${call("field", payload, "1")});
        ${v.name}[${v.i}] = ${call("rest", payload, "2")};
        ${v.on}[${v.i}] = 1;
        ${v.seen}[${v.i}] = 0;
        ${v.chatT}[${v.i}] = 0;
      `,
      drop: ({ v, payload }) => `
        ${v.i} = real(${payload});
        ${v.on}[${v.i}] = 0;
        ${v.seen}[${v.i}] = 0;
        ${v.chatT}[${v.i}] = 0;
      `,
      // "<slot> <room> <x> <y> <facing> <flipped> <angle> <pose>", or "<slot>" for nowhere.
      st: ({ v, payload, call }) => `
        ${v.i} = real(${call("field", payload, "1")});
        if (${call("field", payload, "2")} == "") {
          ${v.seen}[${v.i}] = 0;
        } else {
          ${v.room}[${v.i}] = real(${call("field", payload, "2")});
          ${v.tx}[${v.i}] = real(${call("field", payload, "3")});
          ${v.ty}[${v.i}] = real(${call("field", payload, "4")});
          ${v.fx}[${v.i}] = real(${call("field", payload, "5")});
          ${v.fy}[${v.i}] = real(${call("field", payload, "6")});
          ${v.ang}[${v.i}] = real(${call("field", payload, "7")});
          ${v.pose}[${v.i}] = real(${call("field", payload, "8")});
          if (!${v.seen}[${v.i}]) {
            ${v.dx}[${v.i}] = ${v.tx}[${v.i}];
            ${v.dy}[${v.i}] = ${v.ty}[${v.i}];
          }
          ${v.seen}[${v.i}] = 1;
        }
      `,
      say: ({ v, payload, call }) => `
        ${v.i} = real(${call("field", payload, "1")});
        ${v.chat}[${v.i}] = ${call("rest", payload, "2")};
        ${v.chatT}[${v.i}] = ${CHAT_STEPS};
      `,
      note: ({ v, payload }) => `
        ${v.note} = ${payload};
        ${v.noteT} = ${NOTE_STEPS};
      `,
      // What this player just said, drawn over their own head.
      mine: ({ v, payload }) => `
        ${v.myChat} = ${payload};
        ${v.myChatT} = ${CHAT_STEPS};
      `,
      // The player rebound the chat key. Applies on the very next frame; nothing is rebuilt.
      chatKey: ({ v, payload }) => `${v.chatKey} = real(${payload});`,
      // Echoed back so the app can see what the game made of it: see `pushPrompt`.
      prompt: ({ v, payload, send }) => `${v.prompt} = ${payload};
        ${send("prompt", v.prompt)}`,
    },
  });

  const shared: SharedSaves | null = saves
    ? installSharedSaves(mod, saves, panel.shareSaves.value)
    : null;
  panel.sharing.value = shared !== null;
  panel.onShareSavesChanged((on) => shared?.setEnabled(on));

  // -- JavaScript --------------------------------------------------------------------------------

  const remotes = new Map<string, Remote>();
  const slots: (string | null)[] = Array.from({ length: SLOTS }, () => null);
  /** Which character each slot's sprite holds right now, by its sheet ("" for the Kid). */
  const loaded: (string | null)[] = Array.from({ length: SLOTS }, () => null);
  let defaultFrames: Promise<Uint8Array[]> | null = null;
  let connection: Connection | null = null;
  let lastSaved = 0;
  /** Whose save the pending shared save is, for the notice when it is used. */
  let sharer = "";
  let announcedLoss = false;

  const note = (text: string) => mod.send("note", createText(printable(text), NAME));
  const t = () => panel.t();

  const me = () => identity.account?.name ?? guest;

  /** Rebuilt whole rather than patched, because it is at most SLOTS + 1 rows and the alternative is
   *  keeping two representations of the same list in step. Called only when something actually
   *  changed -- never on the state messages that arrive many times a second. */
  const refreshPlayers = () => {
    panel.players.value = [
      { id: "you", name: me(), you: true },
      ...[...remotes.values()].map((remote) => ({
        id: remote.id,
        name: remote.name,
        you: false,
      })),
    ];
  };

  let nextLine = 1;
  const remember = (who: string, text: string, mine: boolean) => {
    const lines = [...panel.history.value, { id: nextLine, who, text, mine }];
    nextLine += 1;
    panel.history.value =
      lines.length > CHAT_HISTORY ? lines.slice(lines.length - CHAT_HISTORY) : lines;
  };

  const kid = () => {
    defaultFrames ??= sliceSheet(fromBase64(defaultSheet.slice(defaultSheet.indexOf(",") + 1)));
    return defaultFrames;
  };

  const sendState = (remote: Remote) => {
    if (remote.slot === null || !remote.shown) return;
    const s = remote.state;
    mod.send("st", s === null ? `${remote.slot}` : `${remote.slot} ${s.map(gmlNumber).join(" ")}`);
  };

  const show = async (remote: Remote) => {
    const slot = remote.slot;
    if (slot === null) return;
    const wanted = remote.skin ?? "";
    if (loaded[slot] !== wanted) {
      let frames: Uint8Array[];
      try {
        frames = remote.skin ? await sliceSheet(fromBase64(remote.skin)) : await kid();
      } catch (error) {
        console.warn(`[online] ${remote.name}'s character is unreadable, showing the Kid:`, error);
        frames = await kid();
      }
      // Marked stale first: if the load fails half way, the slot must not claim to hold anything.
      loaded[slot] = null;
      await sprites[slot]!.load(frames);
      loaded[slot] = wanted;
    }
    // They may have left, or changed character again, while the picture was on its way.
    if (remote.slot !== slot || slots[slot] !== remote.id || loaded[slot] !== (remote.skin ?? "")) {
      return;
    }
    remote.shown = true;
    mod.send("peer", `${slot} ${createText(printable(remote.name), NAME)}`);
    sendState(remote);
  };

  /**
   * `show`, tried again while the player is still here. A picture sent while the game is still
   * booting times out -- a Studio game in the emulator can spend twenty seconds unpacking its assets
   * after it already said it was listening -- and giving up there would leave that player invisible
   * for the whole session.
   */
  const showRetrying = async (remote: Remote) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await show(remote);
        return;
      } catch (error) {
        if (remotes.get(remote.id) !== remote || attempt >= SHOW_ATTEMPTS) {
          console.warn(`[online] could not show ${remote.name}:`, error);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, SHOW_RETRY_MS));
      }
    }
  };

  const place = (remote: Remote) => {
    const slot = slots.indexOf(null);
    if (slot < 0) return;
    slots[slot] = remote.id;
    remote.slot = slot;
    remote.shown = false;
    void showRetrying(remote);
  };

  const remove = (remote: Remote) => {
    remotes.delete(remote.id);
    refreshPlayers();
    if (remote.slot === null) return;
    mod.send("drop", `${remote.slot}`);
    slots[remote.slot] = null;
    remote.slot = null;
    // Someone who arrived while every slot was taken gets the one just freed.
    const waiting = [...remotes.values()].find((other) => other.slot === null);
    if (waiting) place(waiting);
  };

  const add = (peer: Omit<Peer, "state"> & { state?: State | null }) => {
    const remote: Remote = {
      id: peer.id,
      name: peer.name,
      skin: peer.skin,
      state: peer.state ?? null,
      slot: null,
      shown: false,
    };
    remotes.set(remote.id, remote);
    refreshPlayers();
    place(remote);
  };

  const clear = () => {
    for (const remote of [...remotes.values()]) remove(remote);
    refreshPlayers();
  };

  const onMessage = (message: ServerMessage) => {
    switch (message.t) {
      case "welcome": {
        clear();
        for (const peer of message.peers) add(peer);
        const others = message.peers.length;
        note(others === 0 ? t().game.alone : t().game.others(others));
        return;
      }
      case "join":
        add(message);
        note(t().game.joined(message.name));
        return;
      case "leave": {
        const remote = remotes.get(message.id);
        if (!remote) return;
        remove(remote);
        note(t().game.left(remote.name));
        return;
      }
      case "state": {
        const remote = remotes.get(message.id);
        if (!remote) return;
        remote.state = message.s;
        sendState(remote);
        return;
      }
      case "skin": {
        const remote = remotes.get(message.id);
        if (!remote) return;
        remote.skin = message.skin;
        void showRetrying(remote);
        return;
      }
      case "chat": {
        const remote = remotes.get(message.id);
        if (!remote) return;
        // Remembered before the visibility check below: somebody still waiting for a slot, or in
        // another room, is someone whose message the panel should still show.
        remember(remote.name, message.text, false);
        if (remote.slot === null || !remote.shown) return;
        mod.send("say", `${remote.slot} ${createText(printable(message.text), SAID)}`);
        return;
      }
      case "saved": {
        const remote = remotes.get(message.id);
        if (!remote) return;
        if (shared?.enabled()) {
          sharer = remote.name;
          shared.arm(message);
          console.log(`[online] ${remote.name} saved; your next reload takes you there`);
          note(t().game.saved(remote.name));
        } else {
          console.log(
            `[online] ${remote.name} saved; not following it ` +
              `(${shared ? "save sharing is off" : "this game has no shared saves"})`,
          );
          note(t().game.saved(remote.name));
        }
        return;
      }
      case "error":
        console.warn(`[online] the relay refused this connection: ${message.reason}`);
        if (message.reason === "version") note(t().game.outdated);
        else if (message.reason === "full") note(t().game.full);
        return;
    }
  };

  // -- Wiring ------------------------------------------------------------------------------------

  let guest = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
  let identity = mod.getPlayer();
  const hello = () => ({
    t: "hello" as const,
    v: VERSION,
    name: identity.account?.name ?? guest,
    skin: identity.skin ? toBase64(identity.skin.sheet) : null,
  });

  // Connected on the game's first step rather than at start: a Studio game in the emulator can be
  // unpacking its assets for a while after it says it is listening, and a player with no game yet is
  // nobody the others need to see. Every step reports in (`me`), at least every HEARTBEAT_STEPS.
  let lastContact = 0;
  let connecting = false;
  let quiet = false;
  const heard = () => {
    lastContact = Date.now();
    if (quiet) {
      quiet = false;
      console.log("[online] the game is back; rejoining the lobby");
    }
    if (connection) connection.resume();
    else if (!connecting) join();
  };
  setInterval(() => {
    if (quiet || !connection || Date.now() - lastContact <= GAME_SILENCE_MS) return;
    quiet = true;
    console.log("[online] the game has gone quiet; leaving the lobby until it is back");
    connection.pause();
  }, 2000);

  const join = () => {
    connecting = true;
    connection = connect({
      // Per connection: a player who joins or leaves a room mid-game moves lobby on reconnect.
      url: () => {
        const room = identity.room;
        const url = serverUrl(room ? roomLobbyKey(key, room.id) : key);
        console.log(`[online] joining ${room ? "your room's lobby" : "the public lobby"}: ${url}`);
        return url;
      },
      hello,
      onMessage,
      onOpen: () => {
        panel.status.value = "live";
        if (announcedLoss) note(t().game.reconnected);
        announcedLoss = false;
      },
      onClose: (retrying) => {
        panel.status.value = retrying ? "lost" : "offline";
        clear();
        if (retrying && !announcedLoss) note(t().game.lost);
        announcedLoss = retrying;
      },
    });
  };

  mod.onPlayerChange((next) => {
    const renamed = next.account?.name !== identity.account?.name;
    const moved = next.room?.id !== identity.room?.id;
    const reskinned = next.skin?.id !== identity.skin?.id;
    identity = next;
    if (!connection) return;
    if (renamed) guest = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    if (renamed) refreshPlayers();
    if (renamed || moved) {
      connection.reconnect();
    } else if (reskinned) {
      connection.send({ t: "skin", skin: next.skin ? toBase64(next.skin.sheet) : null });
    }
  });

  // The game (re)started: a `game_restart()` wiped this mod's object along with everything else, so
  // it is told again about everyone it was showing. Sprites come back on their own (the SDK keeps
  // them), so only the bookkeeping is resent.
  // Not `heard()`: a Studio game in the emulator sends this from Create and can then spend twenty
  // seconds loading before its first step, which the watchdog would take for a game that is gone.
  mod.on("ready", () => {
    pushChatKey();
    pushPrompt();
    for (const remote of remotes.values()) {
      if (remote.slot === null || !remote.shown) continue;
      mod.send("peer", `${remote.slot} ${createText(printable(remote.name), NAME)}`);
      sendState(remote);
    }
  });

  mod.on("me", (payload) => {
    heard();
    if (!connection) return;
    if (payload === "") {
      connection.setState(null);
      return;
    }
    const parts = payload.split(" ");
    const [room, x, y, facing, flipped, angle, hspeed, vspeed] = parts.slice(0, 8).map(Number);
    const sprite = parts.slice(8).join(" ");
    const numbers = [room, x, y, facing, flipped, angle, hspeed, vspeed];
    if (numbers.some((value) => value === undefined || !Number.isFinite(value))) return;
    connection.setState([
      room!,
      x!,
      y!,
      facing!,
      flipped!,
      angle!,
      poseOf(sprite, hspeed!, vspeed!, flipped!),
    ]);
  });

  mod.on("chat", (text) => {
    remember(me(), text, true);
    mod.send("mine", createText(printable(text), SAID));
    connection?.send({ t: "chat", text });
  });

  /** The key the panel holds, told to the game. The GML only ever has a default baked in. */
  const pushChatKey = () => mod.send("chatKey", String(gameMakerKey(panel.chatKey.value)));
  panel.onChatKeyChanged(pushChatKey);

  /**
   * The chat prompt, in the player's language -- the one string here the game holds as text.
   *
   * It has to: GameMaker draws its own input box, so no picture can stand in for it, and a message
   * is encoded in the game's own encoding. That is the best available, and on a GameMaker 8.0 game
   * built in some other alphabet it is not enough -- the prompt would arrive as mojibake, which
   * looks broken in a way plain English does not.
   *
   * So the game echoes back what it ended up holding, and a round trip that changed the string is
   * this game saying it cannot hold it. English is ASCII, so the fallback always survives and the
   * exchange settles after at most one correction.
   */
  const english = text("en").game.say;
  let wanted = english;
  const pushPrompt = () => {
    wanted = t().game.say;
    mod.send("prompt", wanted);
  };
  mod.on("prompt", (echo) => {
    if (echo === wanted || wanted === english) return;
    console.log(`[online] this game cannot hold ${JSON.stringify(wanted)}; asking in English`);
    wanted = english;
    mod.send("prompt", english);
  });
  panel.onLanguageChanged(pushPrompt);

  shared?.onSave((save) => {
    const now = Date.now();
    if (now - lastSaved < SAVE_DEBOUNCE_MS) return;
    lastSaved = now;
    console.log(`[online] you saved; sharing it (room ${save.room}, ${save.x},${save.y})`);
    connection?.send({ t: "saved", ...save });
  });

  shared?.onUsed(() => {
    console.log(`[online] sent to ${sharer}'s save`);
  });
};

/**
 * How loudly the badge at the top says each status. The words are in `i18n.ts`: they are the only
 * part that changes with the player's language, and how loud a status is does not.
 */
const STATUS_TONE: Record<Status, UiTone> = {
  offline: "muted",
  live: "ok",
  lost: "warning",
};

export default createMod((mod) => {
  // Read before the panel is declared, so every control is right the first time it is drawn.
  //
  // The panel exists either way -- the chat key stays rebindable, and the panel is there to say why
  // nothing is happening, in a game this mod cannot work in. What is worked out here is only what
  // those controls should *say*, and doing it first means the tree is correct rather than corrected
  // by a patch a moment later. That difference used to be invisible and then was not: a patch a mod
  // emits while its panel window is still opening is delivered now (see the desktop's
  // `patchPanels`), but a panel that never needed the correction cannot be caught by the next bug
  // of that shape either.
  const key = lobbyKey(mod.content);
  const model = findSaveModel(mod.content);
  const player = key === null ? null : findPlayer(mod.content, model.ok ? model.value.players : []);

  const chatKey = mod.ui.state("Space", { persist: "chatKey" });
  const shareSaves = mod.ui.state(true, { persist: "shareSaves" });
  const sharing = mod.ui.state(key !== null && player !== null && model.ok);
  const status = mod.ui.state<Status>("offline");
  const players = mod.ui.state<PanelPlayer[]>([]);
  const history = mod.ui.state<ChatLine[]>([]);
  const supported = mod.ui.state(key !== null && player !== null);

  // `install` owns the channel to the game, so it hands back the one thing this side needs: a way
  // to say the key moved. Null until then, which is also the unsupported case -- there is nothing
  // listening, and a rebind is simply remembered for the next game that is.
  let onLanguage: () => void = () => {};
  let onChatKey: () => void = () => {};
  let onShareSaves: (on: boolean) => void = () => {};

  // Which language to read the panel in. A state because the player can change it in the host while
  // the game runs: `getPlayer()` is pinned while this function runs -- which is what keeps the GML
  // this mod bakes and the JavaScript behind it in agreement -- so the live value arrives through
  // `onPlayerChange` below, and the panel follows because its labels are bound to functions.
  const language = mod.ui.state(mod.getPlayer().language);
  const t = (): Text => text(language.value);

  const current = () => ({ label: t().status[status.value], tone: STATUS_TONE[status.value] });

  // The title is this mod's name, which is why it is the one string here left in English: the
  // catalog lists it that way whatever the page is in, and `panel` takes a plain string, so it could
  // not follow a language change in any case.
  mod.ui.panel({ title: "Online" }, (ui) => [
    ui.section({}, [
      ui.dynamic(() =>
        supported.value
          ? [ui.badge(current().label, { tone: current().tone })]
          : [ui.badge(t().unsupported, { tone: "danger" })],
      ),
    ]),

    ui.section({ title: () => t().players(players.value.length) }, [
      ui.each(
        players,
        (player) =>
          ui.text(player.you ? t().you(player.name) : player.name, { strong: player.you }),
        { key: (player) => player.id },
      ),
    ]),

    ui.section({ title: () => t().history }, [
      // One box, the same height all session -- empty when nobody has said anything, rather than a
      // line of placeholder text that is itself a different height. The controls below it stay put.
      ui.scroll(
        [
          ui.each(
            history,
            (line) =>
              ui.row([
                ui.text(`${line.who}:`, { strong: true, tone: line.mine ? "ok" : "normal" }),
                ui.text(line.text),
              ]),
            { key: (line) => line.id },
          ),
        ],
        { height: CHAT_HEIGHT, stickToBottom: true },
      ),
    ]),

    ui.section({ title: () => t().controls }, [
      ui.keybind({
        label: () => t().chat,
        value: chatKey,
        onChange: () => onChatKey(),
      }),
    ]),

    ui.section({ title: () => t().saves }, [
      ui.toggle({
        label: () => t().shareSaves,
        value: shareSaves,
        disabled: () => !sharing.value,
        onChange: (on) => onShareSaves(on),
      }),
      ui.dynamic(() => (sharing.value ? [] : [ui.text(t().noSharedSaves, { tone: "muted" })])),
    ]),
  ]);

  // Both the panel and the notices drawn over the game read this. The notices can say whatever the
  // language needs because they reach the game as pictures rather than as text (see `@sculptr/text`
  // in `install`), which is what the game's own font could never do.
  mod.onPlayerChange((player) => {
    language.value = player.language;
    onLanguage();
  });

  if (!key) {
    console.warn("[online] could not read this game's contents, so it cannot be matched to a lobby");
    return;
  }
  if (!player) {
    console.warn("[online] no player object found in this game, staying offline");
    return;
  }
  if (!model.ok) console.log(`[online] no shared saves in this game: ${model.error}`);

  console.log(
    `[online] player ${player.objects.join(", ")}, drawn at ${player.xscale} x ${player.yscale}`,
  );
  install(mod, key, player, model.ok ? model.value : null, {
    chatKey,
    status,
    players,
    history,
    t,
    onLanguageChanged: (handler) => (onLanguage = handler),
    onChatKeyChanged: (handler) => (onChatKey = handler),
    onShareSavesChanged: (handler) => (onShareSaves = handler),
    shareSaves,
    sharing,
  });
});
