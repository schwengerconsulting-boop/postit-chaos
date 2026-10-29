import { Drawing, DrawingKind } from "../../../common/src/domain"
import { MAX_DRAWING_POINTS, PointEm, drawingPointsEm, isValidDrawing, newDrawing } from "../../../common/src/drawing"
import { toHex } from "./colors"
import { ApiBody, ApiError, ORIGIN_X_EM, ORIGIN_Y_EM, SCALE } from "./convert"

/** Zeichnungen per API: Freihand ("drawings") sowie Linie und Pfeil ("connectors"). Punkte in API-Pixeln, Ursprung in der Boardmitte. */

const bad = (msg: string) => new ApiError(400, "invalidParameter", msg)
const MAX_ABS_PX = 1_000_000
export const DEFAULT_STROKE_COLOR = "#1a1a1a"
export const DEFAULT_STROKE_WIDTH = 4

type Pt = { x: number; y: number }

function toNumber(v: unknown, name: string): number {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
    if (typeof n !== "number" || !Number.isFinite(n)) throw bad(`${name}: number expected`)
    return n
}

function readPoint(p: any, name: string): Pt {
    if (!p || typeof p !== "object") throw bad(`${name}: object with x and y expected`)
    const x = toNumber(p.x, `${name}.x`)
    const y = toNumber(p.y, `${name}.y`)
    if (Math.abs(x) > MAX_ABS_PX || Math.abs(y) > MAX_ABS_PX) throw bad(`${name}: coordinate outside the allowed range`)
    return { x, y }
}

const pxToEm = (p: Pt): PointEm => ({ x: ORIGIN_X_EM + p.x / SCALE, y: ORIGIN_Y_EM + p.y / SCALE })

function readStyle(style: Record<string, any>, fallback: { color: string; strokeWidth: number }) {
    const raw = style.strokeColor ?? style.color
    let color = fallback.color
    if (raw !== undefined) {
        const c = toHex(raw)
        if (!c) throw bad(`style.strokeColor: unknown color ${raw}`)
        color = c
    }
    let strokeWidth = fallback.strokeWidth
    if (style.strokeWidth !== undefined) {
        strokeWidth = toNumber(style.strokeWidth, "style.strokeWidth")
        if (strokeWidth <= 0 || strokeWidth > 64) throw bad("style.strokeWidth: greater than 0 and at most 64")
    }
    return { color, strokeWidth }
}

function readPenPoints(data: Record<string, any>): Pt[] | undefined {
    if (data.points === undefined) return undefined
    if (!Array.isArray(data.points)) throw bad("data.points: list expected")
    if (data.points.length > MAX_DRAWING_POINTS) {
        throw bad(`data.points: at most ${MAX_DRAWING_POINTS} points`)
    }
    if (data.points.length < 2) throw bad("data.points: at least 2 points")
    return data.points.map((p: any, i: number) => readPoint(p, `data.points[${i}]`))
}

function readEnds(body: Record<string, any>): { start?: Pt; end?: Pt } {
    return {
        start: body.startItem?.position !== undefined ? readPoint(body.startItem.position, "startItem.position") : undefined,
        end: body.endItem?.position !== undefined ? readPoint(body.endItem.position, "endItem.position") : undefined,
    }
}

function readConnectorKind(body: ApiBody, fallback: DrawingKind | undefined): DrawingKind {
    const data = body.data ?? {}
    const style = body.style ?? {}
    const s = data.shape ?? data.kind
    if (s !== undefined) {
        if (s !== "line" && s !== "arrow") throw bad("data.shape: line or arrow")
        return s
    }
    if (style.endStrokeCap !== undefined) return style.endStrokeCap === "none" ? "line" : "arrow"
    return fallback === "line" || fallback === "arrow" ? fallback : "line"
}

function finish(d: Drawing): Drawing {
    d.createdBy = "api"
    if (!isValidDrawing(d)) throw bad("Invalid drawing")
    return d
}

/** POST /drawings (Freihand) bzw. /connectors (Linie, Pfeil). */
export function buildDrawingItem(api: "drawing" | "connector", body: ApiBody): Drawing {
    const b = body as Record<string, any>
    if (body.parent !== undefined && body.parent !== null) throw bad("Drawings cannot have a parent")
    const { color, strokeWidth } = readStyle(body.style ?? {}, { color: DEFAULT_STROKE_COLOR, strokeWidth: DEFAULT_STROKE_WIDTH })
    if (api === "drawing") {
        const pts = readPenPoints(body.data ?? {})
        if (!pts) throw bad("data.points missing")
        return finish(newDrawing("pen", pts.map(pxToEm), color, strokeWidth))
    }
    const { start, end } = readEnds(b)
    if (!start) throw bad("startItem.position missing")
    if (!end) throw bad("endItem.position missing")
    return finish(newDrawing(readConnectorKind(body, undefined), [pxToEm(start), pxToEm(end)], color, strokeWidth))
}

/** PATCH auf eine Zeichnung: Farbe, Stärke, Punkte bzw. Start/Ende, Pfeil/Linie, Lage und Größe. */
export function buildDrawingPatch(existing: Drawing, body: ApiBody): Record<string, any> {
    const b = body as Record<string, any>
    if (body.parent !== undefined && body.parent !== null) throw bad("Drawings cannot have a parent")
    const style = body.style ?? {}
    const current = { color: existing.color, strokeWidth: existing.strokeWidth }
    const { color, strokeWidth } = readStyle(style, current)
    const update: Record<string, any> = {}
    if (color !== existing.color) update.color = color
    if (strokeWidth !== existing.strokeWidth) update.strokeWidth = strokeWidth

    const isPen = existing.kind === "pen"
    let kind = existing.kind
    if (!isPen) kind = readConnectorKind(body, existing.kind)
    else if (body.data?.shape !== undefined || style.endStrokeCap !== undefined) throw bad("Freehand has no line/arrow kind")

    const penPts = isPen ? readPenPoints(body.data ?? {}) : undefined
    const { start, end } = isPen ? {} : readEnds(b)
    if (isPen && (b.startItem !== undefined || b.endItem !== undefined)) throw bad("startItem/endItem only for line and arrow")
    if (!isPen && body.data?.points !== undefined) throw bad("data.points only for freehand")

    const pointsGiven = !!penPts || !!start || !!end
    if (pointsGiven) {
        if (body.position !== undefined || body.geometry !== undefined) {
            throw bad("do not change position/geometry together with points")
        }
        let em: PointEm[]
        if (penPts) em = penPts.map(pxToEm)
        else {
            const cur = drawingPointsEm(existing)
            em = [start ? pxToEm(start) : cur[0], end ? pxToEm(end) : cur[cur.length - 1]]
        }
        const fresh = finish(newDrawing(kind, em, color, strokeWidth, existing.id))
        return { ...update, kind, points: fresh.points, x: fresh.x, y: fresh.y, width: fresh.width, height: fresh.height }
    }
    if (kind !== existing.kind) update.kind = kind

    // Lage/Größe: Mittelpunkt (API-Pixel) und Breite/Höhe; die Punkte sind normalisiert und wandern mit.
    const geometry = body.geometry ?? {}
    const w = geometry.width !== undefined ? toNumber(geometry.width, "geometry.width") / SCALE : existing.width
    const h = geometry.height !== undefined ? toNumber(geometry.height, "geometry.height") / SCALE : existing.height
    if (w <= 0 || h <= 0) throw bad("geometry: width and height must be greater than 0")
    const cur = { cx: (existing.x + existing.width / 2 - ORIGIN_X_EM) * SCALE, cy: (existing.y + existing.height / 2 - ORIGIN_Y_EM) * SCALE }
    const p = body.position === undefined || body.position === null ? {} : (body.position as Record<string, any>)
    const cx = p.x !== undefined ? toNumber(p.x, "position.x") : cur.cx
    const cy = p.y !== undefined ? toNumber(p.y, "position.y") : cur.cy
    if (Math.abs(cx) > MAX_ABS_PX || Math.abs(cy) > MAX_ABS_PX) throw bad("position: coordinate outside the allowed range")
    const x = ORIGIN_X_EM + cx / SCALE - w / 2
    const y = ORIGIN_Y_EM + cy / SCALE - h / 2
    if (w !== existing.width) update.width = w
    if (h !== existing.height) update.height = h
    if (x !== existing.x) update.x = x
    if (y !== existing.y) update.y = y
    return update
}
