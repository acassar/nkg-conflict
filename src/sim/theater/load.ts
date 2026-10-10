import type { TheaterData } from './grid'
import ukraineTheater from '../data/theater-ukraine.json'
import { WORLD_TABLE } from '../scenarios'

/**
 * Décompresse un fichier gzip avec l'API du navigateur (aussi disponible dans Node 18+).
 * Certains serveurs envoient le fichier avec `Content-Encoding: gzip` : le navigateur l'a alors déjà
 * décompressé, ce que l'on reconnaît à l'absence de l'en-tête gzip (1f 8b).
 */
async function gunzip(buffer: ArrayBuffer): Promise<Uint8Array> {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new Uint8Array(buffer)
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Réseau de transport du théâtre (routes et voies ferrées, un octet par cellule), généré par
 * scripts/build-roads.mjs.
 */
async function loadRoads(
  id: 'ukraine' | 'world',
  size: number,
  fetchBinary: (path: string) => Promise<ArrayBuffer>,
): Promise<Uint8Array> {
  const bytes = await gunzip(await fetchBinary(`data/roads-${id}.bin.gz`))
  if (bytes.length !== size)
    throw new Error(`Réseau de transport corrompu : ${id} (${bytes.length} octets)`)
  return bytes
}

/**
 * Charge les données d'un théâtre. La grille mondiale (≈ 10 Mo décompressés) et les réseaux de
 * transport sont des fichiers binaires servis à côté du jeu ; `fetchBinary` permet aux tests de les
 * lire sur le disque.
 */
export async function loadTheater(
  id: 'ukraine' | 'world',
  fetchBinary: (path: string) => Promise<ArrayBuffer>,
): Promise<TheaterData> {
  if (id === 'ukraine') {
    const data = ukraineTheater as unknown as TheaterData
    return { ...data, roads: await loadRoads(id, data.width * data.height, fetchBinary) }
  }
  const size = WORLD_TABLE.width * WORLD_TABLE.height
  const [bytes, roads] = await Promise.all([
    fetchBinary('data/world-grid.bin.gz').then(gunzip),
    loadRoads(id, size, fetchBinary),
  ])
  if (bytes.length !== size * 2)
    throw new Error(`Grille mondiale corrompue (${bytes.length} octets)`)
  return {
    ...WORLD_TABLE,
    ownerBytes: bytes.subarray(0, size),
    terrainBytes: bytes.subarray(size),
    roads,
  }
}
