import { h } from "harmaja"
import * as L from "lonna"
import { CrdtEnabled, Board, Drawing, Item, newNote, Note } from "../../../common/src/domain"
import { newDrawing, PointEm } from "../../../common/src/drawing"
import { Dispatch } from "../store/board-store"
import { BoardCoordinateHelper } from "./board-coordinates"
import { BoardFocus } from "./board-focus"
import { DrawingSvg, DRAWING_Z } from "./DrawingView"
import { DrawStyle, isDrawTool, Tool, ToolController } from "./tool-selection"
import { emptySet } from "../../../common/src/sets"
import * as uuid from "uuid"

/** Mindestabstand (ms) zwischen zwei Live-Zwischenständen, die andere Teilnehmer während des Zeichnens sehen. */
export const LIVE_SEND_INTERVAL_MS = 50

const MIN_LINE_EM = 0.3
const DEFAULT_SHAPE_EM = { width: 6, height: 4 }

/** Neues Rechteck bzw. neue Ellipse: Rahmen in Strichfarbe/-stärke, Füllung (standardmäßig durchsichtig). */
export function newShape(tool: "rect" | "ellipse", style: DrawStyle, x: number, y: number, w: number, h: number, crdt: Board["crdt"]): Note {
    const n = newNote("", style.fill, x, y, w, h, tool === "rect" ? "rect" : "round")
    return {
        ...n,
        flat: true,
        fontSize: 0.5,
        borderColor: style.stroke,
        borderWidth: style.width,
        align: "MC",
        crdt,
    }
}

/**
 * Fängt Zeigerereignisse über dem Board ab, solange ein Zeichenwerkzeug aktiv ist, und legt beim Loslassen das
 * Element an. Liegt als Geschwister neben dem Board, damit das Ziehen nicht als Board-Verschieben zählt.
 */
export const DrawLayer = ({
    board,
    toolController,
    coordinateHelper,
    dispatch,
    focus,
}: {
    board: L.Property<Board>
    toolController: ToolController
    coordinateHelper: BoardCoordinateHelper
    dispatch: Dispatch
    focus: L.Atom<BoardFocus>
}) => {
    const tool = toolController.tool
    const active = L.view(tool, isDrawTool)
    const points = L.atom<PointEm[]>([])
    const drawing = L.atom<{ tool: Tool; id: string } | null>(null)
    let lastLiveSent = 0

    const toBoard = (e: PointerEvent): PointEm => coordinateHelper.pageToBoardCoordinates({ x: e.pageX, y: e.pageY })

    function preview(): Drawing | null {
        const d = drawing.get()
        const pts = points.get()
        if (!d || pts.length < 2 || !["pen", "line", "arrow"].includes(d.tool)) return null
        const s = toolController.drawStyle.get()
        return newDrawing(d.tool as any, pts, s.stroke, s.width, "preview")
    }
    const previewDrawing = L.view(points, drawing, () => preview())

    const rectOf = (pts: PointEm[]) => {
        const a = pts[0]
        const b = pts[pts.length - 1]
        return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
    }
    const previewShape = L.view(points, drawing, (pts, d) => {
        if (!d || (d.tool !== "rect" && d.tool !== "ellipse") || pts.length < 2) return null
        return { ...rectOf(pts), tool: d.tool }
    })

    function onPointerDown(e: PointerEvent) {
        if (e.button !== 0) return
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        focus.set({ status: "none" })
        drawing.set({ tool: tool.get(), id: uuid.v4() })
        lastLiveSent = 0
        points.set([toBoard(e)])
    }
    function onPointerMove(e: PointerEvent) {
        if (!drawing.get()) return
        const p = toBoard(e)
        const t = drawing.get()!.tool
        points.modify((pts) => {
            const last = pts[pts.length - 1]
            if (t === "pen") {
                return Math.hypot(p.x - last.x, p.y - last.y) < 0.03 ? pts : [...pts, p]
            }
            return [pts[0], p]
        })
        sendLive()
    }
    /** Schickt den aktuellen Strich gedrosselt als flüchtigen Zwischenstand (wird nicht gespeichert). */
    function sendLive() {
        const d = drawing.get()
        const pts = points.get()
        if (!d || pts.length < 2 || !["pen", "line", "arrow"].includes(d.tool)) return
        const now = Date.now()
        if (now - lastLiveSent < LIVE_SEND_INTERVAL_MS) return
        lastLiveSent = now
        const s = toolController.drawStyle.get()
        dispatch({ action: "drawing.live", boardId: board.get().id, item: newDrawing(d.tool as any, pts, s.stroke, s.width, d.id) })
    }
    function onPointerUp(e: PointerEvent) {
        const d = drawing.get()
        if (!d) return
        const t = d.tool
        const pts = [...points.get(), toBoard(e)]
        const id = d.id
        drawing.set(null)
        points.set([])
        const b = board.get()
        const style = toolController.drawStyle.get()
        let item: Item | null = null
        if (t === "pen") {
            item = newDrawing("pen", pts.length < 2 ? [pts[0], pts[0]] : pts, style.stroke, style.width, id)
        } else if (t === "line" || t === "arrow") {
            const a = pts[0]
            const z = pts[pts.length - 1]
            if (Math.hypot(a.x - z.x, a.y - z.y) >= MIN_LINE_EM) item = newDrawing(t, [a, z], style.stroke, style.width, id)
        } else if (t === "rect" || t === "ellipse") {
            let r = rectOf([pts[0], pts[pts.length - 1]])
            if (r.width < 0.5 && r.height < 0.5) {
                r = { x: pts[0].x - DEFAULT_SHAPE_EM.width / 2, y: pts[0].y - DEFAULT_SHAPE_EM.height / 2, ...DEFAULT_SHAPE_EM }
            }
            item = newShape(t, style, r.x, r.y, Math.max(r.width, 0.5), Math.max(r.height, 0.5), b.crdt ? CrdtEnabled : undefined)
        }
        if (!item) return
        dispatch({ action: "item.add", boardId: b.id, items: [item], connections: [] })
        if (t !== "pen") {
            toolController.useDefaultTool()
            focus.set({ status: "selected", itemIds: new Set([item.id]), connectionIds: emptySet() })
        }
    }

    return L.view(active, (a) =>
        a ? (
            <div
                className={L.view(tool, (t) => "draw-layer " + t)}
                data-testid="draw-layer"
                onPointerDown={onPointerDown as any}
                onPointerMove={onPointerMove as any}
                onPointerUp={onPointerUp as any}
                onPointerCancel={onPointerUp as any}
            >
                {L.view(previewDrawing, (d) =>
                    d ? (
                        <span className="drawing preview" style={{ position: "absolute", left: 0, top: 0, transform: `translate(${d.x}em, ${d.y}em)`, zIndex: DRAWING_Z }}>
                            <DrawingSvg drawing={L.constant(d)} />
                        </span>
                    ) : null,
                )}
                {L.view(previewShape, toolController.drawStyle, (s, st) =>
                    s ? (
                        <span
                            className={"shape-preview " + s.tool}
                            style={{
                                left: s.x + "em",
                                top: s.y + "em",
                                width: s.width + "em",
                                height: s.height + "em",
                                border: `max(1px, ${st.width / 40}em) solid ${st.stroke}`,
                                background: st.fill,
                                borderRadius: s.tool === "ellipse" ? "50%" : undefined,
                            }}
                        />
                    ) : null,
                )}
            </div>
        ) : null,
    )
}
