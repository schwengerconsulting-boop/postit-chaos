// Schriftgröße für gemeinsamen Notiztext: so groß wie eingestellt, aber nur so groß, dass der Text in die Notiz passt.
// Gemessen wird am echten Editor im DOM, damit Umbruch und lange Wörter genau so zählen, wie der Browser sie setzt.

export const MIN_NOTE_TEXT_SCALE = 0.25

/** Größter Faktor in [min, 1], für den fits() noch gilt (Binärsuche). Passt nicht einmal min, dann min. */
export function largestFittingScale(fits: (scale: number) => boolean, min = MIN_NOTE_TEXT_SCALE): number {
    if (fits(1)) return 1
    let lo = min
    let hi = 1
    for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
    }
    return lo
}

/** Setzt die Schrift des Editors so, dass sein Inhalt in den Innenraum der Notiz passt. */
export function fitEditorToNote(editor: HTMLElement, note: HTMLElement, baseEm: number) {
    const s = getComputedStyle(note)
    const innerWidth = note.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
    const innerHeight = note.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)
    const content = (editor.querySelector(".ql-editor") as HTMLElement | null) ?? editor
    const fits = (scale: number) => {
        editor.style.fontSize = `${baseEm * scale}em`
        return content.scrollHeight <= innerHeight + 1 && content.scrollWidth <= innerWidth + 1
    }
    editor.style.fontSize = `${baseEm * largestFittingScale(fits)}em`
}
