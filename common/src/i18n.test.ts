import { describe, expect, it } from "vitest"
import { de, en, getLanguage, parseLang, setLanguage, t, translate } from "./i18n"

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",")

describe("i18n dictionaries", () => {
    it("every key exists in both languages (no extras, no empty values)", () => {
        const enKeys = Object.keys(en).sort()
        const deKeys = Object.keys(de).sort()
        expect(deKeys).toEqual(enKeys)
        for (const k of enKeys) {
            expect((en as any)[k], `en.${k}`).not.toBe("")
            expect((de as any)[k], `de.${k}`).not.toBe("")
        }
    })
    it("both languages use the same {placeholders} for every key", () => {
        for (const k of Object.keys(en)) {
            expect(placeholders((de as any)[k]), k).toBe(placeholders((en as any)[k]))
        }
    })
    it("the product name is the same in both languages", () => {
        expect(en["app.name"]).toBe("Post-it Chaos")
        expect(de["app.name"]).toBe("Post-it Chaos")
    })
    it('guests are "Gast" in German and "guest" in English, never "Kunde"', () => {
        expect(en["user.guest"]).toBe("Guest")
        expect(de["user.guest"]).toBe("Gast")
        expect(Object.values(de).join("\n")).not.toMatch(/Kunde/i)
    })
})

describe("t() / translate()", () => {
    it("English is the default language", () => {
        expect(getLanguage()).toBe("en")
        expect(t("login.submit")).toBe("Sign in")
    })
    it("translates into German and interpolates variables", () => {
        expect(translate("de", "login.submit")).toBe("Anmelden")
        expect(translate("de", "overview.newGuestComments", { n: 3 })).toBe("3 neue Gästekommentare")
        expect(translate("en", "overview.newGuestComments", { n: 3 })).toBe("3 new guest comments")
        expect(translate("en", "overview.noMatchesText", { term: "x" })).toBe('No board matches "x".')
    })
    it("t() follows setLanguage()", () => {
        try {
            setLanguage("de")
            expect(t("tool.undo")).toBe("Rückgängig")
        } finally {
            setLanguage("en")
        }
        expect(t("tool.undo")).toBe("Undo")
    })
    it("parseLang accepts en/de (also region variants), rejects everything else", () => {
        expect(parseLang("de")).toBe("de")
        expect(parseLang("DE-de")).toBe("de")
        expect(parseLang("en_US")).toBe("en")
        expect(parseLang("fr")).toBeUndefined()
        expect(parseLang(undefined)).toBeUndefined()
        expect(parseLang(["de"])).toBeUndefined()
    })
})
