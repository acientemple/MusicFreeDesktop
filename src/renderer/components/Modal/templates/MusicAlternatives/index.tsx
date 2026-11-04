import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Base from "../Base";
import "./index.scss";
import Loading from "@/renderer/components/Loading";
import Empty from "@/renderer/components/Empty";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import PluginManager, { useSupportedPlugin } from "@shared/plugin-manager/renderer";
import trackPlayer from "@renderer/core/track-player";
import MusicSheet from "@/renderer/core/music-sheet";
import { hideModal } from "../..";
import { getMediaPrimaryKey } from "@/common/media-util";

interface IProps {
    musicItem?: IMusic.IMusicItem;
    /** 本地歌单 id / "play-list"（播放队列）/ undefined（无归属） */
    sheetType?: string;
}

function formatDuration(duration?: number | null) {
    if (!duration || !isFinite(duration)) {
        return null;
    }
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function MusicAlternatives(props: IProps) {
    const { musicItem, sheetType } = props;
    const { t } = useTranslation();

    /**
     * 用完整版覆盖原来的不完整版本：所在本地歌单与播放队列都替换，
     * 正在播放的那一首从头开始播。
     */
    async function applyFullVersion(
        original: IMusic.IMusicItem,
        alternative: IMusic.IMusicItem,
    ) {
        try {
            if (sheetType && sheetType !== "play-list") {
                await MusicSheet.frontend.replaceMusicInSheet(
                    original,
                    alternative,
                    sheetType,
                );
            }
            await trackPlayer.replaceMusic(original, alternative, {
                play: true,
                restartFromStart: true,
            });
            toast.success(t("modal.music_alternatives_replaced"));
        } catch (e) {
            toast.error(
                t("modal.music_alternatives_replace_fail", {
                    reason: e?.message ?? "",
                }),
            );
        }
    }

    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<IMusic.IMusicItem[]>([]);
    const [emptyText, setEmptyText] = useState<string | null>(null);

    const plugins = useSupportedPlugin("getMusicAlternatives");
    // useSupportedPlugin 每次渲染都会返回新数组，取哈希串做依赖才不会反复触发
    const pluginKey = useMemo(
        () => plugins.map((item) => item.hash).join("|"),
        [plugins],
    );

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
                "getMusicAlternatives",
            );
            if (!supports.length) {
                if (!canceled) {
                    setLoading(false);
                    setEmptyText(t("modal.music_alternatives_unsupported"));
                }
                return;
            }
            const settled = await Promise.allSettled(
                supports.map((plugin) =>
                    PluginManager.callPluginDelegateMethod(
                        { platform: plugin.platform, hash: plugin.hash },
                        "getMusicAlternatives",
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
                setEmptyText(t("modal.music_alternatives_empty"));
            }
        })();
        return () => {
            canceled = true;
        };
    }, [musicItem?.platform, musicItem?.id, pluginKey]);

    return (
        <Base defaultClose withBlur={false}>
            <div className="modal--music-alternatives-container shadow backdrop-color">
                <Base.Header>
                    <div className="header-title">
                        {t("modal.music_alternatives")}
                    </div>
                </Base.Header>
                <div className="alternatives-subtitle">
                    {musicItem?.title} - {musicItem?.artist}
                </div>
                <div className="alternatives-body">
                    {loading ? (
                        <Loading></Loading>
                    ) : items.length ? (
                        items.map((item) => {
                            const duration = formatDuration(item.duration);
                            return (
                                <div
                                    className="alternative-item"
                                    key={getMediaPrimaryKey(item)}
                                    role="button"
                                    onClick={() => {
                                        hideModal();
                                        if (musicItem) {
                                            applyFullVersion(musicItem, item);
                                        }
                                    }}
                                >
                                    <img
                                        src={item.artwork ?? albumImg}
                                        onError={setFallbackAlbum}
                                    ></img>
                                    <div className="alternative-info">
                                        <div className="title">{item.title}</div>
                                        <div className="artist">
                                            {item.artist || "-"}
                                            {item.album ? ` · ${item.album}` : ""}
                                        </div>
                                    </div>
                                    <div className="alternative-tags">
                                        {item.isOriginArtist ? (
                                            <div className="origin-tag">
                                                {t(
                                                    "modal.music_alternatives_origin_tag",
                                                )}
                                            </div>
                                        ) : null}
                                        <div className="full-tag">
                                            {t(
                                                "modal.music_alternatives_full_tag",
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
                        <div className="alternatives-empty">
                            <Empty></Empty>
                            <div className="empty-text">
                                {emptyText ?? t("modal.music_alternatives_empty")}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Base>
    );
}
