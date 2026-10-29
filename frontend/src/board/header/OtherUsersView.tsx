import { ListView, h } from "harmaja"
import * as L from "lonna"
import { Board, UserSessionInfo } from "../../../../common/src/domain"
import { Dispatch } from "../../store/board-store"
import { UserSessionState } from "../../store/user-session-store"
import { Rect } from "../../../../common/src/geometry"
import { t } from "../../../../common/src/i18n"

type OtherUsersViewProps = {
    usersOnBoard: L.Property<UserSessionInfo[]>
    dispatch: Dispatch
    state: L.Property<UserSessionState>
    board: L.Property<Board>
    viewRect: L.Property<Rect>
    online: L.Property<boolean>
}

export const OtherUsersView = ({ usersOnBoard, state, online }: OtherUsersViewProps) => {
    const status = L.view(online, usersOnBoard, (online, users) =>
        online ? (users.length > 1 ? "online-with-others" : "online-alone") : "offline",
    )
    return L.view(status, (status) => {
        if (status === "offline") {
            return (
                <div
                    className="offline-status"
                    title={t("users.offlineHint")}
                >
                    {t("users.offline")}
                </div>
            )
        } else if (status === "online-alone") {
            return null
        }
        return (
            <div className="other-users">
                {L.view(usersOnBoard, (u) => t("users.count", { n: u.length }))}
                <div className="pop-up">
                    <ul>
                        <ListView
                            observable={L.view(usersOnBoard, (users) =>
                                users.slice().sort((a, b) => a.nickname.localeCompare(b.nickname)),
                            )}
                            renderItem={(u) => (
                                <li className="user">
                                    {u.nickname}
                                    <span className="youlink">
                                        {u.sessionId === state.get().sessionId ? t("users.you") : ""}
                                    </span>
                                </li>
                            )}
                        />
                    </ul>
                </div>
            </div>
        )
    })
}
