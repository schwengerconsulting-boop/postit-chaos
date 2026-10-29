/**
 * Browser-Regressionstest (echtes Chrome): Eine Notiz lässt sich über die Ecke vergrößern, auch direkt nach dem
 * Tippen (Textbearbeitungsmodus). Vorher sperrte die Regel „im Bearbeitungsmodus kein Ziehen“ auch die Ecken.
 *
 * Braucht Postgres (DATABASE_URL), das gebaute Frontend (npm run build:frontend) und ein installiertes Chrome.
 * Aufruf (im Ordner apps/whiteboard):
 *   DATABASE_URL=postgres://... TEST_TARGET=integration npx vitest --run browser-notiz-resize
 */
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { awaitSavingChanges } from "../../backend/src/board-state"
import { closeConnectionPool, initDB } from "../../backend/src/db"
import { startExpressServer } from "../../backend/src/express-server"

const TOKEN = "test-token-" + Math.random().toString(36).slice(2)
const PORT = 1394
const BASE = `http://127.0.0.1:${PORT}`
const ROOT = path.resolve(__dirname, "../..")
const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-assets-"))

let stop: (() => void) | undefined
let browser: any
let skipReason: string | null = null
const cwd = process.cwd()

async function api(method: string, p: string, body?: any) {
    const r = await fetch(BASE + "/v2" + p, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    return r.json() as Promise<any>
}

beforeAll(async () => {
    process.env.WHITEBOARD_API_TOKEN = TOKEN
    process.env.ASSETS_DIR = assetsDir
    process.env.PUBLIC_URL = BASE
    process.env.WHITEBOARD_SESSION_SECRET ??= "integrationstest-geheimnis-mindestens-32-zeichen"
    if (!fs.existsSync(path.join(ROOT, "frontend/dist"))) {
        skipReason = "frontend/dist fehlt (npm run build:frontend)"
        return
    }
    try {
        const { chromium } = await import("playwright-core")
        browser = await chromium.launch(
            process.env.WB_CHROME_PATH
                ? { executablePath: process.env.WB_CHROME_PATH, headless: true }
                : { channel: "chrome", headless: true },
        )
    } catch (e) {
        skipReason = "kein Chrome verfügbar: " + String(e).split("\n")[0]
        return
    }
    await initDB("./backend")
    process.chdir(path.join(ROOT, "backend")) // express liefert ../frontend/dist relativ zum Arbeitsordner
    stop = startExpressServer(PORT)
    await new Promise((r) => setTimeout(r, 300))
})

afterAll(async () => {
    await browser?.close()
    stop?.()
    process.chdir(cwd)
    if (!skipReason) {
        await awaitSavingChanges()
        closeConnectionPool()
    }
})

describe("Notiz vergrößern nach dem Tippen", () => {
    it("Ecke ziehen vergrößert die Notiz, auch direkt nach dem Tippen", async (ctx) => {
        if (skipReason) return ctx.skip()
        const b = await api("POST", "/boards", { name: "Browsertest Resize" })
        await api("POST", `/boards/${b.id}/sticky_notes`, {
            data: { content: "<p>Hallo was willst du wissen</p>" },
            style: { fillColor: "light_yellow" },
            geometry: { width: 200 },
            position: { x: 0, y: 150 },
        })
        const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
        await page.goto(b.shareLink)
        await page.waitForSelector(".online .board")
        await page.waitForSelector("[data-itemid] .ql-editor")
        await page.waitForTimeout(500)
        const id = await page.locator("[data-itemid]").filter({ hasText: "Hallo" }).first().getAttribute("data-itemid")
        const note = page.locator(`[data-itemid="${id}"]`)
        const b0 = await note.boundingBox()
        await note.click()
        await page.waitForTimeout(250)
        await note.click()
        await page.waitForTimeout(350)
        await page.keyboard.type("Hallo was willst du wissen noch von mir", { delay: 5 })
        await page.waitForTimeout(500)
        const b1 = await note.boundingBox()
        const hb = await page.locator(".corner-resize-drag.right.bottom").first().boundingBox()
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
        await page.mouse.down()
        for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + 8 * i, hb.y + 8 * i)
        await page.mouse.up()
        await page.waitForTimeout(500)
        const b2 = await note.boundingBox()
        expect(Math.abs(b1.y - b0.y)).toBeLessThan(5)
        expect(b2.width).toBeGreaterThan(b1.width + 10)
    }, 60000)
})
