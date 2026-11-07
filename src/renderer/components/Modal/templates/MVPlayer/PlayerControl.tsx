import { useRef, useState } from "react";
import trackPlayer from "@renderer/core/track-player";
import {
    usePlayerState,
    useProgress,
    useVolume,
} from "@renderer/core/track-player/hooks";
import { DownloadState, PlayerState } from "@/common/constant";
import SvgAsset from "@renderer/components/SvgAsset";
import { useTranslation } from "react-i18next";
import Slider from "rc-slider";
import PluginManager from "@shared/plugin-manager/renderer";
import ServiceManager from "@shared/service-manager/renderer";
import AppConfig from "@shared/app-config/renderer";
import Downloader from "@renderer/core/downloader";
import { getGlobalContext } from "@/shared/global-context/renderer";

interface IProps {
    /** 画面元素，进度与播放状态都要跟它对齐 */
    videoRef?: React.RefObject<HTMLVideoElement>;
    /** 画面条目，下载用 */
    videoItem?: IMusic.IMusicItem;
    quality?: IMusic.IQualityKey;
    /** 收起时整条控制栏藏起来 */
    hidden?: boolean;
}

function formatDuration(seconds: number) {
    if (!isFinite(seconds) || seconds < 0) {
        return "--:--";
    }
    const s = Math.floor(seconds % 60);
    const m = Math.floor(seconds / 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function PlayerControl({
    videoRef,
    videoItem,
    quality = "standard",
    hidden,
}: IProps) {
    const { t } = useTranslation();
    const { currentTime, duration } = useProgress();
    const playerState = usePlayerState();
    const isPlaying = playerState === PlayerState.Playing;
    const volume = useVolume();

    const barRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const [dragPercent, setDragPercent] = useState<number | null>(null);
    const [downloadState, setDownloadState] = useState<{
        state: DownloadState;
        downloaded?: number;
        total?: number;
    } | null>(null);

    const hasDuration = isFinite(duration) && duration > 0;
    const percent =
        dragPercent ??
        (hasDuration ? Math.max(0, Math.min(1, currentTime / duration)) : 0);

    const percentAt = (clientX: number) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect?.width) {
            return 0;
        }
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!hasDuration) {
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        setDragPercent(percentAt(e.clientX));
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (draggingRef.current) {
            setDragPercent(percentAt(e.clientX));
        }
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
            return;
        }
        draggingRef.current = false;
        const target = duration * percentAt(e.clientX);
        setDragPercent(null);
        trackPlayer.seekTo(target);
        const video = videoRef?.current;
        if (video && isFinite(target)) {
            video.currentTime = target;
        }
    };

    const onDownload = async () => {
        if (!videoItem?.platform) {
            return;
        }
        if (downloadState?.state === DownloadState.DOWNLOADING) {
            return;
        }
        setDownloadState({ state: DownloadState.DOWNLOADING, downloaded: 0 });
        try {
            const source = await PluginManager.callPluginDelegateMethod(
                { platform: videoItem.platform },
                "getVideoDownloadSource",
                videoItem,
                quality,
            );
            if (!source?.url) {
                throw new Error("no download source");
            }
            const headers = source.headers ?? {};
            // 视频源要校验 Referer，跨域直连会被拦，走本地转发服务
            const proxied =
                ServiceManager.RequestForwarderService.forwardRequest(
                    source.url,
                    "GET",
                    headers,
                ) ?? source.url;
            const rawName = String(
                source.filename || videoItem.title || "mv",
            ).replace(/[/|\\?*"<>:]/g, "_");
            const ext = rawName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "mp4";
            const baseName = rawName.replace(/\.[a-z0-9]+$/i, "");
            const downloadBasePath =
                AppConfig.getConfig("download.path") ??
                getGlobalContext().appPath.downloads;
            const filePath = window.path.resolve(
                downloadBasePath,
                `./${baseName}.${ext}`,
            );
            await Downloader.downloadFileToDisk(
                { url: proxied, userAgent: headers["user-agent"] },
                filePath,
                (status) => {
                    setDownloadState(status);
                },
            );
        } catch (e) {
            setDownloadState({ state: DownloadState.ERROR });
        }
    };

    const downloadTitle = () => {
        switch (downloadState?.state) {
            case DownloadState.DOWNLOADING: {
                const total = downloadState.total ?? 0;
                const done = downloadState.downloaded ?? 0;
                return total
                    ? `${t("modal.mv_player_downloading")} ${Math.round(
                          (done / total) * 100,
                      )}%`
                    : t("modal.mv_player_downloading");
            }
            case DownloadState.DONE:
                return t("modal.mv_player_downloaded");
            case DownloadState.ERROR:
                return t("modal.mv_player_download_failed");
            default:
                return t("modal.mv_player_download");
        }
    };

    return (
        <div className="mv-player-control" style={{ display: hidden ? "none" : "flex" }}>
            <span className="mv-player-time">{formatDuration(currentTime)}</span>
            <div
                className="mv-player-progress"
                ref={barRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            >
                <div
                    className="mv-player-progress-active"
                    style={{ width: `${percent * 100}%` }}
                ></div>
            </div>
            <span className="mv-player-time">{formatDuration(duration)}</span>
            <div
                className="mv-player-play"
                role="button"
                title={t(isPlaying ? "music_bar.pause" : "music_bar.play")}
                onClick={() => {
                    const video = videoRef?.current;
                    if (isPlaying) {
                        trackPlayer.pause();
                        video?.pause();
                    } else {
                        trackPlayer.resume();
                        video?.play().catch(() => undefined);
                    }
                }}
            >
                <SvgAsset iconName={isPlaying ? "pause" : "play"}></SvgAsset>
            </div>
            <div
                className="mv-player-volume"
                title={t(volume === 0 ? "music_bar.unmute" : "music_bar.mute")}
            >
                <div
                    className="mv-player-volume-icon"
                    role="button"
                    onClick={() => {
                        trackPlayer.setVolume(volume === 0 ? 1 : 0);
                    }}
                >
                    <SvgAsset
                        iconName={volume === 0 ? "speaker-x-mark" : "speaker-wave"}
                    ></SvgAsset>
                </div>
                <div className="mv-player-volume-slider">
                    <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        onChange={(val) => {
                            trackPlayer.setVolume(val as number);
                        }}
                        styles={{
                            track: {
                                background: "var(--primaryColor)",
                            },
                            handle: {
                                width: 10,
                                height: 10,
                                marginLeft: -4,
                                borderColor: "var(--primaryColor)",
                            },
                            rail: {
                                background: "var(--dividerColor)",
                            },
                        }}
                    ></Slider>
                </div>
            </div>
            <div
                className="mv-player-btn"
                role="button"
                title={downloadTitle()}
                onClick={onDownload}
            >
                <SvgAsset iconName="array-download-tray"></SvgAsset>
            </div>
        </div>
    );
}
