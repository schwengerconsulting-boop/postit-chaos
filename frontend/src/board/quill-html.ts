import Quill from "quill"

/** HTML eines alten Elements (kein gemeinsamer Text) als Quill-Delta. Links bleiben erhalten, unsichere Adressen fallen durch die Link-Prüfung. */
export function htmlToQuillDelta(html: string): any {
    const holder = document.createElement("div")
    const quill = new Quill(holder)
    quill.clipboard.dangerouslyPasteHTML(html ?? "")
    return quill.getContents()
}
