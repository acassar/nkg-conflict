/** Durée d'un tick de simulation, en heures de jeu. */
export const HOURS_PER_TICK = 1

const MS_PER_HOUR = 3_600_000

/** Vitesses disponibles : nombre de ticks simulés par seconde réelle (index 1 à 5). */
export const SPEED_TICKS_PER_SECOND = [0, 1, 3, 8, 24, 72] as const

export type Speed = 1 | 2 | 3 | 4 | 5

export function isSpeed(value: number): value is Speed {
  return Number.isInteger(value) && value >= 1 && value <= 5
}

/** Date de jeu (UTC) correspondant à un nombre de ticks écoulés depuis le début. */
export function tickToDate(startIso: string, tick: number): Date {
  const start = Date.parse(startIso)
  if (Number.isNaN(start)) throw new Error(`Date de départ invalide : ${startIso}`)
  return new Date(start + tick * HOURS_PER_TICK * MS_PER_HOUR)
}

const MONTHS_FR = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
] as const

/** Formate une date de jeu : « 7 oct. 2026, 14:00 ». Indépendant de la locale du navigateur. */
export function formatGameDate(date: Date): string {
  const day = date.getUTCDate()
  const month = MONTHS_FR[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  const hour = String(date.getUTCHours()).padStart(2, '0')
  return `${day} ${month} ${year}, ${hour}:00`
}
