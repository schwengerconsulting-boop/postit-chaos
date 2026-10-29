import { h } from "harmaja"
import * as L from "lonna"
import { Board, Connection, Drawing } from "../../../common/src/domain"
import { arrowHeadPath, drawingPath, STROKE_EM } from "../../../common/src/drawing"
import { Dispatch } from "../store/board-store"
import { BoardCoordinateHelper } from "./board-coordinates"
import { BoardFocus } from "./board-focus"
import { itemDragToMove } from "./item-dragmove"
import { itemSelectionHandler } from "./item-selection"
import { ToolController } from "./tool-selection"

/** Zeichnet Stift, Linie oder Pfeil als SVG in em-Einheiten (skaliert beim Verändern der Größe mit). */
export const DrawingSvg = ({ drawing }: { drawing: L.Property<Drawing> }) => (
    <svg
        className="drawing-svg"
        viewBox={L.view(drawing, (d) => `0 0 ${d.width} ${d.height}`)}
        style={L.view(drawing, (d) => ({ width: d.width + "em", height: d.height + "em" }))}
    >
        <path
            className="hit"
            d={L.view(drawing, drawingPath)}
            fill="none"
            stroke="transparent"
            stroke-width={L.view(drawing, (d) => Math.max(0.5, STROKE_EM(d.strokeWidth)))}
            stroke-linecap="round"
            stroke-linejoin="round"
        />
        <path
            className="stroke"
            d={L.view(drawing, drawingPath)}
            fill="none"
            stroke={L.view(drawing, "color")}
            stroke-width={L.view(drawing, (d) => STROKE_EM(d.strokeWidth))}
            stroke-linecap="round"
            stroke-linejoin="round"
        />
        {L.view(drawing, (d) =>
            d.kind === "arrow" ? <path className="head" d={arrowHeadPath(d)} fill={d.color} stroke={d.color} stroke-width="0.05" stroke-linejoin="round" /> : null,
        )}
    </svg>
)

export const DrawingView = ({
    id,
    drawing,
    board,
    isLocked,
    focus,
    toolController,
    coordinateHelper,
    latestConnection,
    dispatch,
}: {
    board: L.Property<Board>
    id: string
    drawing: L.Property<Drawing>
    isLocked: L.Property<boolean>
    focus: L.Atom<BoardFocus>
    toolController: ToolController
    coordinateHelper: BoardCoordinateHelper
    latestConnection: L.Property<Connection | null>
    dispatch: Dispatch
}) => {
    const { selected, onClick, onTouchStart } = itemSelectionHandler(
        id,
        "drawing",
        focus,
        toolController,
        board,
        coordinateHelper,
        latestConnection,
        dispatch,
    )
    return (
        <span
            className={L.view(selected, isLocked, (s, l) => `drawing ${s ? "selected" : ""} ${l ? "locked" : ""}`)}
            data-itemid={id}
            data-testid={"drawing-" + id}
            draggable={true}
            onClick={onClick}
            onTouchStart={onTouchStart}
            ref={
                itemDragToMove(
                    id,
                    board,
                    focus,
                    toolController,
                    coordinateHelper,
                    latestConnection,
                    dispatch,
                    false,
                ) as any
            }
            style={L.view(
                drawing,
                (d: Drawing) =>
                    ({
                        top: 0,
                        left: 0,
                        transform: `translate(${d.x}em, ${d.y}em)`,
                        height: d.height + "em",
                        width: d.width + "em",
                        zIndex: DRAWING_Z + Math.max(0, d.z),
                        position: "absolute",
                    } as any),
            )}
        >
            <DrawingSvg drawing={drawing} />
        </span>
    )
}

/** Anmerkungen liegen über den Inhalten (Notizen, Texte, Bilder), aber unter Menüs und Verbindungen. */
export const DRAWING_Z = 100000000
