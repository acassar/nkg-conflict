/**
 * Sauvegardes dans le stockage du navigateur (localStorage).
 * Une partie mondiale fait plus d'un mégaoctet de JSON : elle est compressée (gzip, puis base64)
 * pour tenir dans le quota de quelques mégaoctets du navigateur.
 */

export type SaveSlot = 'manual' | 'auto'

export interface SaveMeta {
  slot: SaveSlot
  scenarioId: string
  playerCountry: string
  countryName: string
  dateLabel: string
  savedAt: string
  /** Taille stockée, en octets. */
  size: number
}

const PREFIX = 'nkg-conflict:save:'
const META = (slot: SaveSlot): string => `${PREFIX}${slot}:meta`
const DATA = (slot: SaveSlot): string => `${PREFIX}${slot}:data`
export const SLOT_LABELS: Record<SaveSlot, string> = {
  manual: 'Sauvegarde',
  auto: 'Sauvegarde automatique',
}

async function gzip(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

async function gunzip(base64: string): Promise<string> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Enregistre une partie ; renvoie un message d'erreur, ou null. */
export async function writeSave(
  slot: SaveSlot,
  text: string,
  meta: Omit<SaveMeta, 'slot' | 'size' | 'savedAt'>,
): Promise<string | null> {
  try {
    const data = await gzip(text)
    const full: SaveMeta = { ...meta, slot, size: data.length, savedAt: new Date().toISOString() }
    localStorage.removeItem(DATA(slot))
    localStorage.setItem(DATA(slot), data)
    localStorage.setItem(META(slot), JSON.stringify(full))
    return null
  } catch (e) {
    const quota = e instanceof DOMException && /quota/i.test(e.name + e.message)
    return quota
      ? 'Stockage du navigateur plein : exportez la partie dans un fichier'
      : 'Sauvegarde impossible dans ce navigateur (navigation privée ?) : exportez la partie'
  }
}

export async function readSave(slot: SaveSlot): Promise<string | null> {
  try {
    const data = localStorage.getItem(DATA(slot))
    return data ? await gunzip(data) : null
  } catch {
    return null
  }
}

export function listSaves(): SaveMeta[] {
  const out: SaveMeta[] = []
  for (const slot of ['manual', 'auto'] as const) {
    try {
      const raw = localStorage.getItem(META(slot))
      if (raw && localStorage.getItem(DATA(slot))) out.push(JSON.parse(raw) as SaveMeta)
    } catch {
      // Stockage indisponible ou entrée abîmée : ignorée.
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function deleteSave(slot: SaveSlot): void {
  try {
    localStorage.removeItem(DATA(slot))
    localStorage.removeItem(META(slot))
  } catch {
    // Rien à faire.
  }
}
