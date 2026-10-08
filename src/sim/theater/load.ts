import type { TheaterData } from './grid'
import ukraineTheater from '../data/theater-ukraine.json'
import { WORLD_TABLE } from '../scenarios'

/** Décompresse un fichier gzip avec l'API du navigateur (aussi disponible dans Node 18+). */
async function gunzip(buffer: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Charge les données d'un théâtre. La grille mondiale (≈ 10 Mo décompressés) est un fichier binaire
 * servi à côté du jeu ; `fetchBinary` permet aux tests de la lire sur le disque.
 */
export async function loadTheater(
  id: 'ukraine' | 'world',
  fetchBinary: (path: string) => Promise<ArrayBuffer>,
): Promise<TheaterData> {
  if (id === 'ukraine') return ukraineTheater as unknown as TheaterData
  const bytes = await gunzip(await fetchBinary('data/world-grid.bin.gz'))
  const size = WORLD_TABLE.width * WORLD_TABLE.height
  if (bytes.length !== size * 2)
    throw new Error(`Grille mondiale corrompue (${bytes.length} octets)`)
  return {
    ...WORLD_TABLE,
    ownerBytes: bytes.subarray(0, size),
    terrainBytes: bytes.subarray(size),
  }
}
