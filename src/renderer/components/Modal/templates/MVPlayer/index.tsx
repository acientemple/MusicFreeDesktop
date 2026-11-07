import { useEffect, useMemo, useRef, useState } from "react";
import Base from "../Base";
import DraggableWindow, { IDraggableWindowHandle } from "../Base/DraggableWindow";
import PlayerControl from "./PlayerControl";
import "./index.scss";
import Loading from "@/renderer/components/Loading";
import PluginManager from "@shared/plugin-manager/renderer";
import ServiceManager from "@shared/service-manager/renderer";
import trackPlayer from "@renderer/core/track-player";
import { useTranslation } from "react-i18next";
import { applyMusicMeta } from "@/renderer/core/music-meta";
import SvgAsset from "@/renderer/components/SvgAsset";
import { hideMVPlayer, useMVPlayerState } from "./store";

/** 画面与音频允许的偏差，超过就重新对齐 */
const MAX_DRIFT = 0.4;

export default function MVPlayer() {
    const { visible, musicItem, videoItem, quality = "standard" } =
        useMVPlayerState();
    const { t } = useTranslation();

    const [videoUrl, setVideoUrl] = useState("");
    const [error, setError] = useState<{ key?: string; message?: string }>(null);
    const [maximized, setMaximized] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const windowRef = useRef<IDraggableWindowHandle>(null);

    /** 画面来自哪：搜索 MV 时与音频不是同一条 */
    const visualItem = useMemo(() => videoItem ?? musicItem, [videoItem, musicItem]);

    useEffect(() => {
        let canceled = false;
        setVideoUrl("");
        setError(null);
        (async () => {
            try {
                const source = await PluginManager.callPluginDelegateMethod(
                    { platform: visualItem?.platform },
                    "getVideoSource",
                    visualItem,
                    quality,
                );
                if (canceled) {
                    return;
                }
                if (!source?.url) {
                    setError({
                        key: videoItem
                            ? "modal.music_video_search_play_failed"
                            : "modal.mv_player_no_source",
                    });
                    return;
                }
                // 视频源普遍要校验 Referer，video 元素带不了请求头，只能走本地转发服务
                const proxied = source.headers
                    ? ServiceManager.RequestForwarderService.forwardRequest(
                          source.url,
                          "GET",
                          source.headers,
                      )
                    : source.url;
                setError(null);
                setVideoUrl(proxied ?? source.url);
            } catch (e) {
                if (!canceled) {
                    setError({ key: "modal.mv_player_failed", message: e?.message });
                }
            }
        })();
        return () => {
            canceled = true;
        };
    }, [musicItem, videoItem, quality]);

    // 画面跟着播放器的进度走，音视频分离的两个文件否则会越差越多
    useEffect(() => {
        if (!videoUrl) {
            return;
        }
        const timer = setInterval(() => {
            const video = videoRef.current;
            if (!video || video.readyState < 1 || video.paused || video.seeking) {
                return;
            }
            const audioTime = trackPlayer.progress.currentTime;
            if (!isFinite(audioTime)) {
                return;
            }
            if (Math.abs(video.currentTime - audioTime) > MAX_DRIFT) {
                video.currentTime = audioTime;
            }
        }, 500);
        return () => {
            clearInterval(timer);
        };
    }, [videoUrl]);

    // 点了「观看 MV」就是想看，播放器停着的话画面会没有声音
    useEffect(() => {
        if (musicItem?.platform && trackPlayer.currentMusic?.platform === musicItem.platform) {
            trackPlayer.resume();
        }
    }, [musicItem]);

    // 收起时画面停掉省 CPU，声音是播放器在放，不受影响
    useEffect(() => {
        if (collapsed) {
            videoRef.current?.pause();
            return;
        }
        const video = videoRef.current;
        if (!video || !videoUrl) {
            return;
        }
        video.play().catch(() => undefined);
        const audioTime = trackPlayer.progress.currentTime;
        if (isFinite(audioTime) && audioTime > 0) {
            video.currentTime = audioTime;
        }
    }, [collapsed, videoUrl]);

    if (!visible) {
        return null;
    }

    return (
        <DraggableWindow
            ref={windowRef}
            className="modal--mv-player-container shadow backdrop-color"
            defaultWidth={880}
            defaultHeight={580}
            minWidth={420}
            minHeight={300}
            onMaximizeChange={setMaximized}
            onCollapsedChange={setCollapsed}
        >
            <Base.Header
                onClose={hideMVPlayer}
                extra={
                    <div className="mv-player-header-actions">
                        <div
                            className="mv-player-btn"
                            role="button"
                            title={t(
                                maximized
                                    ? "modal.mv_player_restore"
                                    : "modal.mv_player_maximize",
                            )}
                            onClick={() => {
                                windowRef.current?.toggleMaximize();
                            }}
                        >
                            <SvgAsset
                                iconName={
                                    maximized
                                        ? "arrows-pointing-in"
                                        : "arrows-pointing-out"
                                }
                            ></SvgAsset>
                        </div>
                        <div
                            className="mv-player-btn"
                            role="button"
                            title={t(
                                collapsed
                                    ? "modal.mv_player_expand"
                                    : "modal.mv_player_minimize",
                            )}
                            onClick={() => {
                                windowRef.current?.toggleCollapsed();
                            }}
                        >
                            <SvgAsset
                                iconName={
                                    collapsed ? "chevron-double-up" : "minus"
                                }
                            ></SvgAsset>
                        </div>
                    </div>
                }
            >
                <div className="header-title">
                    {musicItem
                        ? applyMusicMeta(musicItem).title
                        : t("modal.mv_player")}
                </div>
            </Base.Header>
            <div
                className="mv-player-body"
                style={{ display: collapsed ? "none" : "flex" }}
            >
                {videoUrl ? (
                    <video
                        ref={videoRef}
                        className="mv-player-video"
                        src={videoUrl}
                        autoPlay
                        muted
                        playsInline
                        onLoadedMetadata={() => {
                            const video = videoRef.current;
                            const audioTime = trackPlayer.progress.currentTime;
                            if (video && isFinite(audioTime) && audioTime > 0) {
                                video.currentTime = audioTime;
                            }
                        }}
                    ></video>
                ) : error ? (
                    <div className="mv-player-error">
                        {error.key ? t(error.key) : error.message}
                    </div>
                ) : (
                    <Loading></Loading>
                )}
            </div>
            <PlayerControl
                videoRef={videoRef}
                videoItem={visualItem}
                quality={quality}
                hidden={collapsed}
            ></PlayerControl>
        </DraggableWindow>
    );
}
