import { h, HarmajaChild } from "harmaja"
import * as L from "lonna"
import { Board, isTextItem, Item, Note, newContainer, newSimilarNote, newText } from "../../../../common/src/domain"
import { BoardStore } from "../../store/board-store"
import { Dispatch } from "../../store/server-connection"
import { BoardCoordinateHelper } from "../board-coordinates"
import { BoardFocus, getSelectedConnectionIds, getSelectedItemIds, getSelectedItem } from "../board-focus"
import { dispatchDeletion } from "../item-delete"
import { dispatchDuplication } from "../item-duplicate"
import { openLinkDialog } from "../link-tools"
import { Tool, ToolController } from "../tool-selection"
import { ToolIcons } from "./tool-icons"
import { t } from "../../../../common/src/i18n"

type ToolDef = {
    name: Tool
    label: string
    key?: string
    icon: HarmajaChild
}

export const MainToolBar = ({
    coordinateHelper,
    latestNote,
    containerElement,
    onAdd,
    toolController,
    focus,
    dispatch,
    board,
    boardStore,
    uploadImageFile,
}: {
    coordinateHelper: BoardCoordinateHelper
    latestNote: L.Property<Note>
    containerElement: L.Atom<HTMLElement | null>
    onAdd: (i: Item) => void
    toolController: ToolController
    focus: L.Atom<BoardFocus>
    dispatch: Dispatch
    board: L.Property<Board>
    boardStore: BoardStore
    uploadImageFile: (file: File) => Promise<void>
}) => {
    const tool = toolController.tool
    const fileInput = L.atom<HTMLInputElement | null>(null)

    const startAdd = (name: Tool, create: () => Item, element: HarmajaChild) => () => {
        focus.set({ status: "adding", element, item: create() })
        tool.set(name)
    }

    const toolButton = (d: ToolDef, onActivate: () => void) => (
        <button
            type="button"
            className={L.view(tool, (t) => `wb-tool ${d.name} ${t === d.name ? "active" : ""}`)}
            data-tip={d.key ? `${d.label} (${d.key})` : d.label}
            aria-label={d.label}
            data-testid={`tool-${d.name}`}
            onClick={onActivate}
        >
            {d.icon}
        </button>
    )
    const simple = (name: Tool, label: string, key: string, icon: HarmajaChild) =>
        toolButton({ name, label, key, icon }, () => tool.set(name))

    const actionButton = (id: string, label: string, icon: HarmajaChild, onClick: () => void, enabled?: L.Property<boolean>, key?: string) => (
        <button
            type="button"
            className={enabled ? L.view(enabled, (e) => `wb-tool action ${id} ${e ? "" : "disabled"}`) : `wb-tool action ${id}`}
            data-tip={key ? `${label} (${key})` : label}
            aria-label={label}
            data-testid={`tool-${id}`}
            onClick={onClick}
        >
            {icon}
        </button>
    )

    const hasSelection = L.view(focus, (f) => getSelectedConnectionIds(f).size > 0 || getSelectedItemIds(f).size > 0)

    function linkAction() {
        const f = focus.get()
        const id = f.status === "editing" ? f.itemId : [...getSelectedItemIds(f)][0]
        const item = id ? board.get().items[id] : null
        if (item && isTextItem(item)) openLinkDialog(item.id)
    }

    function pickImage(e: any) {
        const input = e.currentTarget as HTMLInputElement
        const file = input.files?.[0]
        if (!file) return
        // The image goes to the center of the current view
        const r = containerElement.get()?.getBoundingClientRect()
        if (r) {
            coordinateHelper.currentPageCoordinates.set({
                x: r.left + r.width / 2 + window.scrollX - 80,
                y: r.top + r.height / 2 + window.scrollY - 80,
            })
        }
        uploadImageFile(file).finally(() => (input.value = ""))
    }

    return (
        <div className="main-toolbar board-tool vertical" onMouseDown={(e: any) => e.stopPropagation()} onClick={(e: any) => e.stopPropagation()} data-testid="toolbar" role="toolbar" aria-label={t("tool.toolbar")}>
            {simple("select", t("tool.select"), "V", ToolIcons.select)}
            {simple("pan", t("tool.pan"), "H", ToolIcons.pan)}
            <span className="wb-sep" />
            {toolButton({ name: "note", label: t("tool.note"), key: "N", icon: ToolIcons.note }, startAdd("note", () => newSimilarNote(latestNote.get()), ToolIcons.note))}
            {toolButton({ name: "text", label: t("tool.text"), key: "T", icon: ToolIcons.text }, startAdd("text", () => newText(board.get().crdt), ToolIcons.text))}
            {simple("rect", t("tool.rect"), "R", ToolIcons.rect)}
            {simple("ellipse", t("tool.ellipse"), "O", ToolIcons.ellipse)}
            {simple("line", t("tool.line"), "L", ToolIcons.line)}
            {simple("arrow", t("tool.arrow"), "A", ToolIcons.arrow)}
            {simple("pen", t("tool.pen"), "P", ToolIcons.pen)}
            <span className="wb-sep" />
            {actionButton("image", t("tool.image"), ToolIcons.image, () => fileInput.get()?.click())}
            <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: "none" }}
                data-testid="image-input"
                ref={fileInput.set}
                onChange={pickImage}
            />
            {actionButton("link", t("tool.link", { key: t("key.link") }), ToolIcons.link, linkAction)}
            {simple("connect", t("tool.connect"), "C", ToolIcons.connect)}
            {toolButton({ name: "container", label: t("tool.area"), key: "F", icon: ToolIcons.container }, startAdd("container", () => newContainer(board.get().crdt), ToolIcons.container))}
            <span className="wb-sep" />
            {actionButton("undo", t("tool.undo"), ToolIcons.undo, () => dispatch({ action: "ui.undo" }), boardStore.canUndo, t("key.undo"))}
            {actionButton("redo", t("tool.redo"), ToolIcons.redo, () => dispatch({ action: "ui.redo" }), boardStore.canRedo, t("key.redo"))}
            {actionButton("duplicate", t("tool.duplicate"), ToolIcons.duplicate, () => dispatchDuplication(focus, board.get(), dispatch, boardStore.crdtStore), hasSelection)}
            {actionButton("delete", t("tool.delete"), ToolIcons.trash, () => dispatchDeletion(board.get().id, focus.get(), dispatch), hasSelection, t("key.delete"))}
        </div>
    )
}
