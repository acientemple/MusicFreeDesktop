import { useEffect, useRef, useState } from "react";
import { setUserPreference } from "@/renderer/utils/user-perference";
import Base from "../Base";
import "./index.scss";
import { hideModal } from "../..";
import { useTranslation } from "react-i18next";
import { shellUtil, updaterUtil } from "@shared/utils/renderer";
import SvgAsset from "@/renderer/components/SvgAsset";

interface IUpdateProps {
    currentVersion: string;
    update: ICommon.IUpdateInfo["update"];
}

type IUpdateState = "idle" | "downloading" | "ready" | "installing" | "error";

function getMajorVersion(version: string) {
    const matched = /^(\d+)/.exec((version ?? "").trim());
    return matched ? parseInt(matched[1], 10) : 0;
}

function formatSize(bytes: number) {
    if (!bytes) {
        return "";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        ++index;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function Update(props: IUpdateProps) {
    const { currentVersion, update = {} as ICommon.IUpdateInfo["update"] } =
        props;

    const { t } = useTranslation();

    const [state, setState] = useState<IUpdateState>("idle");
    const [progress, setProgress] = useState<ICommon.IUpdaterProgress>({
        percent: 0,
        downloaded: 0,
        total: 0,
        speed: 0,
    });
    const [errorMessage, setErrorMessage] = useState("");
    const [acknowledged, setAcknowledged] = useState(false);
    /** 用户主动点了取消，下载失败不算错误 */
    const cancelRequested = useRef(false);

    /** 跨大版本升级会影响插件与本地数据 */
    const breaking =
        getMajorVersion(update.version) > getMajorVersion(currentVersion);

    useEffect(() => {
        const offProgress = updaterUtil.onProgress((next) => {
            setProgress(next);
        });
        const offStatus = updaterUtil.onStatus((status) => {
            if (status === "downloading") {
                setState("downloading");
            } else if (status === "ready") {
                setState("ready");
            } else if (status === "installing") {
                setState("installing");
            } else if (status === "idle") {
                setState("idle");
            } else if (status === "error") {
                setState("error");
            }
        });
        return () => {
            offProgress();
            offStatus();
        };
    }, []);

    const startDownload = async () => {
        if (!update.download?.[0] || !update.assetName) {
            return;
        }
        setErrorMessage("");
        cancelRequested.current = false;
        setState("downloading");
        try {
            await updaterUtil.download(update.download[0], update.assetName);
        } catch (e: any) {
            if (cancelRequested.current) {
                setState("idle");
                return;
            }
            setErrorMessage(e?.message ?? String(e));
            setState("error");
        }
    };

    const cancelDownload = async () => {
        cancelRequested.current = true;
        try {
            await updaterUtil.cancelDownload();
        } catch {
            // pass
        }
        setState("idle");
    };

    const startInstall = async () => {
        setErrorMessage("");
        setState("installing");
        try {
            await updaterUtil.install(update.version);
        } catch (e: any) {
            setErrorMessage(e?.message ?? String(e));
            setState("error");
        }
    };

    const openDownloadPage = () => {
        shellUtil.openExternal(update.releasePage || update.download?.[0]);
    };

    const downloadDisabled = breaking && !acknowledged;

    return (
        <Base withBlur defaultClose>
            <div className="modal--update-container shadow backdrop-color">
                <Base.Header>{t("modal.new_version_found")}</Base.Header>
                <div className="modal--body-container">
                    <div className="version highlight">
                        {t("modal.latest_version")}
                        {update.version}
                        {update.prerelease ? (
                            <span className="prerelease-tag">
                                {t("modal.update_prerelease_tag")}
                            </span>
                        ) : null}
                    </div>
                    <div className="version">
                        {t("modal.current_version")}
                        {currentVersion}
                    </div>
                    <div className="divider"></div>
                    {update.changeLog?.map((item, index) => (
                        <p key={index}>{item}</p>
                    ))}

                    {breaking ? (
                        <div className="update-warning">
                            <div className="warning-title">
                                {t("modal.update_breaking_title")}
                            </div>
                            <div className="warning-desc">
                                {t("modal.update_breaking_desc")}
                            </div>
                            <ul>
                                <li>{t("modal.update_breaking_item1")}</li>
                                <li>{t("modal.update_breaking_item2")}</li>
                                <li>{t("modal.update_breaking_item3")}</li>
                            </ul>
                            <div
                                className="update-ack"
                                role="button"
                                onClick={() => setAcknowledged((prev) => !prev)}
                            >
                                <div className="checkbox">
                                    {acknowledged ? (
                                        <SvgAsset iconName="check"></SvgAsset>
                                    ) : null}
                                </div>
                                {t("modal.update_acknowledged")}
                            </div>
                        </div>
                    ) : null}

                    {state === "downloading" ? (
                        <div className="update-progress">
                            <div className="bar">
                                <div
                                    className="inner"
                                    style={{
                                        width: `${Math.round(
                                            progress.percent * 100,
                                        )}%`,
                                    }}
                                ></div>
                            </div>
                            <div className="meta">
                                <span>
                                    {t("modal.update_downloading")}{" "}
                                    {Math.round(progress.percent * 100)}%
                                    {progress.speed > 0
                                        ? ` · ${formatSize(progress.speed)}/s`
                                        : ""}
                                </span>
                                <span>
                                    {progress.total > 0
                                        ? `${formatSize(
                                              progress.downloaded,
                                          )} / ${formatSize(progress.total)}`
                                        : formatSize(progress.downloaded)}
                                </span>
                            </div>
                        </div>
                    ) : null}

                    {state === "ready" ? (
                        <div className="update-progress">
                            <div className="meta">
                                <span>{t("modal.update_downloaded")}</span>
                            </div>
                        </div>
                    ) : null}

                    {state === "installing" ? (
                        <div className="update-progress">
                            <div className="meta">
                                <span>{t("modal.update_installing")}</span>
                            </div>
                        </div>
                    ) : null}

                    {state === "error" ? (
                        <div className="update-progress">
                            <div className="meta">
                                <span>
                                    {t("modal.update_failed")}
                                    {errorMessage
                                        ? `：${errorMessage}`
                                        : ""}
                                </span>
                            </div>
                        </div>
                    ) : null}
                </div>
                <div className="divider"></div>
                <div className="footer-options">
                    {state === "idle" ? (
                        <>
                            <div
                                role="button"
                                data-type="normalButton"
                                onClick={() => {
                                    setUserPreference(
                                        "skipVersion",
                                        update.version,
                                    );
                                    hideModal();
                                }}
                            >
                                {t("modal.skip_this_version")}
                            </div>
                            {update.installable ? (
                                <div
                                    role="button"
                                    data-type="primaryButton"
                                    data-disabled={downloadDisabled}
                                    onClick={startDownload}
                                >
                                    {t("modal.update_download_and_install")}
                                </div>
                            ) : (
                                <div
                                    role="button"
                                    data-type="primaryButton"
                                    onClick={openDownloadPage}
                                >
                                    {t("modal.update_open_download_page")}
                                </div>
                            )}
                        </>
                    ) : null}

                    {state === "downloading" ? (
                        <div
                            role="button"
                            data-type="normalButton"
                            onClick={cancelDownload}
                        >
                            {t("modal.update_cancel")}
                        </div>
                    ) : null}

                    {state === "ready" ? (
                        <>
                            <div
                                role="button"
                                data-type="normalButton"
                                onClick={() => hideModal()}
                            >
                                {t("modal.update_later")}
                            </div>
                            <div
                                role="button"
                                data-type="primaryButton"
                                onClick={startInstall}
                            >
                                {t("modal.update_install_now")}
                            </div>
                        </>
                    ) : null}

                    {state === "installing" ? (
                        <div role="button" data-type="primaryButton" data-disabled>
                            {t("modal.update_installing")}
                        </div>
                    ) : null}

                    {state === "error" ? (
                        <>
                            <div
                                role="button"
                                data-type="normalButton"
                                onClick={() => {
                                    setErrorMessage("");
                                    setState("idle");
                                }}
                            >
                                {t("modal.update_back")}
                            </div>
                            <div
                                role="button"
                                data-type="primaryButton"
                                onClick={() => hideModal()}
                            >
                                {t("modal.update_close")}
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </Base>
    );
}
