import { BoardFocus, getSelectedItemIds } from "./board-focus"

/**
 * Darf das Element per Maus-Ziehen (HTML5-Drag) verschoben werden? Im Textbearbeitungsmodus nie:
 * Dort gehört Ziehen dem Text (markieren, markierten Text ziehen), nicht dem Element.
 * Touch ist davon ausgenommen (siehe isItemTouchDragEnabled): Finger-Ziehen markiert keinen Text.
 */
export function isItemDragEnabled(
    f: BoardFocus,
    id: string,
    onlyWhenSelected: boolean,
    isResizeHandle = false,
): boolean {
    // Ausnahme: die Ecken zum Vergrößern. Dort gibt es keinen Text, sie müssen auch beim Tippen greifen.
    if (f.status === "editing" && f.itemId === id && !isResizeHandle) return false
    return isItemTouchDragEnabled(f, id, onlyWhenSelected)
}

export function isItemTouchDragEnabled(f: BoardFocus, id: string, onlyWhenSelected: boolean): boolean {
    return !onlyWhenSelected || getSelectedItemIds(f).has(id)
}

/**
 * Board-Drag (Board schwenken / Auswahlrahmen) darf nicht starten, wenn der Mausdruck im Element lag, das
 * gerade im Textbearbeitungsmodus ist, auch nicht am Rand oder Innenabstand. Dort gibt es nichts zu ziehen.
 */
export function isBoardDragBlockedByEditing(f: BoardFocus, mouseDownItemId: string | null): boolean {
    return f.status === "editing" && mouseDownItemId === f.itemId
}
