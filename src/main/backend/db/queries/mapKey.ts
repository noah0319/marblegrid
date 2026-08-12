/**
 * Case-insensitive identity key for a (map_name, map_creator) pair. Shared by
 * every map_* query module (records, notes, community, history) so they all
 * treat "same map" identically — this game has a confirmed real pattern of
 * inconsistent capitalization (season .sav filenames: "season 55.sav" vs
 * "Season 63.sav"), so the same map reported with different casing across
 * two plays must still merge, not silently split.
 */
export function mapKey(mapName: string, mapCreator: string): string {
  return `${mapName.toLowerCase()}::${mapCreator.toLowerCase()}`
}
