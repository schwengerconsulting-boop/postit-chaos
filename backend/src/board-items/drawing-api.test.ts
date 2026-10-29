import { describe, expect, it } from "vitest"
import { newDrawing } from "../../../common/src/drawing"
import { drawingApiType, drawingToApi } from "./drawing-api"

const toPx = (x: number, y: number) => ({ x: x * 40, y: y * 40 })

describe("API-Darstellung von Zeichnungen", () => {
    it("Freihand -> drawing mit Punkten, Farbe, Stärke", () => {
        const d = newDrawing("pen", [{ x: 1, y: 1 }, { x: 2, y: 1.5 }, { x: 3, y: 1 }], "#E53935", 8)
        expect(drawingApiType(d)).toBe("drawing")
        const out: any = drawingToApi(d, toPx)
        expect(out.data.kind).toBe("pen")
        expect(out.data.points[0].x).toBeCloseTo(40, 0)
        expect(out.data.points[0].y).toBeCloseTo(40, 0)
        expect(out.style).toMatchObject({ color: "#E53935", strokeWidth: "8" })
    })
    it("Linie/Pfeil -> connector mit Start, Ende und Pfeilspitze", () => {
        const d = newDrawing("arrow", [{ x: 1, y: 1 }, { x: 5, y: 3 }], "#1E88E5", 4)
        expect(drawingApiType(d)).toBe("connector")
        const out: any = drawingToApi(d, toPx)
        expect(out.startItem.position.x).toBeCloseTo(40, 0)
        expect(out.startItem.position.y).toBeCloseTo(40, 0)
        expect(out.endItem.position.x).toBeCloseTo(200, 0)
        expect(out.endItem.position.y).toBeCloseTo(120, 0)
        expect(out.style.endStrokeCap).toBe("stealth")
        const line: any = drawingToApi(newDrawing("line", [{ x: 1, y: 1 }, { x: 5, y: 3 }], "#000000", 4), toPx)
        expect(line.style.endStrokeCap).toBe("none")
    })
})
