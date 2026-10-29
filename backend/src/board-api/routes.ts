import { DRAWING_API_TYPES } from "../board-items/drawing-api"
import { buildDrawingItem, buildDrawingPatch } from "./drawing-build"
import Busboy from "busboy"
import crypto from "crypto"
import express, { NextFunction, Request, Response } from "express"
import {
    Board,
    CrdtEnabled,
    Id,
    Item,
    PersistableBoardItemEvent,
    isContainer,
    isTextItem,
    newBoard,
} from "../../../common/src/domain"
import { augmentItemsWithCRDT, getCRDTField } from "../../../common/src/board-crdt-helper"
import { ServerSideBoardState, addBoard, getBoard } from "../board-state"
import { yWebSocketServer } from "../board-yjs-server"
import { withDBClient } from "../db"
import {
    ApiError,
    KIND_BY_PATH,
    ApiBody,
    ItemKind,
    buildItem,
    buildPatch,
    itemToApi,
    kindOfItem,
    isCrdtTextItem,
} from "./convert"
import { dispatchApiEvent } from "./dispatch"
import { storeImage } from "./images"
import { Delta } from "./richtext"
import { ensureShareToken, getShareToken, revokeShareToken, rotateShareToken } from "../zugang/share-tokens"
import { publicUrl } from "../zugang/settings"
import { BoardOverviewRow, getBoardRow, listBoardRows, neueKundenkommentare, renameBoard, setArchived } from "../zugang/uebersicht"

const shareLinkFor = (base: string, token: string | null) => (token ? `${base}/s/${token}` : null)

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

// ---------- Hilfen ----------
function tokenOk(provided: string): boolean {
    const expected = process.env.WHITEBOARD_API_TOKEN
    if (!expected) return false // ohne konfigurierten Token ist die API zu
    const a = crypto.createHash("sha256").update(provided).digest()
    const b = crypto.createHash("sha256").update(expected).digest()
    return crypto.timingSafeEqual(a, b)
}

function auth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization ?? ""
    const m = /^Bearer (.+)$/.exec(header)
    if (!m || !tokenOk(m[1])) {
        return sendError(res, new ApiError(401, "unauthorized", "Bearer token missing or invalid"))
    }
    next()
}

function sendError(res: Response, e: unknown) {
    if (e instanceof ApiError) {
        return res.status(e.status).json({ status: e.status, code: e.code, message: e.message, type: "error" })
    }
    console.error("board-api", e)
    return res.status(500).json({ status: 500, code: "internalError", message: "Interner Fehler", type: "error" })
}

const wrap = (f: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => {
    f(req, res).catch((e) => sendError(res, e))
}

function publicBase(_req: Request): string {
    return publicUrl().replace(/\/+$/, "")
}

async function loadBoard(id: string): Promise<ServerSideBoardState> {
    const state = await getBoard(id)
    if (!state) throw new ApiError(404, "boardNotFound", "Board not found")
    return state
}

async function boardMeta(base: string, row: BoardOverviewRow) {
    const token = await getShareToken(row.id)
    return {
        id: row.id,
        type: "board",
        name: row.name,
        viewLink: `${base}/b/${row.id}`,
        shareLink: shareLinkFor(base, token),
        createdAt: row.createdAt.toISOString(),
        modifiedAt: row.modifiedAt.toISOString(),
        archived: row.archived,
        neueKundenkommentare: await neueKundenkommentare(row),
    }
}

async function boardRow(id: string): Promise<BoardOverviewRow> {
    const row = await getBoardRow(id)
    if (!row) throw new ApiError(404, "boardNotFound", "Board not found")
    return row
}

/** Stand der Items inkl. Text aus dem Yjs-Dokument. */
async function itemsWithText(state: ServerSideBoardState) {
    const doc = await yWebSocketServer.docs.getYDocAndWaitForFetch(state.board.id)
    const items = augmentItemsWithCRDT(doc, Object.values(state.board.items))
    return { items, doc }
}

function serialize(state: ServerSideBoardState, item: Item, base: string, createdAt: string) {
    const delta = isCrdtTextItem(item) ? ((item as any).textAsDelta as Delta | undefined) : undefined
    return itemToApi(state.board, item, delta, base, createdAt)
}

async function boardCreatedAt(id: string): Promise<string> {
    return (await boardRow(id)).createdAt.toISOString()
}

/**
 * Führt die Änderung synchron auf dem frisch geladenen Board aus. Der Server entlädt Boards ohne Sitzung nach dem
 * Speichern aus dem Speicher; ein zuvor geholter Zustand wäre dann veraltet und die Änderung ginge verloren.
 */
async function commit(boardId: string, fn: (state: ServerSideBoardState) => void): Promise<ServerSideBoardState> {
    const live = await getBoard(boardId)
    if (!live) throw new ApiError(404, "boardNotFound", "Board not found")
    fn(live)
    return live
}

function applyDelta(doc: any, itemId: string, delta: Delta) {
    doc.transact(() => {
        const text = getCRDTField(doc, itemId, "text")
        if (text.length > 0) text.delete(0, text.length)
        text.applyDelta(delta)
    }, "api")
}

const ITEM_TYPE_NAMES = ["shape", "text", "sticky_note", "frame", "image"]

function parseKindParam(p: string): ItemKind | null {
    if (!(p in KIND_BY_PATH)) throw new ApiError(404, "notFound", "Unknown path")
    return KIND_BY_PATH[p]
}

function findItem(state: ServerSideBoardState, kind: ItemKind | null, id: string): Item {
    const item = state.board.items[id]
    const k = item ? kindOfItem(item) : null
    if (!item || !k || (kind && k !== kind)) throw new ApiError(404, "itemNotFound", "Item not found")
    return item
}

function parseJsonBody(req: Request): ApiBody {
    const b = req.body
    if (b === undefined || b === null || typeof b !== "object" || Array.isArray(b)) {
        throw new ApiError(400, "invalidBody", "JSON object expected")
    }
    return b as ApiBody
}

// ---------- Multipart (Bilder) ----------
type Multipart = { file?: Buffer; data?: any }

function parseMultipart(req: Request): Promise<Multipart> {
    return new Promise((resolve, reject) => {
        const out: Multipart = {}
        let bb: Busboy.Busboy
        try {
            bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_IMAGE_BYTES, files: 2, fields: 10 } })
        } catch {
            return reject(new ApiError(400, "invalidBody", "Invalid multipart body"))
        }
        let tooLarge = false
        bb.on("file", (name, stream) => {
            const chunks: Buffer[] = []
            stream.on("data", (c: Buffer) => chunks.push(c))
            stream.on("limit", () => (tooLarge = true))
            stream.on("end", () => {
                if (name === "resource") out.file = Buffer.concat(chunks)
                else if (name === "data") parseData(Buffer.concat(chunks).toString("utf8"))
            })
        })
        bb.on("field", (name, value) => {
            if (name === "data") parseData(value)
        })
        function parseData(s: string) {
            try {
                out.data = JSON.parse(s)
            } catch {
                reject(new ApiError(400, "invalidBody", "Part 'data' is not valid JSON"))
            }
        }
        bb.on("error", () => reject(new ApiError(400, "invalidBody", "Invalid multipart body")))
        bb.on("close", () => (tooLarge ? reject(new ApiError(413, "tooLarge", "Image too large (max. 25 MB)")) : resolve(out)))
        req.pipe(bb)
    })
}

// ---------- Router ----------
export function boardApiRouter(): express.Router {
    const r = express.Router()
    r.use(auth)
    r.use((req, res, next) => (req.is("multipart/form-data") ? next() : express.json({ limit: "2mb" })(req, res, next)))
    r.use((err: any, req: Request, res: Response, next: NextFunction) => {
        if (err) return sendError(res, new ApiError(400, "invalidBody", "Invalid JSON"))
        next()
    })

    // --- Boards ---
    r.post(
        "/boards",
        wrap(async (req, res) => {
            const name = (req.body as any)?.name
            if (typeof name !== "string" || name.trim() === "") throw new ApiError(400, "invalidParameter", "name missing")
            const board = newBoard(name.trim(), CrdtEnabled) // immer CRDT-Board: Rich Text nur dort möglich
            await addBoard(board, false)
            await ensureShareToken(board.id)
            const row = await boardRow(board.id)
            res.status(201).json(await boardMeta(publicBase(req), row))
        }),
    )

    r.get(
        "/boards",
        wrap(async (req, res) => {
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 50)
            const offset = decodeCursor(req.query.cursor)
            const a = req.query.archived
            const filter = a === undefined ? undefined : { archived: a === "true" || a === "1" }
            const all = await listBoardRows(filter)
            const base = publicBase(req)
            const data = []
            for (const row of all.slice(offset, offset + limit)) data.push(await boardMeta(base, row))
            res.json(page(data, all.length, limit, offset))
        }),
    )

    r.get(
        "/boards/:id",
        wrap(async (req, res) => {
            const row = await boardRow(String(req.params.id))
            res.json(await boardMeta(publicBase(req), row))
        }),
    )

    // Name und Archiv-Flag ändern (Archivieren löscht nichts, "archived": false stellt wieder her).
    r.patch(
        "/boards/:id",
        wrap(async (req, res) => {
            const id = String(req.params.id)
            await boardRow(id)
            const body = parseJsonBody(req) as Record<string, unknown>
            const hasName = body.name !== undefined
            const hasArchived = body.archived !== undefined
            if (!hasName && !hasArchived) throw new ApiError(400, "invalidParameter", "provide name or archived")
            if (hasName && (typeof body.name !== "string" || body.name.trim() === "" || body.name.length > 200)) {
                throw new ApiError(400, "invalidParameter", "name: not empty, at most 200 characters")
            }
            if (hasArchived && typeof body.archived !== "boolean") {
                throw new ApiError(400, "invalidParameter", "archived: true or false")
            }
            if (hasName) await renameBoard(id, (body.name as string).trim())
            if (hasArchived) await setArchived(id, body.archived as boolean)
            res.json(await boardMeta(publicBase(req), await boardRow(id)))
        }),
    )

    r.post(
        "/boards/:id/share/rotate",
        wrap(async (req, res) => {
            const row = await boardRow(String(req.params.id))
            const token = await rotateShareToken(row.id)
            res.json({ shareLink: shareLinkFor(publicBase(req), token) })
        }),
    )
    r.post(
        "/boards/:id/share/revoke",
        wrap(async (req, res) => {
            const row = await boardRow(String(req.params.id))
            await revokeShareToken(row.id)
            res.json({ shareLink: null })
        }),
    )

    // --- Items anlegen ---
    const createKinds: [string, ItemKind][] = [
        ["shapes", "shape"],
        ["texts", "text"],
        ["sticky_notes", "sticky_note"],
        ["frames", "frame"],
    ]
    for (const [path, kind] of createKinds) {
        r.post(
            `/boards/:id/${path}`,
            wrap(async (req, res) => {
                const state = await loadBoard(String(req.params.id))
                const built = buildItem(state.board, kind, parseJsonBody(req))
                await addItem(state, built.item, built.delta)
                await respondItem(req, res, state, built.item.id, 201)
            }),
        )
    }

    // Zeichnungen: Freihand (drawings) sowie Linie und Pfeil (connectors); gleiche Prüfung wie beim Websocket (isValidDrawing)
    for (const [path, api] of [["drawings", "drawing"], ["connectors", "connector"]] as const) {
        r.post(
            `/boards/:id/${path}`,
            wrap(async (req, res) => {
                const state = await loadBoard(String(req.params.id))
                const item = buildDrawingItem(api, parseJsonBody(req))
                await addItem(state, item)
                await respondItem(req, res, state, item.id, 201)
            }),
        )
    }

    r.post(
        "/boards/:id/images",
        wrap(async (req, res) => {
            const state = await loadBoard(String(req.params.id))
            let body: ApiBody
            let file: Buffer
            if (req.is("multipart/form-data")) {
                const mp = await parseMultipart(req)
                if (!mp.file || mp.file.length === 0) throw new ApiError(400, "invalidParameter", "Part 'resource' (file) missing")
                file = mp.file
                // API: im Teil "data" stehen title, position, geometry, parent auf oberster Ebene
                const d = (mp.data ?? {}) as Record<string, any>
                body = { data: d.data ?? { title: d.title }, position: d.position, geometry: d.geometry, parent: d.parent }
            } else {
                const json = parseJsonBody(req)
                if (json.data?.url !== undefined) {
                    throw new ApiError(400, "invalidParameter", "Please upload the image as a file (multipart, part 'resource')")
                }
                throw new ApiError(400, "invalidParameter", "Image missing: send multipart with part 'resource'")
            }
            const info = await storeImage(file)
            const built = buildItem(state.board, "image", body, info)
            await addItem(state, built.item)
            await respondItem(req, res, state, built.item.id, 201)
        }),
    )

    // --- Items lesen ---
    r.get(
        "/boards/:id/items",
        wrap(async (req, res) => {
            const state = await loadBoard(String(req.params.id))
            const types = req.query.type ? String(req.query.type).split(",") : null
            if (types) {
                for (const t of types) {
                    if (![...ITEM_TYPE_NAMES, ...DRAWING_API_TYPES].includes(t)) {
                        throw new ApiError(400, "invalidParameter", `type: unknown value ${t}`)
                    }
                }
            }
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 50)
            const offset = decodeCursor(req.query.cursor)
            const { items } = await itemsWithText(state)
            const created = await boardCreatedAt(state.board.id)
            const base = publicBase(req)
            const all = items
                .map((i) => serialize(state, i, base, created))
                .filter((x): x is Record<string, any> => !!x && (!types || types.includes(x.type)))
            res.json(page(all.slice(offset, offset + limit), all.length, limit, offset))
        }),
    )

    r.get(
        "/boards/:id/:kind/:itemId",
        wrap(async (req, res) => {
            const state = await loadBoard(String(req.params.id))
            const kind = parseKindParam(String(req.params.kind))
            findItem(state, kind, String(req.params.itemId))
            await respondItem(req, res, state, String(req.params.itemId), 200)
        }),
    )

    // --- Ändern ---
    r.patch(
        "/boards/:id/:kind/:itemId",
        wrap(async (req, res) => {
            const state = await loadBoard(String(req.params.id))
            const pathKind = parseKindParam(String(req.params.kind))
            const itemId = String(req.params.itemId)
            const existing = findItem(state, pathKind, itemId)
            const kind = kindOfItem(existing)!
            const body = parseJsonBody(req)
            if (existing.type === "drawing") {
                const update = buildDrawingPatch(existing, body)
                await commit(state.board.id, (live) => {
                    if (!live.board.items[itemId]) throw new ApiError(404, "itemNotFound", "Item not found")
                    if (Object.keys(update).length > 0) {
                        dispatchApiEvent(live, { action: "item.update", boardId: live.board.id, items: [{ id: itemId, ...update }] as any })
                    }
                })
                await respondItem(req, res, state, itemId, 200)
                return
            }
            const patch = buildPatch(state.board, existing, kind, body)
            const doc = patch.delta ? await yWebSocketServer.docs.getYDocAndWaitForFetch(state.board.id) : null
            await commit(state.board.id, (live) => {
                const current = live.board.items[itemId]
                if (!current) throw new ApiError(404, "itemNotFound", "Item not found")
                if (doc && patch.delta) applyDelta(doc, itemId, patch.delta)
                const items: any[] = [{ id: itemId, ...patch.update }]
                if (patch.frameShift) {
                    for (const child of Object.values(live.board.items)) {
                        if (child.containerId === itemId) {
                            items.push({ id: child.id, x: child.x + patch.frameShift.dx, y: child.y + patch.frameShift.dy })
                        }
                    }
                }
                dispatchApiEvent(live, { action: "item.update", boardId: live.board.id, items })
            })
            await respondItem(req, res, state, itemId, 200)
        }),
    )

    // --- Löschen ---
    r.delete(
        "/boards/:id/:kind/:itemId",
        wrap(async (req, res) => {
            const state = await loadBoard(String(req.params.id))
            const kind = parseKindParam(String(req.params.kind))
            const itemId = String(req.params.itemId)
            findItem(state, kind, itemId)
            await commit(state.board.id, (live) =>
                dispatchApiEvent(live, { action: "item.delete", boardId: live.board.id, itemIds: [itemId], connectionIds: [] }),
            )
            res.status(204).end()
        }),
    )

    r.use((req, res) => sendError(res, new ApiError(404, "notFound", "Unknown path")))
    return r
}

// ---------- gemeinsame Schritte ----------
async function addItem(state: ServerSideBoardState, item: Item, delta?: Delta) {
    const doc = delta && isTextItem(item) ? await yWebSocketServer.docs.getYDocAndWaitForFetch(state.board.id) : null
    await commit(state.board.id, (live) => {
        if (doc && delta) applyDelta(doc, item.id, delta)
        const event: PersistableBoardItemEvent = { action: "item.add", boardId: live.board.id, items: [item], connections: [] }
        dispatchApiEvent(live, event)
    })
}

async function respondItem(req: Request, res: Response, state: ServerSideBoardState, id: Id, status: number) {
    const { items } = await itemsWithText(state)
    const item = items.find((i) => i.id === id)
    if (!item) throw new ApiError(404, "itemNotFound", "Item not found")
    const out = serialize(state, item, publicBase(req), await boardCreatedAt(state.board.id))
    if (!out) throw new ApiError(404, "itemNotFound", "Item not found")
    res.status(status).json(out)
}

function decodeCursor(c: unknown): number {
    if (typeof c !== "string" || c === "") return 0
    const n = parseInt(Buffer.from(c, "base64url").toString("utf8").replace(/^o:/, ""), 10)
    if (!isFinite(n) || n < 0) throw new ApiError(400, "invalidParameter", "cursor invalid")
    return n
}

function page<T>(data: T[], total: number, limit: number, offset: number) {
    const next = offset + data.length
    const out: Record<string, any> = { data, total, size: data.length, offset, limit }
    if (next < total) out.cursor = Buffer.from(`o:${next}`).toString("base64url")
    return out
}
