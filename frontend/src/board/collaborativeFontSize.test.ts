import { describe, expect, it } from "vitest"
import { largestFittingScale, MIN_NOTE_TEXT_SCALE } from "./collaborativeFontSize"

// Notiztext: Schrift wird nur so weit kleiner, wie nötig ist, damit der Text in die Notiz passt
describe("largestFittingScale", () => {
    it("passt der Text schon, bleibt die eingestellte Größe", () => {
        expect(largestFittingScale(() => true)).toBe(1)
    })

    it("zu viel Text: größter Faktor, der noch passt (nicht pauschal winzig)", () => {
        const scale = largestFittingScale((s) => s <= 0.6)
        expect(scale).toBeLessThanOrEqual(0.6)
        expect(scale).toBeGreaterThan(0.59)
    })

    it("passt gar nichts, bleibt die Mindestgröße lesbar statt 0", () => {
        expect(largestFittingScale(() => false)).toBe(MIN_NOTE_TEXT_SCALE)
    })
})
