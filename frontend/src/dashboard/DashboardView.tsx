import { Fragment, h, ListView } from "harmaja"
import { getNavigator, Link } from "harmaja-router"
import * as L from "lonna"
import * as R from "ramda"
import * as uuid from "uuid"
import {
    BoardAccessPolicy,
    BoardStub,
    CrdtDisabled,
    CrdtEnabled,
    EventFromServer,
    exampleBoard,
    RecentBoard,
    ServerConfig,
} from "../../../common/src/domain"
import { t } from "../../../common/src/i18n"
import { BOARD_PATH, createBoardAndNavigate, Routes } from "../board-navigation"
import { localStorageAtom } from "../board/local-storage-atom"
import { IS_TOUCHSCREEN } from "../board/touchScreen"
import { BoardAccessPolicyEditor } from "../components/BoardAccessPolicyEditor"
import { BoardCrdtModeSelector } from "../components/BoardCrdtModeSelector"
import { TextInput } from "../components/components"
import { signIn, signOut } from "../google-auth"
import { Dispatch } from "../store/board-store"
import { RecentBoards } from "../store/recent-boards"
import { canLogin, defaultAccessPolicy, UserSessionState } from "../store/user-session-store"

export const DashboardView = ({
    sessionState,
    dispatch,
    recentBoards,
    eventsFromServer,
    serverConfig,
}: {
    sessionState: L.Property<UserSessionState>
    recentBoards: RecentBoards
    dispatch: Dispatch
    eventsFromServer: L.EventStream<EventFromServer>
    serverConfig: L.Property<ServerConfig | null>
}) => {
    const boardName = L.atom("")
    return (
        <div id="root" className="dashboard">
            <div className="content">
                <header>
                    <h1 id="app-title" data-test="app-title">
                        {t("app.name")}
                    </h1>
                    <p>
                        {t("dash.tagline")}{" "}
                        <a href="https://github.com/raimohanska/ourboard">Ourboard</a>.
                    </p>
                </header>
                <div className="user-info">
                    {L.view(sessionState, (user) => {
                        switch (user.status) {
                            case "logged-in":
                                return (
                                    <>
                                        <span title={user.email}>{user.name}</span>
                                        <a onClick={signOut}>{t("dash.signOut")}</a>
                                    </>
                                )
                            default:
                                if (canLogin(user)) {
                                    return <a onClick={signIn}>{t("dash.signIn")}</a>
                                } else {
                                    return null
                                }
                        }
                    })}
                </div>
                <main>
                    <CreateBoard
                        {...{ dispatch, sessionState, boardName, recentBoards, eventsFromServer, serverConfig }}
                    />
                    <div>
                        <div className="user-content">
                            <RecentBoardsView {...{ recentBoards, boardName }} />
                        </div>
                    </div>
                    <Welcome {...{ recentBoards, dispatch, eventsFromServer, sessionState }} />
                </main>
            </div>
        </div>
    )
}

const RecentBoardsView = ({ recentBoards, boardName }: { recentBoards: RecentBoards; boardName: L.Atom<string> }) => {
    const defaultLimit = 25
    const filter = boardName
    const filtered = L.view(filter, (f) => !!f)
    const edit = L.atom(false)
    const limit = localStorageAtom("recentBoards.limit", defaultLimit)

    const sort = localStorageAtom<"recent-first" | "alphabetical">("recentBoards.sort", "recent-first")

    const matchingBoards = L.view(recentBoards.recentboards, filter, (bs, f) =>
        bs.filter((b) => b.name.toLowerCase().includes(f.toLowerCase())),
    )
    const boardsToShow = L.view(matchingBoards, limit, sort, filter, (bs, l, s, f) =>
        R.pipe(
            R.sortWith([R.descend(R.prop("opened"))]),
            (bs: RecentBoard[]) => bs.slice(0, l),
            R.sortWith([s === "alphabetical" ? R.ascend((b) => b.name.toLowerCase()) : R.descend(R.prop("opened"))]),
        )(bs),
    )
    const moreBoards = L.view(limit, matchingBoards, (l, bs) => bs.length - l)
    const aLot = 7
    const lotsOfShownBoards = L.view(matchingBoards, (bs) => bs.length >= aLot)
    return (
        <div>
            {L.view(
                matchingBoards,
                (recent) => recent.length === 0,
                (empty) =>
                    empty ? null : (
                        <div
                            className={L.view(
                                edit,
                                filtered,
                                (e, f) => `recent-boards${e ? " edit" : ""}${f ? " filtered" : ""}`,
                            )}
                        >
                            <h2>
                                {L.view(filter, (f) =>
                                    f === "" ? t("dash.recent") : t("dash.recentFound"),
                                )}
                                {IS_TOUCHSCREEN && (
                                    <a className="edit" onClick={() => edit.modify((e) => !e)}>
                                        {L.view(edit, (e) => (e ? t("dash.done") : t("dash.edit")))}
                                    </a>
                                )}
                            </h2>
                            <ul>
                                <ListView
                                    observable={boardsToShow}
                                    getKey={(b) => b.id}
                                    renderItem={(b) => (
                                        <li>
                                            <Link<Routes> route={BOARD_PATH} boardId={b.id}>
                                                {b.name}
                                            </Link>
                                            <a className="remove" onClick={() => recentBoards.removeRecentBoard(b)}>
                                                {t("dash.remove")}
                                            </a>
                                        </li>
                                    )}
                                />
                            </ul>
                            {
                                <div className="view-options">
                                    {L.view(moreBoards, limit, (c, l) =>
                                        c > 0 ? (
                                            <a
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    limit.set(Number.MAX_SAFE_INTEGER)
                                                }}
                                            >
                                                {L.view(moreBoards, (n) => t("dash.showMore", { n }))}
                                            </a>
                                        ) : l === defaultLimit ? null : (
                                            <a
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    limit.set(defaultLimit)
                                                }}
                                            >
                                                {t("dash.showLess")}
                                            </a>
                                        ),
                                    )}
                                    {L.view(sort, lotsOfShownBoards, (s, show) =>
                                        show ? (
                                            s === "alphabetical" ? (
                                                <a
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        sort.set("recent-first")
                                                    }}
                                                >
                                                    {t("dash.showRecentFirst")}
                                                </a>
                                            ) : (
                                                <a
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        sort.set("alphabetical")
                                                    }}
                                                >
                                                    {t("dash.sortAlpha")}
                                                </a>
                                            )
                                        ) : null,
                                    )}
                                </div>
                            }
                        </div>
                    ),
            )}
        </div>
    )
}

const Welcome = ({
    recentBoards,
    dispatch,
    eventsFromServer,
    sessionState,
}: {
    recentBoards: RecentBoards
    dispatch: Dispatch
    eventsFromServer: L.EventStream<EventFromServer>
    sessionState: L.Property<UserSessionState>
}) => {
    const navigator = getNavigator<Routes>()
    function createTutorial() {
        createBoardAndNavigate(
            {
                id: uuid.v4(),
                name: t("dash.tutorialName"),
                templateId: "tutorial",
                accessPolicy: defaultAccessPolicy(sessionState.get(), false),
            },
            dispatch,
            navigator,
            eventsFromServer,
        )
    }
    const showExampleLink = L.view(recentBoards.recentboards, (boards) => !boards.some((b) => b.id === exampleBoard.id))
    return (
        <span>
            {L.view(
                recentBoards.recentboards,
                (recent) => recent.length < 3 && !recent.some((b) => b.name.toLowerCase().includes("tutorial")),
                (empty) =>
                    empty ? (
                        <div>
                            <h2>{t("dash.welcome")}</h2>
                            <p>
                                {t("dash.tutorialPre")} <a onClick={createTutorial}>{t("dash.tutorialLink")}</a>{" "}
                                {t("dash.tutorialPost")}{" "}
                                {L.view(showExampleLink, (s) =>
                                    s ? (
                                        <>
                                            {t("dash.checkOut")}{" "}
                                            <a href={`/b/${exampleBoard.id}`}>{t("dash.testBoard")}</a> {t("dash.ifYouDare")}
                                        </>
                                    ) : null,
                                )}
                            </p>
                        </div>
                    ) : null,
            )}
        </span>
    )
}

const CreateBoardOptions = ({
    accessPolicy,
    sessionState,
    useCollaborativeEditing,
    serverConfig,
}: {
    accessPolicy: L.Atom<BoardAccessPolicy | undefined>
    sessionState: L.Property<UserSessionState>
    useCollaborativeEditing: L.Atom<boolean>
    serverConfig: L.Property<ServerConfig | null>
}) => {
    const optInCollaborative = L.view(
        sessionState,
        serverConfig,
        (s, c) => c?.crdt === "opt-in" || (c?.crdt === "opt-in-authenticated" && s.status === "logged-in"),
    )

    return (
        <>
            {L.view(optInCollaborative, (optIn) => optIn && <BoardCrdtModeSelector {...{ useCollaborativeEditing }} />)}
            {L.view(sessionState, (s) =>
                s.status === "logged-in" ? (
                    <BoardAccessPolicyEditor {...{ accessPolicy, user: s }} />
                ) : (
                    <small className="anonymousBoardDisclaimer">
                        {t("dash.anonymous")} <a onClick={signIn}>{t("dash.anonymousSignIn")}</a>
                        {t("dash.anonymousPost")}
                    </small>
                ),
            )}
        </>
    )
}

const CreateBoard = ({
    dispatch,
    sessionState,
    boardName,
    recentBoards,
    eventsFromServer,
    serverConfig,
}: {
    dispatch: Dispatch
    sessionState: L.Property<UserSessionState>
    boardName: L.Atom<string>
    recentBoards: RecentBoards
    eventsFromServer: L.EventStream<EventFromServer>
    serverConfig: L.Property<ServerConfig | null>
}) => {
    const disabled = L.view(boardName, (n) => !n)
    const navigator = getNavigator<Routes>()
    const accessPolicy: L.Atom<BoardAccessPolicy | undefined> = L.atom(defaultAccessPolicy(sessionState.get(), false))
    sessionState.onChange((s) => {
        accessPolicy.set(defaultAccessPolicy(s, false))
    })
    const hasRecentBoards = L.view(recentBoards.recentboards, (bs) => bs.length > 0)
    const useCollaborativeEditingAtom = L.atom(false)
    const useCollaborativeEditing = L.view(serverConfig, useCollaborativeEditingAtom, (c, u) =>
        c?.crdt === "true" ? true : c?.crdt === "false" ? false : u,
    )

    function onSubmit(e: JSX.FormEvent) {
        e.preventDefault()
        const newBoard: BoardStub = {
            name: boardName.get(),
            id: uuid.v4(),
            accessPolicy: accessPolicy.get(),
            crdt: useCollaborativeEditing.get() ? CrdtEnabled : CrdtDisabled,
        }
        createBoardAndNavigate(newBoard, dispatch, navigator, eventsFromServer)
    }

    return (
        <form onSubmit={onSubmit} className="create-board">
            <h2>{L.view(hasRecentBoards, (has) => (has ? t("dash.findOrCreate") : t("dash.create")))}</h2>
            <div className="input-and-button">
                <TextInput value={boardName} autoFocus={!IS_TOUCHSCREEN} placeholder={t("dash.boardName")} />
                <button id="create-board-button" data-test="create-board-submit" type="submit" disabled={disabled}>
                    {t("dash.createButton")}
                </button>
            </div>
            {L.view(
                disabled,
                (d) =>
                    !d && (
                        <CreateBoardOptions
                            {...{
                                accessPolicy,
                                sessionState,
                                useCollaborativeEditing: useCollaborativeEditingAtom,
                                serverConfig,
                            }}
                        />
                    ),
            )}
        </form>
    )
}
