import { Drawing, DrawingKind, Id } from "./domain"
import * as uuid from "uuid"

export type PointEm = { x: number; y: number }

/** Rand um die Punkte (em), damit Strichstärke und Pfeilspitze nicht abgeschnitten werden und der Rahmen nie 0 breit ist. */
export const DRAWING_PAD = 0.6
/** Mindestabstand (em) zwischen zwei Punkten nach der Glättung. */
export const SIMPLIFY_TOLERANCE = 0.06
/** Obergrenze für die Zahl der Punkte (Schutz vor riesigen Ereignissen). */
export const MAX_DRAWING_POINTS = 600

export const STROKE_EM = (strokeWidth: number) => strokeWidth / 40

/** Ramer-Douglas-Peucker: entfernt Punkte, die weniger als `tolerance` von der Verbindungslinie abweichen. */
export function simplifyPoints(points: PointEm[], tolerance: number = SIMPLIFY_TOLERANCE): PointEm[] {
    if (points.length <= 2) return points
    const keep = new Array(points.length).fill(false)
    keep[0] = keep[points.length - 1] = true
    const stack: [number, number][] = [[0, points.length - 1]]
    while (stack.length) {
        const [a, b] = stack.pop()!
        let maxDist = 0
        let index = -1
        for (let i = a + 1; i < b; i++) {
            const d = distanceToSegment(points[i], points[a], points[b])
            if (d > maxDist) {
                maxDist = d
                index = i
            }
        }
        if (index !== -1 && maxDist > tolerance) {
            keep[index] = true
            stack.push([a, index], [index, b])
        }
    }
    return points.filter((_, i) => keep[i])
}

function distanceToSegment(p: PointEm, a: PointEm, b: PointEm) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Baut ein Drawing-Item aus Board-Punkten (em). Freihand wird geglättet und auf MAX_DRAWING_POINTS begrenzt. */
export function newDrawing(
    kind: DrawingKind,
    pointsEm: PointEm[],
    color: string,
    strokeWidth: number,
    id: Id = uuid.v4(),
): Drawing {
    let pts = kind === "pen" ? simplifyPoints(pointsEm) : [pointsEm[0], pointsEm[pointsEm.length - 1]]
    let tol = SIMPLIFY_TOLERANCE
    while (pts.length > MAX_DRAWING_POINTS) pts = simplifyPoints(pointsEm, (tol *= 1.5))
    if (pts.length === 1) pts = [pts[0], pts[0]]
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const x = Math.min(...xs) - DRAWING_PAD
    const y = Math.min(...ys) - DRAWING_PAD
    const width = Math.max(...xs) - Math.min(...xs) + 2 * DRAWING_PAD
    const height = Math.max(...ys) - Math.min(...ys) + 2 * DRAWING_PAD
    return {
        id,
        type: "drawing",
        kind,
        points: pts.map((p) => [round(((p.x - x) / width)), round((p.y - y) / height)] as [number, number]),
        color,
        strokeWidth,
        x,
        y,
        width,
        height,
        z: 0,
        locked: false,
    }
}

const round = (n: number) => Math.round(n * 10000) / 10000

/** Punkte des Items in Board-em (absolut). */
export function drawingPointsEm(d: Pick<Drawing, "points" | "x" | "y" | "width" | "height">): PointEm[] {
    return d.points.map(([px, py]) => ({ x: d.x + px * d.width, y: d.y + py * d.height }))
}

/** SVG-Pfad in lokalen em-Koordinaten (0..width, 0..height), Freihand als glatte Kurve durch die Mittelpunkte. */
export function drawingPath(d: Pick<Drawing, "points" | "width" | "height" | "kind">): string {
    const pts = d.points.map(([px, py]) => ({ x: px * d.width, y: py * d.height }))
    if (pts.length === 0) return ""
    const f = (n: number) => Math.round(n * 1000) / 1000
    if (d.kind !== "pen" || pts.length < 3) {
        return pts.map((p, i) => `${i === 0 ? "M" : "L"}${f(p.x)} ${f(p.y)}`).join(" ")
    }
    let path = `M${f(pts[0].x)} ${f(pts[0].y)}`
    for (let i = 1; i < pts.length - 1; i++) {
        const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
        path += ` Q${f(pts[i].x)} ${f(pts[i].y)} ${f(mid.x)} ${f(mid.y)}`
    }
    const last = pts[pts.length - 1]
    return path + ` L${f(last.x)} ${f(last.y)}`
}

/** Pfeilspitze (gefülltes Dreieck) am Ende der Linie, in lokalen em. Leer, wenn Start = Ende. */
export function arrowHeadPath(d: Pick<Drawing, "points" | "width" | "height" | "strokeWidth">): string {
    if (d.points.length < 2) return ""
    const last = d.points[d.points.length - 1]
    // Richtung aus einem Punkt, der mindestens 0,3 em vom Ende entfernt ist (bei Freihand-Pfeilen stabiler)
    let from = d.points[d.points.length - 2]
    for (let i = d.points.length - 2; i >= 0; i--) {
        from = d.points[i]
        if (Math.hypot((last[0] - from[0]) * d.width, (last[1] - from[1]) * d.height) >= 0.3) break
    }
    const tx = last[0] * d.width
    const ty = last[1] * d.height
    const dx = tx - from[0] * d.width
    const dy = ty - from[1] * d.height
    const len = Math.hypot(dx, dy)
    if (len === 0) return ""
    const ux = dx / len
    const uy = dy / len
    const size = Math.max(0.45, STROKE_EM(d.strokeWidth) * 3.5)
    const half = size * 0.45
    const bx = tx - ux * size
    const by = ty - uy * size
    const f = (n: number) => Math.round(n * 1000) / 1000
    return `M${f(tx)} ${f(ty)} L${f(bx - uy * half)} ${f(by + ux * half)} L${f(bx + uy * half)} ${f(by - ux * half)} Z`
}

/** Prüft ein vom Netz kommendes Drawing (Kunde/API) auf Form und Größe. */
export function isValidDrawing(u: any): boolean {
    return (
        !!u &&
        u.type === "drawing" &&
        ["pen", "line", "arrow"].includes(u.kind) &&
        Array.isArray(u.points) &&
        u.points.length >= 2 &&
        u.points.length <= MAX_DRAWING_POINTS * 2 &&
        u.points.every((p: any) => Array.isArray(p) && p.length === 2 && p.every((n: any) => Number.isFinite(n))) &&
        typeof u.color === "string" &&
        /^#[0-9a-fA-F]{3,8}$/.test(u.color) &&
        Number.isFinite(u.strokeWidth) &&
        u.strokeWidth > 0 &&
        u.strokeWidth <= 64
    )
}

/**
 * Prüft einen Live-Zwischenstand und gibt nur die bekannten Felder zurück (nichts Fremdes wird an andere Teilnehmer
 * weitergereicht). null = ungültig. Es gilt dieselbe Prüfung wie für fertige Zeichnungen.
 */
export function sanitizeLiveDrawing(u: any): Drawing | null {
    if (!isValidDrawing(u)) return null
    if (typeof u.id !== "string" || u.id.length < 1 || u.id.length > 64) return null
    if (![u.x, u.y, u.width, u.height].every(Number.isFinite)) return null
    if (u.width < 0 || u.height < 0 || u.width > 10000 || u.height > 10000) return null
    return {
        id: u.id,
        type: "drawing",
        kind: u.kind,
        points: u.points.map((p: [number, number]) => [p[0], p[1]] as [number, number]),
        color: u.color,
        strokeWidth: u.strokeWidth,
        x: u.x,
        y: u.y,
        width: u.width,
        height: u.height,
        z: 0,
        locked: false,
    }
}
