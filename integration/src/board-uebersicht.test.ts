/**
 * Integrationstests: Board-Übersicht (Archiv, Umbenennen, Gästekommentar-Zähler, Kacheln) gegen echte lokale Postgres-DB.
 * Aufruf (im Projektordner):
 *   DATABASE_URL=postgres://postitchaos@127.0.0.1:5432/postitchaos TEST_TARGET=integration npx vitest --run board-uebersicht
 */
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { awaitSavingChanges, getBoard, updateBoards } from "../../backend/src/board-state"
import { closeConnectionPool, initDB } from "../../backend/src/db"
import { startExpressServer } from "../../backend/src/express-server"
import { newISOTimeStamp } from "../../common/src/domain"
import { signSession } from "../../backend/src/zugang/cookie-session"

const TOKEN = "test-token-" + Math.random().toString(36).slice(2)
const PORT = 1398
const BASE = `http://127.0.0.1:${PORT}`
let stop: (() => void) | undefined
const admin = () => "wb_session=" + signSession({ r: "admin", e: Math.floor(Date.now() / 1000) + 600 })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api(method: string, p: string, body?: any) {
    const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }
    if (body !== undefined) headers["Content-Type"] = "application/json"
    const r = await fetch(BASE + "/v2" + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text()
    return { status: r.status, json: text ? JSON.parse(text) : null }
}
const tileOf = (html: string, id: string) => html.split(`data-id="${id}"`)[1]?.split("</article>")[0] ?? ""
const page = async () => (await fetch(BASE + "/", { headers: { cookie: admin(), accept: "text/html" } })).text()
const adminPost = (p: string, body: string, accept = "application/json") =>
    fetch(BASE + p, {
        method: "POST",
        redirect: "manual",
        headers: { cookie: admin(), "content-type": "application/x-www-form-urlencoded", accept },
        body,
    })

async function addCustomerNote(boardId: string, id: string) {
    const state = (await getBoard(boardId))!
    updateBoards(state, {
        action: "item.add",
        boardId,
        items: [
            { id, type: "note", x: 52, y: 26, width: 5, height: 5, z: 1, locked: false, text: "Kunde", color: "#8FE3DC", shape: "square", createdBy: "customer" } as any,
        ],
        connections: [],
        user: { nickname: "Guest", userType: "unidentified" },
        timestamp: newISOTimeStamp(),
    })
}

beforeAll(async () => {
    process.env.WHITEBOARD_API_TOKEN = TOKEN
    process.env.WHITEBOARD_LANGUAGE = "en"
    process.env.ASSETS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wb-assets-"))
    process.env.PUBLIC_URL = BASE
    process.env.WHITEBOARD_SESSION_SECRET ??= "integrationstest-geheimnis-mindestens-32-zeichen"
    await initDB("./backend")
    stop = startExpressServer(PORT)
    await sleep(300)
})
afterAll(async () => {
    stop?.()
    await awaitSavingChanges()
    closeConnectionPool()
})

describe("Board-API: Übersichtsfelder und PATCH", () => {
    it("GET liefert modifiedAt, archived, neueKundenkommentare; PATCH benennt um und archiviert, ohne zu löschen", async () => {
        const b = (await api("POST", "/boards", { name: "Api Archiv" })).json
        const got = (await api("GET", `/boards/${b.id}`)).json
        expect(got).toMatchObject({ archived: false, neueKundenkommentare: 0 })
        expect(Date.parse(got.modifiedAt)).toBeGreaterThan(0)

        const ren = await api("PATCH", `/boards/${b.id}`, { name: "  Neuer Name  " })
        expect(ren.status).toBe(200)
        expect(ren.json.name).toBe("Neuer Name")
        expect((await getBoard(b.id))!.board.name).toBe("Neuer Name")

        const arch = await api("PATCH", `/boards/${b.id}`, { archived: true })
        expect(arch.json.archived).toBe(true)
        const list = (await api("GET", "/boards?limit=50")).json.data
        expect(list.find((x: any) => x.id === b.id)).toMatchObject({ archived: true, name: "Neuer Name" })
        expect((await api("GET", "/boards?archived=false&limit=50")).json.data.some((x: any) => x.id === b.id)).toBe(false)
        expect((await api("GET", "/boards?archived=true&limit=50")).json.data.some((x: any) => x.id === b.id)).toBe(true)
        // nichts gelöscht: Board und Gastlink sind noch da
        expect((await api("GET", `/boards/${b.id}`)).json.shareLink).toBe(b.shareLink)

        expect((await api("PATCH", `/boards/${b.id}`, { archived: false })).json.archived).toBe(false)
    })
    it("Fehlerfälle: leerer Name, falscher Typ, leerer Body, unbekanntes Board, ohne Token", async () => {
        const b = (await api("POST", "/boards", { name: "Fehler" })).json
        expect((await api("PATCH", `/boards/${b.id}`, { name: "   " })).status).toBe(400)
        expect((await api("PATCH", `/boards/${b.id}`, { archived: "ja" })).status).toBe(400)
        expect((await api("PATCH", `/boards/${b.id}`, {})).status).toBe(400)
        expect((await api("PATCH", `/boards/gibtsnicht`, { name: "x" })).status).toBe(404)
        const r = await fetch(`${BASE}/v2/boards/${b.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })
        expect(r.status).toBe(401)
    })
})

describe("Gästekommentar-Zähler", () => {
    it("zählt Kunden-Elemente seit dem letzten Admin-Besuch; Besuch setzt zurück; Nicks Elemente zählen nicht", async () => {
        const b = (await api("POST", "/boards", { name: "Zähler" })).json
        await api("POST", `/boards/${b.id}/sticky_notes`, { data: { content: "vom Admin" }, geometry: { width: 200 } })
        expect((await api("GET", `/boards/${b.id}`)).json.neueKundenkommentare).toBe(0)

        await addCustomerNote(b.id, "k1")
        await addCustomerNote(b.id, "k2")
        expect((await api("GET", `/boards/${b.id}`)).json.neueKundenkommentare).toBe(2)
        expect((await api("GET", "/boards?limit=50")).json.data.find((x: any) => x.id === b.id).neueKundenkommentare).toBe(2)
        expect(tileOf(await page(), b.id)).toContain("2 new guest comments")

        // Admin öffnet das Board -> Zähler 0
        await fetch(`${BASE}/b/${b.id}`, { headers: { cookie: admin() } }) // Besuch wird vor dem Ausliefern der App gespeichert
        await sleep(150)
        expect((await api("GET", `/boards/${b.id}`)).json.neueKundenkommentare).toBe(0)
        expect(tileOf(await page(), b.id)).not.toContain("guest comment")

        await sleep(50)
        await addCustomerNote(b.id, "k3")
        expect((await api("GET", `/boards/${b.id}`)).json.neueKundenkommentare).toBe(1)
        expect(tileOf(await page(), b.id)).toContain("1 new guest comment")
    })
})

describe("Übersichtsseite", () => {
    it("Kachel mit Vorschau und Menü; Umbenennen und Archivieren per Formular-API; ohne Sitzung kein Zugriff", async () => {
        const b = (await api("POST", "/boards", { name: "Kachel Test" })).json
        await api("POST", `/boards/${b.id}/sticky_notes`, { data: { content: "<p>Hallo</p>" }, style: { fillColor: "#FDC4E7" }, geometry: { width: 200 } })
        const html = await page()
        expect(html).toContain("Kachel Test")
        expect(html).toContain('fill="#fdc4e7"') // Vorschau enthält die Post-it-Farbe
        expect(html).toContain("Copy guest link")
        expect(html).toContain(`data-link="${b.shareLink}"`)
        expect(html).toContain("Last edited")
        expect(html).toContain("<title>Boards – Post-it Chaos</title>")

        const ren = await adminPost(`/admin/boards/${b.id}/rename`, "name=Umbenannt+Kachel")
        expect(ren.status).toBe(200)
        expect(await page()).toContain("Umbenannt Kachel")

        const arch = await adminPost(`/admin/boards/${b.id}/archive`, "archived=1")
        expect(arch.status).toBe(200)
        expect(await page()).toMatch(new RegExp(`data-id="${b.id}"[^>]*data-archived="1"`))
        // Archivierte Kachel ohne Cache lädt ihre Vorschau erst beim Öffnen des Archivs nach
        const b2 = (await api("POST", "/boards", { name: "Nur Archiv" })).json
        await api("POST", `/boards/${b2.id}/sticky_notes`, { data: { content: "<p>x</p>" }, style: { fillColor: "#FDC4E7" }, geometry: { width: 200 } })
        await adminPost(`/admin/boards/${b2.id}/archive`, "archived=1") // ohne Schnappschuss (die API-Antwort würde einen anlegen)
        expect(await page()).toMatch(new RegExp(`data-id="${b2.id}"[^>]*data-lazy="1"`))
        const vor = await fetch(`${BASE}/admin/boards/${b2.id}/vorschau`, { headers: { cookie: admin(), accept: "application/json" } })
        expect(vor.status).toBe(200)
        expect((await vor.json()).svg).toContain('fill="#fdc4e7"')
        expect((await fetch(`${BASE}/admin/boards/${b2.id}/vorschau`)).status).toBe(401)
        await adminPost(`/admin/boards/${b.id}/archive`, "archived=0")
        expect(await page()).toMatch(new RegExp(`data-id="${b.id}"[^>]*data-archived="0"`))

        // Negativ: ohne Sitzung 401, fremder Origin 403, leerer Name 400, unbekanntes Board 404
        const noAuth = await fetch(`${BASE}/admin/boards/${b.id}/archive`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "archived=1" })
        expect(noAuth.status).toBe(401)
        const evil = await fetch(`${BASE}/admin/boards/${b.id}/archive`, {
            method: "POST",
            headers: { cookie: admin(), origin: "http://boese.example", "content-type": "application/x-www-form-urlencoded" },
            body: "archived=1",
        })
        expect(evil.status).toBe(403)
        expect((await adminPost(`/admin/boards/${b.id}/rename`, "name=")).status).toBe(400)
        expect((await adminPost(`/admin/boards/gibtsnicht/archive`, "archived=1")).status).toBe(404)
    })
    it("Login-Seite heißt Board", async () => {
        const login = await (await fetch(BASE + "/login")).text()
        expect(login).toContain("<title>Sign in – Post-it Chaos</title>")
        expect(login).not.toContain("Whiteboard")
    })
})
