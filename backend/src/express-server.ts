import dotenv from "dotenv"
import express from "express"
import expressWs from "express-ws"
import fs from "fs"
import * as Http from "http"
import * as Https from "https"
import * as path from "path"

import { boardApiRouter } from "./board-api/routes"
import { handleBoardEvent } from "./board-event-handler"
import { BoardYJSServer } from "./board-yjs-server"
import { getConfig } from "./config"
import { connectionHandler } from "./connection-handler"
import { getEnv } from "./env"
import { setupProtectedRoutes, setupPublicRoutes } from "./zugang/routes"
import { mayAccessBoard, resolveAuth, WbAuth } from "./zugang/auth"
import { touchAdminVisit } from "./zugang/uebersicht"
import { nicknameFor, registerSocket, unregisterSocket } from "./zugang/ws-guard"
import { setSessionNickname } from "./websocket-sessions"
import { createGetSignedPutUrl } from "./storage"
import { WsWrapper } from "./ws-wrapper"

dotenv.config()

// Standard: nur lokal erreichbar (Reverse-Proxy davor). Mit HOST=0.0.0.0 überschreibbar.
const HOST = process.env.HOST ?? "127.0.0.1"

export const startExpressServer = (httpPort?: number, httpsPort?: number): (() => void) => {
    const config = getConfig()

    const app = express()

    // Board-API (REST API v2) (Bearer-Token WHITEBOARD_API_TOKEN), unabhängig von Sitzungen
    app.use("/v2", boardApiRouter())

    // Zugang: Login, Gastlink, Sitzungsprüfung (backend/src/zugang/). Ohne gültige Sitzung gibt es nur
    // Login-Seite, Gastlink-Einstieg und die statischen Frontend-Dateien. Ourboards eigene Anmeldung
    // (Google/OIDC/Test-Login) und die offene Board-API (/api/v1) sind entfernt; /assets/external gibt es nicht mehr.
    setupPublicRoutes(app)

    app.use("/", express.static("../frontend/dist", { index: false }))
    app.use("/", express.static("../frontend/public", { index: false }))

    setupProtectedRoutes(app, config.storageBackend.type === "LOCAL" ? config.storageBackend.directory : null)

    let stop = () => {}

    if (httpPort) {
        const http = new Http.Server(app)
        startWs(http, app)
        http.listen(httpPort, HOST, () => {
            console.log(`Listening HTTP on ${HOST}:${httpPort}`)
        })
        const prevStop = stop
        stop = () => {
            prevStop()
            http.close()
        }
    }

    if (httpsPort) {
        let https = new Https.Server(
            {
                cert: fs.readFileSync(getEnv("HTTPS_CERT_FILE")),
                key: fs.readFileSync(getEnv("HTTPS_KEY_FILE")),
            },
            app,
        )
        startWs(https, app)
        https.listen(httpsPort, HOST, () => {
            console.log("Listening HTTPS on port " + httpsPort)
        })
        const prevStop = stop
        stop = () => {
            prevStop()
            https.close()
        }
    }

    const redirectURL = process.env.REDIRECT_URL
    if (redirectURL) {
        app.get("*", function (req, res, next) {
            if (req.headers["x-forwarded-proto"] !== "https") {
                res.redirect(redirectURL)
            } else {
                next()
            }
        })
    }
    return stop
}

// Welche Verbindung darf wohin? Wird beim Upgrade geprüft (verifyClient: 401/403 vor dem Handshake)
// und in den Handlern erneut (doppelt hält besser).
const WS_PATH = /^\/socket\/(lobby|board\/([^/]+)|yjs\/board\/([^/]+)\/?)$/
function wsTarget(url: string | undefined): { lobby: true } | { boardId: string } | null {
    const pathname = (url ?? "").split("?")[0]
    const m = WS_PATH.exec(pathname)
    if (!m) return null
    if (m[1] === "lobby") return { lobby: true }
    try {
        return { boardId: decodeURIComponent(m[2] ?? m[3]) }
    } catch {
        return null
    }
}

async function authorizeWs(req: any): Promise<{ status: number } | { auth: WbAuth }> {
    const origin = req.headers.origin
    if (origin) {
        let host: string | undefined
        try {
            host = new URL(origin).host
        } catch {}
        if (host !== req.headers.host) return { status: 403 }
    }
    const auth = await resolveAuth(req)
    if (!auth) return { status: 401 }
    const target = wsTarget(req.url)
    if (!target) return { status: 404 }
    if ("lobby" in target ? auth.role !== "admin" : !mayAccessBoard(auth, target.boardId)) return { status: 403 }
    req.wbAuth = auth
    return { auth }
}

function startWs(http: any, app: express.Express) {
    const ws: expressWs.Instance = expressWs(app, http, {
        wsOptions: {
            verifyClient: (info: { req: any }, cb: (ok: boolean, code?: number, message?: string) => void) => {
                authorizeWs(info.req)
                    .then((r) => ("auth" in r ? cb(true) : cb(false, r.status, "Not allowed")))
                    .catch(() => cb(false, 500, "Error"))
            },
        },
    })

    const signedPutUrl = createGetSignedPutUrl(getConfig().storageBackend)

    const bind = (socket: any, req: any, boardId: string | null) => {
        const auth: WbAuth | undefined = req.wbAuth
        if (!auth || (boardId === null ? auth.role !== "admin" : !mayAccessBoard(auth, boardId))) {
            socket.close()
            return
        }
        const w = WsWrapper(socket)
        registerSocket(w.id, auth, () => socket.close())
        w.onClose(() => {
            unregisterSocket(w.id)
            // Admin verlässt das Board: ab jetzt gilt alles bis hierher als gesehen (Zähler "neue Gästekommentare")
            if (auth.role === "admin" && boardId) touchAdminVisit(boardId).catch((e) => console.error("admin-besuch", e))
        })
        connectionHandler(w, handleBoardEvent(boardId, signedPutUrl))
        setSessionNickname(w.id, nicknameFor(auth))
    }

    ws.app.ws("/socket/lobby", (socket, req) => {
        bind(socket, req, null)
    })
    ws.app.ws("/socket/board/:boardId", (socket, req) => {
        bind(socket, req, String(req.params.boardId))
    })

    BoardYJSServer(ws, "/socket/yjs/board/:boardId/")

    ws.app.ws("*", (socket, req) => {
        console.warn(`Unexpected WS connection: ${req.url} `)
        socket.close()
    })
}
