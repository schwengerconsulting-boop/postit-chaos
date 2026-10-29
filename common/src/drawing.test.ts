import { describe, expect, it } from "vitest"
import { arrowHeadPath, drawingPath, drawingPointsEm, isValidDrawing, newDrawing, simplifyPoints } from "./drawing"
import { normalizeLinkUrl } from "./links"

describe("Zeichnungen", () => {
    it("Freihand wird geglättet (weniger Punkte) und bleibt an derselben Stelle", () => {
        const raw = Array.from({ length: 200 }, (_, i) => ({ x: 10 + i * 0.05, y: 5 + Math.sin(i / 20) * 0.001 }))
        const d = newDrawing("pen", raw, "#E53935", 8)
        expect(d.points.length).toBeLessThan(10)
        const back = drawingPointsEm(d)
        expect(back[0].x).toBeCloseTo(10, 2)
        expect(back[back.length - 1].x).toBeCloseTo(10 + 199 * 0.05, 2)
        expect(isValidDrawing(d)).toBe(true)
    })
    it("Linie/Pfeil: genau zwei Punkte, Rahmen nie 0 breit (waagerechte Linie)", () => {
        const d = newDrawing("arrow", [{ x: 1, y: 2 }, { x: 9, y: 2 }], "#000000", 4)
        expect(d.points).toHaveLength(2)
        expect(d.height).toBeGreaterThan(0)
        expect(arrowHeadPath(d)).toMatch(/^M/)
        expect(drawingPath(d)).toMatch(/^M.* L/)
    })
    it("Punktreduktion hält die Form: Ecke bleibt erhalten", () => {
        const pts = simplifyPoints([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }])
        expect(pts).toHaveLength(3)
    })
    it("Validierung lehnt ungültige Zeichnungen ab", () => {
        const ok = newDrawing("pen", [{ x: 0, y: 0 }, { x: 1, y: 1 }], "#E53935", 8)
        expect(isValidDrawing({ ...ok, points: "x" })).toBe(false)
        expect(isValidDrawing({ ...ok, points: [[0, 0]] })).toBe(false)
        expect(isValidDrawing({ ...ok, color: "red; x" })).toBe(false)
        expect(isValidDrawing({ ...ok, kind: "kreis" })).toBe(false)
        expect(isValidDrawing({ ...ok, points: [[0, NaN], [1, 1]] })).toBe(false)
    })
})

describe("Links", () => {
    it("nur http/https/mailto, ohne Schema wird https ergänzt", () => {
        expect(normalizeLinkUrl("example.com/a")).toBe("https://example.com/a")
        expect(normalizeLinkUrl("http://example.com")).toBe("http://example.com/")
        expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull()
        expect(normalizeLinkUrl("data:text/html,x")).toBeNull()
        expect(normalizeLinkUrl("mailto:a@b.de")).toBe("mailto:a@b.de")
        expect(normalizeLinkUrl("tel:+49401234")).toBeNull()
        expect(normalizeLinkUrl("  ")).toBeNull()
    })
})
