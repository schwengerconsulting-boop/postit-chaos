/**
 * Browser-Regressionstests (echtes Chrome) für Fokus und Tastatur im Board:
 *  1. Im Textbearbeitungsmodus markiert Ziehen mit der Maus Text und verschiebt NICHT das Element.
 *     Außerhalb des Bearbeitungsmodus bleibt Ziehen = Verschieben.
 *  2. Rückgängig/Wiederholen (Strg/Cmd+Z, Strg/Cmd+Umschalt+Z, Werkzeugleisten-Button) wirkt auf die letzte
 *     Board-Aktion, auch wenn ein Element ausgewählt ist. Im Textbearbeitungsmodus macht Strg/Cmd+Z
 *     zuerst nur die Textänderung rückgängig.
 *
 * Braucht Postgres (DATABASE_URL), das gebaute Frontend (npm run build:frontend) und ein installiertes Chrome.
 * Fehlt Chrome (oder WB_CHROME_PATH), werden die Tests übersprungen.
 * Aufruf (im Ordner apps/whiteboard):
 *   DATABASE_URL=postgres://... TEST_TARGET=integration npx vitest --run browser-text-und-undo
 */
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { awaitSavingChanges } from "../../backend/src/board-state"
import { closeConnectionPool, initDB } from "../../backend/src/db"
import { startExpressServer } from "../../backend/src/express-server"

const TOKEN = "test-token-" + Math.random().toString(36).slice(2)
const PORT = 1396
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

/** Legt ein Board mit einem Kasten (zwei Zeilen), einer Notiz und einem einzeiligen Text an, gibt den Gastlink zurück. */
async function seedBoard() {
    const b = await api("POST", "/boards", { name: "Browsertest" })
    await api("POST", `/boards/${b.id}/shapes`, {
        data: {
            shape: "round_rectangle",
            content: "<p>Dies ist ein langer Beispieltext zum Markieren im Kasten</p><p>Zweite Zeile mit mehr Text zum Ziehen</p>",
        },
        style: { fillColor: "#e6f6ee" },
        geometry: { width: 400, height: 200 },
        position: { x: 0, y: 0 },
    })
    await api("POST", `/boards/${b.id}/sticky_notes`, {
        data: { content: "<p>Einzeilige Notiz zum Markieren hier</p>" },
        style: { fillColor: "light_yellow" },
        geometry: { width: 240 },
        position: { x: 600, y: 0 },
    })
    return b.shareLink as string
}

async function openBoard(url: string) {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
    await page.goto(url)
    await page.waitForSelector(".online .board")
    await page.waitForSelector("[data-itemid] .ql-editor")
    await page.waitForTimeout(500)
    return page
}

const item = (page: any, text: string) => page.locator("[data-itemid]").filter({ hasText: text }).first()
const x = async (loc: any) => Math.round((await loc.boundingBox()).x)
const selectedText = (page: any) => page.evaluate(() => String(window.getSelection()))
const activeIsEditor = (page: any) => page.evaluate(() => document.activeElement?.classList.contains("ql-editor"))
const itemClass = (loc: any) => loc.getAttribute("class") as Promise<string>
const MOD = "ControlOrMeta"

/** Auswählen (1. Klick) und in den Bearbeitungsmodus (2. Klick). */
async function enterEditing(page: any, loc: any) {
    await loc.click()
    await page.waitForTimeout(250)
    await loc.click()
    await page.waitForTimeout(350)
    expect(await activeIsEditor(page)).toBe(true)
}

beforeAll(async () => {
    process.env.WHITEBOARD_API_TOKEN = TOKEN
    process.env.WHITEBOARD_LANGUAGE = "en"
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

const t = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
        if (skipReason) {
            console.warn("Browsertest übersprungen: " + skipReason)
            return ctx.skip()
        }
        await fn()
    }, 60000)

describe("Text markieren im Bearbeitungsmodus", () => {
    t("Ziehen mit der Maus im Text markiert, der Kasten bleibt stehen (mehrzeilig)", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await enterEditing(page, box)
        const b = await box.locator(".ql-editor p").first().boundingBox() // Text, nicht der Rand des Kastens
        const x0 = await x(box)
        const y = b.y + b.height / 2
        await page.mouse.move(b.x + 5, y)
        await page.mouse.down()
        await page.mouse.move(b.x + 50, y, { steps: 6 })
        await page.mouse.move(b.x + 90, y, { steps: 6 })
        await page.mouse.up()
        await page.waitForTimeout(300)
        const sel = await selectedText(page)
        expect(sel.length).toBeGreaterThan(3)
        expect(sel.length).toBeLessThan(40)
        expect(await x(box)).toBe(x0)
        expect(await itemClass(box)).toContain("selected")
        expect(await activeIsEditor(page)).toBe(true)
    })

    t("Ziehen im einzeiligen Text (beim Betreten komplett vorausgewählt) markiert einen Teil, verschiebt nicht", async () => {
        const page = await openBoard(await seedBoard())
        const note = item(page, "Einzeilige Notiz")
        await enterEditing(page, note)
        const b = await note.locator(".ql-editor p").first().boundingBox()
        const x0 = await x(note)
        const y = b.y + b.height / 4
        await page.mouse.move(b.x + 5, y)
        await page.mouse.down()
        await page.mouse.move(b.x + 40, y, { steps: 6 })
        await page.mouse.up()
        await page.waitForTimeout(300)
        const sel = await selectedText(page)
        expect(sel.length).toBeGreaterThan(1)
        expect(sel).not.toContain("Einzeilige Notiz zum Markieren hier") // nicht mehr alles
        expect(await x(note)).toBe(x0)
        expect(await activeIsEditor(page)).toBe(true)
    })

    t("Doppelklick markiert ein Wort, der Kasten bleibt stehen", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await enterEditing(page, box)
        const b = await box.locator(".ql-editor p").first().boundingBox()
        const x0 = await x(box)
        await page.mouse.dblclick(b.x + 8, b.y + b.height / 2)
        await page.waitForTimeout(300)
        expect((await selectedText(page)).trim()).toMatch(/^\S+$/)
        expect(await x(box)).toBe(x0)
    })

    t("Ein Drag-Ereignis im Bearbeitungsmodus bewegt das Element nicht und beendet die Bearbeitung nicht", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await enterEditing(page, box)
        const b = await box.boundingBox()
        const x0 = await x(box)
        await dragWithEvents(page, box, b, 120, 60)
        expect(await x(box)).toBe(x0)
        expect(await itemClass(box)).toContain("selected")
    })

    t("Ziehen am Rand/Innenabstand des Kastens im Bearbeitungsmodus bewegt nichts (weder Kasten noch Board)", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await enterEditing(page, box)
        const b = await box.boundingBox()
        const x0 = await x(box)
        const scroll = () => page.evaluate(() => [document.querySelector(".scroll-container")!.scrollLeft, document.querySelector(".scroll-container")!.scrollTop])
        const s0 = await scroll()
        await page.mouse.move(b.x + 3, b.y + 3) // Innenabstand, nicht auf dem Text
        await page.mouse.down()
        await page.mouse.move(b.x + 60, b.y + 40, { steps: 6 })
        await page.mouse.move(b.x + 160, b.y + 90, { steps: 6 })
        await page.mouse.up()
        await page.waitForTimeout(400)
        expect(await x(box)).toBe(x0)
        expect(await scroll()).toEqual(s0)
        expect(await itemClass(box)).toContain("selected")
        expect(await activeIsEditor(page)).toBe(true)
    })

    t("Esc beendet die Bearbeitung, danach verschiebt Ziehen den ausgewählten Kasten", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await enterEditing(page, box)
        await page.keyboard.press("Escape")
        await page.waitForTimeout(300)
        expect(await activeIsEditor(page)).toBe(false)
        expect(await itemClass(box)).toContain("selected")
        const b = await box.boundingBox()
        const x0 = await x(box)
        await dragWithEvents(page, box, b, 120, 60)
        expect(await x(box)).toBeGreaterThan(x0 + 20)
    })

    t("Klick daneben beendet die Bearbeitung", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await enterEditing(page, box)
        await page.mouse.click(1000, 800)
        await page.waitForTimeout(300)
        expect(await itemClass(box)).not.toContain("selected")
        expect(await activeIsEditor(page)).toBe(false)
    })

    t("Negativfall: Ziehen ausserhalb des Bearbeitungsmodus verschiebt das Element weiterhin", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await box.click() // nur ausgewählt, nicht im Bearbeitungsmodus
        await page.waitForTimeout(300)
        expect(await activeIsEditor(page)).toBe(false)
        const b = await box.boundingBox()
        const x0 = await x(box)
        await dragWithEvents(page, box, b, 120, 60)
        expect(await x(box)).toBeGreaterThan(x0 + 20)
    })
})

/** Simuliert das Ziehen per HTML5-Drag-Ereignissen (Playwright liefert für native Drags keine "drag"-Ereignisse). */
async function dragWithEvents(page: any, loc: any, b: any, dx: number, dy: number) {
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const init = (px: number, py: number) => ({ clientX: px, clientY: py, screenX: px, screenY: py, bubbles: true })
    await page.mouse.move(cx, cy)
    await loc.dispatchEvent("dragstart", { ...init(cx, cy), dataTransfer: await page.evaluateHandle(() => new DataTransfer()) })
    for (let i = 1; i <= 6; i++) {
        await page.mouse.move(cx + (dx * i) / 6, cy + (dy * i) / 6)
        await loc.dispatchEvent("drag", init(cx + (dx * i) / 6, cy + (dy * i) / 6))
        await page.waitForTimeout(30)
    }
    await loc.dispatchEvent("dragend", init(cx + dx, cy + dy))
    await page.waitForTimeout(400)
}

describe("Rückgängig / Wiederholen bei ausgewähltem Element", () => {
    /** Element per Pfeiltaste verschieben (Board-Aktion), danach DOM-Fokus in den Editor legen wie nach Mausdruck auf den Text. */
    async function moveThenFocusEditor(page: any, box: any) {
        await box.click()
        await page.waitForTimeout(300)
        const x0 = await x(box)
        for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight")
        await page.waitForTimeout(300)
        const x1 = await x(box)
        expect(x1).toBeGreaterThan(x0)
        await box.locator(".ql-editor").evaluate((el: HTMLElement) => el.focus())
        expect(await activeIsEditor(page)).toBe(true)
        expect(await itemClass(box)).toContain("selected")
        expect(await itemClass(box)).not.toContain("editing")
        return { x0, x1 }
    }

    t("Strg/Cmd+Z macht die letzte Board-Aktion rückgängig, Strg/Cmd+Umschalt+Z stellt sie wieder her", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        const { x0, x1 } = await moveThenFocusEditor(page, box)
        await page.keyboard.press(`${MOD}+z`)
        await page.waitForTimeout(400)
        expect(await x(box)).toBe(x0)
        await page.keyboard.press(`${MOD}+Shift+z`)
        await page.waitForTimeout(400)
        expect(await x(box)).toBe(x1)
    })

    t("Rückgängig-Button der Werkzeugleiste wirkt bei ausgewähltem Element", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        const { x0 } = await moveThenFocusEditor(page, box)
        await page.locator('[data-testid="toolbar"] .action.undo').click()
        await page.waitForTimeout(400)
        expect(await x(box)).toBe(x0)
    })

    t("Rückgängig nimmt ein neu angelegtes, ausgewähltes Element zurück", async () => {
        const page = await openBoard(await seedBoard())
        const before = await page.locator("[data-itemid]").count()
        await page.getByRole("button", { name: /Note/ }).first().click()
        await page.mouse.click(900, 700)
        await page.waitForTimeout(500)
        await page.keyboard.press("Escape") // Bearbeitung beenden, Notiz bleibt ausgewählt
        await page.waitForTimeout(300)
        const neu = page.locator("[data-itemid].selected").first()
        expect(await page.locator("[data-itemid]").count()).toBe(before + 1)
        await neu.locator(".ql-editor").evaluate((el: HTMLElement) => el.focus()) // Fokus im Editor, Auswahl bleibt
        await page.keyboard.press(`${MOD}+z`)
        await page.waitForTimeout(400)
        expect(await page.locator("[data-itemid]").count()).toBe(before)
    })

    t("Negativfall: Strg/Cmd+Z beim Tippen im Text macht nur den Text rückgängig, nicht die Board-Aktion", async () => {
        const page = await openBoard(await seedBoard())
        const box = item(page, "langer Beispieltext")
        await box.click()
        await page.waitForTimeout(300)
        for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight")
        await page.waitForTimeout(300)
        const moved = await x(box)
        await enterEditing(page, box)
        await page.keyboard.press(`${MOD}+End`)
        await page.keyboard.type(" XYZ")
        await page.waitForTimeout(300)
        expect(await box.innerText()).toContain("XYZ")
        await page.keyboard.press(`${MOD}+z`)
        await page.waitForTimeout(400)
        expect(await box.innerText()).not.toContain("XYZ")
        expect(await x(box)).toBe(moved) // Verschiebung bleibt
    })
})
