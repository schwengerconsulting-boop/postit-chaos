import { AppEvent } from "../../../common/src/domain"
import { getBoard } from "../board-state"
import { CUSTOMER_COLOR, adminNickname, customerNickname } from "./settings"
import { isShareSessionValid, onShareTokenChanged } from "./share-tokens"
import { isValidDrawing, MAX_DRAWING_POINTS, sanitizeLiveDrawing } from "../../../common/src/drawing"
import { mayAccessBoard, WbAuth } from "./auth"

const sockets = new Map<string, { auth: WbAuth; close: () => void }>()

export function registerSocket(socketId: string, auth: WbAuth, close: () => void) {
    sockets.set(socketId, { auth, close })
}
export function unregisterSocket(socketId: string) {
    sockets.delete(socketId)
}
export function getSocketAuth(socketId: string): WbAuth | undefined {
    return sockets.get(socketId)?.auth
}
export function nicknameFor(auth: WbAuth) {
    return auth.role === "admin" ? adminNickname() : customerNickname()
}

// Link rotiert/gesperrt -> offene Kunden-Verbindungen dieses Boards sofort schließen.
onShareTokenChanged((boardId) => {
    for (const { auth, close } of sockets.values()) {
        if (auth.role === "customer" && auth.boardId === boardId) close()
    }
})

// Hash/UUID mit Endung (z. B. 3fa9….png); erstes Zeichen nie ein Punkt (kein "..", keine .part-Tempdateien).
export const ASSET_ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/

export async function canJoin(auth: WbAuth, boardId: string): Promise<boolean> {
    if (!mayAccessBoard(auth, boardId)) return false
    if (auth.role === "customer") return isShareSessionValid(auth.boardId, auth.fp)
    return true
}

export type GuardResult = { event: AppEvent; resync?: boolean } | { drop: true; resync?: boolean }

// Ereignisse, die ein Kunde senden darf. Alles andere wird verworfen (Allowlist).
const CUSTOMER_ACTIONS = new Set([
    "ping",
    "board.join",
    "cursor.move",
    "asset.put.request",
    "item.add",
    "item.update",
    "item.move",
    "item.font.increase",
    "item.font.decrease",
    "item.front",
    "item.delete",
    "item.lock",
    "item.unlock",
    "connection.add",
    "connection.modify",
    "connection.delete",
])
const APPEARANCE_KEYS = ["color", "borderColor", "borderWidth", "textColor", "strokeWidth", "points", "kind"]
// Für den Admin gesperrt: Login-/Nutzerverwaltung von Ourboard gibt es nicht mehr.
// "user.bringAllToMe" (Alle zu mir holen) gibt es nicht mehr: für niemanden.
const ALWAYS_DROPPED = new Set(["user.bringAllToMe", "auth.login.jwt", "auth.logout", "nickname.set", "board.associate", "board.dissociate"])

/**
 * Pflichtprüfung für jedes Ereignis einer Socket-Verbindung. Der Browser wird nie als Grundlage vertraut:
 * Rolle und Board kommen aus der signierten Sitzung, nicht aus dem Ereignis.
 */
export async function guardAppEvent(auth: WbAuth, appEvent: AppEvent): Promise<GuardResult> {
    const e = appEvent as any
    if (ALWAYS_DROPPED.has(e.action)) return { drop: true }
    if (e.action === "asset.put.request" && !ASSET_ID_RE.test(String(e.assetId))) return { drop: true }
    if (e.action === "drawing.live") {
        // Zwischenstand beim Zeichnen: dieselbe Prüfung wie bei fertigen Zeichnungen, für Admin und Kunde.
        // Kunden nur auf ihrem eigenen Board; vorhandene Elemente (auch die vom Admin) lassen sich nicht überlagern.
        if (auth.role === "customer" && e.boardId !== auth.boardId) return { drop: true }
        const item = sanitizeLiveDrawing(e.item)
        if (!item || typeof e.boardId !== "string") return { drop: true }
        const state = await getBoard(e.boardId)
        if (!state || item.id in state.board.items) return { drop: true }
        return { event: { action: "drawing.live", boardId: e.boardId, item } }
    }
    if (auth.role === "admin") {
        if (e.action === "item.add" && Array.isArray(e.items)) {
            return { event: { ...e, items: e.items.map((i: any) => ({ ...i, createdBy: "admin" })) } }
        }
        return { event: appEvent }
    }

    // Kunde
    if (!CUSTOMER_ACTIONS.has(e.action)) return { drop: true }
    if ("boardId" in e && e.boardId !== auth.boardId) return { drop: true }
    switch (e.action) {
        case "item.add": {
            const state = await getBoard(auth.boardId)
            if (!state || !Array.isArray(e.items)) return { drop: true }
            // vorhandene Elemente (auch die vom Admin) dürfen nicht per "add" überschrieben werden
            if (e.items.some((i: any) => i.id in state.board.items)) return { drop: true, resync: true }
            if (e.items.some((i: any) => i.type === "drawing" && !isValidDrawing(i))) return { drop: true, resync: true }
            // Die gewählte Farbe bleibt. Nur wenn ein Post-it ganz ohne Farbe kommt, gilt die Kundenfarbe.
            const items = e.items.map((i: any) => ({
                ...i,
                createdBy: "customer",
                ...(i.type === "note" && !i.color ? { color: CUSTOMER_COLOR } : {}),
            }))
            return { event: { ...e, items } }
        }
        case "item.update": {
            if (!Array.isArray(e.items)) return { drop: true }
            const state = await getBoard(auth.boardId)
            if (!state) return { drop: true }
            let changed = false
            const items = e.items.map((i: any) => {
                const { createdBy, ...rest } = i
                if (createdBy !== undefined) changed = true
                // Erscheinungsbild fremder Elemente (vom Admin/API) bleibt unverändert, eigene dürfen umgefärbt werden.
                if (state.board.items[i.id]?.createdBy !== "customer") {
                    for (const k of APPEARANCE_KEYS) {
                        if (k in rest) {
                            delete rest[k]
                            changed = true
                        }
                    }
                }
                if ("points" in rest) {
                    const p = rest.points
                    const ok =
                        Array.isArray(p) &&
                        p.length >= 2 &&
                        p.length <= MAX_DRAWING_POINTS * 2 &&
                        p.every((q: any) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite))
                    if (!ok) {
                        delete rest.points
                        changed = true
                    }
                }
                return rest
            })
            return { event: { ...e, items }, resync: changed }
        }
        case "item.delete": {
            // Kunden dürfen nur ihre eigenen Elemente löschen, nicht die vom Admin.
            const state = await getBoard(auth.boardId)
            if (!state || !Array.isArray(e.itemIds)) return { drop: true }
            const allOwn = e.itemIds.every((id: string) => state.board.items[id]?.createdBy === "customer")
            return allOwn ? { event: appEvent } : { drop: true, resync: true }
        }
    }
    return { event: appEvent }
}

export { CUSTOMER_COLOR }
