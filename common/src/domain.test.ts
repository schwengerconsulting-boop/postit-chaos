import { describe, expect, it } from "vitest"
import { DEFAULT_NOTE_COLOR } from "./colors"
import { newNote, newSimilarNote, NEW_NOTE_FONT_SIZE, NEW_NOTE_SIZE } from "./domain"

describe("newSimilarNote", () => {
    it("übernimmt nie Größe oder Form des Vorbilds (z. B. importierte Tabellenzelle)", () => {
        const cell = { ...newNote("Zelle", "#0b4d3a", 0, 0, 12, 3, "rect"), flat: true }
        const n = newSimilarNote(cell)
        expect([n.width, n.height, n.shape]).toEqual([NEW_NOTE_SIZE, NEW_NOTE_SIZE, "square"])
        expect(n.fontSize).toBe(NEW_NOTE_FONT_SIZE)
        expect(n.color).toBe(DEFAULT_NOTE_COLOR)
    })
    it("behält die Farbe eines normalen Post-its", () => {
        const sticky = newNote("x", "#ff0000", 0, 0, 9, 9)
        const n = newSimilarNote(sticky)
        expect(n.color).toBe("#ff0000")
        expect(n.width).toBe(NEW_NOTE_SIZE)
    })
})
