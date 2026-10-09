/**
 * Rapport d'équilibrage : parties IA contre IA sans affichage, sur plusieurs graines.
 * Utilisé par `scripts/balance.ts` (CI) ; aucune dépendance au navigateur ni à Node.
 */
import { Simulation } from './simulation'
import type { CountryId, ScenarioDef } from './core/types'
import type { TheaterData } from './theater/grid'

/** Relevé d'un pays à une date donnée. */
export interface BalanceCountryPoint {
  /** Part du territoire de départ tenue (1 = 100 %). */
  territory: number
  units: number
}

export interface BalanceCountryResult extends BalanceCountryPoint {
  country: CountryId
  /** Effectifs perdus au combat, en équivalent brigades (somme des pertes de force). */
  losses: number
  /** Unités détruites et unités nouvelles (formations, aide en matériel). */
  destroyed: number
  created: number
}

export interface BalanceGame {
  seed: number
  /** Jours effectivement simulés (moins si la partie se termine avant). */
  days: number
  /** Jour de la fin de la dernière guerre entre pays suivis, null si elle dure encore. */
  peaceDay: number | null
  outcome: string | null
  /** Relevés réguliers : jour → pays → territoire et unités. */
  timeline: Array<{ day: number; countries: Record<CountryId, BalanceCountryPoint> }>
  countries: BalanceCountryResult[]
  /** Durée de calcul, en millisecondes. */
  ms: number
}

/** Joue une partie IA contre IA et relève territoire, unités et pertes des pays suivis. */
export function playBalanceGame(
  scenario: ScenarioDef,
  theater: TheaterData,
  seed: number,
  days: number,
  watch: CountryId[],
  sampleEvery = 30,
): BalanceGame {
  const started = Date.now()
  const sim = Simulation.fromScenario(scenario, theater, seed, scenario.playerCountry)
  sim.aiControlsPlayer = true
  const ctx = sim.ctx
  // Pertes cumulées : la simulation remet ses pertes du jour à zéro chaque jour.
  const losses = new Map<CountryId, number>()
  const clear = ctx.losses.clear.bind(ctx.losses)
  ctx.losses.clear = () => {
    for (const [c, v] of ctx.losses) losses.set(c, (losses.get(c) ?? 0) + v)
    clear()
  }
  const destroyed = new Map<CountryId, number>()
  const created = new Map<CountryId, number>()
  let alive = new Map([...ctx.units.values()].map((u) => [u.id, u.owner]))
  const atWar = (): boolean =>
    ctx.politics.wars.some(
      (w) =>
        watch.some((c) => w.attackers.includes(c)) && watch.some((c) => w.defenders.includes(c)),
    )
  let peaceDay: number | null = null
  const point = (): Record<CountryId, BalanceCountryPoint> => {
    const snap = sim.snapshot()
    const out: Record<CountryId, BalanceCountryPoint> = {}
    for (const c of watch) {
      out[c] = {
        territory: snap.territoryHeld[c] ?? 0,
        units: snap.units.filter((u) => u.owner === c).length,
      }
    }
    return out
  }
  const timeline: BalanceGame['timeline'] = [{ day: 0, countries: point() }]
  let day = 0
  while (day < days && !sim.outcome) {
    const wasAtWar = atWar()
    sim.step(24)
    day++
    const now = new Map([...ctx.units.values()].map((u) => [u.id, u.owner]))
    for (const [id, owner] of alive) {
      if (!now.has(id)) destroyed.set(owner, (destroyed.get(owner) ?? 0) + 1)
    }
    for (const [id, owner] of now) {
      if (!alive.has(id)) created.set(owner, (created.get(owner) ?? 0) + 1)
    }
    alive = now
    if (wasAtWar && !atWar()) peaceDay = day
    else if (atWar()) peaceDay = null
    if (day % sampleEvery === 0 || day === days || sim.outcome) {
      timeline.push({ day, countries: point() })
    }
  }
  const last = timeline[timeline.length - 1]?.countries ?? {}
  return {
    seed,
    days: day,
    peaceDay,
    outcome: sim.outcome ? `${sim.outcome.winner} : ${sim.outcome.reason}` : null,
    timeline,
    countries: watch.map((c) => ({
      country: c,
      territory: last[c]?.territory ?? 0,
      units: last[c]?.units ?? 0,
      losses: Math.round((losses.get(c) ?? 0) * 10) / 10,
      destroyed: destroyed.get(c) ?? 0,
      created: created.get(c) ?? 0,
    })),
    ms: Date.now() - started,
  }
}

export interface BalanceSummary {
  country: CountryId
  territory: { min: number; mean: number; max: number }
  losses: { min: number; mean: number; max: number }
}

/** Minimum, moyenne et maximum par pays sur l'ensemble des graines. */
export function summarizeBalance(games: BalanceGame[]): BalanceSummary[] {
  const countries = games[0]?.countries.map((c) => c.country) ?? []
  const stats = (values: number[]): { min: number; mean: number; max: number } => ({
    min: Math.min(...values),
    mean: values.reduce((s, v) => s + v, 0) / Math.max(1, values.length),
    max: Math.max(...values),
  })
  return countries.map((country) => {
    const rows = games.map((g) => g.countries.find((c) => c.country === country))
    return {
      country,
      territory: stats(rows.map((r) => r?.territory ?? 0)),
      losses: stats(rows.map((r) => r?.losses ?? 0)),
    }
  })
}

const pct = (v: number): string => `${(v * 100).toFixed(0)} %`

/** Rapport lisible (Markdown), publié avec les résultats de la CI. */
export function balanceMarkdown(title: string, games: BalanceGame[]): string {
  const countries = games[0]?.countries.map((c) => c.country) ?? []
  const lines = [
    `## ${title}`,
    '',
    'Territoire rapporté à celui du début de partie ; pertes en équivalent brigades.',
    '',
  ]
  lines.push(
    `| Graine | Jours | Issue | ${countries.map((c) => `${c} territoire · unités · pertes`).join(' | ')} |`,
  )
  lines.push(`| --- | --- | --- | ${countries.map(() => '---').join(' | ')} |`)
  for (const g of games) {
    const issue =
      g.outcome ?? (g.peaceDay !== null ? `paix au jour ${g.peaceDay}` : 'guerre en cours')
    const cells = g.countries.map(
      (c) => `${pct(c.territory)} · ${c.units} · ${c.losses.toFixed(1)} (${c.destroyed} détruites)`,
    )
    lines.push(`| ${g.seed} | ${g.days} | ${issue} | ${cells.join(' | ')} |`)
  }
  lines.push('')
  for (const s of summarizeBalance(games)) {
    lines.push(
      `- ${s.country} : territoire ${pct(s.territory.min)} à ${pct(s.territory.max)} (moyenne ${pct(s.territory.mean)}), pertes ${s.losses.mean.toFixed(1)} brigades en moyenne`,
    )
  }
  const days = games[0]?.timeline.map((t) => t.day) ?? []
  if (days.length > 2) {
    lines.push('', `Territoire par jour (${days.join(', ')}) :`, '')
    for (const g of games) {
      const series = countries.map(
        (c) => `${c} ${g.timeline.map((t) => pct(t.countries[c]?.territory ?? 0)).join(' → ')}`,
      )
      lines.push(`- graine ${g.seed} : ${series.join(' ; ')}`)
    }
  }
  return lines.join('\n') + '\n'
}
