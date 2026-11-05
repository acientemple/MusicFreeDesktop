import { useEffect, useRef, useState } from "react";
import Base from "../Base";
import "./index.scss";
import Loading from "@/renderer/components/Loading";
import PluginManager from "@shared/plugin-manager/renderer";
import ServiceManager from "@shared/service-manager/renderer";
import trackPlayer from "@renderer/core/track-player";
import { useTranslation } from "react-i18next";
import { applyMusicMeta } from "@/renderer/core/music-meta";

interface IProps {
    musicItem?: IMusic.IMusicItem;
    /** 画面来源；搜索 MV 时与音频不是同一条 */
    videoItem?: IMusic.IMusicItem;
    quality?: IMusic.IQualityKey;
}

/** 画面与音频允许的偏差，超过就重新对齐 */
const MAX_DRIFT = 0.4;

export default function MVPlayer(props: IProps) {
    const { musicItem, videoItem, quality = "standard" } = props;
    const { t } = useTranslation();

    const [videoUrl, setVideoUrl] = useState("");
    const [error, setError] = useState<{ key?: string; message?: string }>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        let canceled = false;
        (async () => {
            try {
                const visualItem = videoItem ?? musicItem;
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

    return (
        <Base defaultClose withBlur={false}>
            <div className="modal--mv-player-container shadow backdrop-color">
                <Base.Header>
                    <div className="header-title">
                        {musicItem
                            ? applyMusicMeta(musicItem).title
                            : t("modal.mv_player")}
                    </div>
                </Base.Header>
                <div className="mv-player-body">
                    {videoUrl ? (
                        <video
                            ref={videoRef}
                            className="mv-player-video"
                            src={videoUrl}
                            controls
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
            </div>
        </Base>
    );
}
