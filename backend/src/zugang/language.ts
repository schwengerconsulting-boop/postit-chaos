import { IncomingMessage } from "http"
import { Lang, MessageKey, parseLang, translate } from "../../../common/src/i18n"
import { readCookie } from "./cookie-session"
import { serverLanguage } from "./settings"

export const LANG_COOKIE = "wb_lang"

/** Language of one request: `?lang=de|en` wins, then the `wb_lang` cookie (set by an earlier `?lang=`), then the server default. */
export function requestLanguage(req: IncomingMessage & { query?: any }): Lang {
    return parseLang(req.query?.lang) ?? parseLang(readCookie(req, LANG_COOKIE)) ?? serverLanguage()
}

/** Cookie that remembers a `?lang=` choice for the server-rendered pages (the app itself uses localStorage). */
export function langCookieHeader(lang: Lang): string {
    return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`
}

/** Translator bound to one language. */
export const translator = (lang: Lang) => (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars)
