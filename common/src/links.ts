/** Erlaubt sind nur http, https und mailto. Ohne Schema wird https:// ergänzt (eine E-Mail-Adresse wird zu mailto:). Gibt null zurück, wenn ungültig. */
export function normalizeLinkUrl(input: string): string | null {
    const raw = input.trim()
    if (!raw) return null
    if (/^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(raw)) return "mailto:" + raw
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw
    try {
        const u = new URL(withScheme)
        if (u.protocol === "http:" || u.protocol === "https:") return u.toString()
        if (u.protocol === "mailto:" && /^[^\s@]+@[^\s@]+$/.test(decodeURIComponent(u.pathname))) return u.toString()
        return null
    } catch {
        return null
    }
}
