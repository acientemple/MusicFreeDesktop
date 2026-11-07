import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Base from "../Base";
import DraggableWindow from "../Base/DraggableWindow";
import "./index.scss";
import Loading from "@/renderer/components/Loading";
import Empty from "@/renderer/components/Empty";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import PluginManager, { useSupportedPlugin } from "@shared/plugin-manager/renderer";
import { hideModal, showModal } from "../..";
import { getMediaPrimaryKey, isSameMedia } from "@/common/media-util";
import { applyMusicMeta } from "@/renderer/core/music-meta";
import { clearMusicMv, setMusicMv, useMusicMv } from "@/renderer/core/music-mv";
import trackPlayer from "@renderer/core/track-player";

interface IProps {
    musicItem?: IMusic.IMusicItem;
}

function formatDuration(duration?: number | null) {
    if (!duration || !isFinite(duration)) {
        return null;
    }
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function MusicVideoSearch(props: IProps) {
    const { musicItem } = props;
    const { t } = useTranslation();
    /** 展示用：套用用户手动改过的信息，插件调用仍用原始条目 */
    const displayItem = useMemo(
        () => (musicItem ? applyMusicMeta(musicItem) : null),
        [musicItem?.platform, musicItem?.id],
    );

    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<IMusic.IMusicItem[]>([]);
    const [emptyText, setEmptyText] = useState<string | null>(null);

    const plugins = useSupportedPlugin("getMusicVideoCandidates");
    // useSupportedPlugin 每次渲染都会返回新数组，取哈希串做依赖才不会反复触发
    const pluginKey = useMemo(
        () => plugins.map((item) => item.hash).join("|"),
        [plugins],
    );

    /** 这首歌已经挑过的 MV */
    const mvMap = useMusicMv();
    const boundMv = musicItem ? mvMap[getMediaPrimaryKey(musicItem)] : undefined;

    useEffect(() => {
        let canceled = false;
        const target = musicItem;
        if (!target) {
            setLoading(false);
            setItems([]);
            return;
        }
        setLoading(true);
        setItems([]);
        setEmptyText(null);
        (async () => {
            const supports = PluginManager.getSupportedPlugin(
                "getMusicVideoCandidates",
            );
            if (!supports.length) {
                if (!canceled) {
                    setLoading(false);
                    setEmptyText(t("modal.music_video_search_unsupported"));
                }
                return;
            }
            const settled = await Promise.allSettled(
                supports.map((plugin) =>
                    PluginManager.callPluginDelegateMethod(
                        { platform: plugin.platform, hash: plugin.hash },
                        "getMusicVideoCandidates",
                        target,
                        1,
                    ),
                ),
            );
            const merged: IMusic.IMusicItem[] = [];
            for (const result of settled) {
                if (result.status === "fulfilled" && result.value?.data) {
                    merged.push(...result.value.data);
                }
            }
            if (canceled) {
                return;
            }
            setLoading(false);
            setItems(merged);
            if (!merged.length) {
                setEmptyText(t("modal.music_video_search_empty"));
            }
        })();
        return () => {
            canceled = true;
        };
    }, [musicItem?.platform, musicItem?.id, pluginKey]);

    return (
        <Base withBlur={false}>
            <DraggableWindow
                className="modal--music-video-search-container shadow backdrop-color"
                defaultWidth={600}
                defaultHeight={560}
                minWidth={420}
                minHeight={320}
            >
                <Base.Header>
                    <div className="header-title">
                        {t("modal.music_video_search")}
                    </div>
                </Base.Header>
                <div className="video-search-subtitle">
                    <span className="subtitle-text">
                        {displayItem?.title} - {displayItem?.artist}
                    </span>
                    {boundMv && musicItem ? (
                        <span
                            className="subtitle-clear"
                            role="button"
                            onClick={() => {
                                clearMusicMv(musicItem).catch(console.error);
                            }}
                        >
                            {t("modal.music_video_search_clear")}
                        </span>
                    ) : null}
                </div>
                <div className="video-search-body">
                    {loading ? (
                        <Loading></Loading>
                    ) : items.length ? (
                        items.map((item) => {
                            const duration = formatDuration(item.duration);
                            const isBound =
                                !!boundMv &&
                                getMediaPrimaryKey(boundMv) ===
                                    getMediaPrimaryKey(item);
                            return (
                                <div
                                    className="video-item"
                                    key={getMediaPrimaryKey(item)}
                                    role="button"
                                    onClick={() => {
                                        // 画面是这首的 MV，音频也得是它，否则音画对不上
                                        if (
                                            musicItem &&
                                            !isSameMedia(
                                                trackPlayer.currentMusic,
                                                musicItem,
                                            )
                                        ) {
                                            trackPlayer.playMusic(musicItem);
                                        }
                                        // 记住挑过的 MV，下次直接看同一个
                                        if (musicItem) {
                                            setMusicMv(musicItem, item).catch(
                                                console.error,
                                            );
                                        }
                                        hideModal();
                                        showModal("MVPlayer", {
                                            musicItem,
                                            videoItem: item,
                                        });
                                    }}
                                >
                                    <img
                                        src={item.artwork ?? albumImg}
                                        onError={setFallbackAlbum}
                                    ></img>
                                    <div className="video-info">
                                        <div className="title">{item.title}</div>
                                        <div className="artist">
                                            {item.artist || "-"}
                                            {item.album ? ` · ${item.album}` : ""}
                                        </div>
                                    </div>
                                    <div className="video-tags">
                                        {item.isOfficialMv ? (
                                            <div className="official-tag">
                                                {t(
                                                    "modal.music_video_search_official",
                                                )}
                                            </div>
                                        ) : null}
                                        {isBound ? (
                                            <div className="in-use-tag">
                                                {t(
                                                    "modal.music_video_search_in_use",
                                                )}
                                            </div>
                                        ) : null}
                                        <div className="source-tag">
                                            {PluginManager.getPluginDisplayName(
                                                item.platform,
                                            )}
                                        </div>
                                        {duration ? (
                                            <div className="duration">{duration}</div>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="video-search-empty">
                            <Empty></Empty>
                            <div className="empty-text">
                                {emptyText ??
                                    t("modal.music_video_search_empty")}
                            </div>
                        </div>
                    )}
                </div>
            </DraggableWindow>
        </Base>
    );
}
