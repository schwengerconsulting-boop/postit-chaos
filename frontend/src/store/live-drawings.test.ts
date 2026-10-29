import { describe, expect, it } from "vitest"
import { newDrawing } from "../../../common/src/drawing"
import { applyLiveEvent, LIVE_DRAWING_TTL_MS, pruneLive, visibleLiveDrawings } from "./live-drawings"

const d = (id: string) =>
    newDrawing(
        "pen",
        [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 0 },
        ],
        "#E53935",
        8,
        id,
    )
const ev = (id: string) => ({ action: "drawing.live", boardId: "b", item: d(id) }) as const

describe("Live-Zwischenstände", () => {
    it("neuer Zwischenstand ersetzt den alten derselben Zeichnung", () => {
        let s = applyLiveEvent({}, ev("a"), 0)
        s = applyLiveEvent(s, { ...ev("a"), item: { ...d("a"), color: "#000000" } }, 50)
        expect(Object.keys(s)).toEqual(["a"])
        expect(s.a.item.color).toBe("#000000")
    })
    it("andere Ereignisse ändern nichts", () => {
        const s = {}
        expect(applyLiveEvent(s, { action: "ping" } as any, 0)).toBe(s)
    })
    it("veraltete Zwischenstände (abgebrochener Strich) verschwinden", () => {
        const s = applyLiveEvent({}, ev("a"), 0)
        expect(Object.keys(pruneLive(s, LIVE_DRAWING_TTL_MS - 1))).toEqual(["a"])
        expect(Object.keys(pruneLive(s, LIVE_DRAWING_TTL_MS))).toEqual([])
    })
    it("sobald der Endstand auf dem Board liegt, wird der Zwischenstand nicht mehr gezeigt", () => {
        const s = applyLiveEvent(applyLiveEvent({}, ev("a"), 0), ev("b"), 0)
        expect(visibleLiveDrawings(s, { items: {} }).map((x) => x.id)).toEqual(["a", "b"])
        expect(visibleLiveDrawings(s, { items: { a: d("a") } }).map((x) => x.id)).toEqual(["b"])
    })
})
