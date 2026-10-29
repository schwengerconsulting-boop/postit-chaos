import * as uuid from "uuid"
import {
    Align,
    Board,
    Container,
    CrdtEnabled,
    Image,
    Item,
    Note,
    NoteShape,
    Text,
    TextItem,
    isContainer,
    isTextItem,
} from "../../../common/src/domain"
import { DEFAULT_STICKY_COLOR, hexToStickyName, toHex } from "./colors"
import { drawingApiType, drawingToApi } from "../board-items/drawing-api"
import { Delta, deltaToHtml, deltaToPlain, htmlToDelta, plainToDelta } from "./richtext"

/**
 * Skala: 1 em (Ourboard) = 40 API-Pixel. Eine Haftnotiz mit 200 px Breite ist damit 5 em breit, so groß wie
 * eine im Browser angelegte Haftnotiz (5 x 5 em). Schriftgrößen werden mit derselben Skala umgerechnet
 * (fontSize em = API-Punkte / 40), damit ein mit API-Pixeln gebautes Board proportional gleich aussieht.
 */
export const SCALE = 40
/** API-Ursprung (0,0) liegt auf dem Board bei (50 em, 25 em). Ourboard kennt keine negativen Koordinaten (Ansicht und
 * Zuschnitt beginnen bei 0); Boards haben ihren Ursprung in der Mitte, also Inhalt links/oberhalb von 0. */
export const ORIGIN_X_EM = 50
export const ORIGIN_Y_EM = 25

export type ItemKind = "shape" | "text" | "sticky_note" | "frame" | "image" | "drawing" | "connector"
export const KIND_BY_PATH: Record<string, ItemKind | null> = {
    items: null,
    shapes: "shape",
    texts: "text",
    sticky_notes: "sticky_note",
    frames: "frame",
    images: "image",
    drawings: "drawing",
    connectors: "connector",
}

export class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
        super(message)
    }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
const bad = (msg: string) => new ApiError(400, "invalidParameter", msg)

// ---------- Typen der Anfrage ----------
export type ApiBody = {
    data?: Record<string, any>
    style?: Record<string, any>
    geometry?: Record<string, any>
    position?: Record<string, any> | null
    parent?: { id?: string } | null
}

// ---------- Ausrichtung ----------
const H: Record<string, string> = { left: "L", center: "C", right: "R", justify: "L" }
const V: Record<string, string> = { top: "T", middle: "M", bottom: "B" }
const H_BACK: Record<string, string> = { L: "left", C: "center", R: "right" }
const V_BACK: Record<string, string> = { T: "top", M: "middle", B: "bottom" }

function defaultAlign(kind: ItemKind): Align {
    return (kind === "text" ? "TL" : kind === "frame" ? "TL" : "MC") as Align
}

function computeAlign(style: Record<string, any>, current: Align | undefined, kind: ItemKind): Align | undefined {
    const h = style.textAlign !== undefined ? H[String(style.textAlign)] : undefined
    const v = style.textAlignVertical !== undefined ? V[String(style.textAlignVertical)] : undefined
    if (style.textAlign !== undefined && !h) throw bad(`style.textAlign: invalid value ${style.textAlign}`)
    if (style.textAlignVertical !== undefined && !v)
        throw bad(`style.textAlignVertical: invalid value ${style.textAlignVertical}`)
    if (!h && !v) return undefined
    const base = current ?? defaultAlign(kind)
    return `${v ?? base[0]}${h ?? base[1]}` as Align
}

function num(v: unknown, name: string): number {
    const n = typeof v === "string" ? parseFloat(v) : v
    if (typeof n !== "number" || !isFinite(n)) throw bad(`${name}: number expected`)
    return n
}

// ---------- Form ----------
function shapeToNote(apiShape: unknown): { shape: NoteShape; rounded: boolean } {
    switch (apiShape) {
        case "round_rectangle":
            return { shape: "rect", rounded: true }
        case "circle":
            return { shape: "round", rounded: false }
        case "rhombus":
            return { shape: "diamond", rounded: false }
        default:
            return { shape: "rect", rounded: false } // rectangle und alles Unbekannte
    }
}

function noteToShape(n: Note): string {
    switch (n.shape) {
        case "round":
            return "circle"
        case "diamond":
            return "rhombus"
        default:
            return n.rounded ? "round_rectangle" : "rectangle"
    }
}

// ---------- Text ----------
export function estimateTextHeightPx(plain: string, widthPx: number, fontPx: number): number {
    const charsPerLine = Math.max(1, Math.floor(widthPx / (fontPx * 0.55)))
    const lines = plain.split("\n").reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / charsPerLine)), 0)
    return round3(lines * fontPx * 1.4 + fontPx * 0.4)
}

export type BuiltItem = { item: Item; delta?: Delta }

export function kindOfItem(item: Item): ItemKind | null {
    switch (item.type) {
        case "note":
            return item.flat ? "shape" : "sticky_note"
        case "text":
            return "text"
        case "container":
            return "frame"
        case "image":
            return "image"
        case "drawing":
            return drawingApiType(item)
        default:
            return null
    }
}

function fontEm(style: Record<string, any>): number | undefined {
    if (style.fontSize === undefined) return undefined
    const pt = num(style.fontSize, "style.fontSize")
    if (pt <= 0) throw bad("style.fontSize must be greater than 0")
    return pt / SCALE
}

function applyStyle(item: TextItem, style: Record<string, any>, kind: ItemKind) {
    const fill = style.fillColor !== undefined ? toHex(style.fillColor) : undefined
    if (style.fillColor !== undefined && !fill) throw bad(`style.fillColor: unknown color ${style.fillColor}`)
    if (fill && (item.type === "note" || item.type === "container")) (item as Note | Container).color = fill
    if (fill && item.type === "text") (item as Text).color = fill
    if (style.color !== undefined) {
        const c = toHex(style.color)
        if (!c) throw bad(`style.color: unknown color ${style.color}`)
        item.textColor = c
    }
    if (style.borderColor !== undefined) {
        const c = toHex(style.borderColor)
        if (!c) throw bad(`style.borderColor: unknown color ${style.borderColor}`)
        item.borderColor = c
    }
    if (style.borderWidth !== undefined) item.borderWidth = num(style.borderWidth, "style.borderWidth")
    const fs = fontEm(style)
    if (fs !== undefined) item.fontSize = fs
    const align = computeAlign(style, item.align, kind)
    if (align) item.align = align
}

// ---------- Position / Geometrie ----------
export type Placement = { cx: number; cy: number; parentId?: string }

/** API-Mittelpunkt (px, ggf. relativ zur Frame-Ecke) -> Ourboard linke obere Ecke (em, absolut). */
export function toOurboardXY(
    board: Board,
    cx: number,
    cy: number,
    widthEm: number,
    heightEm: number,
    parentId?: string,
): { x: number; y: number } {
    let ox = ORIGIN_X_EM
    let oy = ORIGIN_Y_EM
    if (parentId) {
        const parent = board.items[parentId]
        if (!parent || !isContainer(parent)) throw bad(`parent.id ${parentId} is not a frame of this board`)
        ox = parent.x
        oy = parent.y
    }
    return { x: ox + cx / SCALE - widthEm / 2, y: oy + cy / SCALE - heightEm / 2 }
}

export function readPosition(body: ApiBody): { cx: number; cy: number } {
    const p = body.position
    if (p === undefined || p === null) return { cx: 0, cy: 0 }
    return {
        cx: p.x === undefined ? 0 : num(p.x, "position.x"),
        cy: p.y === undefined ? 0 : num(p.y, "position.y"),
    }
}

// ---------- Item bauen (POST) ----------
export function buildItem(board: Board, kind: ItemKind, body: ApiBody, imageInfo?: ImageInfo): BuiltItem {
    const data = body.data ?? {}
    const style = body.style ?? {}
    const geometry = body.geometry ?? {}
    const parentId = body.parent?.id
    if (parentId !== undefined && typeof parentId !== "string") throw bad("parent.id must be a string")
    const { cx, cy } = readPosition(body)
    const id = uuid.v4()
    const base = { id, z: 0, locked: false as const, crdt: CrdtEnabled, createdBy: "api" as const }

    if (kind === "image") {
        if (!imageInfo) throw bad("Image missing")
        let wpx = geometry.width !== undefined ? num(geometry.width, "geometry.width") : undefined
        let hpx = geometry.height !== undefined ? num(geometry.height, "geometry.height") : undefined
        if (wpx === undefined && hpx === undefined) wpx = imageInfo.width
        if (wpx === undefined) wpx = hpx! * (imageInfo.width / imageInfo.height)
        if (hpx === undefined) hpx = wpx * (imageInfo.height / imageInfo.width)
        const w = wpx / SCALE
        const h = hpx / SCALE
        const { x, y } = toOurboardXY(board, cx, cy, w, h, parentId)
        const item: Image = {
            id,
            type: "image",
            assetId: imageInfo.assetId,
            src: `/assets/${imageInfo.assetId}`,
            title: typeof data.title === "string" ? data.title : undefined,
            x,
            y,
            width: w,
            height: h,
            z: 0,
            locked: false,
            containerId: parentId,
            createdBy: "api",
        }
        return { item }
    }

    if (kind === "frame") {
        const wpx = num(geometry.width ?? 1000, "geometry.width")
        const hpx = num(geometry.height ?? 1000, "geometry.height")
        const w = wpx / SCALE
        const h = hpx / SCALE
        if (parentId) throw bad("Frames cannot have a parent")
        const { x, y } = toOurboardXY(board, cx, cy, w, h)
        const title = data.title === undefined ? "" : String(data.title)
        const item: Container = {
            ...base,
            type: "container",
            text: "",
            color: "#ffffff",
            fontSize: 0.6,
            x,
            y,
            width: w,
            height: h,
        }
        applyStyle(item, style, kind)
        return { item, delta: plainToDelta(title) }
    }

    // text, shape, sticky_note
    const content = data.content === undefined || data.content === null ? "" : String(data.content)
    const delta = content === "" ? [{ insert: "\n" }] : htmlToDelta(content)
    const plain = deltaToPlain(delta)

    if (kind === "text") {
        const wpx = num(geometry.width ?? 400, "geometry.width")
        const fontPt = style.fontSize !== undefined ? num(style.fontSize, "style.fontSize") : 14
        const hpx =
            geometry.height !== undefined ? num(geometry.height, "geometry.height") : estimateTextHeightPx(plain, wpx, fontPt)
        const w = wpx / SCALE
        const h = hpx / SCALE
        const { x, y } = toOurboardXY(board, cx, cy, w, h, parentId)
        const item: Text = {
            ...base,
            type: "text",
            text: "",
            color: "none",
            fontSize: fontPt / SCALE,
            x,
            y,
            width: w,
            height: h,
            containerId: parentId,
            align: "TL",
        }
        applyStyle(item, style, kind)
        return { item, delta }
    }

    if (kind === "shape") {
        const wpx = num(geometry.width ?? 200, "geometry.width")
        const hpx = num(geometry.height ?? 200, "geometry.height")
        const w = wpx / SCALE
        const h = hpx / SCALE
        const { x, y } = toOurboardXY(board, cx, cy, w, h, parentId)
        const { shape, rounded } = shapeToNote(data.shape)
        const item: Note = {
            ...base,
            type: "note",
            text: "",
            color: "#ffffff",
            shape,
            flat: true,
            rounded: rounded || undefined,
            fontSize: 14 / SCALE,
            x,
            y,
            width: w,
            height: h,
            containerId: parentId,
            align: "MC",
        }
        applyStyle(item, style, kind)
        return { item, delta }
    }

    // sticky_note
    const rect = data.shape === "rectangle"
    const wpx = num(geometry.width ?? 199, "geometry.width")
    const hpx =
        geometry.height !== undefined ? num(geometry.height, "geometry.height") : rect ? round3(wpx * 1.146) : wpx
    const w = wpx / SCALE
    const h = hpx / SCALE
    const { x, y } = toOurboardXY(board, cx, cy, w, h, parentId)
    const item: Note = {
        ...base,
        type: "note",
        text: "",
        color: toHex(DEFAULT_STICKY_COLOR)!,
        shape: rect ? "rect" : "square",
        fontSize: w * 0.1, // 10 % der Breite (optische Wahl, nicht belegt)
        x,
        y,
        width: w,
        height: h,
        containerId: parentId,
        align: "MC",
    }
    applyStyle(item, style, kind)
    return { item, delta }
}

// ---------- Item ändern (PATCH) ----------
export type PatchResult = {
    update: Record<string, any>
    delta?: Delta
    /** Verschiebung in em, wenn ein Frame bewegt wurde (Kinder wandern mit). */
    frameShift?: { dx: number; dy: number }
}

export function buildPatch(board: Board, existing: Item, kind: ItemKind, body: ApiBody): PatchResult {
    const data = body.data
    const style = body.style ?? {}
    const geometry = body.geometry
    const update: Record<string, any> = {}
    const result: PatchResult = { update }
    const scratch: any = { ...existing }

    if (isTextItem(existing)) {
        applyStyle(scratch as TextItem, style, kind)
        for (const key of ["color", "textColor", "borderColor", "borderWidth", "fontSize", "align"] as const) {
            if (JSON.stringify(scratch[key]) !== JSON.stringify((existing as any)[key])) update[key] = scratch[key]
        }
    }
    if (kind === "shape" && data?.shape !== undefined) {
        const { shape, rounded } = shapeToNote(data.shape)
        update.shape = shape
        update.rounded = rounded
    }
    if (kind === "sticky_note" && data?.shape !== undefined) {
        update.shape = data.shape === "rectangle" ? "rect" : "square"
    }
    if (kind === "image" && data?.title !== undefined) update.title = String(data.title)

    // Text/Titel
    if (data && isTextItem(existing)) {
        if (kind === "frame" && data.title !== undefined) result.delta = plainToDelta(String(data.title))
        else if (kind !== "frame" && data.content !== undefined) {
            result.delta = data.content === null || data.content === "" ? [{ insert: "\n" }] : htmlToDelta(String(data.content))
        }
    }

    // Geometrie, Position, Parent
    const prevParentId = existing.containerId
    let parentId: string | undefined = prevParentId
    let parentChanged = false
    if (body.parent !== undefined) {
        const next = body.parent === null ? undefined : body.parent.id
        if (next !== undefined && typeof next !== "string") throw bad("parent.id must be a string")
        if (kind === "frame" && next) throw bad("Frames cannot have a parent")
        parentChanged = next !== prevParentId
        parentId = next
    }
    const oldParent = prevParentId ? board.items[prevParentId] : undefined
    const w = geometry?.width !== undefined ? num(geometry.width, "geometry.width") / SCALE : existing.width
    let h = geometry?.height !== undefined ? num(geometry.height, "geometry.height") / SCALE : existing.height
    if (kind === "text" && geometry?.width !== undefined && geometry.height === undefined && data?.content === undefined) {
        // Breite geändert, Höhe neu schätzen
        const plain = deltaToPlain(htmlToDelta(textOf(existing)))
        h = estimateTextHeightPx(plain, w * SCALE, (((existing as TextItem).fontSize ?? 1) as number) * SCALE) / SCALE
    }
    const geometryChanged = w !== existing.width || h !== existing.height
    if (geometry?.width !== undefined) update.width = w
    if (h !== existing.height) update.height = h

    if (body.position !== undefined || geometryChanged || parentChanged) {
        // aktueller Mittelpunkt (relativ zum bisherigen Parent), falls position nicht angegeben
        let cx: number
        let cy: number
        if (body.position !== undefined && body.position !== null) {
            const p = body.position
            const cur = currentCenter(existing, oldParent)
            cx = p.x !== undefined ? num(p.x, "position.x") : cur.cx
            cy = p.y !== undefined ? num(p.y, "position.y") : cur.cy
        } else if (parentChanged) {
            // Parent gewechselt ohne neue Position: absolute Lage beibehalten
            const abs = { cx: existing.x + existing.width / 2, cy: existing.y + existing.height / 2 }
            const np = parentId ? board.items[parentId] : undefined
            cx = (abs.cx - (np ? np.x : ORIGIN_X_EM)) * SCALE
            cy = (abs.cy - (np ? np.y : ORIGIN_Y_EM)) * SCALE
        } else {
            // nur Größe geändert: Mittelpunkt halten
            const cur = currentCenter(existing, oldParent)
            cx = cur.cx
            cy = cur.cy
        }
        const { x, y } = toOurboardXY(board, cx, cy, w, h, parentId)
        if (x !== existing.x) update.x = x
        if (y !== existing.y) update.y = y
        if (kind === "frame" && (x !== existing.x || y !== existing.y)) {
            result.frameShift = { dx: x - existing.x, dy: y - existing.y }
        }
    }
    if (body.parent !== undefined && parentChanged) update.containerId = parentId ?? null // null statt undefined: überlebt die JSON-Speicherung
    return result
}

function textOf(item: Item): string {
    return isTextItem(item) ? item.text : ""
}

function currentCenter(item: Item, parent: Item | undefined) {
    return {
        cx: (item.x + item.width / 2 - (parent ? parent.x : ORIGIN_X_EM)) * SCALE,
        cy: (item.y + item.height / 2 - (parent ? parent.y : ORIGIN_Y_EM)) * SCALE,
    }
}

// ---------- Item lesen (GET) ----------
export type ImageInfo = { assetId: string; width: number; height: number }

const num1 = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

export function itemToApi(
    board: Board,
    item: Item,
    delta: Delta | undefined,
    publicBase: string,
    boardCreatedAt: string,
): Record<string, any> | null {
    const kind = kindOfItem(item)
    if (!kind) return null
    const parent = item.containerId ? board.items[item.containerId] : undefined
    const cx = round3((item.x + item.width / 2 - (parent ? parent.x : ORIGIN_X_EM)) * SCALE)
    const cy = round3((item.y + item.height / 2 - (parent ? parent.y : ORIGIN_Y_EM)) * SCALE)
    const createdBy = item.createdBy ?? "admin"
    const out: Record<string, any> = {
        id: item.id,
        type: kind,
        position: { x: cx, y: cy, origin: "center", relativeTo: parent ? "parent_top_left" : "canvas_center" },
        geometry: { width: round3(item.width * SCALE), height: round3(item.height * SCALE), rotation: 0 },
        createdAt: item.createdAt ?? boardCreatedAt,
        modifiedAt: item.modifiedAt ?? item.createdAt ?? boardCreatedAt,
        createdBy: { id: createdBy, type: createdBy },
    }
    if (parent) out.parent = { id: parent.id }

    if (item.type === "drawing") {
        const toPx = (xEm: number, yEm: number) => ({
            x: round3((xEm - (parent ? parent.x : ORIGIN_X_EM)) * SCALE),
            y: round3((yEm - (parent ? parent.y : ORIGIN_Y_EM)) * SCALE),
        })
        return { ...out, ...drawingToApi(item, toPx) }
    }

    if (item.type === "image") {
        out.data = { title: item.title ?? "", imageUrl: `${publicBase}/assets/${item.assetId}` }
        return out
    }
    if (!isTextItem(item)) return null

    const tdelta: Delta = delta ?? htmlToDelta(item.text)
    const align = item.align ?? defaultAlign(kind)
    const textAlign = H_BACK[align[1]] ?? "center"
    const textAlignVertical = V_BACK[align[0]] ?? "middle"
    const fontSize = item.fontSize !== undefined ? num1(round3(item.fontSize * SCALE)) : undefined
    const colorOf = (i: TextItem) => ("color" in i ? (i as any).color : undefined)

    switch (kind) {
        case "frame":
            out.data = { title: deltaToPlain(tdelta), format: "custom", type: "freeform" }
            out.style = { fillColor: colorOf(item) ?? "#ffffff" }
            break
        case "text":
            out.data = { content: deltaToHtml(tdelta) }
            out.style = {
                color: item.textColor ?? "#1a1a1a",
                fillColor: colorOf(item) && colorOf(item) !== "none" ? colorOf(item) : "#ffffff",
                fontSize: fontSize ?? "14",
                textAlign,
            }
            break
        case "sticky_note": {
            const n = item as Note
            out.data = { content: deltaToHtml(tdelta), shape: n.shape === "rect" ? "rectangle" : "square" }
            out.style = { fillColor: hexToStickyName(n.color), textAlign, textAlignVertical }
            break
        }
        case "shape": {
            const n = item as Note
            out.data = { content: deltaToHtml(tdelta), shape: noteToShape(n) }
            out.style = {
                fillColor: n.color,
                color: n.textColor ?? "#1a1a1a",
                borderColor: n.borderColor ?? "#1a1a1a",
                borderWidth: num1(n.borderWidth ?? 2),
                fontSize: fontSize ?? "14",
                textAlign,
                textAlignVertical,
            }
            break
        }
    }
    return out
}

export function isCrdtTextItem(item: Item): item is TextItem {
    return isTextItem(item) && !!item.crdt
}
