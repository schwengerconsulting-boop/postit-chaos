import type Quill from "quill"
import * as L from "lonna"

import { normalizeLinkUrl } from "../../../common/src/links"
import { type Board, CrdtEnabled, isTextItem } from "../../../common/src/domain"
import type { CRDTStore } from "../store/crdt-store"
import type { Dispatch } from "../store/board-store"
export { normalizeLinkUrl }

/** Offene Quill-Editoren je Item (nur für gemeinsam bearbeitbare Texte) und die zuletzt markierte Stelle. */
const editors = new Map<string, { quill: Quill; lastRange: { index: number; length: number } | null }>()

/** Wandelt ein altes Element ohne gemeinsamen Text (kein Quill-Editor, daher kein Link-Werkzeug) in gemeinsam bearbeitbaren Text um. Gibt false zurück, wenn nichts umzuwandeln ist. */
let itemUpgrader: ((itemId: string) => boolean) | null = null
export function setItemUpgrader(fn: ((itemId: string) => boolean) | null) {
    itemUpgrader = fn
}
/** Element, dessen Editor nach der Umwandlung erscheint und dann den Link-Dialog öffnen soll. */
let pendingLinkItem: string | null = null

export function registerEditor(itemId: string, quill: Quill) {
    const entry = { quill, lastRange: null as { index: number; length: number } | null }
    editors.set(itemId, entry)
    if (pendingLinkItem === itemId) {
        pendingLinkItem = null
        setTimeout(() => openLinkDialog(itemId), 0)
    }
    quill.on("selection-change", (range: any) => {
        if (range) entry.lastRange = { index: range.index, length: range.length }
    })
}
export function unregisterEditor(itemId: string) {
    editors.delete(itemId)
}

export type LinkDialogState = { itemId: string; index: number; length: number; current: string } | null
export const linkDialog = L.atom<LinkDialogState>(null)

/** Öffnet den Link-Dialog für den Text im Item. Ohne Markierung gilt der ganze Text bzw. der Link unter dem Cursor. */
export function openLinkDialog(itemId: string): boolean {
    const entry = editors.get(itemId)
    if (!entry) {
        // Altes Element ohne Editor: erst umwandeln, der Dialog öffnet sich, sobald der Editor da ist
        // pendingLinkItem muss vorher stehen: der Editor kann schon während der Umwandlung erscheinen
        pendingLinkItem = itemId
        if (itemUpgrader?.(itemId)) return true
        pendingLinkItem = null
        return false
    }
    const { quill } = entry
    const total = Math.max(0, quill.getLength() - 1)
    let range = quill.getSelection() ?? entry.lastRange
    if (!range || range.index > total) range = { index: 0, length: total }
    let { index, length } = range
    if (length === 0) {
        // Cursor in einem bestehenden Link: den ganzen Link ändern, sonst den ganzen Text verlinken
        const [leaf] = quill.getLeaf(index)
        const href = (leaf as any)?.parent?.domNode?.href
        if (href) {
            const offsetIndex = index - (leaf as any).offset(quill.scroll)
            index = offsetIndex
            length = (leaf as any).length()
        } else {
            index = 0
            length = total
        }
    }
    if (length === 0) return false
    const current = (quill.getFormat(index, length).link as string) ?? ""
    linkDialog.set({ itemId, index, length, current })
    return true
}

export function applyLink(url: string | null): boolean {
    const d = linkDialog.get()
    if (!d) return false
    const entry = editors.get(d.itemId)
    if (!entry) return false
    if (url === null) {
        entry.quill.formatText(d.index, d.length, "link", false, "user")
    } else {
        const normalized = normalizeLinkUrl(url)
        if (!normalized) return false
        entry.quill.formatText(d.index, d.length, "link", normalized, "user")
    }
    linkDialog.set(null)
    return true
}

/**
 * Altes Element ohne gemeinsamen Text (z. B. aus früherem Import) auf gemeinsam bearbeitbaren Text umstellen,
 * damit der Quill-Editor und damit das Link-Werkzeug dort genauso funktioniert wie bei neuen Elementen.
 * Reihenfolge wichtig: erst den Text ins gemeinsame Dokument schreiben, dann das Element umschalten.
 */
export function upgradeToCollaborativeText(
    itemId: string,
    board: Board,
    crdtStore: Pick<CRDTStore, "getBoardCrdt">,
    dispatch: Dispatch,
    toDelta: (html: string) => { ops?: any[] },
): boolean {
    const item = board.items[itemId]
    if (!item || !isTextItem(item) || item.crdt) return false
    const crdt = crdtStore.getBoardCrdt(board.id)
    const field = crdt.getField(itemId, "text")
    if (field.length === 0) field.applyDelta(toDelta(item.text ?? "").ops ?? [])
    dispatch({ action: "item.update", boardId: board.id, items: [{ id: itemId, crdt: CrdtEnabled }] })
    return true
}
