import type { MessageKey } from "./i18n"

export const LIGHT_BLUE = "#9FECFC"
export const LIGHT_GREEN = "#C8FC87"
export const YELLOW = "#FBFC86"
export const ORANGE = "#FDDF90"
export const PINK = "#FDC4E7"
export const LIGHT_PURPLE = "#E0BDFA"
export const RED = "#F62A5C"
export const BLACK = "#000000"
export const LIGHT_GRAY = "#f4f4f6"
export const WHITE = "#ffffff"
export const TRANSPARENT = "#ffffff00"
export const DEFAULT_NOTE_COLOR = YELLOW

export const NOTE_COLORS = [
    { name: "light-blue", color: LIGHT_BLUE },
    { name: "light-green", color: LIGHT_GREEN },
    { name: "yellow", color: YELLOW },
    { name: "orange", color: ORANGE },
    { name: "pink", color: PINK },
    { name: "light-purple", color: LIGHT_PURPLE },
    { name: "red", color: RED },
    { name: "black", color: BLACK },
    { name: "light-gray", color: LIGHT_GRAY },
    { name: "white", color: WHITE },
    { name: "transparent", color: TRANSPARENT },
]

// Fixed color for post-its created by a guest (light turquoise). The server enforces it; the frontend
// shows it right away so the guest does not have to reload to see the right color.
export const CUSTOMER_COLOR = "#8FE3DC"

/** Palette of the drawing tools (stroke, border, fill): clear colors ... (`name` is an i18n key) */
export const DRAW_COLORS: { name: MessageKey; color: string }[] = [
    { name: "color.black", color: "#000000" },
    { name: "color.gray", color: "#808080" },
    { name: "color.white", color: "#FFFFFF" },
    { name: "color.red", color: "#E53935" },
    { name: "color.orange", color: "#FB8C00" },
    { name: "color.yellow", color: "#FDD835" },
    { name: "color.green", color: "#43A047" },
    { name: "color.turquoise", color: "#00ACC1" },
    { name: "color.blue", color: "#1E88E5" },
    { name: "color.purple", color: "#8E24AA" },
]
/** ... and the pastel post-it colors (including the guest color). */
export const PASTEL_COLORS: { name: MessageKey; color: string }[] = [
    { name: "color.lightYellow", color: YELLOW },
    { name: "color.lightOrange", color: ORANGE },
    { name: "color.pink", color: PINK },
    { name: "color.lightPurple", color: LIGHT_PURPLE },
    { name: "color.lightBlue", color: LIGHT_BLUE },
    { name: "color.lightGreen", color: LIGHT_GREEN },
    { name: "color.guest", color: CUSTOMER_COLOR },
]

/** Stroke widths in board pixels (1 em = 40 px): thin, medium, thick. */
export const STROKE_WIDTHS: { name: MessageKey; value: number }[] = [
    { name: "width.thin", value: 4 },
    { name: "width.medium", value: 8 },
    { name: "width.thick", value: 16 },
]
export const DEFAULT_STROKE_COLOR = "#E53935"
export const DEFAULT_STROKE_WIDTH = 8
