import dotenv from "dotenv"
dotenv.config()

import * as Http from "http"
import { exampleBoard } from "../../common/src/domain"
import { parseLang } from "../../common/src/i18n"
import { awaitSavingChanges } from "./board-state"
import { createBoard, fetchBoard } from "./board-store"
import { initDB } from "./db"
import { startExpressServer } from "./express-server"
import { terminateSessions } from "./websocket-sessions"
import { adminPasswordHash, sessionSecret } from "./zugang/settings"

let stopServer: (() => void) | null = null

async function shutdown() {
    console.log("Shutdown initiated. Closing sockets.")
    if (stopServer) stopServer()
    terminateSessions()
    console.log("Shutdown in progress. Waiting for all changes to be saved...")
    await awaitSavingChanges()
    console.log("Shutdown complete. Exiting process.")
    process.exit(0)
}

process.on("SIGTERM", () => {
    console.log("Received SIGTERM. Initiating shutdown.")
    shutdown()
})

const PORT = parseInt(process.env.PORT || "1337")
const HTTPS_PORT = process.env.HTTPS_PORT ? parseInt(process.env.HTTPS_PORT) : undefined
const HTTP_PORT = PORT

// Ohne Sitzungsschlüssel startet der Server nicht (kein Betrieb ohne Zugangsschutz).
sessionSecret()
if (process.env.WHITEBOARD_LANGUAGE && !parseLang(process.env.WHITEBOARD_LANGUAGE))
    console.warn(`WHITEBOARD_LANGUAGE="${process.env.WHITEBOARD_LANGUAGE}" is not supported (use "en" or "de"), falling back to "en"`)
if (!adminPasswordHash()) console.warn("WHITEBOARD_ADMIN_PASSWORD_HASH is missing: admin login is not possible")

initDB()
    .then(async () => {
        if (!(await fetchBoard("default"))) {
            await createBoard(exampleBoard)
        }
    })
    .then(() => {
        if (HTTP_PORT) {
            stopServer = startExpressServer(HTTP_PORT, HTTPS_PORT)
        }
    })
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
