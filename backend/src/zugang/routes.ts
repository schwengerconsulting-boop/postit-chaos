import express, { NextFunction, Request, Response } from "express"
import fs from "fs"
import path from "path"
import * as uuid from "uuid"
import { CrdtEnabled, defaultBoardSize } from "../../../common/src/domain"
import { addBoard, getBoard } from "../board-state"
import { withDBClient } from "../db"
import { mayAccessBoard, resolveAuth, WbAuth } from "./auth"
import { ADMIN_TTL_S, clearCookieHeader, CUSTOMER_TTL_S, sessionCookieHeader } from "./cookie-session"
import { verifyPassword } from "./password"
import { translate } from "../../../common/src/i18n"
import { langCookieHeader, requestLanguage } from "./language"
import { adminPage, BoardTile, loginPage, messagePage } from "./pages"
import { FailureLimiter } from "./rate-limit"
import { adminPasswordHash, publicUrl } from "./settings"
import { ensureShareToken, getShareToken, resolveShareToken, revokeShareToken, rotateShareToken } from "./share-tokens"
import { ASSET_ID_RE } from "./ws-guard"
import {
    boardSnapshot,
    buildOverview,
    getBoardRow,
    idPrefixOf,
    renameBoard,
    setArchived,
    touchAdminVisit,
} from "./uebersicht"

declare global {
    namespace Express {
        interface Request {
            wb?: WbAuth
        }
    }
}

const MAX_ASSET_BYTES = 25 * 1024 * 1024
const ipOf = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "?"

// Failed attempts: 5 per IP per 15 minutes, 40 in total (all IPs) per 15 minutes.
export const loginLimiter = new FailureLimiter(5, 15 * 60 * 1000)
export const loginGlobalLimiter = new FailureLimiter(40, 15 * 60 * 1000)
export const shareLimiter = new FailureLimiter(20, 15 * 60 * 1000)

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "same-origin")
    res.setHeader("X-Frame-Options", "DENY")
    next()
}

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store")
const wantsJson = (req: Request) => (req.headers.accept ?? "").includes("application/json")
const wantsHtml = (req: Request) => req.method === "GET" && (req.headers.accept ?? "").includes("text/html")

/** Gate: nothing gets through without a valid session (browsers -> /login, everything else 401). */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
    try {
        const auth = await resolveAuth(req)
        if (!auth) {
            if (wantsHtml(req)) return res.redirect(302, "/login")
            return res.status(401).json({ error: "unauthorized" })
        }
        req.wb = auth
        next()
    } catch (e) {
        next(e)
    }
}

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
    if (req.wb?.role !== "admin") return res.status(403).json({ error: "forbidden" })
    next()
}

// CSRF protection on top of SameSite=Lax: state-changing requests only from our own pages.
function sameOrigin(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin
    if (origin && origin !== "null") {
        let host: string | undefined
        try {
            host = new URL(origin).host
        } catch {}
        if (host !== req.headers.host) return res.status(403).json({ error: "forbidden" })
    } else if (origin === "null") {
        return res.status(403).json({ error: "forbidden" })
    }
    next()
}

function safeNext(next: unknown): string {
    return typeof next === "string" && /^\/b\/[A-Za-z0-9_-]+$/.test(next) ? next : "/"
}

/** The app shell with the language of this request written into <html lang> and <meta name="wb-language">. */
function sendIndex(req: Request, res: Response) {
    const lang = requestLanguage(req)
    fs.readFile(path.resolve("../frontend/dist/index.html"), "utf8", (err, html) => {
        if (err) return res.sendStatus(404)
        noStore(res)
        res.type("html").send(
            html
                .replace('<html lang="en">', `<html lang="${lang}">`)
                .replace('<meta name="wb-language" content="en" />', `<meta name="wb-language" content="${lang}" />`),
        )
    })
}

/** Before the static frontend: login, logout, guest link, protection of index.html. */
export function setupPublicRoutes(app: express.Express) {
    app.disable("x-powered-by")
    app.set("trust proxy", "loopback")
    app.use(securityHeaders)

    // `?lang=de|en` on a page request is remembered in a cookie for the server-rendered pages.
    app.use((req, res, next) => {
        if (req.method === "GET") {
            const q = req.query.lang
            if (q === "de" || q === "en") res.append("Set-Cookie", langCookieHeader(q))
        }
        next()
    })

    app.get("/login", async (req, res) => {
        if ((await resolveAuth(req))?.role === "admin") return res.redirect("/")
        noStore(res)
        res.type("html").send(loginPage(requestLanguage(req), undefined, safeNext(req.query.next)))
    })

    app.post("/login", sameOrigin, express.urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
        const ip = ipOf(req)
        if (loginLimiter.isBlocked(ip) || loginGlobalLimiter.isBlocked("*")) {
            return res
                .status(429)
                .type("html")
                .send(loginPage(requestLanguage(req), "login.tooManyAttempts"))
        }
        const password = typeof req.body?.password === "string" ? req.body.password : ""
        const ok =
            password.length > 0 && password.length < 1024 && (await verifyPassword(password, adminPasswordHash()))
        if (!ok) {
            loginLimiter.fail(ip)
            loginGlobalLimiter.fail("*")
            return res.status(401).type("html").send(loginPage(requestLanguage(req), "login.wrongPassword"))
        }
        loginLimiter.reset(ip)
        res.setHeader("Set-Cookie", sessionCookieHeader({ r: "admin", e: Math.floor(Date.now() / 1000) + ADMIN_TTL_S }))
        res.redirect(303, safeNext(req.body?.next))
    })

    app.post("/logout", sameOrigin, (req, res) => {
        res.setHeader("Set-Cookie", clearCookieHeader())
        if ((req.headers.accept ?? "").includes("text/html")) return res.redirect(303, "/login")
        res.json({ ok: true })
    })

    // Guest link: token -> session for this one board only
    app.get("/s/:token", async (req, res) => {
        const ip = ipOf(req)
        if (shareLimiter.isBlocked(ip))
            return res
                .status(429)
                .type("html")
                .send(messagePage(requestLanguage(req), "msg.tooManyAttemptsTitle", "msg.tryLater"))
        noStore(res)
        const hit = await resolveShareToken(String(req.params.token))
        if (!hit) {
            shareLimiter.fail(ip)
            return res
                .status(404)
                .type("html")
                .send(messagePage(requestLanguage(req), "msg.linkInvalidTitle", "msg.linkInvalidText"))
        }
        res.append(
            "Set-Cookie",
            sessionCookieHeader({
                r: "customer",
                b: hit.boardId,
                f: hit.fp,
                e: Math.floor(Date.now() / 1000) + CUSTOMER_TTL_S,
            }),
        )
        res.redirect(303, `/b/${encodeURIComponent(hit.boardId)}`)
    })

    // index.html is the app itself and sits behind the session; JS/CSS/images stay public.
    app.get("/index.html", requireSession, sendIndex)
}

/** After the static frontend: everything else needs a session. */
export function setupProtectedRoutes(app: express.Express, assetsDir: string | null) {
    app.use((req, res, next) => {
        // WebSocket upgrades are checked by verifyClient/the handler; the board API (/v2) checks its own bearer token.
        if (req.headers.upgrade?.toLowerCase() === "websocket" || req.path.startsWith("/v2/")) return next()
        return requireSession(req, res, next)
    })

    app.get("/", async (req, res) => {
        if (req.wb?.role === "customer") return res.redirect(`/b/${encodeURIComponent(req.wb.boardId)}`)
        const boards: BoardTile[] = await buildOverview(publicUrl(), { lang: requestLanguage(req) })
        noStore(res)
        res.type("html").send(adminPage(requestLanguage(req), boards))
    })

    app.post(
        "/admin/boards",
        adminOnly,
        sameOrigin,
        express.urlencoded({ extended: false, limit: "8kb" }),
        async (req, res) => {
            const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : ""
            if (!name)
                return res
                    .status(400)
                    .type("html")
                    .send(messagePage(requestLanguage(req), "msg.nameMissingTitle", "msg.nameMissingText"))
            const id = uuid.v4()
            await addBoard({
                ...defaultBoardSize,
                id,
                name,
                items: {},
                connections: [],
                crdt: CrdtEnabled,
                serial: 0,
            } as any)
            await ensureShareToken(id)
            res.redirect(303, "/")
        },
    )

    app.post(
        "/admin/boards/:id/share",
        adminOnly,
        sameOrigin,
        express.urlencoded({ extended: false, limit: "1kb" }),
        async (req, res) => {
            const id = String(req.params.id)
            if (!(await getBoard(id))) return res.status(404).json({ error: "not found" })
            const revoke = req.body?.op === "revoke"
            const token = revoke ? (await revokeShareToken(id), null) : await rotateShareToken(id)
            if (wantsJson(req)) {
                return res.json({ shareUrl: token ? `${publicUrl().replace(/\/$/, "")}/s/${token}` : null })
            }
            res.redirect(303, "/")
        },
    )

    // All overview data in one request. ?archiv=1 also computes the previews of archived boards.
    app.get("/admin/uebersicht", adminOnly, async (req, res) => {
        const boards = await buildOverview(publicUrl(), { withArchived: req.query.archiv === "1", lang: requestLanguage(req) })
        noStore(res)
        res.json({ boards })
    })

    app.get("/admin/boards/:id/vorschau", adminOnly, async (req, res) => {
        const row = await getBoardRow(String(req.params.id))
        if (!row) return res.status(404).json({ error: "not found" })
        const snap = await boardSnapshot(row, idPrefixOf(row.id))
        noStore(res)
        res.json({ svg: snap.svg, leer: snap.empty })
    })

    app.post(
        "/admin/boards/:id/rename",
        adminOnly,
        sameOrigin,
        express.urlencoded({ extended: false, limit: "8kb" }),
        async (req, res) => {
            const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : ""
            if (!name) return res.status(400).json({ error: translate("en", "api.nameMissing") })
            if (!(await renameBoard(String(req.params.id), name))) return res.status(404).json({ error: "not found" })
            if (wantsJson(req)) return res.json({ ok: true })
            res.redirect(303, "/")
        },
    )

    // Archiving is only a flag: nothing is deleted, the board stays reachable under its link.
    app.post(
        "/admin/boards/:id/archive",
        adminOnly,
        sameOrigin,
        express.urlencoded({ extended: false, limit: "1kb" }),
        async (req, res) => {
            const archived = req.body?.archived !== "0"
            if (!(await setArchived(String(req.params.id), archived))) return res.status(404).json({ error: "not found" })
            if (wantsJson(req)) return res.json({ ok: true, archived })
            res.redirect(303, "/")
        },
    )

    app.get("/b/:boardId", async (req, res) => {
        const boardId = String(req.params.boardId)
        if (!mayAccessBoard(req.wb!, boardId)) {
            return res
                .status(403)
                .type("html")
                .send(messagePage(requestLanguage(req), "msg.noAccessTitle", "msg.noAccessText"))
        }
        if (req.wb!.role === "admin") touchAdminVisit(boardId).catch((e) => console.error("admin visit", e))
        sendIndex(req, res)
    })

    if (assetsDir) setupAssets(app, assetsDir)
}

async function boardHasAsset(boardId: string, assetId: string): Promise<boolean> {
    const state = await getBoard(boardId)
    if (!state) return false
    return Object.values(state.board.items).some((i: any) => i.assetId === assetId)
}

// Just-uploaded images not yet attached to the board: (board, asset) per guest session.
const uploadedByCustomer = new Set<string>()

function setupAssets(app: express.Express, dir: string) {
    const assetHeaders = (res: Response) => {
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
        res.setHeader("Cache-Control", "private, max-age=3600")
    }

    app.get("/assets/:id", async (req, res) => {
        const id = String(req.params.id)
        if (!ASSET_ID_RE.test(id)) return res.sendStatus(400)
        const file = path.join(dir, id)
        if (!fs.existsSync(file)) return res.sendStatus(404)
        const auth = req.wb!
        if (auth.role === "customer") {
            const ok = uploadedByCustomer.has(`${auth.boardId}/${id}`) || (await boardHasAsset(auth.boardId, id))
            if (!ok) return res.status(403).json({ error: "forbidden" })
        }
        assetHeaders(res)
        res.sendFile(file)
    })

    app.put("/assets/:id", sameOrigin, async (req, res) => {
        const id = String(req.params.id)
        if (!ASSET_ID_RE.test(id)) return res.sendStatus(400)
        const auth = req.wb!
        const target = path.join(dir, id)
        const markUploaded = () => {
            if (auth.role === "customer") uploadedByCustomer.add(`${auth.boardId}/${id}`)
        }
        // Existing files are never overwritten (asset ID = hash of the content).
        if (fs.existsSync(target)) {
            req.resume()
            markUploaded()
            return res.sendStatus(200)
        }
        const tmp = path.join(dir, `.${id}.${uuid.v4()}.part`)
        const out = fs.createWriteStream(tmp, { flags: "wx" })
        let bytes = 0
        let failed = false
        const fail = (code: number) => {
            if (failed) return
            failed = true
            out.destroy()
            fs.unlink(tmp, () => {})
            if (!res.headersSent) res.sendStatus(code)
        }
        req.on("data", (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > MAX_ASSET_BYTES) {
                req.unpipe(out)
                fail(413)
            }
        })
        req.on("aborted", () => fail(400))
        out.on("error", () => fail(500))
        out.on("finish", () => {
            if (failed) return
            fs.rename(tmp, target, (err) => {
                if (err) return fail(500)
                markUploaded()
                res.sendStatus(200)
            })
        })
        req.pipe(out)
    })
}
