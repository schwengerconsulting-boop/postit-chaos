import { describe, expect, it } from "vitest"
import { translate } from "../../common/src/i18n"
import { resolveLanguage } from "./language"

describe("resolveLanguage", () => {
    it("falls back to English when nothing is set", () => {
        expect(resolveLanguage("", null, undefined)).toBe("en")
    })
    it("uses the server default (WHITEBOARD_LANGUAGE via <meta>)", () => {
        expect(resolveLanguage("", null, "de")).toBe("de")
    })
    it("a remembered choice beats the server default", () => {
        expect(resolveLanguage("", "en", "de")).toBe("en")
        expect(resolveLanguage("", "de", "en")).toBe("de")
    })
    it("?lang= beats everything; invalid values are ignored", () => {
        expect(resolveLanguage("?lang=de", "en", "en")).toBe("de")
        expect(resolveLanguage("?foo=1&lang=en", "de", "de")).toBe("en")
        expect(resolveLanguage("?lang=xx", "de", "en")).toBe("de")
    })
})

describe("frontend strings", () => {
    it("toolbar and dialog texts come out German with lang=de and English otherwise", () => {
        expect(translate("de", "tool.note")).toBe("Notiz (Post-it)")
        expect(translate("en", "tool.note")).toBe("Note (Post-it)")
        expect(translate("de", "link.apply")).toBe("Übernehmen")
        expect(translate("en", "link.apply")).toBe("Apply")
        expect(translate("de", "users.count", { n: 3 })).toBe("3 Personen")
        expect(translate("en", "users.count", { n: 3 })).toBe("3 people")
    })
})
