import { BoardHistoryEntry, EventUserInfo, PersistableBoardItemEvent, newISOTimeStamp } from "../../../common/src/domain"
import { ServerSideBoardState, updateBoards } from "../board-state"
import { broadcastBoardEvent } from "../websocket-sessions"

/** Wie dispatchSystemAppEvent in api/utils.ts (ohne Konsolen-Dump des ganzen Events), Nutzer "API". */
export function dispatchApiEvent(board: ServerSideBoardState, event: PersistableBoardItemEvent) {
    const user: EventUserInfo = { userType: "system", nickname: "API" }
    let entry: BoardHistoryEntry = { ...event, user, timestamp: newISOTimeStamp() }
    const serial = updateBoards(board, entry)
    entry = { ...entry, serial }
    broadcastBoardEvent(entry)
}
