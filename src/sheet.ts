/**
 * A character's sheet, cut into the frames of one sprite.
 *
 * The sheet is the host's (`HostSkin`): 128x128, four 32x32 frames across, four rows down --
 * idle, run, jump, fall -- each row repeating its last frame when its animation is shorter. See
 * the Skin mod, which reads the same sheet.
 *
 * Each other player gets one sprite holding every pose back to back (`POSES` says where each
 * starts), rather than one sprite per pose: a sprite is a declared resource, and sixteen players
 * times four poses would be a lot of them.
 */

import { pngSize, sliceImage } from "@sculptr/sdk";

export const TILE = 32;

export const POSES = [
  // `speed` is the Kid's own image_speed for that animation, in frames per step.
  { name: "idle", first: 0, count: 4, speed: 0.2 },
  { name: "run", first: 4, count: 4, speed: 0.5 },
  { name: "jump", first: 8, count: 2, speed: 0.2 },
  { name: "fall", first: 10, count: 2, speed: 0.2 },
] as const;

export type Pose = 0 | 1 | 2 | 3;

/** Every frame the sprite holds, in order. Rejects a sheet of any other shape rather than slicing
 *  it into nonsense: the sheet came over the network from somebody else's copy of this mod. */
export const sliceSheet = async function (sheet: Uint8Array): Promise<Uint8Array[]> {
  const { width, height } = pngSize(sheet);
  if (width !== 4 * TILE || height !== POSES.length * TILE) {
    throw new Error(`the character sheet is ${width}x${height}, expected 128x128`);
  }
  const frames: Uint8Array[] = [];
  for (const [row, pose] of POSES.entries()) {
    for (let column = 0; column < pose.count; column += 1) {
      frames.push(
        await sliceImage(sheet, { x: column * TILE, y: row * TILE, width: TILE, height: TILE }),
      );
    }
  }
  return frames;
};

export const fromBase64 = function (text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
};

export const toBase64 = function (bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return btoa(binary);
};
