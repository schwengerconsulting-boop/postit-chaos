import { h } from "harmaja"
import * as L from "lonna"
import { Board } from "../../../common/src/domain"
import { BoardAccessStatus } from "../store/board-store"
import { UserSessionState } from "../store/user-session-store"
import { t } from "../../../common/src/i18n"

export const BoardViewMessage = ({
    boardAccessStatus,
    sessionState,
    board,
}: {
    boardAccessStatus: L.Property<BoardAccessStatus>
    sessionState: L.Property<UserSessionState>
    board: L.Property<Board>
}) => {
    // TODO: login may be disabled due to Incognito mode or other reasons
    return L.combine(boardAccessStatus, L.view(sessionState, "status"), (s: BoardAccessStatus, sessionStatus) => {
        if (s === "not-found") {
            return (
                <div className="board-status-message">
                    <div>
                        <p>{t("status.notFound")}</p>
                    </div>
                </div>
            )
        }
        if (s === "denied-permanently") {
            return (
                <div className="board-status-message">
                    <div>
                        <p>{t("status.denied")}</p>
                    </div>
                </div>
            )
        }
        if (s === "login-required") {
            if (sessionStatus === "login-failed") {
                return (
                    <div className="board-status-message">
                        <div>{t("status.loginFailed")}</div>
                    </div>
                )
            }

            return (
                <div className="board-status-message">
                    <div>{t("status.linkRequired")}</div>
                </div>
            )
        }
        return null
    })
}
