import crypto from "crypto"
import { IncomingMessage } from "http"
import { COOKIE_NAME, cookieSecure, signingKey } from "./settings"

export type SessionPayload =
    | { r: "admin"; e: number }
    // f = Fingerprint des Gastlink-Tokens zum Zeitpunkt der Anmeldung; Rotation/Sperre macht ihn ungültig
    | { r: "customer"; b: string; f: string; e: number }

export const ADMIN_TTL_S = 7 * 24 * 3600
export const CUSTOMER_TTL_S = 30 * 24 * 3600

function mac(role: "admin" | "customer", body: string): string {
    return crypto.createHmac("sha256", signingKey(role)).update(body).digest("base64url")
}

export function signSession(payload: SessionPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    return `${payload.r === "admin" ? "a" : "c"}.${body}.${mac(payload.r, body)}`
}

export function verifySession(value: string | undefined, nowS = Math.floor(Date.now() / 1000)): SessionPayload | null {
    if (!value) return null
    const [kind, body, sig] = value.split(".")
    if (!body || !sig || (kind !== "a" && kind !== "c")) return null
    const role = kind === "a" ? "admin" : "customer"
    const expected = Buffer.from(mac(role, body))
    const given = Buffer.from(sig)
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
    try {
        const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload
        if (p.r !== role || typeof p.e !== "number" || p.e < nowS) return null
        if (p.r === "customer" && (typeof p.b !== "string" || typeof p.f !== "string")) return null
        return p
    } catch {
        return null
    }
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
    const header = req.headers.cookie
    if (!header) return undefined
    for (const part of header.split(";")) {
        const i = part.indexOf("=")
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
    }
    return undefined
}

export function sessionCookieHeader(payload: SessionPayload): string {
    const maxAge = payload.e - Math.floor(Date.now() / 1000)
    return [
        `${COOKIE_NAME}=${encodeURIComponent(signSession(payload))}`,
        "Path=/",
        `Max-Age=${maxAge}`,
        "HttpOnly",
        "SameSite=Lax",
        ...(cookieSecure() ? ["Secure"] : []),
    ].join("; ")
}

export function clearCookieHeader(): string {
    return [
        `${COOKIE_NAME}=`,
        "Path=/",
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Lax",
        ...(cookieSecure() ? ["Secure"] : []),
    ].join("; ")
}

export function readSessionCookie(req: IncomingMessage): SessionPayload | null {
    return verifySession(readCookie(req, COOKIE_NAME))
}
