import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import { Board, CrdtEnabled, newBoard, newNote } from "../../../common/src/domain"
import { getCRDTField } from "../../../common/src/board-crdt-helper"
import { normalizeLinkUrl } from "../../../common/src/links"
import { linkDialog, openLinkDialog, registerEditor, setItemUpgrader, upgradeToCollaborativeText } from "./link-tools"

describe("Link-Adressen", () => {
    it("http, https und mailto sind erlaubt", () => {
        expect(normalizeLinkUrl("https://example.org/a")).toEqual("https://example.org/a")
        expect(normalizeLinkUrl("example.org")).toEqual("https://example.org/")
        expect(normalizeLinkUrl("mailto:info@example.org")).toEqual("mailto:info@example.org")
        expect(normalizeLinkUrl("info@example.org")).toEqual("mailto:info@example.org")
    })
    it("alles andere wird abgewiesen", () => {
        expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull()
        expect(normalizeLinkUrl("data:text/html,<script>alert(1)</script>")).toBeNull()
        expect(normalizeLinkUrl("vbscript:x")).toBeNull()
        expect(normalizeLinkUrl("tel:+4940123")).toBeNull()
        expect(normalizeLinkUrl("mailto:keine-adresse")).toBeNull()
        expect(normalizeLinkUrl("")).toBeNull()
    })
})

function fakeQuill(length: number) {
    return {
        on: () => {},
        getLength: () => length + 1,
        getSelection: () => null,
        getLeaf: () => [null],
        getFormat: () => ({}),
    } as any
}

describe("Alte Elemente ohne gemeinsamen Text", () => {
    const board: Board = { ...newBoard("t", CrdtEnabled), id: "b1" }
    const oldNote = { ...newNote("alt"), id: "alt", text: "<p>Alter <strong>Kasten</strong></p>" }
    board.items[oldNote.id] = oldNote

    it("werden auf gemeinsamen Text umgestellt, der Text kommt ins gemeinsame Dokument", () => {
        const doc = new Y.Doc()
        const events: any[] = []
        const done = upgradeToCollaborativeText(
            "alt",
            board,
            { getBoardCrdt: () => ({ getField: (id: string, f: string) => getCRDTField(doc, id, f) }) } as any,
            (e) => events.push(e),
            () => ({ ops: [{ insert: "Alter " }, { insert: "Kasten", attributes: { bold: true } }, { insert: "\n" }] }),
        )
        expect(done).toBe(true)
        expect(getCRDTField(doc, "alt", "text").toString()).toEqual("Alter Kasten\n")
        expect(events).toEqual([{ action: "item.update", boardId: "b1", items: [{ id: "alt", crdt: CrdtEnabled }] }])
    })

    it("bereits gemeinsame Elemente bleiben unangetastet", () => {
        const b2 = { ...board, items: { alt: { ...oldNote, crdt: CrdtEnabled } } } as Board
        const events: any[] = []
        expect(
            upgradeToCollaborativeText(
                "alt",
                b2,
                {} as any,
                (e) => events.push(e),
                () => ({}),
            ),
        ).toBe(false)
        expect(events).toEqual([])
    })

    it("Link-Dialog: ohne Editor wird erst umgestellt, der Dialog öffnet sich, sobald der Editor da ist", () => {
        linkDialog.set(null)
        let upgraded = false
        setItemUpgrader((id) => {
            upgraded = true
            // der Editor erscheint schon während der Umwandlung
            registerEditor(id, fakeQuill(12))
            return true
        })
        expect(openLinkDialog("neu-umgestellt")).toBe(true)
        expect(upgraded).toBe(true)
        return new Promise<void>((resolve) =>
            setTimeout(() => {
                expect(linkDialog.get()?.itemId).toEqual("neu-umgestellt")
                setItemUpgrader(null)
                resolve()
            }, 20),
        )
    })

    it("Link-Dialog: nichts umzustellen und kein Editor gibt false", () => {
        setItemUpgrader(() => false)
        expect(openLinkDialog("gibt-es-nicht")).toBe(false)
        setItemUpgrader(null)
    })
})
