import type { UnitKind, UnitSnapshot } from '@/sim/core/types'

export const ICON_W = 44
export const ICON_H = 38
const FRAME = { x: 4, y: 3, w: 36, h: 24 }

export interface IconDef {
  id: string
  url: string
  width: number
  height: number
  anchorY: number
}

const cache = new Map<string, IconDef>()
const bucket = (v: number): number => Math.max(0, Math.min(10, Math.round(v * 10)))

/** Symbole OTAN simplifié dans le cadre de l'unité. */
function drawSymbol(ctx: CanvasRenderingContext2D, kind: UnitKind): void {
  const { x, y, w, h } = FRAME
  ctx.strokeStyle = '#fff'
  ctx.fillStyle = '#fff'
  ctx.lineWidth = 2
  const cx = x + w / 2
  const cy = y + h / 2
  const cross = (): void => {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y + h)
    ctx.moveTo(x + w, y)
    ctx.lineTo(x, y + h)
    ctx.stroke()
  }
  const track = (): void => {
    ctx.beginPath()
    ctx.ellipse(cx, cy, w * 0.32, h * 0.26, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  switch (kind) {
    case 'inf':
      cross()
      break
    case 'tank':
      track()
      break
    case 'mech':
      cross()
      track()
      break
    case 'tdf':
      // Défense territoriale : croix d'infanterie en pointillés.
      ctx.setLineDash([3, 2])
      cross()
      ctx.setLineDash([])
      break
    case 'art':
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'log':
      ctx.beginPath()
      ctx.moveTo(x, y + h * 0.7)
      ctx.lineTo(x + w, y + h * 0.7)
      ctx.stroke()
      break
    case 'hq':
      ctx.font = 'bold 11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('QG', cx, cy + 1)
      break
  }
}

/**
 * Icône d'une pile de pions : cadres empilés et nombre d'unités, jauges moyennes.
 * Mêmes conventions que les pions isolés (sélection, ravitaillement, contact).
 */
export function stackIcon(
  units: UnitSnapshot[],
  color: [number, number, number],
  selected: boolean,
): IconDef {
  const n = units.length
  const avg = (f: (u: UnitSnapshot) => number): number =>
    units.reduce((s, u) => s + f(u), 0) / Math.max(1, n)
  const strength = avg((u) => u.strength)
  const org = avg((u) => u.org)
  const unsupplied = units.some((u) => !u.supplied)
  const engaged = units.some((u) => u.engaged)
  const key = [
    'stack',
    color.join(','),
    n,
    bucket(strength),
    bucket(org),
    selected ? 's' : '',
    unsupplied ? 'x' : '',
    engaged ? 'e' : '',
  ].join('|')
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = ICON_W
  canvas.height = ICON_H
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const { x, y, w, h } = FRAME
    // Deux cadres décalés derrière : effet de pile.
    for (const off of [4, 2]) {
      ctx.fillStyle = `rgb(${color.map((c) => Math.round(c * 0.7)).join(',')})`
      ctx.fillRect(x + off, y - off + 2, w - 2, h)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.strokeRect(x + off, y - off + 2, w - 2, h)
    }
    ctx.fillStyle = `rgb(${color.join(',')})`
    ctx.fillRect(x, y + 2, w - 2, h)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`×${n}`, x + (w - 2) / 2, y + 2 + h / 2 + 1)
    ctx.lineWidth = selected ? 3 : 1.5
    ctx.strokeStyle = selected ? '#facc15' : unsupplied ? '#ef4444' : '#fff'
    if (unsupplied && !selected) ctx.setLineDash([4, 3])
    ctx.strokeRect(x, y + 2, w - 2, h)
    ctx.setLineDash([])
    const gauge = (row: number, value: number, fill: string): void => {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(x, row, w - 2, 3)
      ctx.fillStyle = fill
      ctx.fillRect(x, row, ((w - 2) * bucket(value)) / 10, 3)
    }
    gauge(y + h + 4, strength, '#4ade80')
    gauge(y + h + 8, org, '#7dd3fc')
    if (engaged) {
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.arc(x + w - 2, y + 2, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const def: IconDef = {
    id: key,
    url: canvas.toDataURL(),
    width: ICON_W,
    height: ICON_H,
    anchorY: ICON_H / 2,
  }
  cache.set(key, def)
  return def
}

/**
 * Icône d'une unité : cadre aux couleurs du camp, symbole, et deux jauges (effectifs, organisation).
 * Bordure jaune = sélectionnée, bordure rouge = hors ravitaillement, icône pâle = en déroute.
 */
export function unitIcon(
  u: UnitSnapshot,
  color: [number, number, number],
  selected: boolean,
): IconDef {
  const key = [
    u.owner,
    u.kind,
    bucket(u.strength),
    bucket(u.org),
    selected ? 's' : '',
    u.supplied ? '' : 'x',
    u.routed ? 'r' : '',
    u.engaged ? 'e' : '',
  ].join('|')
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = ICON_W
  canvas.height = ICON_H
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const { x, y, w, h } = FRAME
    ctx.globalAlpha = u.routed ? 0.55 : 1
    ctx.fillStyle = `rgb(${color.join(',')})`
    ctx.fillRect(x, y, w, h)
    drawSymbol(ctx, u.kind)
    ctx.lineWidth = selected ? 3 : 1.5
    ctx.strokeStyle = selected ? '#facc15' : u.supplied ? '#fff' : '#ef4444'
    if (!u.supplied && !selected) ctx.setLineDash([4, 3])
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])
    // Jauges : effectifs (vert) et organisation (bleu clair).
    const gauge = (row: number, value: number, fill: string): void => {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(x, row, w, 3)
      ctx.fillStyle = fill
      ctx.fillRect(x, row, (w * bucket(value)) / 10, 3)
    }
    gauge(y + h + 2, u.strength, '#4ade80')
    gauge(y + h + 6, u.org, '#7dd3fc')
    if (u.engaged) {
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.arc(x + w, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const def: IconDef = {
    id: key,
    url: canvas.toDataURL(),
    width: ICON_W,
    height: ICON_H,
    anchorY: ICON_H / 2,
  }
  cache.set(key, def)
  return def
}
