import { Drawing } from "../../../common/src/domain"
import { drawingPointsEm } from "../../../common/src/drawing"

/** API-Typ eines Zeichen-Items: Freihand = "drawing", Linie/Pfeil = "connector". */
export function drawingApiType(d: Drawing): "drawing" | "connector" {
    return d.kind === "pen" ? "drawing" : "connector"
}

/**
 * GET-Darstellung eines Zeichen-Items. Koordinaten in Board-Pixeln (Mittelpunkt-Ursprung des Boards), wie bei den
 * anderen Elementen; `toPx` rechnet absolute em-Koordinaten um.
 */
export function drawingToApi(d: Drawing, toPx: (xEm: number, yEm: number) => { x: number; y: number }) {
    const pts = drawingPointsEm(d).map((p) => toPx(p.x, p.y))
    const style = { color: d.color, strokeColor: d.color, strokeWidth: String(d.strokeWidth) }
    if (d.kind === "pen") {
        return { data: { kind: "pen", points: pts }, style }
    }
    const first = pts[0]
    const last = pts[pts.length - 1]
    return {
        data: { kind: d.kind, shape: d.kind === "arrow" ? "arrow" : "line" },
        startItem: { position: first },
        endItem: { position: last },
        style: { ...style, endStrokeCap: d.kind === "arrow" ? "stealth" : "none", startStrokeCap: "none" },
    }
}

/** Erlaubte Werte für ?type=. */
export const DRAWING_API_TYPES = ["drawing", "connector"]
