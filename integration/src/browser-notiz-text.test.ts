/**
 * Browser-Regressionstest (echtes Chrome): Text, der in eine Notiz getippt wird, bleibt innerhalb der Notiz.
 * Vorher lief langer Text beim Tippen links und rechts über die Notiz hinaus, weil der Editor die Schrift
 * nicht an die Notizgröße anpasste.
 *
 * Braucht Postgres (DATABASE_URL), das gebaute Frontend (npm run build:frontend) und ein installiertes Chrome.
 * Fehlt Chrome (oder WB_CHROME_PATH), wird der Test übersprungen.
 * Aufruf (im Ordner apps/whiteboard):
 *   DATABASE_URL=postgres://... TEST_TARGET=integration npx vitest --run browser-notiz-text
 */
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { awaitSavingChanges } from "../../backend/src/board-state"
import { closeConnectionPool, initDB } from "../../backend/src/db"
import { startExpressServer } from "../../backend/src/express-server"

const TOKEN = "test-token-" + Math.random().toString(36).slice(2)
const PORT = 1395
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

describe("Notiztext beim Tippen", () => {
    it("langer Text und langes Wort bleiben innerhalb der Notiz", async (ctx) => {
        if (skipReason) {
            console.warn("Browsertest übersprungen: " + skipReason)
            return ctx.skip()
        }
        const b = await api("POST", "/boards", { name: "Browsertest Notiz" })
        await api("POST", `/boards/${b.id}/sticky_notes`, {
            data: { content: "<p>Start</p>" },
            style: { fillColor: "light_yellow" },
            geometry: { width: 200 },
            position: { x: 0, y: 150 },
        })
        const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
        await page.goto(b.shareLink)
        await page.waitForSelector(".online .board")
        await page.waitForSelector("[data-itemid] .ql-editor")
        await page.waitForTimeout(500)

        const id = await page.locator("[data-itemid]").filter({ hasText: "Start" }).first().getAttribute("data-itemid")
        const note = page.locator(`[data-itemid="${id}"]`)
        await note.click()
        await page.waitForTimeout(250)
        await note.click()
        await page.waitForTimeout(350)
        await page.keyboard.press("End")
        await page.keyboard.type(
            "Bitte die Maße in der Mail nochmal prüfen, beim Modell A stimmen die Werte nicht ganz. Außerdem sollte die " +
                "Größentabelle aktualisiert werden, weil die Brustweite seit dem letzten Schnitt anders ausfällt. " +
                "Donaudampfschifffahrtsgesellschaftskapitän",
            { delay: 5 },
        )
        await page.waitForTimeout(500)

        const n = await note.boundingBox()
        const words = await note.evaluate((el: HTMLElement) => {
            const r = document.createRange()
            r.selectNodeContents(el.querySelector(".ql-editor")!)
            const rects = Array.from(r.getClientRects())
            return {
                left: Math.min(...rects.map((x) => x.left)),
                right: Math.max(...rects.map((x) => x.right)),
                top: Math.min(...rects.map((x) => x.top)),
                bottom: Math.max(...rects.map((x) => x.bottom)),
            }
        })
        expect(words.left).toBeGreaterThanOrEqual(n.x - 1)
        expect(words.right).toBeLessThanOrEqual(n.x + n.width + 1)
        expect(words.top).toBeGreaterThanOrEqual(n.y - 1)
        expect(words.bottom).toBeLessThanOrEqual(n.y + n.height + 1)
    }, 60000)
})
