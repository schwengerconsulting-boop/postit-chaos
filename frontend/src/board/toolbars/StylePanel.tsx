import { h } from "harmaja"
import * as L from "lonna"
import { DRAW_COLORS, PASTEL_COLORS, STROKE_WIDTHS, TRANSPARENT } from "../../../../common/src/colors"
import { MessageKey, t } from "../../../../common/src/i18n"
import { Board, Item, ItemUpdate, isDrawing, isNote, isText, Note } from "../../../../common/src/domain"
import { Dispatch } from "../../store/board-store"
import { BoardFocus, getSelectedItems } from "../board-focus"
import { DrawStyle, Tool, ToolController } from "../tool-selection"

type Part = "stroke" | "fill" | "width" | "note" | "text"

/** Which settings exist for an item or tool? */
export function partsForItem(i: Item): Part[] {
    if (isDrawing(i)) return i.kind === "pen" || i.kind === "line" || i.kind === "arrow" ? ["stroke", "width"] : []
    if (isNote(i)) return i.flat ? ["stroke", "fill", "width"] : ["note"]
    if (isText(i)) return ["text"]
    return []
}
export function partsForTool(t: Tool): Part[] {
    switch (t) {
        case "pen":
        case "line":
        case "arrow":
            return ["stroke", "width"]
        case "rect":
        case "ellipse":
            return ["stroke", "fill", "width"]
        case "note":
            return ["note"]
        default:
            return []
    }
}

const LABELS: Record<Part, MessageKey> = {
    stroke: "style.stroke",
    fill: "style.fill",
    width: "style.width",
    note: "style.noteColor",
    text: "style.textColor",
}

function updateFor(part: Part, item: Item, value: string | number): ItemUpdate | null {
    switch (part) {
        case "stroke":
            return isDrawing(item) ? { id: item.id, color: value as string } : { id: item.id, borderColor: value as string }
        case "fill":
        case "note":
            return { id: item.id, color: value as string } as ItemUpdate
        case "width":
            return isDrawing(item) ? { id: item.id, strokeWidth: value as number } : { id: item.id, borderWidth: value as number }
        case "text":
            return { id: item.id, textColor: value as string } as ItemUpdate
    }
}

function currentValue(part: Part, item: Item | undefined, style: DrawStyle): string | number {
    if (item) {
        const it = item as any
        switch (part) {
            case "stroke":
                return (isDrawing(item) ? it.color : it.borderColor) ?? style.stroke
            case "fill":
            case "note":
                return it.color
            case "width":
                return (isDrawing(item) ? it.strokeWidth : it.borderWidth) ?? style.width
            case "text":
                return it.textColor ?? "#000000"
        }
    }
    switch (part) {
        case "stroke":
            return style.stroke
        case "fill":
            return style.fill
        case "width":
            return style.width
        case "note":
            return style.noteColor ?? ""
        case "text":
            return "#000000"
    }
}

export const StylePanel = ({
    board,
    focus,
    toolController,
    dispatch,
    isCustomer,
}: {
    board: L.Property<Board>
    focus: L.Atom<BoardFocus>
    toolController: ToolController
    dispatch: Dispatch
    isCustomer: L.Property<boolean>
}) => {
    const tool = toolController.tool
    const style = toolController.drawStyle
    const state = L.view(board, focus, tool, style, isCustomer, (b, f, t, st, customer) => {
        const items = f.status === "adding" || f.status === "connection-adding" ? [] : getSelectedItems(b)(f)
        // Guests may only restyle their own items (the server enforces this as well)
        const editable = items.filter((i) => !customer || i.createdBy === "customer")
        const itemParts = editable.length > 0 ? partsForItem(editable[0]) : []
        const parts = itemParts.length > 0 ? itemParts : partsForTool(t)
        return { parts, items: itemParts.length > 0 ? editable.filter((i) => partsForItem(i).length > 0) : [], st }
    })

    function choose(part: Part, value: string | number) {
        const { items } = state.get()
        toolController.drawStyle.modify((s) => ({
            ...s,
            ...(part === "stroke" ? { stroke: value as string } : {}),
            ...(part === "fill" ? { fill: value as string } : {}),
            ...(part === "width" ? { width: value as number } : {}),
            ...(part === "note" ? { noteColor: value as string } : {}),
        }))
        const updates = items.flatMap((i) => (partsForItem(i).includes(part) ? updateFor(part, i, value) ?? [] : []))
        if (updates.length) dispatch({ action: "item.update", boardId: board.get().id, items: updates })
    }

    const swatches = (part: Part, withTransparent: boolean) => (
        <div className="wb-swatches">
            {withTransparent && (
                <button
                    type="button"
                    className={L.view(state, (s) => `wb-swatch transparent ${isSame(currentValue(part, s.items[0], s.st), TRANSPARENT) ? "active" : ""}`)}
                    title={t("style.noFill")}
                    aria-label={t("style.noFill")}
                    data-testid={`swatch-${part}-none`}
                    onClick={() => choose(part, TRANSPARENT)}
                />
            )}
            {[...DRAW_COLORS, ...PASTEL_COLORS].map((c) => (
                <button
                    type="button"
                    className={L.view(state, (s) => `wb-swatch ${isSame(currentValue(part, s.items[0], s.st), c.color) ? "active" : ""}`)}
                    style={{ background: c.color }}
                    title={t(c.name)}
                    aria-label={`${t(LABELS[part])}: ${t(c.name)}`}
                    data-testid={`swatch-${part}-${c.color.replace("#", "").toLowerCase()}`}
                    onClick={() => choose(part, c.color)}
                />
            ))}
        </div>
    )

    const widths = () => (
        <div className="wb-widths">
            {STROKE_WIDTHS.map((w) => (
                <button
                    type="button"
                    className={L.view(state, (s) => `wb-width ${currentValue("width", s.items[0], s.st) === w.value ? "active" : ""}`)}
                    title={t(w.name)}
                    aria-label={t("style.widthLabel", { name: t(w.name) })}
                    data-testid={`width-${w.value}`}
                    onClick={() => choose("width", w.value)}
                >
                    <span style={{ height: Math.max(2, w.value / 2.5) + "px" }} />
                </button>
            ))}
        </div>
    )

    return L.view(state, (s) =>
        s.parts.length === 0 ? null : (
            <div className="wb-style-panel board-tool" onMouseDown={(e: any) => e.stopPropagation()} onClick={(e: any) => e.stopPropagation()} data-testid="style-panel">
                {s.parts.map((p) => (
                    <div className="wb-style-section">
                        <div className="wb-style-label">{t(LABELS[p])}</div>
                        {p === "width" ? widths() : swatches(p, p === "fill")}
                    </div>
                ))}
            </div>
        ),
    )
}

const isSame = (a: string | number, b: string) => String(a).toLowerCase() === b.toLowerCase()
