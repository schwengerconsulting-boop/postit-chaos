import * as H from "harmaja"
import { componentScope, h, ListView } from "harmaja"
import * as L from "lonna"
import {
    Board,
    CrdtEnabled,
    Drawing,
    canWrite,
    findConnection,
    findItem,
    getConnection,
    Id,
    Image,
    Item,
    newNote,
    Note,
    Video,
} from "../../../common/src/domain"
import { isFirefox } from "../components/browser"
import { ModalContainer } from "../components/ModalContainer"
import { onClickOutside } from "../components/onClickOutside"
import { isEmbedded } from "../embedding"
import { AssetStore } from "../store/asset-store"
import { BoardState, BoardStore, Dispatch } from "../store/board-store"
import { CursorsStore } from "../store/cursors-store"
import { LiveDrawingsStore } from "../store/live-drawings"
import { UserSessionState } from "../store/user-session-store"
import { boardCoordinateHelper } from "./board-coordinates"
import { boardDragHandler } from "./board-drag"
import {
    BoardFocus,
    getSelectedItemIds,
    getSelectedItem,
    getSelectedItems,
    noFocus,
    getSelectedConnectionIds,
} from "./board-focus"
import { boardScrollAndZoomHandler } from "./board-scroll-and-zoom"
import { BoardToolLayer } from "./toolbars/BoardToolLayer"
import { ConnectionsView } from "./ConnectionsView"
import { ContextMenuView } from "./contextmenu/ContextMenuView"
import { CursorsView } from "./CursorsView"
import * as G from "../../../common/src/geometry"
import { imageUploadHandler, imageDropHandler } from "./image-upload"
import { ImageView } from "./ImageView"
import { DrawingSvg, DrawingView, DRAWING_Z } from "./DrawingView"
import { DrawLayer } from "./DrawLayer"
import { CUSTOMER_COLOR } from "../../../common/src/colors"
import { itemCreateHandler } from "./item-create"
import { cutCopyPasteHandler } from "./item-cut-copy-paste"
import { itemDeleteHandler } from "./item-delete"
import { itemDuplicateHandler } from "./item-duplicate"
import { itemMoveWithArrowKeysHandler } from "./item-move-with-arrow-keys"
import { itemSelectAllHandler } from "./item-select-all"
import { withCurrentContainer } from "./item-setcontainer"
import { itemUndoHandler } from "./item-undo-redo"
import { ItemView } from "./ItemView"
import { controlKey, installKeyboardShortcut, plainKey } from "./keyboard-shortcuts"
import { RectangularDragSelection } from "./RectangularDragSelection"
import { SelectionBorder } from "./SelectionBorder"
import { synchronizeFocusWithServer } from "./synchronize-focus-with-server"
import { isDrawTool, Tool, ToolController } from "./tool-selection"
import { htmlToQuillDelta } from "./quill-html"
import { openLinkDialog, setItemUpgrader, upgradeToCollaborativeText } from "./link-tools"
import { BoardViewHeader } from "./header/BoardViewHeader"
import { VideoView } from "./VideoView"
import { startConnecting } from "./item-connect"
import { emptySet } from "../../../common/src/sets"
import { installZoomKeyboardShortcuts } from "./zoom-shortcuts"
import { itemHideContentsHandler } from "./item-hide-contents"

const emptyNote = newNote("")

export const BoardView = ({
    boardId,
    cursors,
    boardStore,
    sessionState,
    assets,
    dispatch,
}: {
    boardId: string
    cursors: CursorsStore
    boardStore: BoardStore
    sessionState: L.Property<UserSessionState>
    assets: AssetStore
    dispatch: Dispatch
}) => {
    const boardState = boardStore.state
    const board = boardState.pipe(
        L.map((s: BoardState) => s.board!),
        L.filter((b: Board) => !!b, componentScope()),
    )
    const liveDrawings = LiveDrawingsStore(boardStore.eventsFromServer, board)
    const accessLevel = L.view(boardState, "accessLevel")
    const locks = L.view(boardState, (s) => s.locks)
    const sessionId = L.view(sessionState, (s) => s.sessionId)
    const sessions = L.view(boardState, (s) => s.users)
    const zoom = L.atom({ zoom: 1, quickZoom: 1 })

    const containerElement = L.atom<HTMLElement | null>(null)
    const scrollElement = L.atom<HTMLElement | null>(null)
    const boardElement = L.atom<HTMLElement | null>(null)
    const latestNoteId = L.atom<Id | null>(null)
    const toolController = ToolController()
    const tool = toolController.tool
    const isCustomer = L.view(accessLevel, (l) => l !== "admin")
    // Vorbild für neue Post-its. Die Farbe: zuletzt gewählte Post-it-Farbe, sonst (nur Kunden) die Kundenfarbe als Vorauswahl.
    const latestNote = L.view(latestNoteId, board, toolController.drawStyle, isCustomer, (id, b, style, customer) => {
        const note = ((id ? findItem(b)(id) : null) as Note) || emptyNote
        const color = style.noteColor ?? (customer ? CUSTOMER_COLOR : undefined)
        return color ? { ...note, color, flat: false } : note
    })
    const latestConnectionId = L.atom<Id | null>(null)
    const latestConnection = L.view(latestConnectionId, board, (id, b) => {
        return id ? findConnection(b)(id) : null
    })
    const focus = synchronizeFocusWithServer(board, locks, sessionId, dispatch)
    const coordinateHelper = boardCoordinateHelper(containerElement, scrollElement, boardElement, zoom)
    let previousFocus: BoardFocus | null = null
    focus.forEach((f) => {
        const previousIDs = previousFocus && getSelectedItemIds(previousFocus)
        const itemIds = [...getSelectedItemIds(f)].filter((id) => !previousIDs || !previousIDs.has(id))
        previousFocus = f
        if (itemIds.length > 0) {
            dispatch({ action: "item.front", boardId: board.get().id, itemIds })
            const item = getSelectedItem(board.get())(f)
            if (item && item.type === "note") {
                latestNoteId.set(item.id)
            }
        }
        const connectionId = [...getSelectedConnectionIds(f)][0]
        if (connectionId && getConnection(board.get())(connectionId)?.action === "connect") {
            latestConnectionId.set(connectionId)
        }
    })

    tool.pipe(L.changes).forEach((tool) => {
        // Zeichenwerkzeug gewählt: Auswahl aufheben (sonst liegt das Kontextmenü über dem Zeichenfeld)
        if (isDrawTool(tool)) focus.set(noFocus)
        if (tool !== "note" && tool !== "container" && tool !== "text" && focus.get().status === "adding") {
            focus.set(noFocus)
        }
    })

    const doOnUnmount: Function[] = []

    const itemsList = L.view(L.view(board, "items"), Object.values)

    function onURL(assetId: string, url: string) {
        itemsList.get().forEach((i) => {
            if ((i.type === "image" || i.type === "video") && i.assetId === assetId && i.src != url) {
                dispatch({ action: "item.update", boardId, items: [{ id: i.id, src: url }] })
            }
        })
    }
    const uploadImageFile = imageUploadHandler(assets, coordinateHelper, onAdd, onURL)

    doOnUnmount.push(
        cutCopyPasteHandler(board, boardStore.crdtStore, focus, coordinateHelper, dispatch, uploadImageFile),
    )

    const zoomControls = boardScrollAndZoomHandler(
        board,
        boardElement,
        scrollElement,
        zoom,
        coordinateHelper,
        toolController,
    )
    const { viewRect } = zoomControls

    imageDropHandler(boardElement, assets, focus, uploadImageFile)
    itemCreateHandler(board, focus, latestNote, boardElement, onAdd)
    itemDeleteHandler(boardId, dispatch, focus)
    itemDuplicateHandler(board, boardStore.crdtStore, dispatch, focus)
    setItemUpgrader((id) =>
        upgradeToCollaborativeText(id, board.get(), boardStore.crdtStore, dispatch, htmlToQuillDelta),
    )
    doOnUnmount.push(() => setItemUpgrader(null))
    itemHideContentsHandler(board, focus, dispatch)
    itemMoveWithArrowKeysHandler(board, dispatch, focus)
    itemUndoHandler(dispatch)
    itemSelectAllHandler(board, focus)
    installZoomKeyboardShortcuts(zoomControls)
    installKeyboardShortcut(
        (e) => e.key === "Escape",
        () => {
            toolController.useDefaultTool()
            focus.set(noFocus)
        },
    )
    const toolKeys: [string, Tool][] = [
        ["v", "select"],
        ["h", "pan"],
        ["c", "connect"],
        ["r", "rect"],
        ["o", "ellipse"],
        ["l", "line"],
        ["a", "arrow"],
        ["p", "pen"],
    ]
    toolKeys.forEach(([key, t]) => installKeyboardShortcut(plainKey(key), () => toolController.tool.set(t)))
    installKeyboardShortcut(controlKey("k"), () => {
        const f = focus.get()
        const id = f.status === "editing" ? f.itemId : [...getSelectedItemIds(f)][0]
        if (id) openLinkDialog(id)
    })
    L.fromEvent<JSX.KeyboardEvent>(window, "click")
        .pipe(L.applyScope(componentScope()))
        .forEach((event) => {
            if (!boardElement.get()!.contains(event.target as Node)) {
                // Click outside => reset selection
                focus.set(noFocus)
            }
        })

    onClickOutside(boardElement, () => {
        focus.set(noFocus)
    })

    function onClick(e: JSX.UIEvent) {
        const f = focus.get()
        if (f.status === "connection-adding") {
            toolController.useDefaultTool()
        } else if (f.status === "adding") {
            onAdd(f.item)
        } else {
            if (e.target === boardElement.get()) {
                if (tool.get() === "connect") {
                    startConnecting(
                        board,
                        coordinateHelper,
                        latestConnection,
                        dispatch,
                        toolController,
                        focus,
                        coordinateHelper.currentBoardCoordinates.get(),
                    )
                } else {
                    focus.set(noFocus)
                }
            }
        }
    }

    function onAdd(item: Item) {
        toolController.useDefaultTool()
        const point = coordinateHelper.currentBoardCoordinates.get()
        const { x, y } = item.type !== "container" ? G.add(point, { x: -item.width / 2, y: -item.height / 2 }) : point
        item = withCurrentContainer({ ...item, x, y }, board.get())
        // Neue Texte/Post-its immer als gemeinsam bearbeitbarer Text (Links und Formatierung funktionieren nur dort)
        if ((item.type === "note" || item.type === "text") && board.get().crdt && !item.crdt) {
            item = { ...item, crdt: CrdtEnabled }
        }

        dispatch({ action: "item.add", boardId, items: [item], connections: [] })

        if (item.type === "note" || item.type === "text") {
            focus.set({ status: "editing", itemId: item.id })
        } else {
            focus.set({ status: "selected", itemIds: new Set([item.id]), connectionIds: emptySet() })
        }
    }

    coordinateHelper.currentBoardCoordinates.pipe(L.throttle(30)).forEach((position) => {
        dispatch({ action: "cursor.move", position, boardId })
    })

    const { selectionRect } = boardDragHandler({
        ...{
            board,
            boardElem: boardElement,
            coordinateHelper,
            latestConnection,
            focus,
            toolController,
            dispatch,
        },
    })

    H.onUnmount(() => {
        doOnUnmount.forEach((fn) => fn())
    })

    const boardAccessStatus = L.view(boardState, (s) => s.status)
    const quickZoom = L.view(zoom, "quickZoom")
    const mainZoom = L.view(zoom, "zoom")
    const borderContainerStyle = L.combineTemplate({
        width: L.view(board, quickZoom, (b) => b.width + "em"),
        height: L.view(board, quickZoom, (b) => b.height + "em"),
        fontSize: L.view(mainZoom, (z) => z + "em"),
        transform: L.view(quickZoom, (z) => {
            const percentTranslate = ((z - 1) / 2) * 100
            return `translate(${percentTranslate}%, ${percentTranslate}%) scale(${z})`
        }),
        "will-change": "transform, fontSize",
    })

    const className = L.view(
        boardAccessStatus,
        (status) => `board-container ${isEmbedded() ? "embedded" : ""} ${status}`,
    )

    const items = L.view(L.view(board, "items"), Object.values, (items) => items.filter((i) => !i.hidden))
    const selectedItems = L.view(board, focus, (b, f) => getSelectedItems(b)(f))
    const modalContent = L.atom<any>(null)

    L.interval(100, null, componentScope()).forEach(() => {
        if (window.scrollY !== 0 || window.scrollX !== 0) {
            if (focus.get().status !== "editing") {
                // Reset scroll position when not editing. At least iOS seems to need this. It's vital that our scroll pos stays at origin.
                window.scrollTo(0, 0)
            }
        }
    })
    return (
        <div id="root" className={className}>
            <ModalContainer content={modalContent} />
            <BoardViewHeader
                {...{
                    board,
                    usersOnBoard: L.view(boardState, "users"),
                    sessionState,
                    dispatch,
                    accessLevel,
                    modalContent,
                    eventsFromServer: boardStore.eventsFromServer,
                    viewRect,
                    online: L.view(boardStore.state, (s) => s.status === "online"),
                    crdtStore: boardStore.crdtStore,
                }}
            />
            <div className="content-container" ref={containerElement.set}>
                <div className="scroll-container" ref={scrollElement.set}>
                    <div className="border-container" style={borderContainerStyle}>
                        <div
                            className={L.view(tool, (t) => "board " + t)}
                            draggable={isFirefox ? L.view(focus, (f) => f.status !== "editing") : true}
                            ref={boardElement.set}
                            onClick={onClick}
                            onTouchEnd={onClick}
                        >
                            <ListView observable={items} renderObservable={renderItem} getKey={(i) => i.id} />

                            {L.view(tool, (t) =>
                                t === "connect" ? null : (
                                    <ListView
                                        observable={selectedItems}
                                        renderObservable={renderSelectionBorder}
                                        getKey={(i) => i.id}
                                    />
                                ),
                            )}
                            <RectangularDragSelection {...{ rect: selectionRect }} />
                            <ListView
                                observable={liveDrawings}
                                renderObservable={renderLiveDrawing}
                                getKey={(d) => d.id}
                            />
                            <CursorsView {...{ cursors, sessions, viewRect }} />
                            <ContextMenuView
                                {...{
                                    latestNote,
                                    dispatch,
                                    board,
                                    focus,
                                    viewRect,
                                }}
                            />
                            <ConnectionsView {...{ board, zoom, dispatch, focus, coordinateHelper }} />
                        </div>
                        <DrawLayer {...{ board, toolController, coordinateHelper, dispatch, focus }} />
                    </div>
                </div>
                <BoardToolLayer
                    {...{
                        board,
                        accessLevel,
                        boardStore,
                        containerElement,
                        coordinateHelper,
                        dispatch,
                        focus,
                        latestNote,
                        onAdd,
                        uploadImageFile,
                        toolController,
                        sessionState,
                        ...zoomControls,
                    }}
                />
            </div>
        </div>
    )

    function renderSelectionBorder(id: string, item: L.Property<Item>) {
        return <SelectionBorder {...{ id, tool, item: item, coordinateHelper, board, focus, dispatch }} />
    }

    // Striche, die andere gerade zeichnen (Zwischenstände, noch nicht gespeichert)
    function renderLiveDrawing(id: string, d: L.Property<Drawing>) {
        return (
            <span
                className="drawing live"
                data-testid={"live-drawing-" + id}
                style={L.view(
                    d,
                    (v) =>
                        ({
                            position: "absolute",
                            left: 0,
                            top: 0,
                            transform: `translate(${v.x}em, ${v.y}em)`,
                            zIndex: DRAWING_Z,
                        }) as any,
                )}
            >
                <DrawingSvg drawing={d} />
            </span>
        )
    }

    function renderItem(id: string, item: L.Property<Item>) {
        const isLocked = L.combineTemplate({ locks, sessionId }).pipe(
            L.map(({ locks, sessionId }) => !!locks[id] && locks[id] !== sessionId),
        )

        return L.view(L.view(item, "type"), (t) => {
            switch (t) {
                case "container":
                case "text":
                case "note":
                    return (
                        <ItemView
                            {...{
                                board,
                                history,
                                id,
                                type: t,
                                item: item as L.Property<Note>,
                                isLocked,
                                focus,
                                coordinateHelper,
                                latestConnection,
                                dispatch,
                                toolController,
                                accessLevel,
                                boardStore,
                            }}
                        />
                    )
                case "image":
                    return (
                        <ImageView
                            {...{
                                id,
                                image: item as L.Property<Image>,
                                assets,
                                board,
                                isLocked,
                                focus,
                                toolController,
                                coordinateHelper,
                                latestConnection,
                                dispatch,
                            }}
                        />
                    )
                case "drawing":
                    return (
                        <DrawingView
                            {...{
                                id,
                                drawing: item as L.Property<Drawing>,
                                board,
                                isLocked,
                                focus,
                                toolController,
                                coordinateHelper,
                                latestConnection,
                                dispatch,
                            }}
                        />
                    )
                case "video":
                    return (
                        <VideoView
                            {...{
                                id,
                                video: item as L.Property<Video>,
                                assets,
                                board,
                                isLocked,
                                focus,
                                toolController,
                                coordinateHelper,
                                latestConnection,
                                dispatch,
                            }}
                        />
                    )
                default:
                    throw Error("Unsupported item: " + t)
            }
        })
    }
}
