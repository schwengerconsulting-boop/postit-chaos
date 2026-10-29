// Reine Unit-Tests (ohne Datenbank): Vorschau-SVG, Zeitangabe, Zähler, entfernte Aktion.
import { describe, expect, it } from "vitest"
import { countNewCustomer, mapLimit, timeAgo } from "./uebersicht"
import { renderPreviewSvg } from "./vorschau"
import { guardAppEvent } from "./ws-guard"

const note = (id: string, extra: any = {}) => ({
    id,
    type: "note",
    x: 0,
    y: 0,
    width: 5,
    height: 5,
    z: 1,
    locked: false,
    text: "Hallo Welt",
    color: "#FBFC86",
    shape: "square",
    ...extra,
})

describe("Vorschau-SVG", () => {
    it("leeres Board: leeres SVG, kein Fehler", () => {
        const svg = renderPreviewSvg([])
        expect(svg).toContain("<svg")
        expect(svg).toContain("vorschau-leer")
    })
    it("zeichnet Post-it-Farbe, Rahmen, Kundenmarke, Bild und ist deterministisch", () => {
        const items: any[] = [
            { id: "f", type: "container", x: -2, y: -2, width: 20, height: 12, z: 0, locked: false, color: "#ffffff", text: "Plan" },
            note("a", { color: "#8FE3DC", createdBy: "customer", x: 1, y: 1 }),
            note("b", { color: "#FDC4E7", x: 8, y: 1, shape: "round" }),
            { id: "i", type: "image", assetId: "abc123.png", x: 14, y: 1, width: 4, height: 3, z: 2, locked: false },
            { id: "d", type: "drawing", kind: "pen", points: [[0, 0], [1, 1]], color: "#E53935", strokeWidth: 8, x: 1, y: 7, width: 4, height: 2, z: 3, locked: false },
        ]
        const a = renderPreviewSvg(items)
        expect(a).toBe(renderPreviewSvg(items))
        expect(a).toContain('fill="#8FE3DC"')
        expect(a).toContain('fill="#FDC4E7"')
        expect(a).toContain("<ellipse") // runde Form
        expect(a).toContain('href="/assets/abc123.png"')
        expect(a).toContain("<polyline")
        expect(a).toContain('fill="#0f766e"') // Kundenmarke
        expect(a).toContain("<rect") // Textbalken
    })
    it("fremde Inhalte können kein Markup einschleusen (Farbe, Asset-ID)", () => {
        const svg = renderPreviewSvg([
            note("x", { color: '"><script>alert(1)</script>' }),
            { id: "i", type: "image", assetId: '"><script>', x: 8, y: 0, width: 2, height: 2, z: 1, locked: false },
        ] as any)
        expect(svg).not.toContain("<script")
        expect(svg).not.toContain("alert")
    })
    it("versteckte und flächenlose Elemente werden übersprungen", () => {
        const svg = renderPreviewSvg([note("h", { hidden: true, color: "#123456" }), note("z", { width: 0, color: "#654321" })] as any)
        expect(svg).toContain("vorschau-leer")
    })
})

describe("Zähler neue Gästekommentare", () => {
    it("nie geöffnet: alle; sonst nur neuere", () => {
        const t = [1000, 2000, 3000]
        expect(countNewCustomer(t, null)).toBe(3)
        expect(countNewCustomer(t, new Date(2000))).toBe(1)
        expect(countNewCustomer(t, new Date(5000))).toBe(0)
        expect(countNewCustomer([], null)).toBe(0)
    })
})

describe("Zeitangabe", () => {
    const now = new Date("2026-10-14T12:00:00Z")
    const ago = (s: number) => new Date(now.getTime() - s * 1000)
    it("English units (default)", () => {
        expect(timeAgo(ago(10), now)).toBe("just now")
        expect(timeAgo(ago(60), now)).toBe("1 minute ago")
        expect(timeAgo(ago(5 * 60), now)).toBe("5 minutes ago")
        expect(timeAgo(ago(3600), now)).toBe("1 hour ago")
        expect(timeAgo(ago(3 * 3600), now)).toBe("3 hours ago")
        expect(timeAgo(ago(2 * 86400), now)).toBe("2 days ago")
        expect(timeAgo(ago(21 * 86400), now)).toBe("3 weeks ago")
        expect(timeAgo(ago(90 * 86400), now)).toMatch(/^on \d{2}\/\d{2}\/\d{4}$/)
    })
    it("German units", () => {
        expect(timeAgo(ago(10), now, "de")).toBe("gerade eben")
        expect(timeAgo(ago(60), now, "de")).toBe("vor 1 Minute")
        expect(timeAgo(ago(5 * 60), now, "de")).toBe("vor 5 Minuten")
        expect(timeAgo(ago(3600), now, "de")).toBe("vor 1 Stunde")
        expect(timeAgo(ago(3 * 3600), now, "de")).toBe("vor 3 Stunden")
        expect(timeAgo(ago(2 * 86400), now, "de")).toBe("vor 2 Tagen")
        expect(timeAgo(ago(21 * 86400), now, "de")).toBe("vor 3 Wochen")
        expect(timeAgo(ago(90 * 86400), now, "de")).toMatch(/^am \d{2}\.\d{2}\.\d{4}$/)
    })
})

describe("Aktion „Alle zu mir holen“ ist abgeschaltet", () => {
    const ev: any = { action: "user.bringAllToMe", boardId: "b", sessionId: "s", viewRect: { x: 0, y: 0, width: 1, height: 1 }, nickname: "x" }
    it("wird für Kunden und Admin verworfen", async () => {
        expect(await guardAppEvent({ role: "customer", boardId: "b", fp: "f" }, ev)).toEqual({ drop: true })
        expect(await guardAppEvent({ role: "admin" }, ev)).toEqual({ drop: true })
    })
    it("Gegenprobe: ein normales Ereignis (ping) kommt für Admin durch", async () => {
        const r: any = await guardAppEvent({ role: "admin" }, { action: "ping" } as any)
        expect(r.drop).toBeUndefined()
    })
})

describe("mapLimit (Vorschauen parallel, aber begrenzt)", () => {
    it("behält die Reihenfolge und überschreitet die Breite nie", async () => {
        let running = 0
        let peak = 0
        const out = await mapLimit([5, 1, 4, 2, 3, 0, 6, 7], 3, async (n) => {
            running++
            peak = Math.max(peak, running)
            await new Promise((r) => setTimeout(r, n * 3))
            running--
            return n * 10
        })
        expect(out).toEqual([50, 10, 40, 20, 30, 0, 60, 70])
        expect(peak).toBe(3)
    })
    it("leere Liste: leeres Ergebnis", async () => {
        expect(await mapLimit([], 4, async (x) => x)).toEqual([])
    })
})
