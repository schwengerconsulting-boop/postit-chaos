import { describe, expect, it } from "vitest"
import { BoardFocus } from "./board-focus"
import { isBoardDragBlockedByEditing, isItemDragEnabled, isItemTouchDragEnabled } from "./item-drag-rules"

const selected: BoardFocus = { status: "selected", itemIds: new Set(["a"]), connectionIds: new Set() }
const editing: BoardFocus = { status: "editing", itemId: "a" }
const none: BoardFocus = { status: "none" }

describe("Element verschieben per Maus-Ziehen", () => {
    it("ausgewähltes Element lässt sich ziehen", () => {
        expect(isItemDragEnabled(selected, "a", true)).toBe(true)
    })
    it("im Textbearbeitungsmodus gehört Ziehen dem Text, nicht dem Element", () => {
        expect(isItemDragEnabled(editing, "a", true)).toBe(false)
        expect(isItemDragEnabled(editing, "a", false)).toBe(false)
    })
    it("anderes Element im Bearbeitungsmodus bleibt unberührt, nicht ausgewähltes nur bei Behältern", () => {
        expect(isItemDragEnabled(editing, "b", false)).toBe(true)
        expect(isItemDragEnabled(editing, "b", true)).toBe(false)
        expect(isItemDragEnabled(none, "a", true)).toBe(false)
        expect(isItemDragEnabled(none, "a", false)).toBe(true)
    })
    it("Ecken zum Vergrößern greifen auch im Textbearbeitungsmodus", () => {
        expect(isItemDragEnabled(editing, "a", false, true)).toBe(true)
    })
    it("Touch bleibt unverändert: auch im Bearbeitungsmodus verschiebbar", () => {
        expect(isItemTouchDragEnabled(editing, "a", true)).toBe(true)
        expect(isItemTouchDragEnabled(none, "a", true)).toBe(false)
    })
})

describe("Board-Drag im Bearbeitungsmodus", () => {
    it("blockiert, wenn der Mausdruck im bearbeiteten Element lag (auch am Rand)", () => {
        expect(isBoardDragBlockedByEditing(editing, "a")).toBe(true)
    })
    it("erlaubt außerhalb des Elements, bei anderem Element und ohne Bearbeitung", () => {
        expect(isBoardDragBlockedByEditing(editing, null)).toBe(false)
        expect(isBoardDragBlockedByEditing(editing, "b")).toBe(false)
        expect(isBoardDragBlockedByEditing(selected, "a")).toBe(false)
    })
})
