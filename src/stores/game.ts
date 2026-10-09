import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import * as Comlink from 'comlink'
import { formatGameDate, isSpeed, tickToDate } from '@/sim/core/clock'
import { terrainRule } from '@/sim/theater/grid'
import type {
  BattleReport,
  BuildingKind,
  CountryId,
  GridSnapshot,
  LonLat,
  Posture,
  SimSnapshot,
  UnitKind,
  UnitSnapshot,
} from '@/sim/core/types'
import type { PlayerOrder } from '@/sim/simulation'
import type { AidLevel, PeaceKind } from '@/sim/politics/types'
import type { ScenarioInfo } from '@/sim/scenarios'
import type { SimApi } from '@/sim/worker'
import { deleteSave, listSaves, readSave, writeSave, type SaveSlot } from './saves'

/** Sauvegarde automatique tous les 30 jours de jeu. */
const AUTOSAVE_TICKS = 24 * 30

/**
 * Mode d'interaction de la carte : un clic sur la carte sert soit à sélectionner,
 * soit à désigner un point pour un ordre en attente.
 */
export type MapMode =
  | { kind: 'select' }
  | { kind: 'order'; order: Exclude<PlayerOrder, 'hold'> }
  | { kind: 'front'; armyId: number; first: LonLat | null }
  | { kind: 'offensive'; armyId: number; first: LonLat | null; unitIds?: number[] }
  /** Ordre qui vise une unité ennemie (poursuite, assaut, encerclement par la sélection ou une armée). */
  | { kind: 'target'; action: TargetAction; armyId?: number }

export type TargetAction = 'pursue' | 'assault' | 'encircle'

const TARGET_LABELS: Record<TargetAction, string> = {
  pursue: 'Poursuite',
  assault: 'Assaut',
  encircle: 'Encerclement',
}

/** Relation d'un pays avec le joueur, pour les couleurs de la carte. */
export type Stance = 'player' | 'enemy' | 'ally' | 'war' | 'neutral'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'danger' | 'success'
}

const ORDER_LABELS: Record<Exclude<PlayerOrder, 'hold'>, string> = {
  move: 'Déplacer',
  attack: 'Attaquer',
  retreat: 'Se replier',
}

/** Événements du journal qui méritent une notification quand ils concernent le joueur. */
const IMPORTANT =
  /déclare la guerre|capitule|paix|entre en guerre|propose la paix|Fin de partie|aide|Matériel livré/

/** Pont entre l'interface et le Worker de simulation. L'interface ne fait que lire l'état publié. */
export const useGameStore = defineStore('game', () => {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })
  const sim = Comlink.wrap<SimApi>(worker)

  // shallowRef : chaque snapshot remplace le précédent, inutile de rendre ses objets réactifs.
  const snapshot = shallowRef<SimSnapshot | null>(null)
  /** Grille de la partie : reçue entière au chargement, puis tenue à jour par les patchs. */
  const grid = shallowRef<GridSnapshot | null>(null)
  /** Incrémenté à chaque patch appliqué (la carte redessine les cellules modifiées). */
  const gridTick = ref(0)
  /** Cellules modifiées en attente de dessin (vidées par la carte). */
  let pendingCells: number[] = []
  const scenarios = ref<ScenarioInfo[]>([])
  const loading = ref(false)
  const selection = ref<number[]>([])
  const selectedArmyId = ref<number | null>(null)
  const selectedCountryCode = ref<CountryId | null>(null)
  const mode = ref<MapMode>({ kind: 'select' })
  /** Onglet du panneau de droite. */
  const panelTab = ref<'units' | 'armies' | 'production' | 'country' | 'log'>('units')
  /** Tiroir du panneau sur téléphone en portrait : replié, à mi-hauteur ou plein écran. */
  const drawer = ref<'collapsed' | 'half' | 'full'>('collapsed')
  /** Hauteur affichée du tiroir, en pixels (pour placer les boutons flottants au-dessus). */
  const drawerHeight = ref(0)
  /** Bataille ouverte dans la fenêtre de détail (unités qui la composent). */
  const battleIds = ref<number[] | null>(null)
  /** Sélection par zone : le prochain glisser sur la carte trace un rectangle. */
  const lasso = ref(false)
  const selectedCityName = ref<string | null>(null)
  /** Message bref affiché en haut de l'écran (erreur de commande, par exemple). */
  const notice = ref<string | null>(null)
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const toasts = ref<Toast[]>([])
  let toastId = 0
  /** Tick du dernier événement déjà examiné pour les notifications. */
  let lastEventTick = -1
  /** Demande de recentrage de la carte (début de partie). */
  const focus = ref<{ at: LonLat; zoom: number; nonce: number } | null>(null)
  /** Recentrer la carte dès l'arrivée du prochain état (nouvelle partie ou chargement). */
  let focusPending = false

  void sim.scenarios().then((list) => (scenarios.value = list))

  /** Faux après un retour au menu : un état encore en route depuis le Worker est ignoré. */
  let active = false
  /** Sauvegardes présentes dans le navigateur (écran de départ). */
  const saves = ref(listSaves())
  let lastAutosaveTick = 0
  let saving = false

  void sim.subscribe(
    Comlink.proxy((next: SimSnapshot) => {
      if (!active) return
      if (next.grid) {
        grid.value = next.grid
        pendingCells = []
        gridTick.value++
      } else if (next.gridPatch && grid.value) {
        const owner = grid.value.owner
        const patch = next.gridPatch
        for (let k = 0; k < patch.length; k += 2) {
          const cell = patch[k] ?? 0
          owner[cell] = patch[k + 1] ?? 0
          pendingCells.push(cell)
        }
        if (patch.length) gridTick.value++
      }
      const previous = snapshot.value
      snapshot.value = next
      if (!previous) lastAutosaveTick = next.tick
      else if (next.tick - lastAutosaveTick >= AUTOSAVE_TICKS && !next.outcome) {
        lastAutosaveTick = next.tick
        void saveLocal('auto', true)
      }
      // L'état publié peut arriver après la réponse de newGame : le recentrage se fait ici.
      if (focusPending) {
        focusPending = false
        focusOnPlayer()
      }
      if (!previous || previous.scenarioId !== next.scenarioId || next.tick < previous.tick) {
        lastEventTick = next.events.at(-1)?.tick ?? -1
      } else {
        notifyEvents(next)
      }
      // On retire de la sélection les unités disparues.
      const alive = new Set(next.units.map((u) => u.id))
      if (selection.value.some((id) => !alive.has(id))) {
        selection.value = selection.value.filter((id) => alive.has(id))
      }
      if (
        selectedArmyId.value !== null &&
        !next.armies.some((a) => a.id === selectedArmyId.value)
      ) {
        selectedArmyId.value = null
      }
    }),
  )

  /** Cellules modifiées depuis le dernier appel (pour un dessin incrémental). */
  function takePendingCells(): number[] {
    const out = pendingCells
    pendingCells = []
    return out
  }

  /** Notifications pour les événements importants qui concernent le joueur. */
  function notifyEvents(s: SimSnapshot): void {
    const fresh = s.events.filter((e) => e.tick > lastEventTick)
    if (fresh.length === 0) return
    lastEventTick = s.events.at(-1)?.tick ?? lastEventTick
    const me = s.countries.find((c) => c.id === s.playerCountry)?.name ?? ''
    for (const e of fresh) {
      if (!IMPORTANT.test(e.text)) continue
      if (e.owner !== s.playerCountry && !e.text.includes(me)) continue
      pushToast(e.text, /capitule|déclare la guerre/.test(e.text) ? 'danger' : 'info')
    }
  }

  function pushToast(text: string, tone: Toast['tone'] = 'info'): void {
    const id = ++toastId
    toasts.value = [...toasts.value.slice(-3), { id, text, tone }]
    setTimeout(() => dismissToast(id), 9000)
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  const started = computed(() => snapshot.value !== null)
  const paused = computed(() => snapshot.value?.paused ?? true)
  const speed = computed(() => snapshot.value?.speed ?? 1)
  const dateLabel = computed(() => {
    const s = snapshot.value
    return s ? formatGameDate(tickToDate(s.startDate, s.tick)) : '—'
  })
  const playerCountry = computed(() => {
    const s = snapshot.value
    return s?.countries.find((c) => c.id === s.playerCountry) ?? null
  })
  const countryByCode = computed(
    () => new Map((snapshot.value?.countries ?? []).map((c) => [c.id, c])),
  )
  const politicsByCode = computed(
    () => new Map((snapshot.value?.politics.countries ?? []).map((p) => [p.code, p])),
  )
  const playerPolitics = computed(() => {
    const s = snapshot.value
    return s ? (politicsByCode.value.get(s.playerCountry) ?? null) : null
  })
  const selectedUnits = computed<UnitSnapshot[]>(() => {
    const s = snapshot.value
    if (!s) return []
    const set = new Set(selection.value)
    return s.units.filter((u) => set.has(u.id))
  })
  const armies = computed(() => snapshot.value?.armies ?? [])
  const selectedArmy = computed(
    () => armies.value.find((a) => a.id === selectedArmyId.value) ?? null,
  )
  const economy = computed(() => snapshot.value?.economy ?? null)
  const selectedCity = computed(
    () => snapshot.value?.cities.find((c) => c.name === selectedCityName.value) ?? null,
  )
  const selectedCountry = computed(() =>
    selectedCountryCode.value ? (countryByCode.value.get(selectedCountryCode.value) ?? null) : null,
  )
  const offers = computed(() => snapshot.value?.politics.offers ?? [])
  const aids = computed(() => snapshot.value?.politics.aids ?? [])
  const aidRequests = computed(() => snapshot.value?.politics.aidRequests ?? [])

  /**
   * Position de chaque pays vis-à-vis du joueur (couleurs de la carte et des pions).
   * La clé change seulement quand les guerres ou les alliances changent.
   */
  const stances = computed(() => {
    const s = snapshot.value
    const map = new Map<CountryId, Stance>()
    if (!s) return { map, key: '' }
    const me = s.playerCountry
    for (const w of s.politics.wars) {
      for (const c of [...w.attackers, ...w.defenders]) if (!map.has(c)) map.set(c, 'war')
      const mine = w.attackers.includes(me)
        ? w.attackers
        : w.defenders.includes(me)
          ? w.defenders
          : null
      if (!mine) continue
      const theirs = mine === w.attackers ? w.defenders : w.attackers
      for (const c of mine) map.set(c, 'ally')
      for (const c of theirs) map.set(c, 'enemy')
    }
    for (const a of s.politics.alliances) {
      if (!a.members.includes(me)) continue
      for (const m of a.members) if (map.get(m) !== 'enemy') map.set(m, 'ally')
    }
    map.set(me, 'player')
    const key = JSON.stringify([s.politics.wars, s.politics.alliances.map((a) => a.members), me])
    return { map, key }
  })

  /** Paires de camps en guerre (indices de la grille, a × 256 + b), pour tracer les lignes de front. */
  const hostilePairs = computed(() => {
    const s = snapshot.value
    const g = grid.value
    const set = new Set<number>()
    if (!s || !g) return set
    const index = new Map(g.sides.map((c, i) => [c, i]))
    for (const w of s.politics.wars) {
      for (const a of w.attackers) {
        for (const d of w.defenders) {
          const x = index.get(a) ?? 0
          const y = index.get(d) ?? 0
          set.add(x * 256 + y)
          set.add(y * 256 + x)
        }
      }
    }
    return set
  })

  const modeHint = computed(() => {
    const m = mode.value
    if (m.kind === 'order')
      return `${ORDER_LABELS[m.order]} : cliquez sur la carte (Échap pour annuler)`
    if (m.kind === 'front') {
      return m.first
        ? 'Portion de front : cliquez sur la seconde extrémité'
        : 'Portion de front : cliquez sur la première extrémité'
    }
    if (m.kind === 'target') return `${TARGET_LABELS[m.action]} : cliquez sur une unité ennemie`
    if (m.kind === 'offensive') {
      return m.first
        ? "Offensive : cliquez sur l'objectif"
        : 'Offensive : cliquez sur le point de départ'
    }
    return null
  })

  // Les valeurs réactives de Vue sont des Proxy que postMessage ne sait pas copier :
  // tout ce qui part vers le Worker est d'abord recopié en tableaux simples.
  const ids = (): number[] => [...selection.value]
  const lonLat = (p: LonLat): LonLat => [p[0], p[1]]

  function cellAt(lon: number, lat: number): number {
    const g = grid.value
    if (!g) return -1
    const [lon0, lat0, lon1, lat1] = g.bbox
    const x = Math.floor(((lon - lon0) / (lon1 - lon0)) * g.width)
    const y = Math.floor(((lat - lat0) / (lat1 - lat0)) * g.height)
    if (x < 0 || y < 0 || x >= g.width || y >= g.height) return -1
    return y * g.width + x
  }

  /** Nom du terrain sous un point (pour le panneau). */
  function terrainNameAt(lon: number, lat: number): string {
    const i = cellAt(lon, lat)
    return i < 0 || !grid.value ? '' : terrainRule(grid.value.terrain[i]).name
  }

  /** Pays qui contrôle un point de la carte. */
  function ownerAt(lon: number, lat: number): CountryId | null {
    const i = cellAt(lon, lat)
    const g = grid.value
    if (i < 0 || !g) return null
    return g.sides[g.owner[i] ?? 0] || null
  }

  function showNotice(text: string): void {
    notice.value = text
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (notice.value = null), 4000)
  }

  /** Affiche l'erreur renvoyée par une commande, ou le message de réussite. */
  function report(error: string | null | undefined, success?: string): void {
    if (error) showNotice(error)
    else if (success) pushToast(success, 'success')
  }

  function resetUi(): void {
    selection.value = []
    selectedArmyId.value = null
    selectedCityName.value = null
    selectedCountryCode.value = null
    panelTab.value = 'units'
    toasts.value = []
    cancelMode()
  }

  // ---------- Partie ----------

  async function newGame(scenarioId: string, country: CountryId): Promise<void> {
    loading.value = true
    try {
      resetUi()
      focusPending = true
      active = true
      await sim.newGame(scenarioId, country)
    } catch (e) {
      focusPending = false
      showNotice(e instanceof Error ? e.message : String(e))
    } finally {
      loading.value = false
    }
  }

  /** Centre la carte sur la capitale du joueur. */
  function focusOnPlayer(): void {
    const s = snapshot.value
    if (!s) return
    const capital = s.cities.find((c) => c.capital && c.owner === s.playerCountry)
    const at: LonLat = capital
      ? [capital.lon, capital.lat]
      : lonLat(playerCountry.value?.label ?? [0, 30])
    focus.value = { at, zoom: s.scenarioId === 'world-2026' ? 4.3 : 5, nonce: Date.now() }
  }

  function playableCountries(
    scenarioId: string,
  ): Promise<Array<{ code: CountryId; name: string; pop: number }>> {
    return sim.playableCountries(scenarioId)
  }

  /** Revient à l'écran de choix (la partie en cours est abandonnée). */
  /** Revient à l'écran de départ ; la partie est d'abord sauvegardée automatiquement. */
  async function quitToMenu(): Promise<void> {
    if (snapshot.value && !snapshot.value.outcome) await saveLocal('auto', true)
    active = false
    void sim.quit()
    snapshot.value = null
    grid.value = null
    resetUi()
    saves.value = listSaves()
  }

  // ---------- Sélection ----------

  function selectUnit(id: number, additive: boolean): void {
    const u = snapshot.value?.units.find((x) => x.id === id)
    if (!u || u.owner !== snapshot.value?.playerCountry) return
    if (!additive) selection.value = [id]
    else if (selection.value.includes(id)) selection.value = selection.value.filter((x) => x !== id)
    else selection.value = [...selection.value, id]
  }

  /** Sélectionne plusieurs unités à la fois (pile de pions) ; seules celles du joueur sont retenues. */
  function selectUnits(list: number[], additive: boolean): void {
    const s = snapshot.value
    if (!s) return
    const mine = s.units.filter((u) => list.includes(u.id) && u.owner === s.playerCountry)
    const picked = mine.map((u) => u.id)
    selection.value = additive ? [...new Set([...selection.value, ...picked])] : picked
  }

  function clearSelection(): void {
    selection.value = []
  }

  function selectArmy(id: number | null): void {
    selectedArmyId.value = id
    const army = armies.value.find((a) => a.id === id)
    if (army) selection.value = [...army.unitIds]
  }

  function selectCity(name: string | null): void {
    selectedCityName.value = name
    if (name) panelTab.value = 'production'
  }

  function selectCountry(code: CountryId | null, openPanel = true): void {
    selectedCountryCode.value = code
    if (code && openPanel) panelTab.value = 'country'
  }

  // ---------- Clics sur la carte ----------

  function cancelMode(): void {
    mode.value = { kind: 'select' }
    lasso.value = false
  }

  function startOrder(order: Exclude<PlayerOrder, 'hold'>): void {
    if (selection.value.length > 0) mode.value = { kind: 'order', order }
  }

  function startFront(armyId: number): void {
    mode.value = { kind: 'front', armyId, first: null }
  }

  /** Planification d'une offensive : avec `withSelection`, seules les unités choisies de l'armée y vont. */
  function startOffensive(armyId: number, withSelection = false): void {
    const army = armies.value.find((a) => a.id === armyId)
    const unitIds = withSelection
      ? selection.value.filter((id) => army?.unitIds.includes(id))
      : undefined
    mode.value = { kind: 'offensive', armyId, first: null, unitIds }
  }

  /** Ordre visant une unité : poursuite, assaut, encerclement (sélection ou armée). */
  function startTargetOrder(action: TargetAction, armyId?: number): void {
    if (armyId === undefined && selection.value.length === 0) return
    mode.value = { kind: 'target', action, armyId }
  }

  /**
   * Clic sur la carte (et sur les unités touchées, s'il y en a).
   * Renvoie vrai si le clic a été consommé par un mode en cours.
   */
  function mapClick(point: LonLat, units: UnitSnapshot[] = []): boolean {
    const m = mode.value
    if (m.kind === 'target') {
      const enemy = units.find((u) => stances.value.map.get(u.owner) === 'enemy')
      if (!enemy) {
        showNotice('Choisissez une unité ennemie (Échap pour annuler)')
        return true
      }
      void (async () => {
        const error =
          m.action === 'pursue'
            ? await sim.pursueUnit(ids(), enemy.id)
            : m.action === 'assault'
              ? await sim.assaultUnit(ids(), enemy.id)
              : m.armyId !== undefined
                ? await sim.encircleWithArmy(m.armyId, enemy.id)
                : await sim.encircle(ids(), enemy.id)
        report(error)
      })()
      cancelMode()
      return true
    }
    if (m.kind === 'order') {
      void sim.orderUnits(ids(), m.order, point)
      cancelMode()
      return true
    }
    if (m.kind === 'front' || m.kind === 'offensive') {
      if (!m.first) {
        mode.value = { ...m, first: point }
        return true
      }
      if (m.kind === 'front') void sim.setArmyFront(m.armyId, [lonLat(m.first), point])
      else
        void sim.planOffensive(
          m.armyId,
          lonLat(m.first),
          point,
          m.unitIds ? [...m.unitIds] : undefined,
        )
      cancelMode()
      return true
    }
    return false
  }

  /** Clic droit : déplacement direct de la sélection. */
  function quickMove(point: LonLat): void {
    if (selection.value.length > 0) void sim.orderUnits(ids(), 'move', point)
  }

  function setPosture(posture: Posture): void {
    if (selection.value.length > 0) void sim.setPosture(ids(), posture)
  }

  const setArmyPosture = (armyId: number, posture: Posture): Promise<void> =>
    sim.setArmyPosture(armyId, posture)

  function openBattle(ids: number[]): void {
    battleIds.value = [...ids]
  }

  function closeBattle(): void {
    battleIds.value = null
  }

  /** Rapport détaillé de la bataille ouverte (ses unités sont mises à jour d'un appel à l'autre). */
  async function fetchBattle(): Promise<BattleReport | null> {
    const ids = battleIds.value
    if (!ids) return null
    const report = await sim.battleReport([...ids])
    if (report && battleIds.value) battleIds.value = [...report.a, ...report.b].map((u) => u.id)
    return report
  }

  function cancelOrders(): void {
    if (selection.value.length > 0) void sim.cancelOrders(ids())
  }

  function hold(): void {
    if (selection.value.length > 0) void sim.orderUnits(ids(), 'hold')
  }

  // ---------- Économie ----------

  async function queueConstruction(city: string, kind: BuildingKind): Promise<void> {
    report(await sim.queueConstruction(city, kind))
  }

  async function queueRecruit(kind: UnitKind, city: string, armyId: number | null): Promise<void> {
    report(await sim.queueRecruit(kind, city, armyId))
  }

  const cancelConstruction = (id: number): Promise<void> => sim.cancelConstruction(id)
  const cancelRecruit = (id: number): Promise<void> => sim.cancelRecruit(id)
  const setAutoEconomy = (on: boolean): Promise<void> => sim.setAutoEconomy(on)

  // ---------- Diplomatie ----------

  async function declareWar(target: CountryId): Promise<void> {
    report(await sim.declareWar(target))
  }

  async function proposePeace(warId: number, kind: PeaceKind): Promise<void> {
    report(await sim.proposePeace(warId, kind), 'Paix acceptée')
  }

  const answerOffer = (id: number, accept: boolean): Promise<void> =>
    sim.answerPeaceOffer(id, accept)

  async function improveRelations(target: CountryId): Promise<void> {
    report(await sim.improveRelations(target), 'Relations améliorées')
  }

  const toggleSanction = (target: CountryId): Promise<void> => sim.toggleSanction(target)

  async function proposeAlliance(target: CountryId): Promise<void> {
    report(await sim.proposeAlliance(target), 'Alliance conclue')
  }

  const leaveAlliance = (id?: string): Promise<void> => sim.leaveAlliance(id)

  async function callAllies(): Promise<void> {
    pushToast(await sim.callAllies())
  }

  // ---------- Aide étrangère ----------

  async function requestAid(donor: CountryId): Promise<void> {
    report(await sim.requestAid(donor))
  }

  async function grantAid(recipient: CountryId, level: AidLevel): Promise<void> {
    report(await sim.grantAid(recipient, level))
  }

  const setAidLevel = (id: number, level: AidLevel): Promise<void> => sim.setAidLevel(id, level)
  const revokeAid = (id: number): Promise<void> => sim.revokeAid(id)

  async function answerAidRequest(id: number, accept: boolean, level: AidLevel = 1): Promise<void> {
    report(await sim.answerAidRequest(id, accept, level))
  }

  async function mobilize(): Promise<void> {
    report(await sim.mobilize(), 'Forces mobilisées')
  }

  // ---------- Armées ----------

  async function createArmyFromSelection(name: string): Promise<void> {
    if (selection.value.length === 0) return
    selectedArmyId.value = (await sim.createArmy(name, ids())) ?? null
  }

  function addSelectionToArmy(armyId: number): Promise<void> {
    return sim.addUnitsToArmy(armyId, ids())
  }

  const disbandArmy = (id: number): Promise<void> => sim.disbandArmy(id)
  const endEncirclement = (id: number): Promise<void> => sim.endEncirclement(id)
  const setWholeFront = (id: number): Promise<void> => sim.setArmyFront(id, 'whole')
  const clearFront = (id: number): Promise<void> => sim.setArmyFront(id, null)
  const launchOffensive = (id: number): Promise<void> => sim.launchOffensive(id)
  const cancelOffensive = (id: number): Promise<void> => sim.cancelOffensive(id)

  // ---------- Temps et fichiers ----------

  function togglePause(): Promise<void> {
    return sim.setPaused(!paused.value)
  }

  function setSpeed(value: number): Promise<void> {
    if (!isSpeed(value)) return Promise.resolve()
    return sim.setSpeed(value)
  }

  function step(ticks: number): Promise<void> {
    return sim.step(ticks)
  }

  /** Sauvegarde dans le navigateur (`quiet` : sans message de réussite, pour l'automatique). */
  async function saveLocal(slot: SaveSlot = 'manual', quiet = false): Promise<void> {
    const s = snapshot.value
    if (!s || saving) return
    saving = true
    try {
      const text = await sim.save()
      const error = await writeSave(slot, text, {
        scenarioId: s.scenarioId,
        playerCountry: s.playerCountry,
        countryName: playerCountry.value?.name ?? s.playerCountry,
        dateLabel: dateLabel.value,
      })
      if (error) showNotice(error)
      else if (!quiet) pushToast('Partie sauvegardée dans le navigateur', 'success')
      saves.value = listSaves()
    } finally {
      saving = false
    }
  }

  async function loadLocal(slot: SaveSlot): Promise<void> {
    const text = await readSave(slot)
    if (!text) {
      showNotice('Sauvegarde introuvable ou abîmée')
      saves.value = listSaves()
      return
    }
    await loadText(text)
  }

  function removeSave(slot: SaveSlot): void {
    deleteSave(slot)
    saves.value = listSaves()
  }

  /** Exporte la partie dans un fichier (à garder ou à transférer sur un autre appareil). */
  async function exportToFile(): Promise<void> {
    const text = await sim.save()
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nkg-conflict-${snapshot.value?.playerCountry ?? ''}-${snapshot.value?.tick ?? 0}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function loadFromFile(file: File): Promise<void> {
    return file.text().then(loadText)
  }

  async function loadText(text: string): Promise<void> {
    loading.value = true
    try {
      resetUi()
      focusPending = true
      active = true
      await sim.load(text)
    } catch (e) {
      focusPending = false
      showNotice(e instanceof Error ? e.message : String(e))
    } finally {
      loading.value = false
    }
  }

  return {
    snapshot,
    grid,
    gridTick,
    takePendingCells,
    scenarios,
    loading,
    started,
    focus,
    selection,
    selectedUnits,
    armies,
    selectedArmy,
    selectedArmyId,
    mode,
    modeHint,
    panelTab,
    drawer,
    drawerHeight,
    lasso,
    notice,
    toasts,
    dismissToast,
    economy,
    selectedCity,
    selectedCountry,
    selectedCountryCode,
    countryByCode,
    politicsByCode,
    playerPolitics,
    stances,
    hostilePairs,
    offers,
    aids,
    aidRequests,
    paused,
    speed,
    dateLabel,
    playerCountry,
    newGame,
    playableCountries,
    quitToMenu,
    selectUnit,
    selectUnits,
    terrainNameAt,
    ownerAt,
    clearSelection,
    selectArmy,
    selectCity,
    selectCountry,
    cancelMode,
    startOrder,
    startFront,
    startOffensive,
    startTargetOrder,
    mapClick,
    quickMove,
    hold,
    cancelOrders,
    battleIds,
    openBattle,
    closeBattle,
    fetchBattle,
    setPosture,
    setArmyPosture,
    queueConstruction,
    queueRecruit,
    cancelConstruction,
    cancelRecruit,
    setAutoEconomy,
    declareWar,
    proposePeace,
    answerOffer,
    improveRelations,
    toggleSanction,
    proposeAlliance,
    leaveAlliance,
    callAllies,
    mobilize,
    requestAid,
    grantAid,
    setAidLevel,
    revokeAid,
    answerAidRequest,
    createArmyFromSelection,
    addSelectionToArmy,
    disbandArmy,
    endEncirclement,
    setWholeFront,
    clearFront,
    launchOffensive,
    cancelOffensive,
    togglePause,
    setSpeed,
    step,
    saveLocal,
    loadLocal,
    removeSave,
    saves,
    exportToFile,
    loadFromFile,
  }
})
