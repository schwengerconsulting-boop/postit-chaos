import { Item } from "../../../common/src/domain"

// Deterministische Vorschau eines Boards als SVG (nur aus den Element-Rechtecken und Farben, ohne Browser,
// ohne ausgehende Verbindungen). Einheit im SVG: 1 em des Boards.

const HEX = /^#[0-9a-fA-F]{3,8}$/
const color = (c: unknown, fallback: string) => (typeof c === "string" && HEX.test(c) ? c : fallback)
const num = (n: unknown, fallback = 0) => (typeof n === "number" && Number.isFinite(n) ? n : fallback)
const r2 = (n: number) => Math.round(n * 100) / 100
const SAFE_ASSET = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/

function luminance(hex: string): number {
    let h = hex.slice(1)
    if (h.length === 3 || h.length === 4) h = h.replace(/./g, "$&$&")
    const n = parseInt(h.slice(0, 6), 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** Graue Zeilenbalken statt Text: zeigt, dass ein Element Text hat, ohne dass ein Schriftsatz nötig ist. */
function textBars(item: any, x: number, y: number, w: number, h: number, ink: string): string {
    const text = typeof item.text === "string" ? item.text.trim() : ""
    if (!text || w <= 0 || h <= 0) return ""
    const font = Math.max(num(item.fontSize, item.type === "text" ? 1 : 0.5), 0.2)
    const lineH = font * 1.5
    const barH = Math.max(font * 0.5, 0.12)
    const pad = Math.min(w, h) * 0.1
    const maxChars = Math.max(Math.floor((w - 2 * pad) / (font * 0.55)), 3)
    const lines: number[] = []
    for (const para of text.split(/\n+/)) {
        let rest = para.length
        if (rest === 0) continue
        while (rest > 0) {
            lines.push(Math.min(rest, maxChars))
            rest -= maxChars
        }
    }
    const fit = Math.max(Math.floor((h - 2 * pad) / lineH), 1)
    const shown = lines.slice(0, Math.min(fit, 8))
    const align = item.align === "center" ? "center" : "left"
    return shown
        .map((len, i) => {
            const bw = Math.max(Math.min(len * font * 0.55, w - 2 * pad), font)
            const bx = align === "center" ? x + (w - bw) / 2 : x + pad
            return `<rect x="${r2(bx)}" y="${r2(y + pad + i * lineH)}" width="${r2(bw)}" height="${r2(barH)}" rx="${r2(barH / 2)}" fill="${ink}" opacity=".5"/>`
        })
        .join("")
}

export type PreviewOptions = { maxItems?: number; idPrefix?: string }

/** items inkl. Text (augmentItemsWithCRDT). Gibt ein <svg>-Element zurück (ohne feste Größe, skaliert per CSS). */
export function renderPreviewSvg(items: Item[], opts: PreviewOptions = {}): string {
    const list = (items as any[]).filter((i) => i && !i.hidden && num(i.width) > 0 && num(i.height) > 0)
    if (list.length === 0) {
        return `<svg class="vorschau vorschau-leer" viewBox="0 0 40 30" preserveAspectRatio="xMidYMid meet" aria-hidden="true"></svg>`
    }
    const shown = list.sort((a, b) => num(a.z) - num(b.z)).slice(0, opts.maxItems ?? 600)
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
    for (const i of shown) {
        minX = Math.min(minX, i.x)
        minY = Math.min(minY, i.y)
        maxX = Math.max(maxX, i.x + i.width)
        maxY = Math.max(maxY, i.y + i.height)
    }
    const w = Math.max(maxX - minX, 1)
    const h = Math.max(maxY - minY, 1)
    const pad = Math.max(w, h) * 0.04
    const vb = `${r2(minX - pad)} ${r2(minY - pad)} ${r2(w + 2 * pad)} ${r2(h + 2 * pad)}`
    const sw = r2(Math.max(w, h) / 600) // Haarlinie, bleibt bei jeder Boardgröße sichtbar

    const parts: string[] = []
    let clipN = 0
    for (const i of shown) {
        const x = i.x,
            y = i.y,
            iw = i.width,
            ih = i.height
        const customer = i.createdBy === "customer"
        switch (i.type) {
            case "container": {
                const fill = color(i.color, "#ffffff")
                const transparent = fill.length === 9 && fill.endsWith("00")
                parts.push(
                    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(iw)}" height="${r2(ih)}" rx="${r2(Math.min(iw, ih) * 0.01)}" fill="${transparent ? "#ffffff" : fill}" fill-opacity="${transparent ? 0.4 : 0.55}" stroke="#aeb6c4" stroke-width="${sw * 1.5}"/>`,
                )
                // Titelleiste als Balken über dem Rahmen
                if (typeof i.text === "string" && i.text.trim()) {
                    const th = Math.min(Math.max(num(i.fontSize, 0.8), 0.4), ih / 4)
                    parts.push(
                        `<rect x="${r2(x + iw * 0.02)}" y="${r2(y + th * 0.4)}" width="${r2(Math.min(i.text.length * th * 0.5, iw * 0.6))}" height="${r2(th * 0.5)}" rx="${r2(th * 0.25)}" fill="#5b6475" opacity=".6"/>`,
                    )
                }
                break
            }
            case "note": {
                const fill = color(i.color, "#FBFC86")
                const dark = luminance(fill) < 0.45
                const ink = color(i.textColor, dark ? "#ffffff" : "#3a4252")
                const border = i.borderColor ? color(i.borderColor, "none") : "none"
                const bw = i.borderColor ? Math.max(num(i.borderWidth, 1) / 40, sw) : 0
                const stroke = border !== "none" ? ` stroke="${border}" stroke-width="${r2(bw)}"` : ""
                const transparent = fill.length === 9 && fill.endsWith("00")
                const fa = transparent ? ' fill-opacity="0"' : ""
                const cx = x + iw / 2,
                    cy = y + ih / 2
                if (i.shape === "round") {
                    parts.push(`<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(iw / 2)}" ry="${r2(ih / 2)}" fill="${fill}"${fa}${stroke}/>`)
                } else if (i.shape === "diamond") {
                    parts.push(
                        `<polygon points="${r2(cx)},${r2(y)} ${r2(x + iw)},${r2(cy)} ${r2(cx)},${r2(y + ih)} ${r2(x)},${r2(cy)}" fill="${fill}"${fa}${stroke}/>`,
                    )
                } else {
                    const rx = i.rounded ? Math.min(iw, ih) * 0.2 : Math.min(iw, ih) * 0.02
                    const shadow = i.flat || transparent ? "" : ` stroke="#00000022" stroke-width="${sw}"`
                    parts.push(
                        `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(iw)}" height="${r2(ih)}" rx="${r2(rx)}" fill="${fill}"${fa}${stroke || shadow}/>`,
                    )
                }
                if (customer) {
                    parts.push(
                        `<circle cx="${r2(x + iw - Math.min(iw, ih) * 0.12)}" cy="${r2(y + Math.min(iw, ih) * 0.12)}" r="${r2(Math.min(iw, ih) * 0.07)}" fill="#0f766e"/>`,
                    )
                }
                parts.push(textBars(i, x, y, iw, ih, ink))
                break
            }
            case "text": {
                parts.push(textBars(i, x, y, iw, ih, color(i.textColor, color(i.color, "#3a4252"))))
                break
            }
            case "image":
            case "video": {
                const id = `${opts.idPrefix ?? ""}c${clipN++}`
                parts.push(
                    `<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(iw)}" height="${r2(ih)}"/></clipPath>`,
                    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(iw)}" height="${r2(ih)}" fill="#dfe4ec" stroke="#c4ccd9" stroke-width="${sw}"/>`,
                )
                if (i.type === "image" && typeof i.assetId === "string" && SAFE_ASSET.test(i.assetId)) {
                    parts.push(
                        `<image href="/assets/${i.assetId}" x="${r2(x)}" y="${r2(y)}" width="${r2(iw)}" height="${r2(ih)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`,
                    )
                }
                break
            }
            case "drawing": {
                const pts: [number, number][] = Array.isArray(i.points) ? i.points : []
                if (pts.length < 2) break
                const stroke = color(i.color, "#1d2433")
                const swd = Math.max(num(i.strokeWidth, 8) / 40, sw * 1.5)
                const toXY = ([px, py]: [number, number]) => `${r2(x + px * iw)},${r2(y + py * ih)}`
                const use = i.kind === "pen" ? pts : [pts[0], pts[pts.length - 1]]
                parts.push(
                    `<polyline points="${use.map(toXY).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${r2(swd)}" stroke-linecap="round" stroke-linejoin="round"/>`,
                )
                break
            }
        }
    }
    return `<svg class="vorschau" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${parts.join("")}</svg>`
}
