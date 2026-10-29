/**
 * Regression: Texte von API-Elementen müssen im ersten Yjs-Sync eines neuen Clients stehen
 * (Gastlink, Client schickt SyncStep1 sofort nach dem Öffnen, wie y-websocket), auch nach "Neustart"
 * (Dokument und Board aus dem Speicher entladen).
 *   DATABASE_URL=postgres://localhost:5432/board_textfix_test TEST_TARGET=integration npx vitest --run text-erster-sync
 */
import fs from "fs"
import os from "os"
import path from "path"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import WebSocket from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { awaitSavingChanges } from "../../backend/src/board-state"
import { yWebSocketServer } from "../../backend/src/board-yjs-server"
import { initDB } from "../../backend/src/db"
import { startExpressServer } from "../../backend/src/express-server"
import { getCRDTField } from "../../common/src/board-crdt-helper"

const TOKEN = "test-token-" + Math.random().toString(36).slice(2)
const PORT = 1398
const BASE = `http://127.0.0.1:${PORT}`
let stop: (() => void) | undefined

async function api(method: string, p: string, body?: any) {
    const r = await fetch(BASE + "/v2" + p, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: r.status, json: await r.json() }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Öffnet das Board wie ein Kunde: Sitzung per Link, board.join, dann Yjs-Socket mit sofortigem SyncStep1. */
async function openAsCustomer(boardId: string, shareLink: string) {
    const token = shareLink.split("/s/")[1]
    const r = await fetch(`${BASE}/s/${token}`, { redirect: "manual" })
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]
    const main = new WebSocket(`ws://127.0.0.1:${PORT}/socket/board/${boardId}`, { headers: { cookie } })
    await new Promise((res) => main.on("open", res))
    let joined = false
    let sessionId = ""
    main.on("message", (d) => {
        const m = /"action":"board.join.ack"[^}]*"sessionId":"([^"]+)"/.exec(d.toString()) ?? /"sessionId":"([^"]+)"[^}]*"action":"board.join.ack"/.exec(d.toString())
        if (m) sessionId = m[1]
        joined ||= d.toString().includes("board.init")
    })
    main.send(JSON.stringify({ events: [{ action: "board.join", boardId }] }))
    for (let i = 0; i < 200 && !joined; i++) await sleep(25)
    expect(joined).toBe(true)
    for (let i = 0; i < 200 && !sessionId; i++) await sleep(25)
    expect(sessionId).not.toBe("") // das Frontend setzt daraus das Cookie sessionId für den Yjs-Socket

    const doc = new Y.Doc()
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/socket/yjs/board/${boardId}`, { headers: { cookie: `${cookie}; sessionId=${sessionId}` } })
    ws.binaryType = "arraybuffer"
    ws.on("message", (data: ArrayBuffer) => {
        const dec = decoding.createDecoder(new Uint8Array(data))
        if (decoding.readVarUint(dec) !== 0) return // nur Sync-Nachrichten
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, 0)
        syncProtocol.readSyncMessage(dec, enc, doc, "server")
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
    })
    // wie y-websocket: SyncStep1 im open-Handler, ohne zu warten
    ws.on("open", () => {
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, 0)
        syncProtocol.writeSyncStep1(enc, doc)
        ws.send(encoding.toUint8Array(enc))
    })
    return { doc, close: () => (ws.close(), main.close()) }
}

async function textsWithin(doc: Y.Doc, ids: string[], ms: number): Promise<number> {
    const t = Date.now()
    while (Date.now() - t < ms) {
        if (ids.every((id) => getCRDTField(doc, id, "text").length > 0)) return Date.now() - t
        await sleep(25)
    }
    return -1
}

async function fillBoard() {
    const b = (await api("POST", "/boards", { name: "Textfix" })).json
    const ids: string[] = []
    ids.push((await api("POST", `/boards/${b.id}/sticky_notes`, { data: { content: "<p>Notiz</p>" }, geometry: { width: 200 }, position: { x: 0, y: 0 } })).json.id)
    ids.push((await api("POST", `/boards/${b.id}/shapes`, { data: { shape: "rectangle", content: "<p>Form</p>" }, geometry: { width: 200, height: 100 }, position: { x: 300, y: 0 } })).json.id)
    ids.push((await api("POST", `/boards/${b.id}/texts`, { data: { content: "<p>Text</p>" }, geometry: { width: 200 }, position: { x: 600, y: 0 } })).json.id)
    return { b, ids }
}

beforeAll(async () => {
    process.env.WHITEBOARD_API_TOKEN = TOKEN
    process.env.ASSETS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wb-assets-"))
    process.env.PUBLIC_URL = BASE
    process.env.WHITEBOARD_SESSION_SECRET ??= "integrationstest-geheimnis-mindestens-32-zeichen"
    await initDB("./backend")
    stop = startExpressServer(PORT)
    await sleep(300)
}, 60000)
afterAll(() => stop?.())

describe("Texte von API-Elementen im ersten Yjs-Sync", () => {
    it("Kunde öffnet direkt nach dem Befüllen: Texte stehen im ersten Sync (Dokument noch im Speicher)", async () => {
        const { b, ids } = await fillBoard()
        const c = await openAsCustomer(b.id, b.shareLink)
        const ms = await textsWithin(c.doc, ids, 3000)
        c.close()
        expect(ms).toBeGreaterThanOrEqual(0)
        expect(getCRDTField(c.doc, ids[0], "text").toString()).toContain("Notiz")
    }, 20000)

    it("nach Entladen von Dokument und Board (Neustart): Texte kommen aus der DB im ersten Sync", async () => {
        const { b, ids } = await fillBoard()
        await sleep(1500)
        await awaitSavingChanges()
        await awaitSavingChanges()
        const doc = await yWebSocketServer.docs.getYDocAndWaitForFetch(b.id)
        yWebSocketServer.docs.deleteYDoc(doc) // wie Neustart: Speicher leer, nur Postgres bleibt
        const c = await openAsCustomer(b.id, b.shareLink)
        const ms = await textsWithin(c.doc, ids, 3000)
        c.close()
        expect(ms).toBeGreaterThanOrEqual(0)
        expect(getCRDTField(c.doc, ids[2], "text").toString()).toContain("Text")
    }, 30000)
})
