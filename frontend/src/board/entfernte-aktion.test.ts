import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8")

describe("Aktion „Alle zu mir holen“ ist entfernt", () => {
    it("kein Knopf in der Personenanzeige, die Personenanzeige bleibt", () => {
        const src = read("header/OtherUsersView.tsx")
        expect(src).not.toContain("Alle zu mir holen")
        expect(src).not.toContain("Bring everyone to me")
        expect(src).not.toContain("bringAllToMe")
        expect(src).toContain("users.count")
    })
    it("Board-Ansicht reagiert nicht mehr auf die Aktion", () => {
        expect(read("BoardView.tsx")).not.toContain("bringAllToMe")
    })
})
