import expressWs from "express-ws"
import * as Y from "yjs"
import { updateBoardCrdt } from "./board-state"
import { getBoardHistoryCrdtUpdates } from "./board-store"
import { withDBClient } from "./db"
import { getSessionIdFromCookies } from "./http-session"
import { getSessionById } from "./websocket-sessions"
import YWebSocketServer from "./y-websocket-server/YWebSocketServer"
import WebSocket from "ws"
import { mayAccessBoard, WbAuth } from "./zugang/auth"
import { isShareSessionValid } from "./zugang/share-tokens"
import { canRead, canWrite } from "../../common/src/domain"
import { trackTextActivity } from "./board-api/text-activity"

const socketsBySessionId: Record<string, WebSocket[]> = {}

export function closeYjsSocketsBySessionId(sessionId: string) {
    const sockets = socketsBySessionId[sessionId]
    if (sockets) {
        for (const socket of sockets) {
            socket.close()
        }
        delete socketsBySessionId[sessionId]
        console.log(
            `CLOSED ${sockets.length} y.js sockets by session id ${sessionId} - remaining sockets exist for ${
                Object.keys(socketsBySessionId).length
            } other sessions`,
        )
    }
}

export const yWebSocketServer = new YWebSocketServer({
    persistence: {
        bindState: async (docName, ydoc) => {
            const boardId = docName
            const updates = await withDBClient(async (client) => getBoardHistoryCrdtUpdates(client, boardId))

            if (updates.length === 0) {
                const initUpdate = Y.encodeStateAsUpdate(ydoc)
                console.log(`Storing initial CRDT state to DB for board ${boardId}`)
                updateBoardCrdt(boardId, initUpdate)
            } else {
                console.log(`Loaded ${updates.length} CRDT updates from DB for board ${boardId}`)
                for (const update of updates) {
                    Y.applyUpdate(ydoc, update)
                }
            }

            trackTextActivity(boardId, ydoc)
            ydoc.on("update", (update: Uint8Array, origin: any, doc: Y.Doc) => {
                updateBoardCrdt(boardId, update)
            })
        },
        writeState: async (docName, ydoc) => {
            // TODO: needed?
        },
    },
})

export function BoardYJSServer(ws: expressWs.Instance, path: string) {
    ws.app.ws(path, async (socket, req) => {
        // Der Client schickt SyncStep1 sofort beim Öffnen. Die Prüfungen unten sind asynchron (DB); ein Listener, der
        // erst danach hängt, verliert diese Nachricht und der Client bekommt den Stand nie im ersten Sync.
        const early: any[] = []
        const collectEarly = (data: any) => early.push(data)
        socket.on("message", collectEarly)
        const boardId = String(req.params.boardId)
        const wbAuth = (req as any).wbAuth as WbAuth | undefined
        if (
            !wbAuth ||
            !mayAccessBoard(wbAuth, boardId) ||
            (wbAuth.role === "customer" && !(await isShareSessionValid(wbAuth.boardId, wbAuth.fp)))
        ) {
            socket.close()
            return
        }
        const sessionId = getSessionIdFromCookies(req)
        const session = sessionId ? getSessionById(sessionId) : undefined
        if (
            !sessionId ||
            !session ||
            !session.boardSession ||
            session.boardSession.boardId !== boardId ||
            !canRead(session.boardSession.accessLevel)
        ) {
            // TODO: implement read-only YJS connections
            //console.warn("No session for YJS connection for board", boardId)
            socket.close()
            return
        }
        if (!socketsBySessionId[sessionId]) {
            socketsBySessionId[sessionId] = []
        }
        socketsBySessionId[sessionId].push(socket)
        console.log(
            `OPENED y.js connection for session ${sessionId}. Now sockets exist for ${
                Object.keys(socketsBySessionId).length
            } sessions`,
        )
        socket.addEventListener("close", () => {
            if (socketsBySessionId[sessionId]) {
                socketsBySessionId[sessionId] = socketsBySessionId[sessionId].filter((s) => s !== socket)
                if (socketsBySessionId[sessionId].length === 0) {
                    delete socketsBySessionId[sessionId]
                }
                console.log(
                    `CLOSED y.js connection. Now sockets exist for ${Object.keys(socketsBySessionId).length} sessions`,
                )
            }
        })
        const readOnly = !canWrite(session.boardSession.accessLevel)
        const docName = boardId
        try {
            const setup = yWebSocketServer.setupWSConnection(socket, docName, readOnly)
            socket.off("message", collectEarly)
            for (const data of early) socket.emit("message", data)
            await setup
        } catch (e) {
            console.error("Error setting up YJS connection", e)
            socket.close()
        }
    })
}
