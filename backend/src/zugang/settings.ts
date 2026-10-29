import crypto from "crypto"
import { DEFAULT_LANGUAGE, Lang, parseLang, translate } from "../../../common/src/i18n"

// All settings are read on demand (not at import time) so tests can set the environment.
export { CUSTOMER_COLOR } from "../../../common/src/colors" // light turquoise #8FE3DC, guest post-its
export const COOKIE_NAME = "wb_session"
/** Default language of the server (WHITEBOARD_LANGUAGE: "en" or "de", default "en"). Read on demand so tests can set it. */
export function serverLanguage(): Lang {
    return parseLang(process.env.WHITEBOARD_LANGUAGE) ?? DEFAULT_LANGUAGE
}

/** Display name of guests (in the server default language). */
export const customerNickname = () => translate(serverLanguage(), "user.guest")

/** Display name of the admin (WHITEBOARD_ADMIN_NAME, default "Admin"). */
export function adminNickname(): string {
    return process.env.WHITEBOARD_ADMIN_NAME?.trim() || "Admin"
}

export function sessionSecret(): string {
    const s = process.env.WHITEBOARD_SESSION_SECRET
    if (!s || s.length < 32) {
        throw new Error("WHITEBOARD_SESSION_SECRET is missing or shorter than 32 characters")
    }
    return s
}

export function adminPasswordHash(): string | undefined {
    return process.env.WHITEBOARD_ADMIN_PASSWORD_HASH || undefined
}

export function publicUrl(): string {
    return process.env.PUBLIC_URL ?? "http://localhost:1337"
}

export function cookieSecure(): boolean {
    return publicUrl().startsWith("https://")
}

// Signing key per role. The admin key depends on the password hash: new password = all admin sessions invalid.
export function signingKey(role: "admin" | "customer"): Buffer {
    const h = crypto.createHmac("sha256", sessionSecret())
    h.update(role === "admin" ? "admin:" + (adminPasswordHash() ?? "") : "customer")
    return h.digest()
}
