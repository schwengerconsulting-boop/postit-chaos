import * as Y from "yjs"
import { getBoard } from "../board-state"
import { dispatchApiEvent } from "./dispatch"

const DEBOUNCE_MS = 1500

/**
 * Text-Änderungen im Browser laufen nur über das Yjs-Dokument und berühren das Item nicht. Damit `modifiedAt`
 * trotzdem stimmt (Gästekommentare zurücklesen), wird pro geändertem Item gebündelt ein leeres item.update
 * abgesetzt, das der Reducer mit dem Zeitstempel versieht. Änderungen mit Origin "api" werden ignoriert.
 */
const tracked = new WeakSet<Y.Doc>()

export function trackTextActivity(boardId: string, doc: Y.Doc) {
    if (tracked.has(doc)) return // bindState wird upstream doppelt aufgerufen
    tracked.add(doc)
    const timers = new Map<string, NodeJS.Timeout>()
    doc.on("afterTransaction", (tx: Y.Transaction) => {
        if (tx.origin === "api" || tx.changed.size === 0) return
        const ids = new Set<string>()
        for (const type of tx.changed.keys()) {
            for (const [key, shared] of doc.share) {
                if (shared !== type) continue
                const m = /^items\.(.+)\.text$/.exec(key)
                if (m) ids.add(m[1])
            }
        }
        for (const id of ids) {
            if (timers.has(id)) continue
            timers.set(
                id,
                setTimeout(async () => {
                    timers.delete(id)
                    try {
                        const board = await getBoard(boardId)
                        if (board && board.board.items[id]) {
                            dispatchApiEvent(board, { action: "item.update", boardId, items: [{ id }] })
                        }
                    } catch (e) {
                        console.error("text-activity", e)
                    }
                }, DEBOUNCE_MS),
            )
        }
    })
}
