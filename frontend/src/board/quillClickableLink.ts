import Quill from "quill"
import { normalizeLinkUrl } from "./link-tools"
var Link = Quill.import("formats/link")

export default class ClickableLink extends Link {
    // Nur http/https/mailto; alles andere wird nicht zum Link
    static sanitize(url: string) {
        return normalizeLinkUrl(url) ?? "about:blank"
    }
    static create(href: any) {
        let node = super.create(href) as HTMLAnchorElement
        const safe = normalizeLinkUrl(String(href))
        node.title = safe ?? ""
        node.setAttribute("rel", "noopener noreferrer")
        node.setAttribute("target", "_blank")
        node.addEventListener("click", (e) => {
            e.stopPropagation()
            e.preventDefault()
            if (safe) window.open(safe, "_blank", "noopener,noreferrer")
        })
        return node
    }
}
