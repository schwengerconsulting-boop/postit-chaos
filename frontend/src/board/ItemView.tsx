import { componentScope, h } from "harmaja"
import * as L from "lonna"
import {
    AccessLevel,
    Board,
    Connection,
    getAlign,
    getHorizontalAlign,
    getItemBackground,
    getItemShape,
    getVerticalAlign,
    isContainer,
    isLocalUIEvent,
    isTextItem,
    Item,
    ItemType,
    TextItem,
} from "../../../common/src/domain"
import { BoardStore, Dispatch } from "../store/board-store"
import { BoardCoordinateHelper } from "./board-coordinates"
import { BoardFocus } from "./board-focus"
import { CollaborativeTextView } from "./CollaborativeTextView"
import { DragBorder } from "./DragBorder"
import { itemDragToMove } from "./item-dragmove"
import { itemSelectionHandler } from "./item-selection"
import { TextView } from "./TextView"
import { ToolController } from "./tool-selection"
import { itemZIndex } from "./zIndices"
import { VisibilityOffIcon } from "../components/Icons"
import { t } from "../../../common/src/i18n"

export const ItemView = ({
    board,
    accessLevel,
    id,
    type,
    item,
    isLocked,
    focus,
    coordinateHelper,
    latestConnection,
    dispatch,
    toolController,
    boardStore,
}: {
    board: L.Property<Board>
    accessLevel: L.Property<AccessLevel>
    id: string
    type: ItemType
    item: L.Property<Item>
    isLocked: L.Property<boolean>
    focus: L.Atom<BoardFocus>
    coordinateHelper: BoardCoordinateHelper
    latestConnection: L.Property<Connection | null>
    dispatch: Dispatch
    toolController: ToolController
    boardStore: BoardStore
}) => {
    const element = L.atom<HTMLElement | null>(null)

    const ref = (el: HTMLElement) => {
        itemDragToMove(
            id,
            board,
            focus,
            toolController,
            coordinateHelper,
            latestConnection,
            dispatch,
            type === "container",
        )(el)
        element.set(el)
    }

    const { itemFocus, selected, onClick, onTouchStart } = itemSelectionHandler(
        id,
        type,
        focus,
        toolController,
        board,
        coordinateHelper,
        latestConnection,
        dispatch,
    )

    function itemPadding(i: Item) {
        if (i.type != "note") return undefined

        const shape = getItemShape(i)
        if (i.flat) return shape == "round" || shape == "diamond" ? `${i.width / 8}em` : "0.4em"
        return shape == "diamond"
            ? `${i.width / 4}em`
            : shape == "round"
              ? `${i.width / 8}em`
              : shape == "square" || shape == "rect"
                ? `${(i.fontSize || 1) / 3}em`
                : undefined
    }
    const shape = L.view(item, getItemShape)
    const itemNow = item.get()
    // Reaktiv: ein altes Element kann zur Laufzeit auf gemeinsamen Text umgestellt werden (Link-Werkzeug)
    // Im Konstruktor anlegen: componentScope() geht nur dort, nicht im späteren Umschalten
    const uiEvents = boardStore.events.pipe(L.filter(isLocalUIEvent), L.applyScope(componentScope()))
    const isCollaborativeText = L.view(item, (i) => isTextItem(i) && !!i.crdt)

    return (
        <span
            title={L.view(isLocked, (l) => (l ? t("item.beingEdited") : ""))}
            ref={ref}
            data-itemid={id}
            draggable={L.view(itemFocus, (f) => f !== "editing")}
            onClick={onClick}
            onTouchStart={onTouchStart}
            className={L.view(
                selected,
                L.view(item, getItemBackground),
                isLocked,
                (s, b, l) =>
                    `${type} ${"color-" + b.replace("#", "").toLowerCase()} ${s ? "selected" : ""} ${
                        l ? "locked" : ""
                    } ${(itemNow as any).flat ? "flat" : ""}`,
            )}
            style={L.view(item, (i) => {
                return {
                    top: 0,
                    left: 0,
                    height: i.height + "em",
                    width: i.width + "em",
                    transform: `translate(${i.x}em, ${i.y}em)`,
                    zIndex: itemZIndex(i),
                    position: "absolute",
                    padding: itemPadding(i),
                    justifyContent: getJustifyContent(i),
                    alignItems: getAlignItems(i),
                    textAlign: getTextAlign(i),
                }
            })}
        >
            <span
                className={L.view(shape, (s) => "shape " + s)}
                style={L.view(item, (i) => {
                    const t = i as TextItem
                    return {
                        background: getItemBackground(i),
                        border: t.borderColor
                            ? `max(1px, ${(t.borderWidth ?? 1) / 40}em) solid ${t.borderColor}`
                            : undefined,
                        borderRadius: t.rounded && getItemShape(i) !== "round" ? "0.6em" : undefined,
                    }
                })}
            />

            {L.view(isCollaborativeText, (collaborative) =>
                collaborative ? (
                    <CollaborativeTextView
                        item={item as L.Property<TextItem>}
                        board={board}
                        id={id}
                        accessLevel={accessLevel}
                        focus={focus}
                        itemFocus={itemFocus}
                        crdtStore={boardStore.crdtStore}
                        isLocked={isLocked}
                        uiEvents={uiEvents}
                        element={element}
                    />
                ) : (
                    <TextView
                        id={id}
                        item={item as L.Property<TextItem>}
                        dispatch={dispatch}
                        board={board}
                        toolController={toolController}
                        accessLevel={accessLevel}
                        focus={focus}
                        itemFocus={itemFocus}
                        coordinateHelper={coordinateHelper}
                        element={element}
                    />
                ),
            )}

            {L.view(
                item,
                (i) => isContainer(i) && i.contentsHidden,
                (hidden) =>
                    (hidden && (
                        <div className="hidden-contents-indicator">
                            <VisibilityOffIcon />
                        </div>
                    )) ??
                    null,
            )}

            {type === "container" && (
                <DragBorder {...{ id, board, toolController, coordinateHelper, latestConnection, focus, dispatch }} />
            )}
        </span>
    )
}

export function getJustifyContent(item: Item) {
    if (isTextItem(item)) {
        switch (getHorizontalAlign(getAlign(item))) {
            case "left":
                return "flex-start"
            case "center":
                return "center"
            case "right":
                return "flex-end"
        }
    }
    return null
}

export function getAlignItems(item: Item) {
    if (isTextItem(item)) {
        switch (getVerticalAlign(getAlign(item))) {
            case "top":
                return "flex-start"
            case "middle":
                return "center"
            case "bottom":
                return "flex-end"
        }
    }
    return null
}

function getTextAlign(item: Item) {
    if (isTextItem(item)) {
        return getHorizontalAlign(getAlign(item))
    }
    return null
}
