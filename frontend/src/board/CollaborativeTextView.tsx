import { componentScope, h } from "harmaja"
import * as L from "lonna"
import Quill from "quill"
import QuillCursors from "quill-cursors"
import { QuillBinding } from "y-quill"
import {
    AccessLevel,
    Board,
    LocalUIEvent,
    TextItem,
    canWrite,
    getAlign,
    getHorizontalAlign,
    getItemBackground,
    getItemShape,
} from "../../../common/src/domain"
import { CRDTStore } from "../store/crdt-store"
import { getAlignItems } from "./ItemView"
import { BoardFocus } from "./board-focus"
import { fitEditorToNote } from "./collaborativeFontSize"
import { itemTextColor } from "./contrasting-color"
import { preventDoubleClick } from "./double-click"
import PasteLinkOverText from "./quillPasteLinkOverText"
import ClickableLink from "./quillClickableLink"
import { openLinkDialog, registerEditor, unregisterEditor } from "./link-tools"
import * as H from "harmaja"

Quill.register("modules/cursors", QuillCursors)
Quill.register("modules/pasteLinkOverText", PasteLinkOverText)
Quill.register(ClickableLink, true) // true = bewusst überschreiben (kein Quill-Warning)

interface CollaborativeTextViewProps {
    item: L.Property<TextItem>
    board: L.Property<Board>
    id: string
    accessLevel: L.Property<AccessLevel>
    focus: L.Atom<BoardFocus>
    itemFocus: L.Property<"none" | "selected" | "dragging" | "editing">
    crdtStore: CRDTStore
    isLocked: L.Property<boolean>
    uiEvents: L.EventStream<LocalUIEvent>
    element: L.Property<HTMLElement | null>
}
export function CollaborativeTextView({
    id,
    item,
    board,
    accessLevel,
    focus,
    itemFocus,
    isLocked,
    crdtStore,
    uiEvents,
    element,
}: CollaborativeTextViewProps) {
    const baseFontSize = (i: TextItem) => (i.fontSize ? i.fontSize : 1)
    // Notizen: Schrift wird beim Tippen nur so weit kleiner, dass der Text in die Notiz passt (siehe fitNoteText)
    const fontSize = L.view(item, (i) => (i.type === "note" ? "" : `${baseFontSize(i)}em`))
    const color = L.view(item, itemTextColor)

    const quillEditor = L.atom<Quill | null>(null)

    let editorElement: HTMLElement | null = null
    let fitPending = false
    function fitNoteText() {
        if (fitPending) return
        fitPending = true
        requestAnimationFrame(() => {
            fitPending = false
            const i = item.get()
            const note = element.get()
            if (i.type === "note" && editorElement && note) fitEditorToNote(editorElement, note, baseFontSize(i))
        })
    }
    // Neu anpassen, wenn sich Größe, Form oder Schriftgröße der Notiz ändert (auch durch andere Nutzer)
    L.view(item, (i) => `${i.type}|${i.width}|${i.height}|${i.fontSize}|${getItemShape(i)}`)
        .applyScope(componentScope())
        .forEach(fitNoteText)

    accessLevel.applyScope(componentScope()).forEach((al) => {
        quillEditor.get()?.enable(canWrite(al))
    })

    function initQuill(el: HTMLElement) {
        const quill = new Quill(el, {
            modules: {
                cursors: true,
                toolbar: false,
                pasteLinkOverText: true,
                history: {
                    userOnly: true, // Local undo shouldn't undo changes from remote users
                },
            },
            theme: "snow",
            readOnly: !canWrite(accessLevel.get()),
        })
        const crdt = crdtStore.getBoardCrdt(board.get().id)
        const ytext = crdt.getField(id, "text")
        new QuillBinding(ytext, quill, crdt.awareness)
        quillEditor.set(quill)
        editorElement = el
        quill.on("text-change", fitNoteText)
        fitNoteText()
        registerEditor(id, quill)
        // Tastatur ausserhalb des Bearbeitungsmodus gehoert dem Board (Strg/Cmd+Z, Entf, ...), nicht dem Editor.
        // Hat der Editor trotzdem noch den DOM-Fokus (z. B. nach Mausdruck auf den Text zum Verschieben),
        // geben wir ihn ab, bevor Quill die Taste sieht. Quill 1.x ignoriert Tasten ohne Fokus.
        el.addEventListener(
            "keydown",
            () => {
                if (itemFocus.get() !== "editing" && quill.hasFocus()) quill.blur()
            },
            true,
        )
        // Neu angelegtes Element: Fokus kam vor dem Editor, also jetzt nachholen
        if (itemFocus.get() === "editing") setTimeout(() => quill.focus(), 0)
    }
    H.onUnmount(() => unregisterEditor(id))

    const editingThis = L.view(itemFocus, (f) => f === "editing")

    editingThis.forEach((e) => {
        const q = quillEditor.get()
        if (q) {
            if (e) {
                const multipleLines =
                    q
                        .getText()
                        .split("\n")
                        .filter((x) => x).length > 1
                if (!multipleLines) {
                    // For one-liners, select the whole text on double click
                    q.setSelection(0, 1000000)
                }
            } else {
                // Clear text selecting when not editing
                q.setSelection(null as any)
            }
        }
    })

    // Fokus weg vom Editor, sobald das Element nicht mehr im Bearbeitungsmodus ist (z. B. Verschieben gestartet)
    itemFocus.applyScope(componentScope()).forEach((f) => {
        const q = quillEditor.get()
        if (f !== "editing" && q && q.hasFocus()) q.blur()
    })

    function handleClick() {
        if (itemFocus.get() === "selected") {
            focus.set({ status: "editing", itemId: id })
        }
    }

    const pointerEvents = L.view(itemFocus, isLocked, (f, l) =>
        f === "editing" || f === "selected" || l ? "auto" : "none",
    )
    const hAlign = L.view(item, getAlign, getHorizontalAlign).applyScope(componentScope())
    hAlign.onChange((align) => {
        quillEditor.get()?.formatText(0, 10000000, "align", align === "left" ? "" : align)
    })

    uiEvents.applyScope(componentScope()).forEach((e) => {
        if (e.action === "ui.text.format" && e.itemIds.includes(id)) {
            const quill = quillEditor.get()
            const selection = quill?.getSelection()
            const format = selection && quill?.getFormat(selection)
            const newValue = !(format && format[e.format])
            quill?.format(e.format, newValue)
        }
    })

    let touchMoves = 0

    return (
        <div
            className="quill-wrapper text"
            onKeyUp={(e) => {
                if (itemFocus.get() !== "editing") return
                e.stopPropagation()
                if (e.key === "Escape") {
                    focus.set({ status: "selected", itemIds: new Set([id]), connectionIds: new Set() })
                }
            }}
            onKeyDown={(e) => {
                if (itemFocus.get() !== "editing") return // Board-Tastenkuerzel (Rueckgaengig usw.) durchlassen
                e.stopPropagation()
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                    e.preventDefault()
                    openLinkDialog(id)
                }
            }}
            onKeyPress={(e) => {
                if (itemFocus.get() !== "editing") return
                e.stopPropagation()
            }}
            onMouseDown={() => {
                // Im Bearbeitungsmodus ist bei einzeiligem Text alles vorausgewaehlt. Ein Mausdruck in diese
                // Auswahl wuerde den markierten Text ziehen statt neu zu markieren. Auswahl vorher aufloesen.
                if (itemFocus.get() === "editing") {
                    const sel = window.getSelection()
                    if (sel && !sel.isCollapsed) sel.removeAllRanges()
                }
            }}
            onDoubleClick={(e) => {
                e.stopPropagation()
                quillEditor.get()?.focus()
            }}
            onTouchStart={(e) => {
                preventDoubleClick(e)
                touchMoves = 0
            }}
            onTouchMove={() => touchMoves++}
            onTouchEnd={() => {
                if (touchMoves === 0) {
                    // This is a way to detect a tap (vs swipe)
                    quillEditor.get()?.focus()
                }
            }}
            onClick={handleClick}
            style={L.combineTemplate({ alignItems: L.view(item, getAlignItems) })}
        >
            <div
                className="quill-editor"
                style={L.combineTemplate({ fontSize, color, pointerEvents })}
                ref={initQuill}
            />
        </div>
    )
}
