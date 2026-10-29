import { h } from "harmaja"
import * as L from "lonna"
import { applyLink, linkDialog, normalizeLinkUrl } from "../link-tools"
import { t } from "../../../../common/src/i18n"

/** Small dialog for linking selected text (http, https and mailto only). */
export const LinkDialog = () => {
    const error = L.atom("")
    const value = L.atom("")
    linkDialog.forEach((d) => {
        value.set(d?.current ?? "")
        error.set("")
    })
    const submit = (e?: any) => {
        e?.preventDefault()
        if (!normalizeLinkUrl(value.get())) {
            error.set(t("link.invalid"))
            return
        }
        applyLink(value.get())
    }
    return L.view(linkDialog, (d) =>
        d === null ? null : (
            <div className="wb-link-dialog board-tool" onMouseDown={(e: any) => e.stopPropagation()} onClick={(e: any) => e.stopPropagation()} data-testid="link-dialog" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
                <form onSubmit={submit}>
                    <label>
                        {t("link.address")}
                        <input
                            type="text"
                            data-testid="link-input"
                            placeholder="https://…"
                            value={value}
                            onInput={(e) => value.set((e.target as HTMLInputElement).value)}
                            ref={(el: HTMLInputElement) => setTimeout(() => el.focus(), 0)}
                            onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === "Escape") linkDialog.set(null)
                            }}
                        />
                    </label>
                    {L.view(error, (m) => (m ? <div className="wb-link-error">{m}</div> : null))}
                    <div className="wb-link-buttons">
                        <button type="submit" data-testid="link-apply">{t("link.apply")}</button>
                        {d.current && (
                            <button type="button" data-testid="link-remove" onClick={() => applyLink(null)}>
                                {t("link.remove")}
                            </button>
                        )}
                        <button type="button" onClick={() => linkDialog.set(null)}>{t("common.cancel")}</button>
                    </div>
                </form>
            </div>
        ),
    )
}
