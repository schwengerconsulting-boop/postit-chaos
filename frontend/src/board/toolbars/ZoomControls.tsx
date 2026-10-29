import { h } from "harmaja"
import { ResetZoomIcon, ZoomInIcon, ZoomOutIcon } from "../../components/Icons"
import { ZoomAndScrollControls } from "../board-scroll-and-zoom"
import { t } from "../../../../common/src/i18n"

export function ZoomControls({
    increaseZoom,
    decreaseZoom,
    resetZoom,
}: Pick<ZoomAndScrollControls, "increaseZoom" | "decreaseZoom" | "resetZoom">) {
    return (
        <span className="zoom-controls" onClick={(e) => e.stopPropagation()}>
            <span className="icon" title={t("zoom.in")} onClick={() => increaseZoom("preserveCenter")}>
                <ZoomInIcon />
            </span>
            <span className="icon" title={t("zoom.reset")} onClick={() => resetZoom("preserveCenter")}>
                <ResetZoomIcon />
            </span>
            <span className="icon" title={t("zoom.out")} onClick={() => decreaseZoom("preserveCenter")}>
                <ZoomOutIcon />
            </span>
        </span>
    )
}
