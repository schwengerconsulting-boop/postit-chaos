import { augmentItemsWithCRDT } from "../../../common/src/board-crdt-helper"
import { BoardHistoryEntry, Id, newISOTimeStamp } from "../../../common/src/domain"
import { DEFAULT_LANGUAGE, Lang, MessageKey, translate } from "../../../common/src/i18n"
import { getBoard, maybeGetBoard, updateBoards } from "../board-state"
import { renameBoardConvenienceColumnOnly } from "../board-store"
import { yWebSocketServer } from "../board-yjs-server"
import { inTransaction, withDBClient } from "../db"
import { broadcastBoardEvent } from "../websocket-sessions"
import { getAllShareTokens } from "./share-tokens"
import { renderPreviewSvg } from "./vorschau"

export type BoardOverviewRow = {
    id: string
    name: string
    createdAt: Date
    modifiedAt: Date
    archived: boolean
    adminLastOpened: Date | null
}

export async function listBoardRows(filter?: { archived?: boolean }): Promise<BoardOverviewRow[]> {
    const where = filter?.archived === undefined ? "" : filter.archived ? " AND b.archived" : " AND NOT b.archived"
    const r = await withDBClient((c) =>
        c.query(
            `SELECT b.id, b.name, b.created_at, b.archived, b.admin_last_opened,
                    (SELECT max(e.saved_at) FROM board_event e WHERE e.board_id = b.id) AS modified_at
               FROM board b WHERE b.id <> 'default'${where}
              ORDER BY b.created_at DESC NULLS LAST, b.id`,
        ),
    )
    return r.rows.map(toRow)
}

export async function getBoardRow(id: string): Promise<BoardOverviewRow | null> {
    const r = await withDBClient((c) =>
        c.query(
            `SELECT b.id, b.name, b.created_at, b.archived, b.admin_last_opened,
                    (SELECT max(e.saved_at) FROM board_event e WHERE e.board_id = b.id) AS modified_at
               FROM board b WHERE b.id = $1`,
            [id],
        ),
    )
    return r.rows[0] ? toRow(r.rows[0]) : null
}

function toRow(r: any): BoardOverviewRow {
    const createdAt: Date = r.created_at ?? new Date(0)
    return {
        id: r.id,
        name: r.name,
        createdAt,
        modifiedAt: r.modified_at ?? createdAt,
        archived: !!r.archived,
        adminLastOpened: r.admin_last_opened ?? null,
    }
}

// ---------- Archiv, Umbenennen, Besuchszeitpunkt ----------
export async function setArchived(id: Id, archived: boolean): Promise<boolean> {
    const r = await inTransaction((c) => c.query("UPDATE board SET archived=$1 WHERE id=$2 AND id <> 'default'", [archived, id]))
    return (r.rowCount ?? 0) > 0
}

export async function renameBoard(id: Id, name: string): Promise<boolean> {
    const state = await getBoard(id)
    if (!state) return false
    await renameBoardConvenienceColumnOnly(id, name)
    const entry: BoardHistoryEntry = {
        action: "board.rename",
        boardId: id,
        name,
        user: { userType: "system", nickname: "Admin" },
        timestamp: newISOTimeStamp(),
    }
    const serial = updateBoards(state, entry)
    broadcastBoardEvent({ ...entry, serial })
    return true
}

/** Merkt sich, wann der Admin das Board zuletzt geöffnet bzw. verlassen hat. */
export async function touchAdminVisit(id: Id): Promise<void> {
    await inTransaction((c) => c.query("UPDATE board SET admin_last_opened = now() WHERE id=$1", [id]))
}

// ---------- Vorschau und Gästekommentare ----------
type Snapshot = { key: string; svg: string; customerTimes: number[]; empty: boolean }
const cache = new Map<Id, Snapshot>()

async function buildSnapshot(id: Id, prefix: string): Promise<{ svg: string; customerTimes: number[]; empty: boolean } | null> {
    const state = await getBoard(id)
    if (!state) return null
    let items: any[] = Object.values(state.board.items)
    try {
        // Text steht bei CRDT-Boards im Yjs-Dokument; Boards ohne CRDT haben ihn am Item. Nie lange warten.
        if (state.board.crdt) {
            const doc = await Promise.race([
                yWebSocketServer.docs.getYDocAndWaitForFetch(id),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
            ])
            items = augmentItemsWithCRDT(doc, items as any)
        }
    } catch (e) {
        console.error("preview: text not readable", id, e)
    }
    const customerTimes = items
        .filter((i) => i.createdBy === "customer")
        .map((i) => Date.parse(i.modifiedAt ?? i.createdAt ?? "") || 0)
    return { svg: renderPreviewSvg(items, { idPrefix: prefix }), customerTimes, empty: items.length === 0 }
}

/**
 * Vorschau-SVG und Zeitpunkte der Kunden-Elemente eines Boards. Gecacht je Stand (letzter gespeicherter Zeitpunkt);
 * ein Board mit noch ungespeicherten Änderungen wird immer frisch gelesen.
 */
export async function boardSnapshot(row: BoardOverviewRow, idPrefix = ""): Promise<{ svg: string; customerTimes: number[]; empty: boolean }> {
    const key = `${row.modifiedAt.getTime()}:${idPrefix}`
    const hit = cache.get(row.id)
    const live = maybeGetBoard(row.id)
    const unsaved = !!live && (live.recentEvents.length > 0 || live.recentCrdtUpdate !== null || !!live.currentlyStoring)
    if (hit && hit.key === key && !unsaved) return hit
    const built = await buildSnapshot(row.id, idPrefix)
    const snap: Snapshot = { key, ...(built ?? { svg: renderPreviewSvg([]), customerTimes: [], empty: true }) }
    cache.set(row.id, snap)
    return snap
}

export const idPrefixOf = (id: string) => `b${id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}-`

/** Nur aus dem Cache (kein Laden des Boards): für archivierte Boards. */
export function cachedSnapshot(row: BoardOverviewRow, idPrefix = ""): { svg: string; customerTimes: number[]; empty: boolean } | null {
    const hit = cache.get(row.id)
    return hit && hit.key === `${row.modifiedAt.getTime()}:${idPrefix}` ? hit : null
}

/** Anzahl Kunden-Elemente, die seit dem letzten Admin-Besuch neu oder geändert sind (nie geöffnet: alle). */
export function countNewCustomer(customerTimes: number[], lastOpened: Date | null): number {
    if (!lastOpened) return customerTimes.length
    const t = lastOpened.getTime()
    return customerTimes.filter((x) => x > t).length
}

export async function neueKundenkommentare(row: BoardOverviewRow): Promise<number> {
    return countNewCustomer((await boardSnapshot(row)).customerTimes, row.adminLastOpened)
}

// ---------- Zeitangabe ----------
export function timeAgo(date: Date, now = new Date(), lang: Lang = DEFAULT_LANGUAGE): string {
    const t = (key: MessageKey, n: number) => translate(lang, key, { n })
    const s = Math.max(Math.floor((now.getTime() - date.getTime()) / 1000), 0)
    const unit = (n: number, one: MessageKey, many: MessageKey) => t(n === 1 ? one : many, n)
    if (s < 60) return translate(lang, "time.justNow")
    const m = Math.floor(s / 60)
    if (m < 60) return unit(m, "time.minute", "time.minutes")
    const h = Math.floor(m / 60)
    if (h < 24) return unit(h, "time.hour", "time.hours")
    const d = Math.floor(h / 24)
    if (d < 14) return unit(d, "time.day", "time.days")
    if (d < 60) return unit(Math.floor(d / 7), "time.week", "time.weeks")
    const date_ = date.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    return translate(lang, "time.onDate", { date: date_ })
}


// ---------- Übersicht: alle Kacheln mit einer Abfrage ----------
export type OverviewTile = {
    id: string
    name: string
    shareUrl: string | null
    modifiedAt: number // ms
    modifiedLabel: string
    archived: boolean
    neu: number
    svg: string | null // null = Vorschau noch nicht berechnet (archivierte Boards, wenn nicht angefordert)
    leer: boolean
}

/** Parallel mit begrenzter Breite (der DB-Pool hat 10 Verbindungen; ein Board-Laden braucht mehrere kurz nacheinander). */
export async function mapLimit<T, R>(items: T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let next = 0
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const i = next++
                out[i] = await f(items[i])
            }
        }),
    )
    return out
}

const SNAPSHOT_PARALLEL = 6

/**
 * Alle Daten der Board-Übersicht auf einmal: eine Abfrage für Boards, eine für Gastlinks, die Vorschauen parallel.
 * Archivierte Boards bekommen ihre Vorschau nur mit `withArchived` (sonst höchstens aus dem Cache).
 */
export async function buildOverview(publicBase: string, opts: { withArchived?: boolean; lang?: Lang } = {}): Promise<OverviewTile[]> {
    const [rows, tokens] = await Promise.all([listBoardRows(), getAllShareTokens()])
    const base = publicBase.replace(/\/$/, "")
    const now = new Date()
    return mapLimit(rows, SNAPSHOT_PARALLEL, async (r) => {
        const prefix = idPrefixOf(r.id)
        const snap = r.archived && !opts.withArchived ? cachedSnapshot(r, prefix) : await boardSnapshot(r, prefix)
        const token = tokens.get(r.id)
        return {
            id: r.id,
            name: r.name,
            shareUrl: token ? `${base}/s/${token}` : null,
            modifiedAt: r.modifiedAt.getTime(),
            modifiedLabel: timeAgo(r.modifiedAt, now, opts.lang),
            archived: r.archived,
            neu: snap ? countNewCustomer(snap.customerTimes, r.adminLastOpened) : 0,
            svg: snap ? snap.svg : null,
            leer: snap ? snap.empty : false,
        }
    })
}
