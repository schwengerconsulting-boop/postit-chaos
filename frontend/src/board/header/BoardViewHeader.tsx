import { Fragment, h } from "harmaja"
import { getNavigator } from "harmaja-router"
import * as L from "lonna"
import { AccessLevel, Board, EventFromServer, UserSessionInfo } from "../../../../common/src/domain"
import { Routes, createBoardAndNavigate } from "../../board-navigation"
import { EditableSpan } from "../../components/EditableSpan"
import { Dispatch } from "../../store/board-store"
import { UserSessionState, defaultAccessPolicy } from "../../store/user-session-store"
import { OtherUsersView } from "./OtherUsersView"
import { UserInfoView } from "./UserInfoView"
import { Rect } from "../../../../common/src/geometry"
import { CRDTStore } from "../../store/crdt-store"
import * as uuid from "uuid"
import { t } from "../../../../common/src/i18n"

export function BoardViewHeader({
    usersOnBoard,
    board,
    accessLevel,
    sessionState,
    dispatch,
    modalContent,
    eventsFromServer,
    viewRect,
    online,
    crdtStore,
}: {
    usersOnBoard: L.Property<UserSessionInfo[]>
    board: L.Property<Board>
    accessLevel: L.Property<AccessLevel>
    sessionState: L.Property<UserSessionState>
    dispatch: Dispatch
    modalContent: L.Atom<any>
    eventsFromServer: L.EventStream<EventFromServer>
    viewRect: L.Property<Rect>
    online: L.Property<boolean>
    crdtStore: CRDTStore
}) {
    const editingAtom = L.atom(false)
    const nameAtom = L.atom(
        L.view(board, (board) => board.name || ""),
        (newName) => dispatch({ action: "board.rename", boardId: board.get()!.id, name: newName }),
    )
    const navigator = getNavigator<Routes>()
    function makeCopy() {
        const newBoard = {
            id: uuid.v4(),
            name: `${nameAtom.get()} ${t("header.copySuffix")}`,
            templateId: board.get()!.id,
            accessPolicy: defaultAccessPolicy(sessionState.get(), false),
        }
        createBoardAndNavigate(newBoard, dispatch, navigator, eventsFromServer)
    }

    return (
        <header>
            <span className="logo-area">
                {L.view(accessLevel, (l) => (
                    <a className="brand-logo" href={l === "admin" ? "/" : undefined} title={l === "admin" ? t("header.allBoards") : ""}>
                        <span className="brand-wordmark">{t("app.name")}</span>
                    </a>
                ))}
            </span>
            {L.view(
                board,
                (b) => !!b,
                (b) =>
                    b && (
                        <span data-test="board-name" id="board-info">
                            <span id="board-name">
                                {L.view(accessLevel, (l) =>
                                    l === "admin" ? (
                                        <EditableSpan value={nameAtom} editingThis={editingAtom} />
                                    ) : (
                                        <span>{nameAtom}</span>
                                    ),
                                )}
                            </span>
                            {/* Copy and sharing are admin-only; the server forbids them for guests anyway. */}
                            {L.view(accessLevel, (l) => (l === "admin" ? <ForkButton onClick={makeCopy} /> : null))}
                        </span>
                    ),
            )}
            <span className="right-panel">
                {L.view(accessLevel, (l) =>
                    l === "admin" ? (
                        <a
                            className="navigation"
                            onClick={async () => {
                                await fetch("/logout", { method: "POST" })
                                document.location.assign("/login")
                            }}
                        >
                            {t("header.signOut")}
                        </a>
                    ) : null,
                )}
                <OtherUsersView
                    usersOnBoard={usersOnBoard}
                    board={board}
                    viewRect={viewRect}
                    state={sessionState}
                    dispatch={dispatch}
                    online={online}
                />
                <UserInfoView
                    state={sessionState}
                    usersOnBoard={usersOnBoard}
                    dispatch={dispatch}
                    modalContent={modalContent}
                />
            </span>
        </header>
    )
}

const ForkButton = ({ onClick }: { onClick: () => void }) => {
    return (
        <a className="board-button" title={t("header.makeCopy")} onClick={onClick}>
            <svg viewBox="0 0 22 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                <title>{t("header.makeCopy")}</title>
                <rect
                    x="6.56582"
                    y="5.86245"
                    width="14.0013"
                    height="14.0013"
                    rx="1.4"
                    fill="#0A5AF5"
                    fill-opacity="0.1"
                    stroke="#0A5AF5"
                    stroke-width="1.2"
                />
                <path
                    d="M3.6805 15.7398H3.18848C2.08391 15.7398 1.18848 14.8444 1.18848 13.7398V3.18433C1.18848 2.07976 2.08391 1.18433 3.18848 1.18433H13.8317C14.9363 1.18433 15.8317 2.07976 15.8317 3.18433V3.76324"
                    stroke="#0A5AF5"
                    stroke-width="1.2"
                    stroke-linecap="round"
                />
            </svg>
        </a>
    )
}
