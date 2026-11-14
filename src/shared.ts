/**
 * Shared saves, as I Wanna Play Online had them: when somebody saves, everyone else is sent to
 * that save on their next reload -- once. Saving there keeps it; not saving means the reload after
 * that puts them back on their own save, because nothing of theirs was ever overwritten.
 *
 * ## What counts as a save
 *
 * Only the game's own: the statements `@sculptr/detect` finds storing the player's position in
 * its save routine. A save the player made in their first moments in a room is not shared -- that
 * is a game saving on its own, starting a new file or entering an area, and passing it on would
 * send everyone back to the beginning of the game whenever anybody starts one.
 *
 * ## What is carried
 *
 * The room, the position, and gravity -- the globals among those the save round-trips (detect's
 * `carried`) whose name says gravity. Nothing else: a shared save must not hand anybody another
 * player's difficulty, clear flags or items.
 *
 * ## When it happens
 *
 * The way the Quicksave mod finds a respawn, for the same reason: a game can put its player back
 * without calling the routine that loads its save. So both are watched -- a hook on that routine,
 * and the player arriving discontinuously on their own last save (the "anchor"). Either applies
 * the shared save, and it is used up once the player has been playing from it for half a second
 * (`CONFIRM_STEPS`), since some games reload twice in a row with a restart in between.
 *
 * A save of the player's own cancels a pending one: they have made progress of their own since,
 * and being pulled back to somebody else's save behind it would be the opposite of help.
 *
 * ## Opting out
 *
 * Personal, and a setting of this mod's own -- a toggle in its panel, remembered per account. It
 * used to be a column on the host's account, which meant the host's database knew what one mod
 * meant by "share saves"; a mod that needs a setting now brings its own. A player who turns it off
 * neither sends their saves nor is moved by anyone else's, and turning it off mid-game drops a
 * shared save that was waiting.
 *
 * ## Surviving a restart
 *
 * Some games `game_restart()` on every death, which wipes every global. The pending save and the
 * anchor are written to a scratch file and read back in Create, before any of the game's own code
 * runs -- the restart is exactly the moment the shared save is needed.
 */

import type { Mod } from "@sculptr/sdk";
import type { SaveModel } from "@sculptr/detect";

const ANCHOR_TOLERANCE = 8;
/** A move this big in one step is the game placing the player, not the player walking. */
const RESPAWN_JUMP = 64;
/** Steps after a respawn to keep checking the room: a room change the game asked for this frame
 *  has not landed yet, and must not win over ours. */
const SETTLE_FRAMES = 3;
/**
 * Steps the player must have been playing after a shared save was applied before it counts as used.
 * Some games load and then restart straight away -- I Wanna See The Moon's R runs its load routine,
 * then `game_restart()`, then the load routine again -- so being applied once proves nothing: until
 * the player has been playing from there for a moment, every reload applies it again.
 */
const CONFIRM_STEPS = 25;
/** Steps a player must have been in a room before their save is shared. See the file comment. */
const SETTLED_IN_ROOM = 25;

const GRAVITY = /grav/iu;

const G = {
  /** The player shares saves: their account setting, handed down by the JavaScript side. */
  enabled: "global.online_sh_enabled",
  /** 0 nothing pending, 1 a shared save is waiting, 2 applied but not yet used up (see CONFIRM_STEPS). */
  state: "global.online_sh_state",
  room: "global.online_sh_room",
  x: "global.online_sh_x",
  y: "global.online_sh_y",
  gravity: (index: number) => `global.online_sh_g${index}`,
  hasAnchor: "global.online_sh_has_anchor",
  /** -1 while the anchor's room is not known: a load has queued a room change that has not landed. */
  anchorRoom: "global.online_sh_anchor_room",
  anchorX: "global.online_sh_anchor_x",
  anchorY: "global.online_sh_anchor_y",
  applying: "global.online_sh_applying",
  roomSteps: "global.online_sh_room_steps",
};

export interface SharedSave {
  room: number;
  x: number;
  y: number;
  g: number[];
}

export interface SharedSaves {
  /** Whether the player shares saves right now. */
  enabled(): boolean;
  /** The player moved the toggle in the panel. */
  setEnabled(on: boolean): void;
  /** Somebody else saved: send the player there on their next reload. */
  arm(save: SharedSave): void;
  /** The player saved, and it should be shared. */
  onSave(handler: (save: SharedSave) => void): void;
  /** The player was just sent to a shared save. */
  onUsed(handler: () => void): void;
}

export const installSharedSaves = function (
  mod: Mod,
  model: SaveModel,
  /** What the panel's toggle says right now, which is where this setting lives. */
  initial: boolean,
): SharedSaves {
  const gravity = model.carried.filter((name) => GRAVITY.test(name));
  const file = mod.scratchPath("shared.txt");
  const saveHandlers: ((save: SharedSave) => void)[] = [];
  const usedHandlers: (() => void)[] = [];
  let enabled = initial;

  const reals = [
    G.enabled,
    G.state,
    G.room,
    G.x,
    G.y,
    ...gravity.map((_, index) => G.gravity(index)),
    G.hasAnchor,
    G.anchorRoom,
    G.anchorX,
    G.anchorY,
  ];

  mod.resource.script.create({
    name: "shPersist",
    body: () => `var sh_file;
sh_file = file_text_open_write(${file});
${reals.map((name) => `file_text_write_real(sh_file, ${name}); file_text_writeln(sh_file);`).join("\n")}
file_text_close(sh_file);`,
  });

  mod.resource.script.create({
    name: "shReset",
    body: () => `${[...reals, G.applying, G.roomSteps].map((name) => `${name} = 0;`).join("\n")}
${G.anchorRoom} = -1;`,
  });

  mod.resource.script.create({
    name: "shRestore",
    body: ({ call }) => `var sh_file;
${call("shReset")};
if (!file_exists(${file})) exit;
sh_file = file_text_open_read(${file});
${reals.map((name) => `${name} = file_text_read_real(sh_file); file_text_readln(sh_file);`).join("\n")}
file_text_close(sh_file);`,
  });

  /** Is this player standing on their own last save? `checkRoom` is off inside a load, whose room
   *  change has been asked for but has not happened. */
  mod.resource.script.create({
    name: "shAtAnchor",
    args: ["who", "checkRoom"],
    body: ({ a }) => `if (!${G.hasAnchor}) return 0;
if (${a.checkRoom} && ${G.anchorRoom} >= 0 && ${G.anchorRoom} != room) return 0;
if (abs(${a.who}.x - ${G.anchorX}) > ${ANCHOR_TOLERANCE}) return 0;
if (abs(${a.who}.y - ${G.anchorY}) > ${ANCHOR_TOLERANCE}) return 0;
return 1;`,
  });

  // A player built under the other gravity has to be built again; only its Create can do that.
  const rebuildIf = model.createReads
    .filter((name) => gravity.includes(name))
    .map((name) => `if (global.${name} != ${G.gravity(gravity.indexOf(name))}) sh_rebuild = 1;`)
    .join("\n");

  /**
   * Send this player to the pending shared save, and use it up. `inPlace` for a respawn that asked
   * for no room of its own; a load has already queued one, which this has to override.
   */
  mod.resource.script.create({
    name: "shApply",
    args: ["who", "inPlace"],
    body: ({ a, call }) => `var sh_rebuild;
if (!room_exists(${G.room})) {
  ${G.state} = 0;
  ${call("shPersist")};
  exit;
}
${G.applying} = 1;
sh_rebuild = 0;
${rebuildIf}
${gravity.map((name, index) => `global.${name} = ${G.gravity(index)};`).join("\n")}
if (${a.inPlace} == 0 || room != ${G.room}) room_goto(${G.room});
with (${a.who}) {
  if (sh_rebuild) event_perform(ev_create, 0);
  x = ${G.x};
  y = ${G.y};
  xprevious = x;
  yprevious = y;
  hspeed = 0;
  vspeed = 0;
}
${G.applying} = 0;
${G.state} = 2;
${call("shPersist")};`,
  });

  // The player's own save. Runs once per line that stores the position, so several times a save;
  // the JavaScript side sends one.
  for (const write of model.positionWrites) {
    mod.resource.script.insert({
      at: write,
      place: "after",
      body: ({ call, send }) => `
        var sh_player;
        if (!${G.applying}) {
          sh_player = ${call("me")};
          if (sh_player != noone) {
            ${G.anchorX} = sh_player.x;
            ${G.anchorY} = sh_player.y;
            ${G.anchorRoom} = room;
            ${G.hasAnchor} = 1;
          }
          ${G.state} = 0;
          ${call("shPersist")};
          if (${G.enabled} && sh_player != noone && ${G.roomSteps} >= ${SETTLED_IN_ROOM}) {
            ${send(
              "shSaved",
              [
                "string(room)",
                "string(sh_player.x)",
                "string(sh_player.y)",
                ...gravity.map((name) => `string(global.${name})`),
              ].join(' + " " + '),
            )}
          } else if (sh_player != noone) {
            ${send("shKept", `string(${G.enabled})`)}
          }
        }
      `,
    });
  }

  // A reload through the game's own load routine: the moment IWPO used.
  for (const load of model.loads) {
    mod.resource.script.hook(load, ({ original, call }) => `
        var sh_result, sh_player;
        sh_result = ${original.call()};
        sh_player = ${call("me")};
        if (sh_player != noone && !${G.applying}) {
          ${G.anchorX} = sh_player.x;
          ${G.anchorY} = sh_player.y;
          ${G.anchorRoom} = -1;
          ${G.hasAnchor} = 1;
          if (${G.state} != 0) ${call("shApply", "sh_player", "0")};
          else ${call("shPersist")};
        }
        return sh_result;
      `);
  }

  mod.resource.object.create({
    name: "shared",
    persistent: true,
    visible: false,
    vars: ["seen", "settle", "held", "lastId", "lastX", "lastY", "lastRoom"],
    events: {
      create: ({ v, call }) => `
        ${call("shRestore")};
        ${v.seen} = 0;
        ${v.settle} = 0;
        ${v.held} = 0;
        ${v.lastId} = noone;
        ${v.lastX} = 0;
        ${v.lastY} = 0;
        ${v.lastRoom} = -1;
      `,
      // After the frame's movement and before Draw: a respawn found here is fixed before anything
      // shows the player on their own save first.
      endStep: ({ v, call, send }) => `
        var sh_who, sh_jump;
        sh_who = ${call("me")};

        if (sh_who != noone && ${G.hasAnchor} && ${G.anchorRoom} < 0) {
          if (${call("shAtAnchor", "sh_who", "0")}) ${G.anchorRoom} = room;
        }

        if (room != ${v.lastRoom}) ${G.roomSteps} = 0;
        else ${G.roomSteps} += 1;

        sh_jump = 0;
        if (sh_who == noone) {
          ${v.seen} = 0;
        } else if (!${v.seen}) {
          sh_jump = 1;
        } else if (sh_who != ${v.lastId} || room != ${v.lastRoom}) {
          sh_jump = 1;
        } else if (abs(sh_who.x - ${v.lastX}) > ${RESPAWN_JUMP} || abs(sh_who.y - ${v.lastY}) > ${RESPAWN_JUMP}) {
          sh_jump = 1;
        }

        if (sh_who != noone) {
          if (${v.settle} > 0) {
            ${v.settle} -= 1;
            if (room != ${G.room} && room_exists(${G.room})) room_goto(${G.room});
          }
          if (sh_jump && ${G.state} != 0 && ${call("shAtAnchor", "sh_who", "1")}) {
            ${call("shApply", "sh_who", "1")};
            ${v.settle} = ${SETTLE_FRAMES};
            ${v.held} = 0;
          }
          // Applied, and nothing has put the player back since: now it has been used. Any room --
          // a save beside a warp must still count once the player has walked through it.
          if (${G.state} == 2) {
            ${v.held} += 1;
            if (${v.held} >= ${CONFIRM_STEPS}) {
              ${G.state} = 0;
              ${v.held} = 0;
              ${call("shPersist")};
              ${send("shUsed")}
            }
          } else {
            ${v.held} = 0;
          }
          ${v.seen} = 1;
          ${v.lastId} = sh_who;
          ${v.lastX} = sh_who.x;
          ${v.lastY} = sh_who.y;
        }
        ${v.lastRoom} = room;
      `,
    },
    receive: {
      // "<room> <x> <y> <gravity...>": somebody else's save, waiting for the next reload.
      shShare: ({ payload, call }) => `
        if (${G.enabled}) {
        ${G.room} = real(${call("field", payload, "1")});
        ${G.x} = real(${call("field", payload, "2")});
        ${G.y} = real(${call("field", payload, "3")});
        ${gravity.map((_, index) => `${G.gravity(index)} = real(${call("field", payload, String(4 + index))});`).join("\n        ")}
        ${G.state} = 1;
        ${call("shPersist")};
        }
      `,
      // "1" or "0": the account setting changed mid-game. At launch it rides on shFresh instead.
      shEnable: ({ payload, call }) => `
        ${G.enabled} = real(${payload});
        if (!${G.enabled}) ${G.state} = 0;
        ${call("shPersist")};
      `,
      // A new launch: whatever the scratch file says is from a session that is over. Carries the
      // account setting ("1" or "0") rather than leaving it to a separate shEnable, because the SDK
      // hands an object its messages grouped by event, not in the order they were sent -- a reset
      // arriving second would wipe the setting it was sent after.
      shFresh: ({ payload, call }) => `
        ${call("shReset")};
        ${G.enabled} = real(${payload});
        ${call("shPersist")};
      `,
    },
  });

  const flag = () => (enabled ? "1" : "0");

  mod.onStart(() => {
    mod.send("shFresh", flag());
    console.log(`[online] save sharing ${enabled ? "on" : "off"}`);
  });

  const setEnabled = (on: boolean) => {
    if (on === enabled) return;
    enabled = on;
    mod.send("shEnable", flag());
    console.log(`[online] save sharing turned ${enabled ? "on" : "off"}`);
  };

  mod.on("shSaved", (payload) => {
    const numbers = payload.split(" ").map(Number);
    const [room, x, y, ...g] = numbers;
    if (numbers.some((value) => !Number.isFinite(value)) || g.length !== gravity.length) return;
    for (const handler of saveHandlers) handler({ room: room!, x: x!, y: y!, g });
  });

  // A save that stays private: sharing is off, or it is the game saving on its own as a room
  // starts. Once per save, not once per line of it.
  let lastKept = 0;
  mod.on("shKept", (enabledFlag) => {
    const now = Date.now();
    if (now - lastKept < 2000) return;
    lastKept = now;
    console.log(
      enabledFlag === "1"
        ? "[online] the game saved as a room started; not sharing that one"
        : "[online] you saved; not sharing it (save sharing is off)",
    );
  });

  mod.on("shUsed", () => {
    for (const handler of usedHandlers) handler();
  });

  return {
    enabled: () => enabled,
    setEnabled,
    arm(save) {
      // Another copy of the game, or another version of it, may not agree on what gravity is.
      if (save.g.length !== gravity.length) return;
      const text = (value: number) => String(Math.round(value * 100) / 100);
      mod.send("shShare", [save.room, save.x, save.y, ...save.g].map(text).join(" "));
    },
    onSave: (handler) => saveHandlers.push(handler),
    onUsed: (handler) => usedHandlers.push(handler),
  };
};
