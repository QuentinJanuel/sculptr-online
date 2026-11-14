/**
 * Which of the four poses a skin has the sender's player is in.
 *
 * Read off the name of the sprite the game is showing, the same way the Skin mod decides which of
 * the game's sprites to replace: a name that says it is the player, then which pose, in that order
 * -- so `sprPlayerRunning` is a run and `sprJumpRefresher` is nothing. The game already knows which
 * pose its player is in; asking it is sturdier than re-deriving that from physics.
 *
 * Physics is only the fallback, for a sprite whose name says nothing (`sprPlayerSlide`,
 * `spr_kid_dash`): moving up against gravity is a jump, down is a fall, sideways is a run.
 */

import type { Pose } from "./sheet";

const POSE_WORDS: readonly (readonly [string, Pose])[] = [
  ["idle", 0],
  ["standing", 0],
  ["stand", 0],
  ["running", 1],
  ["walking", 1],
  ["run", 1],
  ["walk", 1],
  ["jumping", 2],
  ["jump", 2],
  ["falling", 3],
  ["fall", 3],
];

const byName = new Map<string, Pose | null>();

const poseOfName = function (sprite: string): Pose | null {
  const cached = byName.get(sprite);
  if (cached !== undefined) return cached;
  const name = sprite.toLowerCase();
  let who = name.indexOf("player");
  if (who < 0) who = name.indexOf("kid");
  let pose: Pose | null = null;
  if (who >= 0) {
    for (const [word, candidate] of POSE_WORDS) {
      if (name.indexOf(word, who) > who) {
        pose = candidate;
        break;
      }
    }
  }
  byName.set(sprite, pose);
  return pose;
};

export const poseOf = function (
  sprite: string,
  hspeed: number,
  vspeed: number,
  flipped: number,
): Pose {
  const named = poseOfName(sprite);
  if (named !== null) return named;
  const up = vspeed * flipped;
  if (up < -0.5) return 2;
  if (up > 0.5) return 3;
  if (Math.abs(hspeed) > 0.1) return 1;
  return 0;
};
