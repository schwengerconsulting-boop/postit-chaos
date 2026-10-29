import { DEFAULT_LANGUAGE, Lang, parseLang, setLanguage } from "../../common/src/i18n"

export const LANGUAGE_STORAGE_KEY = "postitchaos.lang"

/**
 * Picks the UI language: `?lang=de|en` in the URL (remembered in localStorage) wins, then the remembered choice,
 * then the server default (WHITEBOARD_LANGUAGE), which the server writes into <meta name="wb-language">.
 */
export function resolveLanguage(
    search: string,
    storedValue: string | null | undefined,
    serverDefault: string | null | undefined,
): Lang {
    return (
        parseLang(new URLSearchParams(search).get("lang")) ??
        parseLang(storedValue) ??
        parseLang(serverDefault) ??
        DEFAULT_LANGUAGE
    )
}

function readStored(): string | null {
    try {
        return localStorage.getItem(LANGUAGE_STORAGE_KEY)
    } catch {
        return null
    }
}

function remember(lang: Lang) {
    try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
    } catch {}
}

export function initLanguage() {
    const fromUrl = parseLang(new URLSearchParams(location.search).get("lang"))
    if (fromUrl) remember(fromUrl)
    const serverDefault = document.querySelector('meta[name="wb-language"]')?.getAttribute("content")
    const lang = resolveLanguage(location.search, readStored(), serverDefault)
    setLanguage(lang)
    document.documentElement.lang = lang
}

// Runs on import, so `import "./language"` must be the first import of the entry point (before any t() call).
if (typeof document !== "undefined" && typeof location !== "undefined") initLanguage()
