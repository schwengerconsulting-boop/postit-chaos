// Integrationstests gegen den echten Server (in-process) und die echte lokale Postgres-DB.
// Aufruf (Postgres lokal, DB postitchaos):  DATABASE_URL=postgres://postitchaos@127.0.0.1:5432/postitchaos npm run test:unit -- zugang
import { spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import * as uuid from "uuid"
import WebSocket from "ws"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const PORT = 1349
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_PW = "richtiges-passwort-123"
const ROOT = path.resolve(__dirname, "../../..") // apps/whiteboard
const ASSET_DIR = path.resolve(process.env.WB_TEST_ASSET_DIR ?? path.join(ROOT, "backend/localfiles-test"))

vi.hoisted(() => {
    process.env.DATABASE_URL ??= "postgres://postitchaos@127.0.0.1:5432/postitchaos"
    process.env.WHITEBOARD_SESSION_SECRET = "test-secret-test-secret-test-secret-0123456789"
    process.env.PUBLIC_URL = "http://127.0.0.1:1349"
    process.env.PORT = "1349"
    process.env.WHITEBOARD_LANGUAGE = "en" // tests run in the English default; one test below switches to "de"
})

import { addBoard, getBoard } from "../board-state"
import { initDB, withDBClient } from "../db"
import { startExpressServer } from "../express-server"
import { sessionCookieHeader } from "./cookie-session"
import { hashPassword, verifyPassword } from "./password"
import { loginGlobalLimiter, loginLimiter } from "./routes"
import { ensureShareToken, revokeShareToken, rotateShareToken } from "./share-tokens"
import { CUSTOMER_COLOR } from "./settings"

let stop: () => void
let adminCookie: string
const ipCounter = { n: 10 }
const freshIp = () => `10.0.0.${ipCounter.n++}`

const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]

async function req(
    p: string,
    o: { method?: string; cookie?: string; body?: string | Buffer; headers?: Record<string, string> } = {},
) {
    return fetch(BASE + p, {
        method: o.method ?? "GET",
        redirect: "manual",
        body: o.body as any,
        headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) },
    })
}
const html = { accept: "text/html" }
const form = { "content-type": "application/x-www-form-urlencoded" }

async function login(password: string, ip = freshIp()) {
    return req("/login", {
        method: "POST",
        body: `password=${encodeURIComponent(password)}`,
        headers: { ...form, "x-forwarded-for": ip },
    })
}

async function newBoard(name: string) {
    const id = uuid.v4()
    await addBoard({ width: 800, height: 600, id, name, items: {}, connections: [], serial: 0 } as any)
    const token = await ensureShareToken(id)
    return { id, token }
}
async function customerCookie(token: string) {
    const r = await req(`/s/${token}`)
    expect(r.status).toBe(303)
    return cookieFrom(r)
}

type WsResult = { status: number } | { status: "open"; ws: WebSocket; messages: any[]; closed: () => boolean }
function wsConnect(p: string, cookie?: string, headers: Record<string, string> = {}): Promise<WsResult> {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}${p}`, {
            headers: { ...(cookie ? { cookie } : {}), ...headers },
        })
        const messages: any[] = []
        let closed = false
        ws.on("message", (d) => {
            try {
                messages.push(JSON.parse(d.toString()))
            } catch {}
        })
        ws.on("close", () => (closed = true))
        ws.on("unexpected-response", (_r, res) => resolve({ status: res.statusCode! }))
        ws.on("error", () => {})
        ws.on("open", () => resolve({ status: "open", ws, messages, closed: () => closed }))
    })
}
const waitFor = async (f: () => boolean, ms = 4000) => {
    const t = Date.now()
    while (Date.now() - t < ms) {
        if (f()) return true
        await new Promise((r) => setTimeout(r, 25))
    }
    return false
}
const send = (ws: WebSocket, ...events: any[]) => ws.send(JSON.stringify({ events }))
async function joinBoard(cookie: string, boardId: string) {
    const c = await wsConnect(`/socket/board/${boardId}`, cookie)
    if (c.status !== "open") throw new Error("ws status " + c.status)
    send(c.ws, { action: "board.join", boardId })
    expect(await waitFor(() => c.messages.some((m) => m.action === "board.init"))).toBe(true)
    return c
}
const note = (id: string, extra: any = {}) => ({
    id,
    type: "note",
    x: 5,
    y: 5,
    width: 5,
    height: 5,
    z: 1,
    locked: false,
    text: "hallo",
    color: "#ff0000",
    shape: "square",
    ...extra,
})

beforeAll(async () => {
    process.chdir(path.join(ROOT, "backend"))
    fs.mkdirSync(ASSET_DIR, { recursive: true })
    process.env.ASSETS_DIR = ASSET_DIR
    process.env.WHITEBOARD_ADMIN_PASSWORD_HASH = await hashPassword(ADMIN_PW)
    await initDB()
    stop = startExpressServer(PORT)
    await new Promise((r) => setTimeout(r, 300))
    const r = await login(ADMIN_PW)
    adminCookie = cookieFrom(r)
}, 60000)

afterAll(() => stop?.())

describe("Admin-Login", () => {
    it("richtiges Passwort: Sitzung, Cookie HttpOnly + SameSite=Lax, ohne Secure auf http", async () => {
        const r = await login(ADMIN_PW)
        expect(r.status).toBe(303)
        const c = r.headers.get("set-cookie")!
        expect(c).toMatch(/^wb_session=/)
        expect(c).toMatch(/HttpOnly/)
        expect(c).toMatch(/SameSite=Lax/)
        expect(c).not.toMatch(/Secure/)
        const home = await req("/", { cookie: cookieFrom(r), headers: html })
        expect(home.status).toBe(200)
        expect(await home.text()).toContain("New board")
    })
    it("falsches Passwort: 401, kein Cookie", async () => {
        const r = await login("falsch-falsch-falsch")
        expect(r.status).toBe(401)
        expect(r.headers.get("set-cookie")).toBeNull()
        expect(await r.text()).toContain("Wrong password")
    })
    it("Rate-Limit: nach 5 Fehlversuchen 429, auch mit richtigem Passwort; andere IP unberührt", async () => {
        loginGlobalLimiter.reset("*")
        const ip = freshIp()
        for (let i = 0; i < 5; i++) expect((await login("falsch-falsch-falsch", ip)).status).toBe(401)
        const blocked = await login(ADMIN_PW, ip)
        expect(blocked.status).toBe(429)
        expect(blocked.headers.get("set-cookie")).toBeNull()
        expect((await login(ADMIN_PW, freshIp())).status).toBe(303)
        loginLimiter.reset(ip)
        loginGlobalLimiter.reset("*")
    })
    it("Secure-Flag bei https-PUBLIC_URL", () => {
        const prev = process.env.PUBLIC_URL
        process.env.PUBLIC_URL = "https://board.example.com"
        try {
            expect(sessionCookieHeader({ r: "admin", e: Math.floor(Date.now() / 1000) + 60 })).toMatch(/; Secure/)
        } finally {
            process.env.PUBLIC_URL = prev
        }
    })
    it("manipuliertes oder abgelaufenes Cookie wird abgelehnt", async () => {
        const good = adminCookie
        const tampered = good.slice(0, -3) + (good.endsWith("AAA") ? "BBB" : "AAA")
        expect((await req("/", { cookie: tampered })).status).toBe(401)
        const expired = sessionCookieHeader({ r: "admin", e: Math.floor(Date.now() / 1000) - 10 }).split(";")[0]
        expect((await req("/", { cookie: expired })).status).toBe(401)
    })
    it("Logout löscht das Cookie", async () => {
        const r = await req("/logout", { method: "POST", cookie: adminCookie })
        expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/)
    })
    it("Hash-Skript erzeugt Hash, der verifiziert; Passwort steht nicht in der Ausgabe", async () => {
        const out = spawnSync("node", [path.join(ROOT, "scripts/hash-password.mjs")], {
            input: "ein-sehr-gutes-passwort\n",
            encoding: "utf8",
        })
        expect(out.status).toBe(0)
        expect(out.stdout).not.toContain("ein-sehr-gutes-passwort")
        expect(await verifyPassword("ein-sehr-gutes-passwort", out.stdout.trim())).toBe(true)
        expect(await verifyPassword("anderes", out.stdout.trim())).toBe(false)
        expect(await verifyPassword("x", undefined)).toBe(false)
    })
})

describe("ohne Sitzung kommt man an nichts", () => {
    const protectedGets = [
        "/",
        "/b/irgendein-board",
        "/index.html",
        "/assets/abc",
        "/api/v1/board/x",
        "/admin/boards",
        "/admin/uebersicht",
        "/assets/external?src=http://127.0.0.1:1/",
        "/test-callback",
        "/google-callback",
    ]
    for (const p of protectedGets) {
        it(`GET ${p}: Browser -> Redirect /login, API -> 401`, async () => {
            const a = await req(p, { headers: html })
            expect(a.status).toBe(302)
            expect(a.headers.get("location")).toBe("/login")
            const b = await req(p)
            expect(b.status).toBe(401)
        })
    }
    it("schreibende Routen: 401", async () => {
        expect((await req("/assets/abc", { method: "PUT", body: "x" })).status).toBe(401)
        expect((await req("/admin/boards", { method: "POST", body: "name=x", headers: form })).status).toBe(401)
        expect(
            (
                await req("/api/v1/board", {
                    method: "POST",
                    body: "{}",
                    headers: { "content-type": "application/json" },
                })
            ).status,
        ).toBe(401)
    })
    it("offen sind nur Login, Gastlink-Einstieg und statische Dateien", async () => {
        expect((await req("/login")).status).toBe(200)
        expect((await req("/s/gibt-es-nicht-gibt-es-nicht-gibt-es-nicht")).status).toBe(404)
        const js = fs.readdirSync(path.join(ROOT, "frontend/dist")).find((f) => f.endsWith(".js"))!
        expect((await req("/" + js)).status).toBe(200)
        expect(await (await req("/login")).text()).not.toContain('href="/b/')
    })
    it("WebSocket ohne Sitzung: Handshake abgelehnt (401), Lobby und Yjs ebenso", async () => {
        for (const p of ["/socket/lobby", "/socket/board/x", "/socket/yjs/board/x/"]) {
            expect(await wsConnect(p)).toEqual({ status: 401 })
        }
    })
    it("WebSocket mit fremdem Origin: abgelehnt", async () => {
        const r = await wsConnect("/socket/lobby", adminCookie, { origin: "http://boese.example" })
        expect(r).toEqual({ status: 403 })
    })
    it("Upstream-Lücken sind zu: kein Test-Login, kein Proxy, kein Upload ohne Sitzung", async () => {
        const t = await req("/test-callback", { cookie: adminCookie })
        expect(t.status).toBe(404)
        expect(t.headers.get("set-cookie")).toBeNull()
        expect((await req("/assets/external?src=http://127.0.0.1:1/", { cookie: adminCookie })).status).toBe(404) // nur noch Datei-Lookup in ASSET_DIR, nie ein Proxy
    })
})

describe("Admin", () => {
    it("legt Board per Formular an, sieht Liste und Gastlink", async () => {
        const r = await req("/admin/boards", {
            method: "POST",
            cookie: adminCookie,
            body: "name=Testkunde+Analyse",
            headers: form,
        })
        expect(r.status).toBe(303)
        const page = await (await req("/", { cookie: adminCookie, headers: html })).text()
        expect(page).toContain("Testkunde Analyse")
        expect(page).toMatch(/data-link="http:\/\/127\.0\.0\.1:1349\/s\/[A-Za-z0-9_-]{43}"/)
    })
    it("Cross-Site-POST (fremder Origin) wird abgewiesen", async () => {
        const r = await req("/admin/boards", {
            method: "POST",
            cookie: adminCookie,
            body: "name=x",
            headers: { ...form, origin: "http://boese.example" },
        })
        expect(r.status).toBe(403)
    })
    it("Admin öffnet jedes Board per WebSocket mit Admin-Rechten und stempelt createdBy=admin", async () => {
        const b = await newBoard("A1")
        await watch(b.id)
        const c = await joinBoard(adminCookie, b.id)
        const init = c.messages.find((m) => m.action === "board.init")
        expect(init.accessLevel).toBe("admin")
        send(c.ws, { action: "item.add", boardId: b.id, items: [note("n-admin")], connections: [] })
        expect(await waitFor(() => !!getBoardSync(b.id)?.board.items["n-admin"])).toBe(true)
        expect((await getBoard(b.id))!.board.items["n-admin"].createdBy).toBe("admin")
        c.ws.close()
    })
})
const getBoardSync = (id: string): any => (global as any).__b?.[id]
// kleine Hilfe: getBoard async -> Cache für waitFor
const origGet = getBoard
;(global as any).__b = {}
setInterval(async () => {
    for (const id of Object.keys((global as any).__b)) (global as any).__b[id] = await origGet(id)
}, 20).unref()
async function watch(id: string) {
    ;(global as any).__b[id] = await origGet(id)
}

describe("Übersicht in einem Request (/admin/uebersicht)", () => {
    it("Admin: alle Boards mit Gastlink, Vorschau und Zähler; archivierte Vorschau nur mit ?archiv=1", async () => {
        const a = await newBoard("Ü-Aktiv")
        const b = await newBoard("Ü-Archiv")
        const arch = await req(`/admin/boards/${b.id}/archive`, { method: "POST", cookie: adminCookie, body: "archived=1", headers: { ...form, accept: "application/json" } })
        expect(arch.status).toBe(200)
        const r = await req("/admin/uebersicht", { cookie: adminCookie, headers: { accept: "application/json" } })
        expect(r.status).toBe(200)
        expect(r.headers.get("cache-control")).toBe("no-store")
        const { boards } = (await r.json()) as { boards: any[] }
        const ta = boards.find((x) => x.id === a.id)
        const tb = boards.find((x) => x.id === b.id)
        expect(ta).toMatchObject({ name: "Ü-Aktiv", archived: false, leer: true, neu: 0 })
        expect(ta.svg).toContain("<svg")
        expect(ta.shareUrl).toBe(`http://127.0.0.1:1349/s/${a.token}`)
        expect(tb.archived).toBe(true)
        expect(tb.svg).toBeNull() // archiviert und nicht im Cache: wird nicht berechnet
        const voll = (await (await req("/admin/uebersicht?archiv=1", { cookie: adminCookie, headers: { accept: "application/json" } })).json()) as any
        expect(voll.boards.find((x: any) => x.id === b.id).svg).toContain("<svg")
    })
    it("Kunde: kein Zugriff (403), auch nicht mit fremdem Board; ohne Sitzung 401", async () => {
        const a = await newBoard("Ü-Kunde")
        const cookie = await customerCookie(a.token)
        const r = await req("/admin/uebersicht", { cookie, headers: { accept: "application/json" } })
        expect(r.status).toBe(403)
        expect(await r.text()).not.toContain("Ü-Kunde")
        expect((await req("/admin/uebersicht?archiv=1", { cookie })).status).toBe(403)
        expect((await req("/admin/uebersicht")).status).toBe(401)
    })
    it("viele Boards: alle kommen, ohne Verbindungs-Stau", async () => {
        const tag = `Ü-Viele-${uuid.v4().slice(0, 8)}`
        await Promise.all(Array.from({ length: 25 }, (_, i) => newBoard(`${tag} ${i}`)))
        const { boards } = (await (await req("/admin/uebersicht", { cookie: adminCookie })).json()) as any
        expect(boards.filter((x: any) => x.name.startsWith(tag)).length).toBe(25)
        expect(boards.every((x: any) => x.archived || x.svg !== null)).toBe(true)
    })
})

describe("Gastlink", () => {
    it("Token: ≥ 32 Zeichen, nicht die Board-ID; /s/<token> -> Sitzung nur für dieses Board", async () => {
        const b = await newBoard("K1")
        expect(b.token.length).toBeGreaterThanOrEqual(32)
        expect(b.token).not.toContain(b.id)
        const r = await req(`/s/${b.token}`)
        expect(r.status).toBe(303)
        expect(r.headers.get("location")).toBe(`/b/${b.id}`)
        expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/)
        const cookie = cookieFrom(r)
        const page = await req(`/b/${b.id}`, { cookie, headers: html })
        expect(page.status).toBe(200)
        expect(await page.text()).toContain("<html")
    })
    it("Kunde: keine Übersicht (Redirect aufs eigene Board), fremdes Board 403 (HTTP)", async () => {
        const a = await newBoard("K-A")
        const b = await newBoard("K-B")
        const cookie = await customerCookie(a.token)
        const home = await req("/", { cookie, headers: html })
        expect(home.status).toBe(302)
        expect(home.headers.get("location")).toBe(`/b/${a.id}`)
        const foreign = await req(`/b/${b.id}`, { cookie, headers: html })
        expect(foreign.status).toBe(403)
        expect(await foreign.text()).toContain("No access")
        expect((await req("/b/gibt-es-nicht", { cookie })).status).toBe(403)
    })
    it("Kunde: fremdes Board per WebSocket und Yjs 403, Lobby 403, eigenes Board offen", async () => {
        const a = await newBoard("W-A")
        const b = await newBoard("W-B")
        const cookie = await customerCookie(a.token)
        expect(await wsConnect(`/socket/board/${b.id}`, cookie)).toEqual({ status: 403 })
        expect(await wsConnect(`/socket/yjs/board/${b.id}/`, cookie)).toEqual({ status: 403 })
        expect(await wsConnect(`/socket/lobby`, cookie)).toEqual({ status: 403 })
        const own = await joinBoard(cookie, a.id)
        expect(own.messages.find((m) => m.action === "board.init").accessLevel).toBe("read-write")
        // Beitritt zu fremdem Board über die eigene Verbindung liefert keine Daten
        send(own.ws, { action: "board.join", boardId: b.id })
        await new Promise((r) => setTimeout(r, 300))
        expect(own.messages.filter((m) => m.action === "board.init").length).toBe(1)
        own.ws.close()
    })
    it("Kunde: gewählte Farbe bleibt, createdBy=customer wird erzwungen; ohne Farbe gilt die Kundenfarbe", async () => {
        const b = await newBoard("P1")
        await watch(b.id)
        const admin = await joinBoard(adminCookie, b.id)
        send(admin.ws, { action: "item.add", boardId: b.id, items: [note("von-admin")], connections: [] })
        const cookie = await customerCookie(b.token)
        const c = await joinBoard(cookie, b.id)
        send(c.ws, {
            action: "item.add",
            boardId: b.id,
            items: [note("n-kunde", { color: "#ff0000", createdBy: "admin" }), note("n-auto", { color: undefined })],
            connections: [],
        })
        expect(await waitFor(() => !!getBoardSync(b.id)?.board.items["n-auto"])).toBe(true)
        const items = (await getBoard(b.id))!.board.items as any
        expect(items["n-kunde"].color).toBe("#ff0000")
        expect(items["n-kunde"].createdBy).toBe("customer")
        expect(items["n-auto"].color).toBe(CUSTOMER_COLOR)
        // eigene Elemente dürfen umgefärbt werden, createdBy lässt sich nicht ändern
        send(c.ws, {
            action: "item.update",
            boardId: b.id,
            items: [{ id: "n-kunde", color: "#00ff00", createdBy: "admin", text: "neu" }],
        })
        expect(await waitFor(() => (getBoardSync(b.id)?.board.items["n-kunde"] as any)?.text === "neu")).toBe(true)
        const after = (await getBoard(b.id))!.board.items["n-kunde"] as any
        expect(after.color).toBe("#00ff00")
        expect(after.createdBy).toBe("customer")
        // Elemente vom Admin: Farbe bleibt, Text darf der Kunde ändern
        send(c.ws, { action: "item.update", boardId: b.id, items: [{ id: "von-admin", color: "#00ff00", text: "kommentiert" }] })
        expect(await waitFor(() => (getBoardSync(b.id)?.board.items["von-admin"] as any)?.text === "kommentiert")).toBe(true)
        expect(((await getBoard(b.id))!.board.items["von-admin"] as any).color).toBe("#ff0000")
        c.ws.close()
        admin.ws.close()
    })
    it("Kunde: Stift, Linie, Rechteck mit eigener Farbe; ungültige Zeichnung wird verworfen; löschen nur eigene", async () => {
        const b = await newBoard("Z1")
        await watch(b.id)
        const admin = await joinBoard(adminCookie, b.id)
        send(admin.ws, { action: "item.add", boardId: b.id, items: [note("von-admin")], connections: [] })
        const cookie = await customerCookie(b.token)
        const c = await joinBoard(cookie, b.id)
        const drawing = (id: string, extra: any = {}) => ({
            id, type: "drawing", kind: "pen", points: [[0, 0], [0.5, 0.4], [1, 1]], color: "#E53935", strokeWidth: 8,
            x: 3, y: 3, width: 4, height: 2, z: 0, locked: false, ...extra,
        })
        send(c.ws, { action: "item.add", boardId: b.id, items: [drawing("z-ok")], connections: [] })
        send(c.ws, { action: "item.add", boardId: b.id, items: [drawing("z-bad", { points: "x" })], connections: [] })
        send(c.ws, {
            action: "item.add",
            boardId: b.id,
            items: [note("r-blau", { flat: true, shape: "rect", color: "#ffffff00", borderColor: "#1E88E5", borderWidth: 8 })],
            connections: [],
        })
        expect(await waitFor(() => !!getBoardSync(b.id)?.board.items["r-blau"])).toBe(true)
        const items = (await getBoard(b.id))!.board.items as any
        expect(items["z-ok"]).toMatchObject({ createdBy: "customer", color: "#E53935", kind: "pen" })
        expect(items["z-bad"]).toBeUndefined()
        expect(items["r-blau"]).toMatchObject({ createdBy: "customer", borderColor: "#1E88E5" })
        // Rechte: eigene löschen ja, fremde nein
        send(c.ws, { action: "item.delete", boardId: b.id, itemIds: ["von-admin"], connectionIds: [] })
        send(c.ws, { action: "item.delete", boardId: b.id, itemIds: ["z-ok"], connectionIds: [] })
        expect(await waitFor(() => !getBoardSync(b.id)?.board.items["z-ok"])).toBe(true)
        expect(getBoardSync(b.id)?.board.items["von-admin"]).toBeDefined()
        c.ws.close()
        admin.ws.close()
    })
    it("Kunde darf nicht: Board anlegen/umbenennen/Zugriff ändern/Inhalt ersetzen; Elemente vom Admin bleiben", async () => {
        const b = await newBoard("V1")
        await watch(b.id)
        const admin = await joinBoard(adminCookie, b.id)
        send(admin.ws, { action: "item.add", boardId: b.id, items: [note("von-admin")], connections: [] })
        expect(await waitFor(() => !!getBoardSync(b.id)?.board.items["von-admin"])).toBe(true)
        const boardsBefore = (await withDBClient((c) => c.query("select count(*)::int n from board"))).rows[0].n
        const cookie = await customerCookie(b.token)
        const c = await joinBoard(cookie, b.id)
        send(c.ws, { action: "board.add", payload: { id: uuid.v4(), name: "Eigenes Board" } })
        send(c.ws, { action: "board.rename", boardId: b.id, name: "gehackt" })
        send(c.ws, {
            action: "board.setAccessPolicy",
            boardId: b.id,
            accessPolicy: { allowList: [], publicRead: true, publicWrite: true },
        })
        send(c.ws, { action: "item.bootstrap", boardId: b.id, items: [], connections: [] })
        send(c.ws, { action: "item.delete", boardId: b.id, itemIds: ["von-admin"], connectionIds: [] })
        send(c.ws, {
            action: "item.add",
            boardId: b.id,
            items: [note("von-admin", { text: "überschrieben" })],
            connections: [],
        })
        await new Promise((r) => setTimeout(r, 600))
        const st = (await getBoard(b.id))!.board as any
        expect(st.name).toBe("V1")
        expect(st.items["von-admin"]?.text).toBe("hallo")
        expect(st.accessPolicy).toBeUndefined()
        expect((await withDBClient((c) => c.query("select count(*)::int n from board"))).rows[0].n).toBe(boardsBefore)
        // eigene Elemente darf der Kunde löschen
        send(c.ws, { action: "item.add", boardId: b.id, items: [note("eigenes")], connections: [] })
        expect(await waitFor(() => !!getBoardSync(b.id)?.board.items["eigenes"])).toBe(true)
        send(c.ws, { action: "item.delete", boardId: b.id, itemIds: ["eigenes"], connectionIds: [] })
        expect(await waitFor(() => !getBoardSync(b.id)?.board.items["eigenes"])).toBe(true)
        // HTTP: Anlegen und Freigaben verboten (Grund: 403, nicht 401)
        expect((await req("/admin/boards", { method: "POST", cookie, body: "name=x", headers: form })).status).toBe(403)
        expect(
            (await req(`/admin/boards/${b.id}/share`, { method: "POST", cookie, body: "op=revoke", headers: form }))
                .status,
        ).toBe(403)
        c.ws.close()
        admin.ws.close()
    })
})

describe("Assets", () => {
    it("Kunde sieht nur Assets seines Boards; fremdes 403; unbekanntes 404; PUT ohne Sitzung 401; kein Überschreiben", async () => {
        const a = await newBoard("S-A")
        const b = await newBoard("S-B")
        await watch(a.id)
        const idA = "asset" + uuid.v4().replace(/-/g, "")
        const idB = "asset" + uuid.v4().replace(/-/g, "")
        expect((await req(`/assets/${idA}`, { method: "PUT", body: "AAA", cookie: adminCookie })).status).toBe(200)
        expect((await req(`/assets/${idB}`, { method: "PUT", body: "BBB", cookie: adminCookie })).status).toBe(200)
        const admin = await joinBoard(adminCookie, a.id)
        send(admin.ws, {
            action: "item.add",
            boardId: a.id,
            items: [{ id: "bild", type: "image", assetId: idA, x: 1, y: 1, width: 5, height: 5, z: 1, locked: false }],
            connections: [],
        })
        expect(await waitFor(() => !!getBoardSync(a.id)?.board.items["bild"])).toBe(true)
        admin.ws.close()
        const cookie = await customerCookie(a.token)
        const own = await req(`/assets/${idA}`, { cookie })
        expect(own.status).toBe(200)
        expect(await own.text()).toBe("AAA")
        expect(own.headers.get("content-security-policy")).toContain("sandbox")
        expect((await req(`/assets/${idB}`, { cookie })).status).toBe(403)
        expect((await req(`/assets/gibt-es-nicht-xyz`, { cookie })).status).toBe(404)
        expect((await req(`/assets/${idA}`)).status).toBe(401)
        expect((await req(`/assets/${idA}`, { method: "PUT", body: "XXX" })).status).toBe(401)
        // vorhandene Datei wird nie überschrieben
        expect((await req(`/assets/${idA}`, { method: "PUT", body: "XXX", cookie })).status).toBe(200)
        expect(await (await req(`/assets/${idA}`, { cookie })).text()).toBe("AAA")
        // Kunde lädt neues Bild hoch und sieht es, bevor es am Board hängt
        const idNew = "asset" + uuid.v4().replace(/-/g, "")
        expect((await req(`/assets/${idNew}`, { method: "PUT", body: "NEU", cookie })).status).toBe(200)
        expect(await (await req(`/assets/${idNew}`, { cookie })).text()).toBe("NEU")
        // ungültige Namen
        expect((await req(`/assets/..%2F..%2Fetc%2Fpasswd`, { method: "PUT", body: "x", cookie })).status).toBe(400)
    })
})

describe("Link erneuern / sperren", () => {
    it("rotate: alter Link und alte Sitzung sind tot (HTTP, WebSocket, Asset), offene Verbindung wird getrennt, neuer Link geht", async () => {
        const b = await newBoard("R1")
        const cookie = await customerCookie(b.token)
        const live = await joinBoard(cookie, b.id)
        const idA = "asset" + uuid.v4().replace(/-/g, "")
        await req(`/assets/${idA}`, { method: "PUT", body: "Z", cookie })
        expect((await req(`/b/${b.id}`, { cookie })).status).toBe(200)

        const fresh = await rotateShareToken(b.id)
        expect(fresh).not.toBe(b.token)
        expect(await waitFor(() => live.closed())).toBe(true)
        expect((await req(`/s/${b.token}`)).status).toBe(404)
        expect((await req(`/b/${b.id}`, { cookie, headers: html })).status).toBe(302)
        expect((await req(`/b/${b.id}`, { cookie })).status).toBe(401)
        expect((await req(`/assets/${idA}`, { cookie })).status).toBe(401)
        expect(await wsConnect(`/socket/board/${b.id}`, cookie)).toEqual({ status: 401 })
        const again = await customerCookie(fresh)
        expect((await req(`/b/${b.id}`, { cookie: again })).status).toBe(200)
    })
    it("revoke: Link und Sitzungen tot, bis neu erzeugt wird; Admin-Weg über /admin/boards/:id/share", async () => {
        const b = await newBoard("R2")
        const cookie = await customerCookie(b.token)
        await revokeShareToken(b.id)
        expect((await req(`/s/${b.token}`)).status).toBe(404)
        expect((await req(`/b/${b.id}`, { cookie })).status).toBe(401)
        const r = await req(`/admin/boards/${b.id}/share`, {
            method: "POST",
            cookie: adminCookie,
            body: "op=rotate",
            headers: form,
        })
        expect(r.status).toBe(303)
        const page = await (await req("/", { cookie: adminCookie, headers: html })).text()
        // nach dem Neuerzeugen zeigt die Kachel den neuen Link (Kachel trägt data-id und data-link)
        const m = new RegExp(`data-id="${b.id}"[^>]*data-link="http://127\\.0\\.0\\.1:1349/s/([A-Za-z0-9_-]{43})"`).exec(page)
        expect(m).not.toBeNull()
    })
    it("Admin-Sitzung bleibt von rotate/revoke unberührt", async () => {
        const b = await newBoard("R3")
        await rotateShareToken(b.id)
        expect((await req(`/b/${b.id}`, { cookie: adminCookie })).status).toBe(200)
    })
})

describe("Browser-Formulare", () => {
    it("Referrer-Policy erlaubt same-origin-Formulare (bei no-referrer sendet der Browser Origin: null und der Login scheiterte)", async () => {
        const r = await req("/login")
        expect(r.headers.get("referrer-policy")).toBe("same-origin")
    })
})

describe("Passwort-Login", () => {
    it("Passwort-Login funktioniert weiter", async () => {
        loginGlobalLimiter.reset("*")
        expect((await login(ADMIN_PW)).status).toBe(303)
    })
})

describe("Language (WHITEBOARD_LANGUAGE, ?lang=)", () => {
    it("default is English: login page, invalid guest link, app shell", async () => {
        const loginHtml = await (await req("/login", { headers: html })).text()
        expect(loginHtml).toContain('<html lang="en">')
        expect(loginHtml).toContain("<title>Sign in – Post-it Chaos</title>")
        const bad = await req(`/s/${"x".repeat(43)}`, { headers: { ...html, "x-forwarded-for": freshIp() } })
        expect(bad.status).toBe(404)
        expect(await bad.text()).toContain("Link not valid")
        const b = await newBoard("Lang-EN")
        const shell = await (await req(`/b/${b.id}`, { cookie: adminCookie, headers: html })).text()
        expect(shell).toContain('<meta name="wb-language" content="en" />')
    })
    it("WHITEBOARD_LANGUAGE=de switches the server-rendered pages and the app shell to German", async () => {
        process.env.WHITEBOARD_LANGUAGE = "de"
        try {
            const loginHtml = await (await req("/login", { headers: html })).text()
            expect(loginHtml).toContain('<html lang="de">')
            expect(loginHtml).toContain("<title>Anmelden – Post-it Chaos</title>")
            expect(loginHtml).toContain("Passwort")
            const wrong = await login("falsch-falsch-falsch")
            expect(await wrong.text()).toContain("Passwort falsch")
            const home = await (await req("/", { cookie: adminCookie, headers: html })).text()
            expect(home).toContain("Neues Board")
            expect(home).toContain("Boards durchsuchen")
            expect(home).not.toContain("New board")
            const bad = await req(`/s/${"y".repeat(43)}`, { headers: { ...html, "x-forwarded-for": freshIp() } })
            expect(await bad.text()).toContain("Link nicht gültig")
            const b = await newBoard("Lang-DE")
            const shell = await (await req(`/b/${b.id}`, { cookie: adminCookie, headers: html })).text()
            expect(shell).toContain('<meta name="wb-language" content="de" />')
            expect(shell).toContain('<html lang="de">')
        } finally {
            process.env.WHITEBOARD_LANGUAGE = "en"
        }
    })
    it("?lang=de overrides the English default and is remembered in a cookie; unknown values are ignored", async () => {
        const r = await req("/login?lang=de", { headers: html })
        expect(await r.text()).toContain("Anmelden")
        const langCookie = (r.headers.get("set-cookie") ?? "").split(";")[0]
        expect(langCookie).toBe("wb_lang=de")
        const next = await (await req("/login", { cookie: langCookie, headers: html })).text()
        expect(next).toContain("Anmelden")
        const bogus = await req("/login?lang=xx", { headers: html })
        expect(await bogus.text()).toContain("Sign in")
        expect(bogus.headers.get("set-cookie")).toBeNull()
    })
})
