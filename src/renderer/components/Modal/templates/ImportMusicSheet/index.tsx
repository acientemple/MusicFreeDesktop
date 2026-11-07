import { hideModal, showModal } from "../..";
import Base from "../Base";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import "./index.scss";
import NoPlugin from "@renderer/components/NoPlugin";
import PluginManager from "@shared/plugin-manager/renderer";
import { normalizeErrorMessage } from "@/common/normalize-util";

interface IProps {
    plugins: IPlugin.IPluginDelegate[];
}

export default function ImportMusicSheet(props: IProps) {
    const { plugins } = props;

    const { t } = useTranslation();

    return (
        <Base withBlur={false}>
            <div className="modal--import-music-sheet shadow backdrop-color">
                <Base.Header>{t("plugin.method_import_music_sheet")}</Base.Header>
                <div className="content-container">
                    {
                        plugins?.length > 0 ? <>{plugins.map((it) => (
                            <div
                                role="button"
                                key={it.hash}
                                className="plugin-item"
                                onClick={() => {
                                    hideModal();
                                    showModal("SimpleInputWithState", {
                                        title: t("plugin.method_import_music_sheet"),
                                        withLoading: true,
                                        loadingText: t("plugin_management_page.importing_media"),
                                        placeholder: t(
                                            "plugin_management_page.placeholder_import_music_sheet",
                                            {
                                                plugin: it.platform,
                                            },
                                        ),
                                        onOk(text) {
                                            return PluginManager.callPluginDelegateMethod(
                                                it,
                                                "importMusicSheet",
                                                text.trim(),
                                            );
                                        },
                                        onPromiseResolved(result) {
                                            hideModal();
                                            showModal("AddMusicToSheet", {
                                                musicItems: result as IMusic.IMusicItem[],
                                            });
                                        },
                                        onPromiseRejected(reason) {
                                            const detail = normalizeErrorMessage(reason);
                                            toast.error(
                                                detail
                                                    ? `${t("plugin_management_page.import_failed")}: ${detail}`
                                                    : t("plugin_management_page.import_failed"),
                                            );
                                        },
                                        hints: it.hints?.importMusicSheet,
                                    });
                                }}
                            >
                                {it.displayName ?? it.platform}
                            </div>
                        ))}</> : <NoPlugin supportMethod={t("plugin.method_import_music_sheet")}></NoPlugin>
                    }
                </div>
            </div>
        </Base>
    );
}
