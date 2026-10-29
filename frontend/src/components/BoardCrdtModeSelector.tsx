import { Fragment, h } from "harmaja"
import * as L from "lonna"
import { Checkbox } from "./components"
import { t } from "../../../common/src/i18n"

type BoardCrdtModeSelectorProps = {
    useCollaborativeEditing: L.Atom<boolean>
}
export const BoardCrdtModeSelector = ({ useCollaborativeEditing }: BoardCrdtModeSelectorProps) => {
    return (
        <div className="board-access-editor">
            <div className="restrict-toggle">
                <Checkbox checked={useCollaborativeEditing}>{t("editing.experimental")}</Checkbox>
            </div>
        </div>
    )
}
