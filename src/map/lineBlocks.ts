/**
 * Traits fins de la carte (réseau routier, frontières) rangés par blocs de cellules : seuls les blocs
 * proches de la vue sont dessinés, et un bloc modifié est recalculé seul.
 */

/** Taille des blocs, en cellules. */
export const LINE_BLOCK = 128

/**
 * Un bloc de segments. Données binaires pour deck.gl (LineLayer) : 4 nombres par segment (lon, lat
 * de départ puis d'arrivée) et, si les couleurs varient d'un segment à l'autre, une couleur RGBA.
 */
export interface LineBlock {
  id: string
  /** Emprise du bloc [lon0, lat0, lon1, lat1], segments débordants compris. */
  bounds: [number, number, number, number]
  length: number
  positions: Float32Array
  colors?: Uint8Array
}

/** Bloc construit à partir de ses segments (et de leurs couleurs éventuelles). */
export function lineBlock(id: string, pos: number[], col?: number[]): LineBlock {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 2) {
    const lon = pos[i] ?? 0
    const lat = pos[i + 1] ?? 0
    if (lon < w) w = lon
    if (lon > e) e = lon
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return {
    id,
    bounds: [w, s, e, n],
    length: pos.length / 4,
    positions: new Float32Array(pos),
    ...(col ? { colors: new Uint8Array(col) } : {}),
  }
}

/** Blocs qui touchent l'emprise visible [lon0, lat0, lon1, lat1] (tous sans emprise). */
export function visibleBlocks<T extends LineBlock>(
  blocks: T[],
  view: [number, number, number, number] | null,
): T[] {
  if (!view) return blocks
  const [w, s, e, n] = view
  return blocks.filter(
    (b) => b.bounds[0] <= e && b.bounds[2] >= w && b.bounds[1] <= n && b.bounds[3] >= s,
  )
}
