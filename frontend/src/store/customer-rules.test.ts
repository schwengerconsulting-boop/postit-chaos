import { describe, expect, it } from "vitest"
import { CUSTOMER_COLOR } from "../../../common/src/colors"
import { applyCustomerRules } from "./customer-rules"

describe("Kundenregeln im Frontend", () => {
    it("neue Elemente: createdBy=customer, gewählte Farbe bleibt, Post-it ohne Farbe bekommt die Kundenfarbe", () => {
        const e: any = applyCustomerRules({
            action: "item.add",
            boardId: "b",
            connections: [],
            items: [
                { id: "n", type: "note", color: "#f00" },
                { id: "n2", type: "note" },
                { id: "t", type: "text", color: "none" },
                { id: "d", type: "drawing", color: "#E53935" },
            ],
        } as any)
        expect(e.items[0]).toMatchObject({ color: "#f00", createdBy: "customer" })
        expect(e.items[1]).toMatchObject({ color: CUSTOMER_COLOR, createdBy: "customer" })
        expect(e.items[2]).toMatchObject({ color: "none", createdBy: "customer" })
        expect(e.items[3]).toMatchObject({ color: "#E53935", createdBy: "customer" })
    })
    it("Updates: createdBy wird entfernt, Farbe und Text bleiben", () => {
        const e: any = applyCustomerRules({
            action: "item.update",
            boardId: "b",
            items: [{ id: "n", color: "#0f0", createdBy: "admin", text: "x" }],
        } as any)
        expect(e.items[0]).toEqual({ id: "n", color: "#0f0", text: "x" })
    })
})
