import crypto from "crypto"
import { inTransaction, withDBClient } from "../db"

// Gastlink-Tokens: 32 zufällige Bytes (43 Zeichen base64url), getrennt von der Board-ID.
// Schnittstelle für die Board-API: getShareToken, ensureShareToken, rotateShareToken, revokeShareToken.

type RevokeListener = (boardId: string) => void
const listeners: RevokeListener[] = []
/** Wird nach rotate/revoke aufgerufen (schließt offene Kunden-Sockets). */
export function onShareTokenChanged(l: RevokeListener) {
    listeners.push(l)
}

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex")
export const fingerprint = (token: string) => hashToken(token).slice(0, 32)
const newToken = () => crypto.randomBytes(32).toString("base64url")

export async function getShareToken(boardId: string): Promise<string | null> {
    const r = await withDBClient((c) => c.query("SELECT token FROM board_share_token WHERE board_id=$1", [boardId]))
    return r.rows[0]?.token ?? null
}

/** Alle Gastlink-Tokens mit einer einzigen Abfrage (Board-ID -> Token). */
export async function getAllShareTokens(): Promise<Map<string, string>> {
    const r = await withDBClient((c) => c.query("SELECT board_id, token FROM board_share_token"))
    return new Map(r.rows.map((x: any) => [x.board_id as string, x.token as string]))
}

export async function ensureShareToken(boardId: string): Promise<string> {
    const existing = await getShareToken(boardId)
    if (existing) return existing
    const token = newToken()
    await inTransaction((c) =>
        c.query(
            "INSERT INTO board_share_token (board_id, token, token_hash) VALUES ($1,$2,$3) ON CONFLICT (board_id) DO NOTHING",
            [boardId, token, hashToken(token)],
        ),
    )
    return (await getShareToken(boardId))!
}

/** Neuer Token; der alte Link und alle Kundensitzungen dieses Boards sind sofort tot. */
export async function rotateShareToken(boardId: string): Promise<string> {
    const token = newToken()
    await inTransaction((c) =>
        c.query(
            `INSERT INTO board_share_token (board_id, token, token_hash) VALUES ($1,$2,$3)
             ON CONFLICT (board_id) DO UPDATE SET token=EXCLUDED.token, token_hash=EXCLUDED.token_hash, created_at=now()`,
            [boardId, token, hashToken(token)],
        ),
    )
    listeners.forEach((l) => l(boardId))
    return token
}

/** Link sperren: kein Token mehr, alle Kundensitzungen dieses Boards sind tot. */
export async function revokeShareToken(boardId: string): Promise<void> {
    await inTransaction((c) => c.query("DELETE FROM board_share_token WHERE board_id=$1", [boardId]))
    listeners.forEach((l) => l(boardId))
}

/** Token aus dem Link -> Board. Lookup über den Hash, Vergleich des Tokens in konstanter Zeit. */
export async function resolveShareToken(token: string): Promise<{ boardId: string; fp: string } | null> {
    if (token.length < 32 || token.length > 200) return null
    const r = await withDBClient((c) =>
        c.query("SELECT board_id, token FROM board_share_token WHERE token_hash=$1", [hashToken(token)]),
    )
    const row = r.rows[0]
    if (!row) return null
    const a = Buffer.from(token)
    const b = Buffer.from(row.token as string)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    return { boardId: row.board_id, fp: fingerprint(token) }
}

/** Gilt die Kundensitzung (Board + Fingerprint) noch? */
export async function isShareSessionValid(boardId: string, fp: string): Promise<boolean> {
    const token = await getShareToken(boardId)
    return !!token && fingerprint(token) === fp
}
