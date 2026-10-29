import {
    AppEvent,
    BoardHistoryEntry,
    canWrite,
    Id,
    isBoardItemEvent,
    isPersistableBoardItemEvent,
    newISOTimeStamp,
} from "../../common/src/domain"
import { getBoard, maybeGetBoard, updateBoards } from "./board-state"
import { getBoardInfo, renameBoardConvenienceColumnOnly, updateBoardAccessPolicy } from "./board-store"
import { handleCommonEvent } from "./common-event-handler"
import { MessageHandlerResult } from "./connection-handler"
import { WS_HOST_DEFAULT, WS_HOST_LOCAL, WS_PROTOCOL } from "./host-config"
import { obtainLock } from "./locker"
import { canJoin, getSocketAuth, guardAppEvent } from "./zugang/ws-guard"
import { addSessionToBoard, broadcastBoardEvent, getSession } from "./websocket-sessions"
import { toBuffer, WsWrapper } from "./ws-wrapper"

/** Mindestabstand pro Verbindung zwischen zwei Live-Zwischenständen (ca. 25 pro Sekunde); Überzählige werden still verworfen. */
export const LIVE_DRAWING_MIN_INTERVAL_MS = 40
const lastLiveDrawing = new WeakMap<WsWrapper, number>()

export const handleBoardEvent =
    (allowedBoardId: Id | null, getSignedPutUrl: (key: string) => string | Promise<string>) =>
    async (socket: WsWrapper, appEvent: AppEvent): Promise<MessageHandlerResult> => {
        // Zugang: Rolle und Board kommen aus der signierten Sitzung (zugang/), nie aus dem Ereignis.
        const auth = getSocketAuth(socket.id)
        if (!auth) {
            socket.close()
            return true
        }
        const guarded = await guardAppEvent(auth, appEvent)
        if ("drop" in guarded) {
            if (guarded.resync) getSession(socket)?.sendEvent({ action: "board.action.apply.failed" })
            return true
        }
        appEvent = guarded.event
        if (guarded.resync) getSession(socket)?.sendEvent({ action: "board.action.apply.failed" })
        if (await handleCommonEvent(socket, appEvent)) return true
        const session = getSession(socket)
        if (!session) {
            console.error("Session missing for socket " + socket.id)
            return true
        }
        if (appEvent.action === "board.join") {
            //await sleep(3000) // simulate latency

            const boardInfo = await getBoardInfo(appEvent.boardId)
            if (!boardInfo) {
                console.warn(`Trying to join unknown board ${appEvent.boardId}`)
                session.sendEvent({
                    action: "board.join.denied",
                    boardId: appEvent.boardId,
                    reason: "not found",
                })
                return true
            }
            const wsHost = boardInfo.ws_host ?? WS_HOST_DEFAULT

            if (!allowedBoardId || appEvent.boardId !== allowedBoardId || !WS_HOST_LOCAL.includes(wsHost)) {
                // Path - board id mismatch -> always redirect

                const wsAddress = `${WS_PROTOCOL}://${wsHost}/socket/board/${appEvent.boardId}`
                /* console.info(
                    `Trying to join board ${appEvent.boardId} on socket for board ${allowedBoardId}, board host ${wsHost} local hostnames ${WS_HOST_LOCAL}`,
            )*/

                session.sendEvent({
                    action: "board.join.denied",
                    boardId: appEvent.boardId,
                    reason: "redirect",
                    wsAddress,
                })
                return true
            }

            let board = (await getBoard(appEvent.boardId))!

            // Zugriffsstufe nach Rolle: Admin darf alles, Kunde bearbeitet nur sein Board (kein "admin"-Level:
            // keine Zugriffsrechte, kein Umbenennen). Ourboards boardeigene accessPolicy wird nicht mehr ausgewertet.
            if (!(await canJoin(auth, appEvent.boardId))) {
                session.sendEvent({ action: "board.join.denied", boardId: appEvent.boardId, reason: "forbidden" })
                return true
            }
            const accessLevel = auth.role === "admin" ? "admin" : "read-write"
            await addSessionToBoard(board, socket, accessLevel, appEvent.initAtSerial)
            return true
        }

        if (!session.boardSession) {
            console.warn("Trying to send event to board without session", appEvent)
            return true
        }

        if (appEvent.action === "drawing.live") {
            // nur weiterreichen: kein Speichern, keine Seriennummer
            const now = Date.now()
            const tooSoon = now - (lastLiveDrawing.get(socket) ?? 0) < LIVE_DRAWING_MIN_INTERVAL_MS
            if (!tooSoon && session.boardSession && session.isOnBoard(appEvent.boardId) && canWrite(session.boardSession.accessLevel)) {
                lastLiveDrawing.set(socket, now)
                broadcastBoardEvent(appEvent, session)
            }
            return true
        }

        if (isBoardItemEvent(appEvent)) {
            const boardId = appEvent.boardId
            const state = await getBoard(boardId)
            if (!state) {
                return true // Just ignoring for now, see above todo
            }
            if (!canWrite(session.boardSession.accessLevel)) {
                console.warn("Trying to change read-only board")
                return true
            }
            obtainLock(state.locks, appEvent, socket) // Allow even if was locked (offline use)
            if (isPersistableBoardItemEvent(appEvent)) {
                if (!session.isOnBoard(appEvent.boardId)) {
                    console.warn("Trying to send event to board without valid session")
                } else {
                    let historyEntry: BoardHistoryEntry = {
                        ...appEvent,
                        user: session.userInfo,
                        timestamp: newISOTimeStamp(),
                    }
                    try {
                        const serial = updateBoards(state, historyEntry)
                        historyEntry = { ...historyEntry, serial }
                        broadcastBoardEvent(historyEntry, session)
                        if (appEvent.action === "board.rename") {
                            // special case: keeping name up to date as it's in a separate column
                            await renameBoardConvenienceColumnOnly(appEvent.boardId, appEvent.name)
                        }
                        if (appEvent.action === "board.setAccessPolicy") {
                            if (session.boardSession.accessLevel !== "admin") {
                                console.warn("Trying to change access policy without admin access")
                                return true
                            }
                            await updateBoardAccessPolicy(appEvent.boardId, appEvent.accessPolicy)
                        }
                        return { boardId, serial }
                    } catch (e) {
                        console.warn(`Error applying event ${JSON.stringify(appEvent)}: ${e} -> forcing board refresh`)
                        session.sendEvent({ action: "board.action.apply.failed" })
                        return true
                    }
                }
            } else if (appEvent.action === "item.unlock") {
                return true
            }
        } else {
            switch (appEvent.action) {
                case "cursor.move": {
                    const { boardId, position } = appEvent
                    const { x, y } = position
                    const state = maybeGetBoard(boardId)
                    if (state) {
                        const session = getSession(socket)
                        if (session && session.isOnBoard(appEvent.boardId)) {
                            state.cursorPositions[socket.id] = { x, y, sessionId: socket.id }
                            state.cursorsMoved = true
                        }
                    }
                    return true
                }
                case "user.bringAllToMe": {
                    // abgeschaltet: niemand darf die Ansicht anderer verschieben
                    return true
                }
                case "asset.put.request": {
                    const { assetId } = appEvent
                    const signedUrl = await getSignedPutUrl(assetId)
                    socket.send(toBuffer({ action: "asset.put.response", assetId, signedUrl }))
                    return true
                }
            }
        }
        return false
    }
