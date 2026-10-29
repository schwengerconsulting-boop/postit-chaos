/** Farbnamen (Haftnotizen) und einfache CSS-Namen -> Hex. Die Hexwerte der Farbnamen sind Näherungen. */
export const BOARD_COLORS: Record<string, string> = {
    gray: "#d5d6db",
    light_yellow: "#fff9b1",
    yellow: "#f5d128",
    orange: "#ff9d48",
    light_green: "#d5f692",
    green: "#c9df56",
    dark_green: "#93d275",
    cyan: "#6cd8fa",
    light_pink: "#ffcee0",
    pink: "#f16c7f",
    violet: "#ca64ea",
    red: "#f24726",
    light_blue: "#a6ccf5",
    blue: "#2d9bf0",
    dark_blue: "#414bb2",
    black: "#1a1a1a",
    white: "#ffffff",
    transparent: "#ffffff00",
}

export const DEFAULT_STICKY_COLOR = "light_yellow"

/** Liefert normalisiertes Hex (#rrggbb oder #rrggbbaa, klein) oder null, wenn nicht erkennbar. */
export function toHex(input: unknown): string | null {
    if (typeof input !== "string") return null
    const s = input.trim().toLowerCase()
    if (s === "") return null
    if (BOARD_COLORS[s]) return BOARD_COLORS[s]
    const short = /^#([0-9a-f]{3})$/.exec(s)
    if (short) return "#" + short[1].split("").map((c) => c + c).join("")
    if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return s
    return null
}

/** Für Haftnotizen gibt die API Farbnamen zurück; erkennt die Palette wieder, sonst Hex. */
export function hexToStickyName(hex: string | undefined): string | undefined {
    if (!hex) return undefined
    for (const [name, value] of Object.entries(BOARD_COLORS)) {
        if (value === hex.toLowerCase() && !["black", "white", "transparent", "red"].includes(name)) return name
    }
    if (hex.toLowerCase() === BOARD_COLORS.red) return "red"
    return hex.toLowerCase()
}
