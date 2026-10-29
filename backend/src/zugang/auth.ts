import { IncomingMessage } from "http"
import { readSessionCookie } from "./cookie-session"
import { isShareSessionValid } from "./share-tokens"

export type WbAuth = { role: "admin" } | { role: "customer"; boardId: string; fp: string }

/** Liest das Sitzungs-Cookie und prüft es (Signatur, Ablauf, bei Kunden zusätzlich: Link noch gültig). */
export async function resolveAuth(req: IncomingMessage): Promise<WbAuth | null> {
    const s = readSessionCookie(req)
    if (!s) return null
    if (s.r === "admin") return { role: "admin" }
    if (!(await isShareSessionValid(s.b, s.f))) return null
    return { role: "customer", boardId: s.b, fp: s.f }
}

export function mayAccessBoard(auth: WbAuth, boardId: string): boolean {
    return auth.role === "admin" || auth.boardId === boardId
}
