/**
 * Integrationstests der Board-API (REST API v2) gegen eine echte lokale Postgres-DB.
 * Aufruf (im Projektordner):
 *   DATABASE_URL=postgres://postitchaos@127.0.0.1:5432/postitchaos TEST_TARGET=integration npx vitest --run board-api
 */
import fs from "fs"
import os from "os"
import path from "path"
import zlib from "zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { awaitSavingChanges, getBoard, updateBoards } from "../../backend/src/board-state"
import { fetchBoard } from "../../backend/src/board-store"
import { yWebSocketServer } from "../../backend/src/board-yjs-server"
import { closeConnectionPool, initDB } from "../../backend/src/db"
import { startExpressServer } from "../../backend/src/express-server"
import { getCRDTField } from "../../common/src/board-crdt-helper"
import { newISOTimeStamp } from "../../common/src/domain"
import { signSession } from "../../backend/src/zugang/cookie-session"
import { ORIGIN_X_EM, ORIGIN_Y_EM } from "../../backend/src/board-api/convert"
import { deltaToHtml, htmlToDelta } from "../../backend/src/board-api/richtext"

const TOKEN = "test-token-" + Math.random().toString(36).slice(2)
const PORT = 1399
const BASE = `http://127.0.0.1:${PORT}`
const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-assets-"))
let stop: (() => void) | undefined

async function api(method: string, p: string, body?: any, opts: { token?: string | null; raw?: BodyInit } = {}) {
    const headers: Record<string, string> = {}
    const token = opts.token === undefined ? TOKEN : opts.token
    if (token) headers.Authorization = `Bearer ${token}`
    let payload: BodyInit | undefined = opts.raw
    if (body !== undefined) {
        headers["Content-Type"] = "application/json"
        payload = JSON.stringify(body)
    }
    const r = await fetch(BASE + "/v2" + p, { method, headers, body: payload })
    const text = await r.text()
    return { status: r.status, json: text ? JSON.parse(text) : null }
}

function png(width: number, height: number): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const td = Buffer.concat([Buffer.from(type, "latin1"), data])
        const crc = Buffer.alloc(4)
        crc.writeUInt32BE(zlib.crc32(td) >>> 0)
        return Buffer.concat([len, td, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)])
    const raw = Buffer.concat(Array.from({ length: height }, () => row))
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ])
}

async function newTestBoard(name = "Testboard") {
    const r = await api("POST", "/boards", { name })
    expect(r.status).toBe(201)
    return r.json as { id: string; viewLink: string; shareLink: string }
}

beforeAll(async () => {
    process.env.WHITEBOARD_API_TOKEN = TOKEN
    process.env.ASSETS_DIR = assetsDir
    process.env.PUBLIC_URL = BASE
    process.env.WHITEBOARD_SESSION_SECRET ??= "integrationstest-geheimnis-mindestens-32-zeichen"
    await initDB("./backend")
    stop = startExpressServer(PORT)
    await new Promise((r) => setTimeout(r, 300))
})

afterAll(async () => {
    stop?.()
    await awaitSavingChanges()
    closeConnectionPool()
})

describe("Auth", () => {
    it("401 ohne und mit falschem Token, 200 mit richtigem", async () => {
        expect((await api("GET", "/boards", undefined, { token: null })).status).toBe(401)
        expect((await api("GET", "/boards", undefined, { token: "falsch" })).status).toBe(401)
        expect((await api("POST", "/boards", { name: "x" }, { token: "falsch" })).status).toBe(401)
        expect((await api("GET", "/boards")).status).toBe(200)
    })
    it("ohne konfigurierten Server-Token ist die API zu", async () => {
        const saved = process.env.WHITEBOARD_API_TOKEN
        delete process.env.WHITEBOARD_API_TOKEN
        try {
            expect((await api("GET", "/boards")).status).toBe(401)
        } finally {
            process.env.WHITEBOARD_API_TOKEN = saved
        }
    })
})

describe("Boards", () => {
    it("anlegen, lesen, listen; CRDT-Board; Gastlink erneuern und sperren", async () => {
        const b = await newTestBoard("Kunde A")
        expect(b.viewLink).toBe(`${BASE}/b/${b.id}`)
        expect(b.shareLink).toMatch(new RegExp(`^${BASE}/s/[A-Za-z0-9_-]{32,}$`))
        const state = await getBoard(b.id)
        expect(state!.board.crdt).toBe(1)

        const got = await api("GET", `/boards/${b.id}`)
        expect(got.json.name).toBe("Kunde A")
        expect(got.json.shareLink).toBe(b.shareLink)

        const rot = await api("POST", `/boards/${b.id}/share/rotate`)
        expect(rot.status).toBe(200)
        expect(rot.json.shareLink).not.toBe(b.shareLink)
        expect(rot.json.shareLink).toMatch(/\/s\/[A-Za-z0-9_-]{32,}$/)
        expect((await api("GET", `/boards/${b.id}`)).json.shareLink).toBe(rot.json.shareLink)

        const rev = await api("POST", `/boards/${b.id}/share/revoke`)
        expect(rev.json).toEqual({ shareLink: null })
        expect((await api("GET", `/boards/${b.id}`)).json.shareLink).toBeNull()

        const list = await api("GET", "/boards?limit=50")
        expect(list.json.data.some((x: any) => x.id === b.id)).toBe(true)
        expect((await api("GET", "/boards/gibtsnicht")).status).toBe(404)
        expect((await api("POST", "/boards", {})).status).toBe(400)
    })
})

describe("Shapes, Texte, Haftnotizen: Roundtrip", () => {
    it("Panel mit Rich Text, Hex-Füllung, Rahmen, links oben", async () => {
        const b = await newTestBoard()
        const content = "<p><strong>Titel</strong></p><p></p><p>· Punkt <em>kursiv</em> und <a href=\"https://example.com/x?a=1&amp;b=2\">Link</a></p>"
        const payload = {
            data: { shape: "round_rectangle", content },
            style: {
                fillColor: "#e6f6ee",
                fontSize: "18",
                color: "#1a1a1a",
                borderColor: "#dde2e8",
                borderWidth: "1.0",
                textAlign: "left",
                textAlignVertical: "top",
            },
            geometry: { width: 560, height: 760 },
            position: { x: 280, y: 700 },
        }
        const r = await api("POST", `/boards/${b.id}/shapes`, payload)
        expect(r.status).toBe(201)
        const g = (await api("GET", `/boards/${b.id}/items/${r.json.id}`)).json
        expect(g.type).toBe("shape")
        expect(g.data.shape).toBe("round_rectangle")
        expect(g.data.content).toBe(content)
        expect(g.style).toMatchObject({
            fillColor: "#e6f6ee",
            fontSize: "18.0",
            color: "#1a1a1a",
            borderColor: "#dde2e8",
            borderWidth: "1.0",
            textAlign: "left",
            textAlignVertical: "top",
        })
        expect(g.geometry).toMatchObject({ width: 560, height: 760 })
        expect(g.position).toMatchObject({ x: 280, y: 700, origin: "center" })
        expect(g.createdBy.type).toBe("api")
        expect(g.createdAt).toBeTruthy()

        // Ourboard-Seite: em-Skala, linke obere Ecke, Ausrichtung TL
        const item: any = (await getBoard(b.id))!.board.items[r.json.id]
        expect(item.width).toBeCloseTo(14)
        expect(item.height).toBeCloseTo(19)
        expect(item.x).toBeCloseTo(ORIGIN_X_EM + 280 / 40 - 7)
        expect(item.y).toBeCloseTo(ORIGIN_Y_EM + 700 / 40 - 9.5)
        expect(item.align).toBe("TL")
        expect(item.fontSize).toBeCloseTo(18 / 40)
        expect(item.textColor).toBe("#1a1a1a")
        expect(item.crdt).toBe(1)
    })

    it("Kopfzelle dunkelgrün mit weißer Schrift, Formen und Farbnamen", async () => {
        const b = await newTestBoard()
        const r = await api("POST", `/boards/${b.id}/shapes`, {
            data: { shape: "rectangle", content: "<p><strong>Kopf</strong></p>" },
            style: { fillColor: "#1f5c3a", color: "#ffffff", fontSize: 16, textAlign: "center", textAlignVertical: "middle" },
            geometry: { width: 300, height: 80 },
            position: { x: 10, y: 20 },
        })
        const g = (await api("GET", `/boards/${b.id}/shapes/${r.json.id}`)).json
        expect(g.style.color).toBe("#ffffff")
        expect(g.style.fillColor).toBe("#1f5c3a")
        expect(g.style.textAlign).toBe("center")
        expect(g.style.textAlignVertical).toBe("middle")

        const shapes: [string, string][] = [
            ["circle", "circle"],
            ["rhombus", "rhombus"],
            ["round_rectangle", "round_rectangle"],
            ["triangle", "rectangle"], // unbekannt -> rectangle, kein Fehler
        ]
        for (const [inShape, outShape] of shapes) {
            const x = await api("POST", `/boards/${b.id}/shapes`, { data: { shape: inShape }, geometry: { width: 100, height: 100 } })
            expect(x.status).toBe(201)
            expect(x.json.data.shape).toBe(outShape)
        }
    })

    it("Text 48 pt, linksbündig", async () => {
        const b = await newTestBoard()
        const r = await api("POST", `/boards/${b.id}/texts`, {
            data: { content: "<p><strong>Status quo</strong></p>" },
            style: { fontSize: "48", textAlign: "left", color: "#222222" },
            geometry: { width: 2800 },
            position: { x: 1300, y: 0 },
        })
        expect(r.status).toBe(201)
        const g = (await api("GET", `/boards/${b.id}/texts/${r.json.id}`)).json
        expect(g.type).toBe("text")
        expect(g.style).toMatchObject({ fontSize: "48.0", textAlign: "left", color: "#222222" })
        expect(g.geometry.width).toBe(2800)
        expect(g.geometry.height).toBeGreaterThan(0)
        expect(g.position).toMatchObject({ x: 1300, y: 0 })
        expect(g.data.content).toBe("<p><strong>Status quo</strong></p>")
    })

    it("Haftnotiz: Farbnamen und Hex, Quadrat/Rechteck", async () => {
        const b = await newTestBoard()
        const a = await api("POST", `/boards/${b.id}/sticky_notes`, {
            data: { content: "<p>Frage an den Kunden</p>", shape: "rectangle" },
            style: { fillColor: "light_yellow" },
            geometry: { width: 320 },
            position: { x: 100, y: 100 },
        })
        expect(a.status).toBe(201)
        expect(a.json.type).toBe("sticky_note")
        expect(a.json.style.fillColor).toBe("light_yellow")
        expect(a.json.data.shape).toBe("rectangle")
        expect(a.json.geometry.width).toBe(320)
        const c = await api("POST", `/boards/${b.id}/sticky_notes`, {
            data: { content: "x" },
            style: { fillColor: "#abcdef" },
            geometry: { width: 200 },
        })
        expect(c.json.style.fillColor).toBe("#abcdef")
        expect(c.json.data.shape).toBe("square")
        expect(c.json.geometry.height).toBe(200)
        const bad = await api("POST", `/boards/${b.id}/sticky_notes`, { data: { content: "x" }, style: { fillColor: "nix" } })
        expect(bad.status).toBe(400)
    })

    it("Rich Text: <br>, Listen, Entities, Absätze", async () => {
        const b = await newTestBoard()
        const r = await api("POST", `/boards/${b.id}/texts`, {
            data: { content: "<p>A &amp; B<br>zweite Zeile</p><p></p><ul><li>eins</li><li><b>zwei</b></li></ul>" },
            geometry: { width: 400 },
        })
        const g = (await api("GET", `/boards/${b.id}/items/${r.json.id}`)).json
        expect(g.data.content).toBe(
            "<p>A &amp; B</p><p>zweite Zeile</p><p></p><ul><li>eins</li><li><strong>zwei</strong></li></ul>",
        )
        // Im Yjs-Dokument steht ein Quill-Delta
        const doc = await yWebSocketServer.docs.getYDocAndWaitForFetch(b.id)
        const delta = getCRDTField(doc, r.json.id, "text").toDelta()
        expect(delta[0].insert.startsWith("A & B\nzweite Zeile\n\neins")).toBe(true)
        expect(delta.some((op: any) => op.attributes?.bold)).toBe(true)
    })

    it("Konverter: gefährliche Links fliegen raus, Tags werden nicht durchgereicht", () => {
        const html = deltaToHtml(htmlToDelta('<p><a href="javascript:alert(1)">x</a><script>y</script></p>'))
        expect(html).not.toContain("javascript")
        expect(html).not.toContain("<script")
    })
})

describe("Frames und Kinder", () => {
    it("Kind-Position ist relativ zur Frame-Ecke, Frame-Verschiebung nimmt Kinder mit", async () => {
        const b = await newTestBoard()
        const f = await api("POST", `/boards/${b.id}/frames`, {
            data: { title: "Zusammenarbeit", format: "custom" },
            style: { fillColor: "#f4f4f4" },
            geometry: { width: 1200, height: 800 },
            position: { x: 1000, y: 500 }, // Mittelpunkt -> Ecke bei (400, 100)
        })
        expect(f.status).toBe(201)
        expect(f.json.type).toBe("frame")
        expect(f.json.data.title).toBe("Zusammenarbeit")
        expect(f.json.style.fillColor).toBe("#f4f4f4")
        expect(f.json.position).toMatchObject({ x: 1000, y: 500 })

        const c = await api("POST", `/boards/${b.id}/shapes`, {
            data: { shape: "rectangle", content: "<p>Kind</p>" },
            geometry: { width: 200, height: 100 },
            position: { x: 300, y: 200 }, // relativ: Mittelpunkt 300/200 ab Frame-Ecke
            parent: { id: f.json.id },
        })
        expect(c.status).toBe(201)
        expect(c.json.parent).toEqual({ id: f.json.id })
        expect(c.json.position).toMatchObject({ x: 300, y: 200 })
        const board = (await getBoard(b.id))!.board
        const fr: any = board.items[f.json.id]
        const ch: any = board.items[c.json.id]
        expect(fr.x).toBeCloseTo(ORIGIN_X_EM + 400 / 40)
        expect(fr.y).toBeCloseTo(ORIGIN_Y_EM + 100 / 40)
        // absolut (Mittelpunkt) = Frame-Ecke + relativ = (700, 300) px
        expect((ch.x + ch.width / 2) * 40).toBeCloseTo(ORIGIN_X_EM * 40 + 400 + 300)
        expect((ch.y + ch.height / 2) * 40).toBeCloseTo(ORIGIN_Y_EM * 40 + 100 + 200)
        expect(ch.containerId).toBe(f.json.id)

        // Frame verschieben: Kinder behalten relative Position
        const mv = await api("PATCH", `/boards/${b.id}/frames/${f.json.id}`, { position: { x: 2000, y: 1500 } })
        expect(mv.json.position).toMatchObject({ x: 2000, y: 1500 })
        const after = (await api("GET", `/boards/${b.id}/items/${c.json.id}`)).json
        expect(after.position).toMatchObject({ x: 300, y: 200 })
        const ch2: any = (await getBoard(b.id))!.board.items[c.json.id]
        expect((ch2.x + ch2.width / 2) * 40).toBeCloseTo(ORIGIN_X_EM * 40 + 1400 + 300)

        // ungültiger Parent
        const bad = await api("POST", `/boards/${b.id}/shapes`, { parent: { id: "nope" }, geometry: { width: 10, height: 10 } })
        expect(bad.status).toBe(400)
    })
})

describe("Bilder", () => {
    it("multipart wie in der v2-API, Seitenverhältnis, Asset abrufbar; data.url -> 400", async () => {
        const b = await newTestBoard()
        const file = png(40, 20)
        const form = new FormData()
        form.append("resource", new Blob([new Uint8Array(file)], { type: "image/png" }), "bild.png")
        form.append(
            "data",
            new Blob([JSON.stringify({ title: "Mein Bild", position: { x: 500, y: 400 }, geometry: { width: 600 } })], {
                type: "application/json",
            }),
        )
        const r = await api("POST", `/boards/${b.id}/images`, undefined, { raw: form })
        expect(r.status).toBe(201)
        expect(r.json.type).toBe("image")
        expect(r.json.data.title).toBe("Mein Bild")
        expect(r.json.geometry).toMatchObject({ width: 600, height: 300 })
        expect(r.json.position).toMatchObject({ x: 500, y: 400 })
        const url: string = r.json.data.imageUrl
        // Assets liegen hinter der Sitzungsprüfung: ohne Cookie 401, mit Admin-Sitzung 200
        expect((await fetch(url)).status).toBe(401)
        const cookie = "wb_session=" + signSession({ r: "admin", e: Math.floor(Date.now() / 1000) + 600 })
        const asset = await fetch(url, { headers: { cookie } })
        expect(asset.status).toBe(200)
        expect(Buffer.from(await asset.arrayBuffer()).equals(file)).toBe(true)

        const viaUrl = await api("POST", `/boards/${b.id}/images`, { data: { url: "https://example.com/a.png" } })
        expect(viaUrl.status).toBe(400)
        expect(viaUrl.json.message).toMatch(/upload the image as a file/)

        const evil = new FormData()
        evil.append("resource", new Blob(["<svg onload=alert(1)>"], { type: "image/svg+xml" }), "x.svg")
        const e = await api("POST", `/boards/${b.id}/images`, undefined, { raw: evil })
        expect(e.status).toBe(400)
        const none = new FormData()
        none.append("data", "{}")
        expect((await api("POST", `/boards/${b.id}/images`, undefined, { raw: none })).status).toBe(400)
    })
})

describe("Lesen, Paginierung, Ändern, Löschen", () => {
    it("Paginierung mit cursor und type-Filter", async () => {
        const b = await newTestBoard()
        for (let i = 0; i < 7; i++) {
            await api("POST", `/boards/${b.id}/${i % 2 ? "texts" : "sticky_notes"}`, {
                data: { content: `<p>Item ${i}</p>` },
                geometry: { width: 200 },
                position: { x: i * 10, y: 0 },
            })
        }
        const seen: string[] = []
        let cursor: string | undefined
        let pages = 0
        do {
            const r = await api("GET", `/boards/${b.id}/items?limit=3${cursor ? "&cursor=" + cursor : ""}`)
            expect(r.json.total).toBe(7)
            seen.push(...r.json.data.map((i: any) => i.id))
            cursor = r.json.cursor
            pages++
        } while (cursor)
        expect(pages).toBe(3)
        expect(new Set(seen).size).toBe(7)
        const notes = await api("GET", `/boards/${b.id}/items?type=sticky_note&limit=50`)
        expect(notes.json.data).toHaveLength(4)
        expect(notes.json.cursor).toBeUndefined()
        expect((await api("GET", `/boards/${b.id}/items?type=quatsch`)).status).toBe(400)
    })

    it("PATCH (kind- und items-Pfad), 404 bei falschem Kind, fremder und unbekannter ID, DELETE", async () => {
        const b = await newTestBoard()
        const other = await newTestBoard()
        const s = await api("POST", `/boards/${b.id}/shapes`, {
            data: { shape: "rectangle", content: "<p>alt</p>" },
            style: { fillColor: "#ffffff", fontSize: 14 },
            geometry: { width: 400, height: 200 },
            position: { x: 100, y: 100 },
        })
        const id = s.json.id
        const p1 = await api("PATCH", `/boards/${b.id}/shapes/${id}`, {
            data: { content: "<p><strong>neu</strong></p>" },
            style: { fillColor: "#112233", color: "#ffffff", fontSize: "20" },
            position: { x: 150, y: 120 },
        })
        expect(p1.status).toBe(200)
        expect(p1.json.data.content).toBe("<p><strong>neu</strong></p>")
        expect(p1.json.style).toMatchObject({ fillColor: "#112233", color: "#ffffff", fontSize: "20.0" })
        expect(p1.json.position).toMatchObject({ x: 150, y: 120 })
        expect(p1.json.geometry).toMatchObject({ width: 400, height: 200 }) // unverändert

        const p2 = await api("PATCH", `/boards/${b.id}/items/${id}`, { geometry: { width: 800 } })
        expect(p2.json.geometry).toMatchObject({ width: 800, height: 200 })
        expect(p2.json.position).toMatchObject({ x: 150, y: 120 }) // Mittelpunkt bleibt

        expect((await api("PATCH", `/boards/${b.id}/texts/${id}`, {})).status).toBe(404) // falsches Kind
        expect((await api("GET", `/boards/${other.id}/items/${id}`)).status).toBe(404) // fremdes Board
        expect((await api("PATCH", `/boards/${other.id}/items/${id}`, {})).status).toBe(404)
        expect((await api("DELETE", `/boards/${other.id}/items/${id}`)).status).toBe(404)
        expect((await api("GET", `/boards/${b.id}/items/unbekannt`)).status).toBe(404)
        expect((await api("PATCH", `/boards/${b.id}/shapes/${id}`, { style: { fillColor: "grün-ish" } })).status).toBe(400)

        const d = await api("DELETE", `/boards/${b.id}/items/${id}`)
        expect(d.status).toBe(204)
        expect((await api("GET", `/boards/${b.id}/items/${id}`)).status).toBe(404)
        expect((await getBoard(b.id))!.board.items[id]).toBeUndefined()
    })
})

describe("Browser-Änderungen und Persistenz", () => {
    it("Browser-Item und Text-Edit sind per GET lesbar (createdBy, modifiedAt); Kunden-Haken", async () => {
        const b = await newTestBoard()
        const s = await api("POST", `/boards/${b.id}/sticky_notes`, { data: { content: "<p>vom Skript</p>" }, geometry: { width: 200 } })
        const state = (await getBoard(b.id))!
        const user = { nickname: "Admin", userType: "unidentified" as const }

        // Wie im Browser: Item anlegen (ohne createdBy) -> "admin"; mit Haken createdBy "customer" -> "customer"
        const browserNote = { ...state.board.items[s.json.id], id: "browser-1", createdBy: undefined, createdAt: undefined, modifiedAt: undefined }
        const customerNote = { ...browserNote, id: "customer-1", createdBy: "customer" as const }
        updateBoards(state, {
            action: "item.add",
            boardId: b.id,
            items: [browserNote as any, customerNote as any],
            connections: [],
            user,
            timestamp: newISOTimeStamp(),
        })
        const bn = (await api("GET", `/boards/${b.id}/items/browser-1`)).json
        expect(bn.createdBy.type).toBe("admin")
        expect((await api("GET", `/boards/${b.id}/items/customer-1`)).json.createdBy.type).toBe("customer")
        expect(s.json.createdBy.type).toBe("api")

        // Text im Browser ändern: nur das Yjs-Dokument ändert sich; modifiedAt muss nachziehen
        const before = (await api("GET", `/boards/${b.id}/items/${s.json.id}`)).json.modifiedAt
        await new Promise((r) => setTimeout(r, 20))
        await getBoard(b.id) // im Betrieb hält die Browser-Sitzung das Board im Speicher
        const doc = await yWebSocketServer.docs.getYDocAndWaitForFetch(b.id)
        doc.transact(() => getCRDTField(doc, s.json.id, "text").insert(0, "Kunde: "), "browser")
        await new Promise((r) => setTimeout(r, 2200))
        const after = (await api("GET", `/boards/${b.id}/items/${s.json.id}`)).json
        expect(after.data.content).toBe("<p>Kunde: vom Skript</p>")
        expect(after.modifiedAt > before).toBe(true)
        expect(after.createdBy.type).toBe("api")
    })

    it("alles überlebt Speichern und Neuladen aus der DB (Server-Neustart)", async () => {
        const b = await newTestBoard()
        const f = await api("POST", `/boards/${b.id}/frames`, { data: { title: "F" }, geometry: { width: 400, height: 400 }, position: { x: 200, y: 200 } })
        const c = await api("POST", `/boards/${b.id}/shapes`, {
            data: { shape: "circle", content: "<p>x</p>" },
            style: { fillColor: "#123456", color: "#ffffff", borderColor: "#654321", borderWidth: 3 },
            geometry: { width: 100, height: 100 },
            position: { x: 50, y: 60 },
            parent: { id: f.json.id },
        })
        await new Promise((r) => setTimeout(r, 1600))
        await awaitSavingChanges()
        const fresh = await fetchBoard(b.id)
        const item: any = fresh!.board.items[c.json.id]
        expect(item.textColor).toBe("#ffffff")
        expect(item.borderColor).toBe("#654321")
        expect(item.borderWidth).toBe(3)
        expect(item.containerId).toBe(f.json.id)
        expect(item.createdBy).toBe("api")
        expect(item.modifiedAt).toBeTruthy()
        expect(item.shape).toBe("round")
    })
})

describe("Zeichnungen: Freihand, Linie, Pfeil", () => {
    // Punkte werden im Item auf 4 Nachkommastellen normalisiert: Abweichung unter 0,05 px
    const near = (p: any, x: number, y: number) => {
        expect(Math.abs(p.x - x)).toBeLessThan(0.05)
        expect(Math.abs(p.y - y)).toBeLessThan(0.05)
    }
    const pen = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: Math.sin(i / 3) * 80 }))

    it("Freihand: POST -> GET mit Punkten, Farbe, Stärke; PATCH Farbe und Punkte; DELETE", async () => {
        const b = await newTestBoard()
        const r = await api("POST", `/boards/${b.id}/drawings`, {
            data: { points: pen(40) },
            style: { strokeColor: "#e53935", strokeWidth: 8 },
        })
        expect(r.status).toBe(201)
        expect(r.json.type).toBe("drawing")
        expect(r.json.data.kind).toBe("pen")
        expect(r.json.style).toMatchObject({ color: "#e53935", strokeWidth: "8" })
        expect(r.json.data.points[0].x).toBeCloseTo(0, 0)
        expect(r.json.createdBy.type).toBe("api")
        const state = await getBoard(b.id)
        expect((state!.board.items[r.json.id] as any).type).toBe("drawing")

        const list = await api("GET", `/boards/${b.id}/items?type=drawing`)
        expect(list.json.data.map((x: any) => x.id)).toContain(r.json.id)

        const p = await api("PATCH", `/boards/${b.id}/drawings/${r.json.id}`, { style: { strokeColor: "blue", strokeWidth: 2 } })
        expect(p.status).toBe(200)
        expect(p.json.style).toMatchObject({ color: "#2d9bf0", strokeWidth: "2" })
        expect(p.json.data.points.length).toBe(r.json.data.points.length)

        const moved = await api("PATCH", `/boards/${b.id}/drawings/${r.json.id}`, { position: { x: 500, y: 300 } })
        near(moved.json.position, 500, 300)

        const np = await api("PATCH", `/boards/${b.id}/drawings/${r.json.id}`, {
            data: { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }] },
        })
        expect(np.json.data.points.length).toBe(3)
        near(np.json.data.points[2], 200, 0)

        expect((await api("DELETE", `/boards/${b.id}/drawings/${r.json.id}`)).status).toBe(204)
        expect((await api("GET", `/boards/${b.id}/drawings/${r.json.id}`)).status).toBe(404)
    })

    it("Linie und Pfeil: POST, Pfeilspitze per PATCH, Ende verschieben", async () => {
        const b = await newTestBoard()
        const a = await api("POST", `/boards/${b.id}/connectors`, {
            data: { shape: "arrow" },
            startItem: { position: { x: -200, y: -100 } },
            endItem: { position: { x: 200, y: 100 } },
            style: { strokeColor: "#1e88e5", strokeWidth: 6 },
        })
        expect(a.status).toBe(201)
        expect(a.json.type).toBe("connector")
        expect(a.json.data.shape).toBe("arrow")
        near(a.json.startItem.position, -200, -100)
        near(a.json.endItem.position, 200, 100)
        expect(a.json.style.endStrokeCap).toBe("stealth")

        const l = await api("PATCH", `/boards/${b.id}/connectors/${a.json.id}`, { data: { shape: "line" }, endItem: { position: { x: 400, y: 0 } } })
        expect(l.json.data.shape).toBe("line")
        expect(l.json.style.endStrokeCap).toBe("none")
        near(l.json.endItem.position, 400, 0)
        near(l.json.startItem.position, -200, -100)

        const noEnd = await api("POST", `/boards/${b.id}/connectors`, { startItem: { position: { x: 0, y: 0 } } })
        expect(noEnd.status).toBe(400)
        const type = await api("GET", `/boards/${b.id}/items?type=connector`)
        expect(type.json.total).toBe(1)
    })

    it("Negativfälle: ohne Token 401, zu viele Punkte 400, ungültige Farbe/Stärke/Punkte 400, Parent 400", async () => {
        const b = await newTestBoard()
        const ok = { data: { points: pen(10) } }
        expect((await api("POST", `/boards/${b.id}/drawings`, ok, { token: null })).status).toBe(401)
        expect((await api("POST", `/boards/${b.id}/connectors`, ok, { token: "falsch" })).status).toBe(401)
        const many = await api("POST", `/boards/${b.id}/drawings`, { data: { points: pen(601) } })
        expect(many.status).toBe(400)
        expect(many.json.code).toBe("invalidParameter")
        expect((await api("POST", `/boards/${b.id}/drawings`, { data: { points: pen(600) } })).status).toBe(201)
        expect((await api("POST", `/boards/${b.id}/drawings`, { data: { points: [{ x: 0, y: 0 }] } })).status).toBe(400)
        expect((await api("POST", `/boards/${b.id}/drawings`, { data: { points: [{ x: 0, y: 0 }, { x: "a", y: 1 }] } })).status).toBe(400)
        expect((await api("POST", `/boards/${b.id}/drawings`, { ...ok, style: { strokeColor: "rot; x" } })).status).toBe(400)
        expect((await api("POST", `/boards/${b.id}/drawings`, { ...ok, style: { strokeWidth: 100 } })).status).toBe(400)
        expect((await api("POST", `/boards/${b.id}/drawings`, { ...ok, parent: { id: "x" } })).status).toBe(400)
        expect((await api("POST", `/boards/${b.id}/drawings`, {})).status).toBe(400)
        const d = await api("POST", `/boards/${b.id}/drawings`, ok)
        expect((await api("PATCH", `/boards/${b.id}/drawings/${d.json.id}`, { data: { points: pen(601) } })).status).toBe(400)
        expect((await api("PATCH", `/boards/${b.id}/drawings/${d.json.id}`, { data: { shape: "arrow" } })).status).toBe(400)
    })

    it("Zeichnung überlebt Speichern und Neuladen aus der DB", async () => {
        const b = await newTestBoard()
        const d = await api("POST", `/boards/${b.id}/drawings`, { data: { points: pen(20) }, style: { strokeColor: "#00ff00" } })
        await new Promise((r) => setTimeout(r, 1600))
        await awaitSavingChanges()
        const fresh = await fetchBoard(b.id)
        const item: any = fresh!.board.items[d.json.id]
        expect(item.type).toBe("drawing")
        expect(item.color).toBe("#00ff00")
        expect(item.createdBy).toBe("api")
    })
})
