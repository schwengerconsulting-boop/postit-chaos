import { localStorageAtom } from "./local-storage-atom"
import * as L from "lonna"
import { DEFAULT_STROKE_COLOR, DEFAULT_STROKE_WIDTH, TRANSPARENT } from "../../../common/src/colors"

export type Tool =
    | "pan"
    | "select"
    | "connect"
    | "note"
    | "container"
    | "text"
    | "line"
    | "arrow"
    | "pen"
    | "rect"
    | "ellipse"
export type ControlSettings = {
    tool: Tool
    defaultTool?: Tool
}

/** Werkzeuge, die per Ziehen auf dem Board zeichnen (Stift, Linie, Pfeil, Rechteck, Ellipse). */
export const DRAW_TOOLS: Tool[] = ["pen", "line", "arrow", "rect", "ellipse"]
export const isDrawTool = (t: Tool) => DRAW_TOOLS.includes(t)

/** Zuletzt gewählte Zeichenfarben/-stärke: Strich/Rahmen, Füllung (Formen, Post-its) und Strichstärke. */
export type DrawStyle = { stroke: string; fill: string; width: number; noteColor?: string }
export const DEFAULT_DRAW_STYLE: DrawStyle = {
    stroke: DEFAULT_STROKE_COLOR,
    fill: TRANSPARENT,
    width: DEFAULT_STROKE_WIDTH,
}

export type ToolController = ReturnType<typeof ToolController>

export function ToolController() {
    const controlSettings = localStorageAtom<ControlSettings>("controlSettings", {
        tool: "pan",
    })
    const tool = L.atom(L.view(controlSettings, "tool"), (t) => {
        controlSettings.modify((s) => ({
            tool: t,
            defaultTool: t === "pan" || t === "select" ? t : s.defaultTool,
        }))
    })
    const defaultTool = L.view(controlSettings, (s) => s.defaultTool || "pan")
    const drawStyle = localStorageAtom<DrawStyle>("drawStyle", DEFAULT_DRAW_STYLE)

    const useDefaultTool = () => {
        tool.set(defaultTool.get())
    }

    return {
        controlSettings,
        tool,
        useDefaultTool,
        drawStyle,
    }
}
