import * as L from "lonna"
import { AppEvent, Board, Drawing, Id } from "../../../common/src/domain"

/** Ein Zwischenstand, der länger als das hier nichts Neues bekommt, gilt als abgebrochen und verschwindet. */
export const LIVE_DRAWING_TTL_MS = 3000

export type LiveDrawings = Record<Id, { item: Drawing; at: number }>

export function applyLiveEvent(state: LiveDrawings, event: AppEvent, now: number): LiveDrawings {
    if (event.action !== "drawing.live") return state
    return pruneLive({ ...state, [event.item.id]: { item: event.item, at: now } }, now)
}

export function pruneLive(state: LiveDrawings, now: number): LiveDrawings {
    const keep = Object.entries(state).filter(([, v]) => now - v.at < LIVE_DRAWING_TTL_MS)
    return keep.length === Object.keys(state).length ? state : Object.fromEntries(keep)
}

/** Nur Zwischenstände, die noch nicht als fertiges Element auf dem Board liegen. */
export function visibleLiveDrawings(state: LiveDrawings, board: Pick<Board, "items">): Drawing[] {
    return Object.values(state)
        .map((v) => v.item)
        .filter((d) => !(d.id in board.items))
}

/** Sammelt die Live-Zwischenstände anderer Teilnehmer aus den Serverereignissen. */
export function LiveDrawingsStore(eventsFromServer: L.EventStream<AppEvent>, board: L.Property<Board>) {
    const state = L.atom<LiveDrawings>({})
    let timer: ReturnType<typeof setTimeout> | undefined
    eventsFromServer.forEach((e) => {
        if (e.action !== "drawing.live") return
        state.modify((s) => applyLiveEvent(s, e, Date.now()))
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => state.modify((s) => pruneLive(s, Date.now())), LIVE_DRAWING_TTL_MS + 50)
    })
    return L.view(state, board, (s, b) => visibleLiveDrawings(s, b))
}
