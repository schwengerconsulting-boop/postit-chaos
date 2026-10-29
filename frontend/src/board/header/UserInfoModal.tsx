import { Fragment, h } from "harmaja"
import * as L from "lonna"
import { TextInput } from "../../components/components"
import { UserIcon } from "../../components/Icons"
import { signIn, signOut } from "../../google-auth"
import { Dispatch } from "../../store/board-store"
import { canLogin, LoggingInServer, UserSessionState } from "../../store/user-session-store"
import { t } from "../../../../common/src/i18n"

export const UserInfoModal = ({
    state,
    dispatch,
    dismiss,
}: {
    state: L.Property<UserSessionState>
    dispatch: Dispatch
    dismiss: () => void
}) => {
    const pictureURL = L.view(state, (s) => (s.status === "logged-in" ? s.picture : undefined))
    return (
        <span className="user-info">
            <h2>{t("user.welcome")}</h2>
            {L.view(
                state,
                (s) => s.status,
                (status) => {
                    switch (status) {
                        case "logging-in-server":
                            return null
                        case "logged-in":
                            return (
                                <div className="logged-in">
                                    <p>
                                        {t("user.signedInAs")}{" "}
                                        <span className="name">
                                            {L.view(state, (s) => (s as LoggingInServer).name)}
                                        </span>{" "}
                                        ({L.view(state, (s) => (s as LoggingInServer).email)}).
                                    </p>
                                    <p>
                                        <a className="login" onClick={signOut}>
                                            {t("header.signOut")}
                                        </a>{" "}
                                        {t("user.signOutAnon")}
                                    </p>
                                </div>
                            )
                        default:
                            return (
                                <div className="anonymous">
                                    <p className="nickname">
                                        <span>{t("user.chooseNickname")}</span>
                                        <NicknameEditor {...{ state, dispatch }} />
                                    </p>
                                    {L.view(
                                        state,
                                        canLogin,
                                        (show) =>
                                            show && (
                                                <p className="sign-in">
                                                    {t("user.or")}{" "}
                                                    <a className="login" onClick={signIn}>
                                                        {t("user.signIn")}
                                                    </a>{" "}
                                                    {t("user.withGoogle")}
                                                </p>
                                            ),
                                    )}
                                </div>
                            )
                    }
                },
            )}
            <p>
                <button onClick={dismiss}>{t("common.done")}</button>
            </p>
        </span>
    )
}

const NicknameEditor = ({ state, dispatch }: { state: L.Property<UserSessionState>; dispatch: Dispatch }) => {
    const nicknameAtom = L.atom(L.view(state, "nickname"), (nickname) => {
        if (nickname === undefined) throw Error("Cannot set nickname to undefined")
        dispatch({ action: "nickname.set", nickname })
    })

    return <TextInput value={nicknameAtom} />
}
