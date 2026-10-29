import { h } from "harmaja"
import * as L from "lonna"
import { UserSessionInfo } from "../../../../common/src/domain"
import { UserIcon } from "../../components/Icons"
import { BoardState, Dispatch } from "../../store/board-store"
import { UserSessionState } from "../../store/user-session-store"

export const UserInfoView = ({
    state,
    dispatch,
    usersOnBoard,
    modalContent,
}: {
    state: L.Property<UserSessionState>
    usersOnBoard: L.Property<UserSessionInfo[]>
    dispatch: Dispatch
    modalContent: L.Atom<any>
}) => {
    const pictureURL = L.view(state, (s) => (s.status === "logged-in" ? s.picture : undefined))
    // No name dialog: the display name ("Admin" or "Guest") comes from the server.
    return (
        <span
            className={L.view(
                state,
                (s) => s.status,
                (s) => `user-info ${s}`,
            )}
        >
            <span className="icon">{L.view(pictureURL, (p) => (p ? <img src={p} /> : <UserIcon />))}</span>
        </span>
    )
}
