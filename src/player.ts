/**
 * Everything this mod needs to know about the game's own player, found in its code once at setup.
 *
 * ## Which objects are the player
 *
 * The ones `@sculptr/detect` finds in the game's save routine -- the object whose position the
 * game stores is the player by definition -- plus any object named the way I Wanna engines name
 * it, for a game whose saves detect could not follow. A game with neither is not supported.
 *
 * ## Which way it faces, and which way is up
 *
 * What other players are shown is only a skin at a position, so the sender has to say which way to
 * draw it. `image_xscale` is the answer in most GameMaker 8 engines, and wrong in most Studio ones:
 * YoYoYo's Studio engine keeps facing in a variable of its own and gravity in `global.grav`, and
 * multiplies them in when it draws. Rather than knowing about every engine, this reads the player's
 * own Draw event and borrows the scale arguments of its `draw_sprite_ext` -- whatever the game
 * multiplies in there is, by construction, what it means by facing.
 *
 * Only an expression that is safe to evaluate from outside the Draw event is borrowed: built-in
 * variables, the player's own variables that its Create event sets, and globals the game assigns
 * somewhere. Anything else -- a local, a call, a variable only the Draw event itself sets -- falls
 * back to plain `image_xscale`/`image_yscale`. GameMaker 8 stops the game on reading a variable that
 * does not exist yet, so guessing wrong here would be much worse than drawing someone backwards.
 */

import { type Expr, type GameContent, walk } from "@sculptr/sdk";

const PLAYER_NAME = /^(obj_?|o_?)?(player|kid)_?2?$/iu;
/** GameMaker 8 engines flip gravity by swapping in a second player object, drawn upside down. */
const FLIPPED_NAME = /^(obj_?|o_?)?(player|kid)_?2$/iu;

export interface PlayerModel {
  objects: string[];
  /** The subset drawn upside down by a separate object rather than by a negative scale. */
  flippedObjects: string[];
  /** GML, evaluated as the player, for the horizontal and vertical scale it is drawn with. */
  xscale: string;
  yscale: string;
}

export const findPlayer = function (
  content: GameContent,
  detected: readonly string[],
): PlayerModel | null {
  const named = content.objects.map((object) => object.name).filter((name) => PLAYER_NAME.test(name));
  const objects = [...new Set([...detected, ...named])];
  if (objects.length === 0) return null;

  const assignedGlobals = new Set<string>();
  for (const block of [
    ...content.scripts.map((script) => script.body),
    ...content.objects.flatMap((object) => Object.values(object.events)),
  ]) {
    for (const stmt of walk(block ?? [])) {
      if (stmt.k === "assign" && stmt.target.k === "var" && stmt.target.scope === "global") {
        assignedGlobals.add(stmt.target.name);
      }
    }
  }

  let xscale = "image_xscale";
  let yscale = "image_yscale";
  for (const name of objects) {
    const object = content.objects.find((one) => one.name === name);
    if (!object?.events.draw) continue;

    const created = new Set<string>();
    for (const stmt of walk(object.events.create ?? [])) {
      if (stmt.k === "assign" && stmt.target.k === "var" && stmt.target.scope === "self") {
        created.add(stmt.target.name);
      }
    }
    const safe = (expr: Expr): string | null => print(expr, created, assignedGlobals);

    for (const stmt of walk(object.events.draw)) {
      if (stmt.k !== "call" || stmt.call.name !== "draw_sprite_ext") continue;
      const [, , , , xs, ys] = stmt.call.args;
      const x = xs && safe(xs);
      const y = ys && safe(ys);
      if (x) xscale = x;
      if (y) yscale = y;
      break;
    }
    if (xscale !== "image_xscale" || yscale !== "image_yscale") break;
  }

  return {
    objects,
    flippedObjects: objects.filter((name) => FLIPPED_NAME.test(name)),
    xscale,
    yscale,
  };
};

/** GML for an expression, or null when it is not one this module trusts (see the file comment). */
const print = function (
  expr: Expr,
  selfVars: ReadonlySet<string>,
  globals: ReadonlySet<string>,
): string | null {
  const recurse = (inner: Expr) => print(inner, selfVars, globals);
  switch (expr.k) {
    case "number":
      return String(expr.value);
    case "var":
      if (expr.scope === "builtin") return expr.name;
      if (expr.scope === "self" && selfVars.has(expr.name)) return expr.name;
      if (expr.scope === "global" && globals.has(expr.name)) return `global.${expr.name}`;
      return null;
    case "op": {
      // No division: a divisor that is zero on some frame stops a GameMaker 8 game.
      if (!["*", "+", "-"].includes(expr.op)) return null;
      const args = expr.args.map(recurse);
      if (args.some((arg) => arg === null)) return null;
      if (args.length === 1) return `(${expr.op}${args[0]})`;
      if (args.length === 2) return `(${args[0]} ${expr.op} ${args[1]})`;
      return null;
    }
    default:
      return null;
  }
};
