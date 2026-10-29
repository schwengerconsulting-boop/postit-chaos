import { h } from "harmaja"
import { BackIcon } from "../../components/Icons"
import { t } from "../../../../common/src/i18n"

// Only visible to the admin (the caller checks the role). A plain link with a page reload: "/" is the
// server-rendered board overview, not part of the app.
export function BackToAllBoardsLink() {
    return (
        <a href="/" className="navigation">
            <span className="icon">
                <BackIcon />
            </span>
            {t("header.allBoards")}
        </a>
    )
}
