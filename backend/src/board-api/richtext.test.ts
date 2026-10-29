import { describe, expect, it } from "vitest"
import { deltaToHtml, htmlToDelta } from "./richtext"

describe("richtext", () => {
    it("Absätze, fett, kursiv, Links, leere Zeilen bleiben erhalten", () => {
        const html =
            '<p><strong>Titel</strong></p><p></p><p>Text <em>kursiv</em> <a href="https://a.de/?x=1&amp;y=2">Link</a></p>'
        const delta = htmlToDelta(html)
        expect(delta[0]).toEqual({ insert: "Titel", attributes: { bold: true } })
        expect(deltaToHtml(delta)).toBe(html)
    })
    it("<br> wird zu eigenem Absatz, <b>/<i> werden normalisiert", () => {
        expect(deltaToHtml(htmlToDelta("<p>a<br>b</p><p><b>x</b> <i>y</i></p>"))).toBe(
            "<p>a</p><p>b</p><p><strong>x</strong> <em>y</em></p>",
        )
    })
    it("Klartext ohne Tags und leerer Inhalt", () => {
        expect(deltaToHtml(htmlToDelta("Hallo\nWelt"))).toBe("<p>Hallo</p><p>Welt</p>")
        expect(htmlToDelta("")).toEqual([{ insert: "\n" }])
    })
    it("Listen", () => {
        const html = "<ul><li>eins</li><li>zwei</li></ul><ol><li>a</li></ol>"
        expect(deltaToHtml(htmlToDelta(html))).toBe(html)
    })
})
