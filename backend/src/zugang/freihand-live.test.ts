// Live-Zwischenstände beim Zeichnen ("drawing.live"): gehen an die anderen Teilnehmer, werden nie gespeichert und
// laufen durch dieselbe Prüfung wie fertige Zeichnungen.
// Aufruf: DATABASE_URL=postgres://<user>@127.0.0.1:5432/whiteboard_freihand npm run test:unit -- freihand-live
import fs from "fs"
import path from "path"
import * as uuid from "uuid"
import WebSocket from "ws"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const PORT = 1351
const ADMIN_PW = "richtiges-passwort-123"
const ROOT = path.resolve(__dirname, "../../..")
const ASSET_DIR = path.resolve(process.env.WB_TEST_ASSET_DIR ?? path.join(ROOT, "backend/localfiles-test-freihand"))

vi.hoisted(() => {
    process.env.DATABASE_URL ??= "postgres://postitchaos@127.0.0.1:5432/postitchaos"
    process.env.WHITEBOARD_SESSION_SECRET = "test-secret-test-secret-test-secret-0123456789"
    process.env.PUBLIC_URL = "http://127.0.0.1:1351"
    process.env.PORT = "1351"
})

import { addBoard, getBoard } from "../board-state"
import { initDB } from "../db"
import { startExpressServer } from "../express-server"
import { hashPassword } from "./password"
import { ensureShareToken } from "./share-tokens"

let stop: () => void
let adminCookie: string
const BASE = `http://127.0.0.1:${PORT}`
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]

async function newBoard() {
    const id = uuid.v4()
    await addBoard({ width: 800, height: 600, id, name: "Live", items: {}, connections: [], serial: 0 } as any)
    return { id, token: await ensureShareToken(id) }
}
function wsConnect(p: string, cookie: string) {
    return new Promise<{ ws: WebSocket; messages: any[] }>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}${p}`, { headers: { cookie } })
        const messages: any[] = []
        ws.on("message", (d) => {
            try {
                messages.push(JSON.parse(d.toString()))
            } catch {}
        })
        ws.on("unexpected-response", (_r, res) => reject(new Error("ws " + res.statusCode)))
        ws.on("error", () => {})
        ws.on("open", () => resolve({ ws, messages }))
    })
}
const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
    const t = Date.now()
    while (Date.now() - t < ms) {
        if (await f()) return true
        await new Promise((r) => setTimeout(r, 25))
    }
    return false
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const send = (ws: WebSocket, ...events: any[]) => ws.send(JSON.stringify({ events }))
async function join(cookie: string, boardId: string) {
    const c = await wsConnect(`/socket/board/${boardId}`, cookie)
    send(c.ws, { action: "board.join", boardId })
    expect(await until(() => c.messages.some((m) => m.action === "board.init"))).toBe(true)
    return c
}
const itemOf = async (boardId: string, id: string) => (await getBoard(boardId))!.board.items[id]
const drawing = (id: string, extra: any = {}) => ({
    id,
    type: "drawing",
    kind: "pen",
    points: [
        [0, 0],
        [0.5, 0.4],
        [1, 1],
    ],
    color: "#E53935",
    strokeWidth: 8,
    x: 3,
    y: 3,
    width: 4,
    height: 2,
    z: 0,
    locked: false,
    ...extra,
})

beforeAll(async () => {
    process.chdir(path.join(ROOT, "backend"))
    fs.mkdirSync(ASSET_DIR, { recursive: true })
    process.env.ASSETS_DIR = ASSET_DIR
    process.env.WHITEBOARD_ADMIN_PASSWORD_HASH = await hashPassword(ADMIN_PW)
    await initDB()
    stop = startExpressServer(PORT)
    await sleep(300)
    const r = await fetch(BASE + "/login", {
        method: "POST",
        redirect: "manual",
        body: `password=${encodeURIComponent(ADMIN_PW)}`,
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "10.9.9.9" },
    })
    adminCookie = cookieFrom(r)
}, 60000)
afterAll(() => stop?.())

describe("Freihand live", () => {
    it("Kunde zeichnet: Admin sieht Zwischenstände sofort, nichts wird gespeichert; Endstand per item.add bleibt", async () => {
        const b = await newBoard()
        const admin = await join(adminCookie, b.id)
        const cust = await join(cookieFrom(await fetch(`${BASE}/s/${b.token}`, { redirect: "manual" })), b.id)
        const serialBefore = (await getBoard(b.id))!.board.serial

        send(cust.ws, { action: "drawing.live", boardId: b.id, item: drawing("live-1") })
        await sleep(60) // Drosselung: höchstens ein Zwischenstand je 40 ms pro Verbindung
        send(cust.ws, {
            action: "drawing.live",
            boardId: b.id,
            item: drawing("live-1", {
                points: [
                    [0, 0],
                    [0.5, 0.4],
                    [0.8, 0.9],
                    [1, 1],
                ],
            }),
        })
        expect(await until(() => admin.messages.filter((m) => m.action === "drawing.live").length === 2)).toBe(true)
        const live = admin.messages.filter((m) => m.action === "drawing.live")
        expect(live[1].item).toMatchObject({ id: "live-1", kind: "pen" })
        expect(live[1].item.points).toHaveLength(4)
        // Absender bekommt seinen eigenen Zwischenstand nicht zurück
        expect(cust.messages.some((m) => m.action === "drawing.live")).toBe(false)
        // nichts gespeichert
        expect(await itemOf(b.id, "live-1")).toBeUndefined()
        expect((await getBoard(b.id))!.board.serial).toBe(serialBefore)

        send(cust.ws, { action: "item.add", boardId: b.id, items: [drawing("live-1")], connections: [] })
        expect(await until(async () => !!(await itemOf(b.id, "live-1")))).toBe(true)
        cust.ws.close()
        admin.ws.close()
    })
    it("Ungültige Zwischenstände werden abgewiesen (Form, Punktezahl, Farbe, fremdes Board, bestehendes Element)", async () => {
        const b = await newBoard()
        const other = await newBoard()
        const admin = await join(adminCookie, b.id)
        const cust = await join(cookieFrom(await fetch(`${BASE}/s/${b.token}`, { redirect: "manual" })), b.id)
        send(admin.ws, { action: "item.add", boardId: b.id, items: [drawing("von-admin")], connections: [] })
        expect(await until(async () => !!(await itemOf(b.id, "von-admin")))).toBe(true)

        const tooMany = Array.from({ length: 1300 }, (_, i) => [i / 1300, 0.5])
        for (const bad of [
            { boardId: b.id, item: drawing("a", { points: "x" }) },
            { boardId: b.id, item: drawing("a", { points: tooMany }) },
            { boardId: b.id, item: drawing("a", { color: "red; x" }) },
            { boardId: other.id, item: drawing("a") }, // fremdes Board
            { boardId: b.id, item: drawing("von-admin") }, // bestehendes Element
            { boardId: b.id, item: { ...drawing("a"), type: "note" } },
        ]) {
            send(cust.ws, { action: "drawing.live", ...bad })
        }
        // gültiger Folge-Zwischenstand als Marker: kommt an, die ungültigen davor nicht
        send(cust.ws, { action: "drawing.live", boardId: b.id, item: drawing("marker") })
        expect(
            await until(() => admin.messages.some((m) => m.action === "drawing.live" && m.item.id === "marker")),
        ).toBe(true)
        expect(admin.messages.filter((m) => m.action === "drawing.live").map((m) => m.item.id)).toEqual(["marker"])
        cust.ws.close()
        admin.ws.close()
    })
    it("Drosselung: Flut von 100 Zwischenständen -> nur wenige kommen an, Verbindung bleibt offen", async () => {
        const b = await newBoard()
        const admin = await join(adminCookie, b.id)
        const cust = await join(cookieFrom(await fetch(`${BASE}/s/${b.token}`, { redirect: "manual" })), b.id)
        const t0 = Date.now()
        for (let i = 0; i < 100; i++) send(cust.ws, { action: "drawing.live", boardId: b.id, item: drawing("flut") })
        await sleep(500)
        const got = admin.messages.filter((m) => m.action === "drawing.live").length
        const maxAllowed = Math.floor((Date.now() - t0) / 40) + 1
        expect(got).toBeGreaterThanOrEqual(1)
        expect(got).toBeLessThanOrEqual(Math.min(maxAllowed, 5))
        expect(cust.ws.readyState).toBe(WebSocket.OPEN)
        // danach geht es wieder
        await sleep(60)
        send(cust.ws, { action: "drawing.live", boardId: b.id, item: drawing("danach") })
        expect(
            await until(() => admin.messages.some((m) => m.action === "drawing.live" && m.item.id === "danach")),
        ).toBe(true)
        cust.ws.close()
        admin.ws.close()
    })
})
