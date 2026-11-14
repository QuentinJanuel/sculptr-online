import type { GameContent } from "@sculptr/sdk";

/**
 * Which lobby this game's players meet in.
 *
 * The host does not tell a mod which game it is running, so the game is recognised by its own
 * contents: the names of its objects and scripts, sorted. Names rather than code because they are
 * the one thing every backend reads identically -- the emulator and an installed copy decompile
 * through different paths, and a key that differed between them would split one game's players
 * into two lobbies that never see each other.
 *
 * Two different games built on the same engine without renaming anything would share a lobby.
 * That costs little -- the relay only shows players who share a room number -- and a name list
 * long enough to include a single custom object tells them apart.
 *
 * @returns null for a game whose contents could not be read, which would otherwise put every such
 *   game in one lobby together.
 */
export const lobbyKey = function (content: GameContent): string | null {
  if (content.objects.length === 0) return null;
  const names = [
    ...content.objects.map((object) => `o:${object.name}`),
    ...content.scripts.map((script) => `s:${script.name}`),
  ].sort();
  const text = names.join("\n");
  // Two independent 32-bit FNV-1a runs: 64 bits, which is plenty for telling games apart and needs
  // no crypto API (there is none to await during a mod's setup).
  return `g-${fnv(text, 0x811c9dc5)}${fnv(text, 0x050c5d1f)}`;
};

/**
 * The lobby for players in the same host room: the game's lobby, narrowed to that room. A room
 * is how friends arrange to play together, so its lobby is theirs alone -- what IWPO's passwords
 * were for. Hashed like the rest of the key; the relay never sees the room id itself.
 */
export const roomLobbyKey = function (key: string, roomId: string): string {
  return `${key}-r${fnv(roomId, 0x811c9dc5)}${fnv(roomId, 0x050c5d1f)}`;
};

const fnv = function (text: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
