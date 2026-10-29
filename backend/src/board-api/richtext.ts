/**
 * Rich-Text-Umwandlung zwischen API-HTML (<p>, <strong>/<b>, <em>/<i>, <u>, <s>, <br>, <a href>, <ul>/<ol>/<li>)
 * und Quill-Delta (Format des Yjs-Texts in Ourboard).
 *
 * Quill kennt keinen weichen Zeilenumbruch: <br> wird zu einem neuen Absatz. Beim Zurücklesen kommt daher
 * <p>a</p><p>b</p> statt <p>a<br>b</p>. Leere Absätze (<p></p>) bleiben erhalten.
 */

export type DeltaOp = { insert: string; attributes?: Record<string, any> }
export type Delta = DeltaOp[]

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

export function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === "#") {
            const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
            try {
                return String.fromCodePoint(code)
            } catch {
                return m
            }
        }
        return ENTITIES[e.toLowerCase()] ?? m
    })
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function pushOp(ops: Delta, insert: string, attributes?: Record<string, any>) {
    if (insert === "") return
    const attrs = attributes && Object.keys(attributes).length > 0 ? attributes : undefined
    const last = ops[ops.length - 1]
    // Zusammenfassen, wenn gleiche Attribute und kein Zeilenende (Zeilenenden tragen Blockattribute)
    if (last && !insert.includes("\n") && !last.insert.includes("\n") && sameAttrs(last.attributes, attrs)) {
        last.insert += insert
        return
    }
    ops.push(attrs ? { insert, attributes: attrs } : { insert })
}

function sameAttrs(a?: Record<string, any>, b?: Record<string, any>) {
    return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
}

export function htmlToDelta(html: string | null | undefined): Delta {
    const ops: Delta = []
    const src = html ?? ""
    const tokenRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>|<!--[\s\S]*?-->|[^<]+|</g
    const fmt = { bold: 0, italic: 0, underline: 0, strike: 0 }
    const links: string[] = []
    const lists: ("bullet" | "ordered")[] = []
    let lineOpen = false
    let m: RegExpExecArray | null

    const attrsNow = () => {
        const a: Record<string, any> = {}
        if (fmt.bold > 0) a.bold = true
        if (fmt.italic > 0) a.italic = true
        if (fmt.underline > 0) a.underline = true
        if (fmt.strike > 0) a.strike = true
        if (links.length > 0) a.link = links[links.length - 1]
        return a
    }
    const endLine = () => {
        const list = lists[lists.length - 1]
        pushOp(ops, "\n", list ? { list } : undefined)
        lineOpen = false
    }

    while ((m = tokenRe.exec(src))) {
        const token = m[0]
        if (token.startsWith("<!--")) continue
        if (m[1] === undefined) {
            if (token === "<") {
                // Einzelnes "<" ohne Tag: als Text behandeln
                pushOp(ops, "<", attrsNow())
                lineOpen = true
                continue
            }
            // Text. Rohe Zeilenumbrüche im Quelltext zwischen Blöcken ignorieren, im Text als Absatz zählen
            let text = decodeEntities(token)
            if (!lineOpen && text.trim() === "") continue
            const parts = text.split("\n")
            parts.forEach((part, i) => {
                if (i > 0) endLine()
                if (part !== "") {
                    pushOp(ops, part, attrsNow())
                    lineOpen = true
                }
            })
            continue
        }
        const name = m[1].toLowerCase()
        const closing = token.startsWith("</")
        switch (name) {
            case "p":
            case "div":
            case "h1":
            case "h2":
            case "h3":
            case "h4":
                if (closing) {
                    if (lineOpen) endLine()
                    if (name.startsWith("h")) fmt.bold = Math.max(0, fmt.bold - 1)
                } else {
                    if (lineOpen) endLine()
                    lineOpen = true
                    if (name.startsWith("h")) fmt.bold++
                }
                break
            case "br":
                endLine()
                break
            case "strong":
            case "b":
                fmt.bold = Math.max(0, fmt.bold + (closing ? -1 : 1))
                break
            case "em":
            case "i":
                fmt.italic = Math.max(0, fmt.italic + (closing ? -1 : 1))
                break
            case "u":
                fmt.underline = Math.max(0, fmt.underline + (closing ? -1 : 1))
                break
            case "s":
            case "strike":
            case "del":
                fmt.strike = Math.max(0, fmt.strike + (closing ? -1 : 1))
                break
            case "a":
                if (closing) links.pop()
                else {
                    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2] ?? "")
                    links.push(href ? decodeEntities(href[1] ?? href[2] ?? "") : "")
                    if (links[links.length - 1] === "") links.pop()
                    else if (!/^(https?:|mailto:|tel:|\/)/i.test(links[links.length - 1])) links.pop()
                }
                break
            case "ul":
            case "ol":
                if (closing) lists.pop()
                else lists.push(name === "ul" ? "bullet" : "ordered")
                break
            case "li":
                if (closing) {
                    if (lineOpen) endLine()
                } else {
                    if (lineOpen) endLine()
                    lineOpen = true
                }
                break
            default:
                // Unbekannte Tags (span, font, ...) werden ignoriert, der Inhalt bleibt
                break
        }
    }
    if (lineOpen) endLine()
    if (ops.length === 0) ops.push({ insert: "\n" })
    return ops
}

type Line = { segs: DeltaOp[]; block: Record<string, any> }

function splitLines(delta: Delta): Line[] {
    const lines: Line[] = []
    let cur: Line = { segs: [], block: {} }
    for (const op of delta) {
        if (typeof op.insert !== "string") continue
        const parts = op.insert.split("\n")
        parts.forEach((part, i) => {
            if (part !== "") cur.segs.push({ insert: part, attributes: op.attributes })
            if (i < parts.length - 1) {
                cur.block = op.attributes ?? {}
                lines.push(cur)
                cur = { segs: [], block: {} }
            }
        })
    }
    if (cur.segs.length > 0) lines.push(cur)
    return lines
}

function renderSeg(seg: DeltaOp): string {
    const a = seg.attributes ?? {}
    let out = escapeHtml(seg.insert)
    if (a.strike) out = `<s>${out}</s>`
    if (a.underline) out = `<u>${out}</u>`
    if (a.italic) out = `<em>${out}</em>`
    if (a.bold) out = `<strong>${out}</strong>`
    if (a.link) out = `<a href="${escapeHtml(String(a.link))}">${out}</a>`
    return out
}

export function deltaToHtml(delta: Delta | null | undefined): string {
    const lines = splitLines(delta ?? [])
    let html = ""
    let openList: "bullet" | "ordered" | null = null
    const closeList = () => {
        if (openList) html += openList === "bullet" ? "</ul>" : "</ol>"
        openList = null
    }
    for (const line of lines) {
        const inner = line.segs.map(renderSeg).join("")
        const list = line.block.list === "bullet" || line.block.list === "ordered" ? line.block.list : null
        if (list) {
            if (openList !== list) {
                closeList()
                html += list === "bullet" ? "<ul>" : "<ol>"
                openList = list
            }
            html += `<li>${inner}</li>`
        } else {
            closeList()
            html += `<p>${inner}</p>`
        }
    }
    closeList()
    return html
}

export function deltaToPlain(delta: Delta | null | undefined): string {
    return (delta ?? [])
        .map((o) => (typeof o.insert === "string" ? o.insert : ""))
        .join("")
        .replace(/\n$/, "")
}

export function plainToDelta(text: string): Delta {
    return htmlToDelta(
        text
            .split("\n")
            .map((l) => `<p>${escapeHtml(l)}</p>`)
            .join(""),
    )
}
