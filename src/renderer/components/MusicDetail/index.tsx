import AnimatedDiv from "../AnimatedDiv";
import "./index.scss";
import albumImg from "@/assets/imgs/album-cover.jpg";
import Tag from "../Tag";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import Header from "./widgets/Header";
import Lyric from "./widgets/Lyric";
import Condition from "../Condition";
import { useTranslation } from "react-i18next";
import { useCurrentMusic } from "@renderer/core/track-player/hooks";
import { useEffect, useMemo } from "react";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { showModal } from "@renderer/components/Modal";
import { showMVPlayer } from "@renderer/components/Modal/templates/MVPlayer/store";
import { useSupportedPlugin, usePluginDisplayName } from "@shared/plugin-manager/renderer";
import SvgAsset from "@renderer/components/SvgAsset";
import { applyMusicMeta, useMusicMeta } from "@renderer/core/music-meta";
import { useMusicMv } from "@renderer/core/music-mv";
import { getMediaPrimaryKey } from "@/common/media-util";
import isLocalMusic from "@renderer/utils/is-local-music";

export const isMusicDetailShown = musicDetailShownStore.getValue;
export const useMusicDetailShown = musicDetailShownStore.useValue;

function MusicDetail() {
    const musicItem = useCurrentMusic();
    const musicDetailShown = musicDetailShownStore.useValue();
    const musicMeta = useMusicMeta();
    /** 展示用：套用用户手动改过的信息，插件调用仍用原始条目 */
    const displayItem = useMemo(
        () => (musicItem ? applyMusicMeta(musicItem) : null),
        [musicItem, musicMeta],
    );

    const { t } = useTranslation();

    const mvPlugins = useSupportedPlugin("getVideoSource");
    /** 这首歌挑过的 MV，有它就不用再搜一遍 */
    const boundMv = useMusicMv()[musicItem ? getMediaPrimaryKey(musicItem) : ""];
    const canWatchMv =
        (!!musicItem?.platform &&
            mvPlugins.some((plugin) => plugin.platform === musicItem.platform)) ||
        !!boundMv;

    // 找完整播放版本不挑来源，任何支持该方法的插件都能给候选
    const alternativePlugins = useSupportedPlugin("getMusicAlternatives");
    const canSearchFullVersion = !!musicItem && alternativePlugins.length > 0;

    // 按歌曲找 MV，候选来自所有支持该方法的插件
    const mvSearchPlugins = useSupportedPlugin("getMusicVideoCandidates");
    const canSearchMv = !!musicItem && mvSearchPlugins.length > 0;

    // 本地音乐的信息来自文件标签，不支持改
    const canEditMeta = !!musicItem && !isLocalMusic(musicItem);

    const platformDisplayName = usePluginDisplayName(musicItem?.platform);

    useEffect(() => {
        const escHandler = (evt: KeyboardEvent) => {
            if (evt.code === "Escape") {
                evt.preventDefault();
                musicDetailShownStore.setValue(false);
            }
        };
        window.addEventListener("keydown", escHandler);

        return () => {
            window.removeEventListener("keydown", escHandler);
        };
    }, []);


    return (
        <AnimatedDiv
            showIf={musicDetailShown}
            className="music-detail--container animate__animated background-color"
            mountClassName="animate__slideInUp"
            unmountClassName="animate__slideOutDown"
            onAnimationEnd={() => {
                // hack logic: https://github.com/electron/electron/issues/32341
                // force reflow to refresh drag region
                setTimeout(() => {
                    document.body.style.width = "0";
                    document.body.getBoundingClientRect();
                    document.body.style.width = "";
                }, 200);
            }}
        >
            <div
                className="music-detail-background"
                style={{
                    backgroundImage: `url(${musicItem?.artwork ?? albumImg})`,
                }}
            ></div>
            <Header></Header>
            <div className="music-title" title={displayItem?.title}>
                {displayItem?.title || t("media.unknown_title")}
            </div>
            <div className="music-info">
                <span>
                    <Condition condition={displayItem?.artist}>
                        {displayItem?.artist}
                    </Condition>
                    <Condition condition={displayItem?.album}>
                        {" "}
                        - {displayItem?.album}
                    </Condition>
                </span>
                {musicItem?.platform ? (
                    <Tag fill>{platformDisplayName}</Tag>
                ) : null}
            </div>
            <div className="music-body">
                <div className="music-album-options">
                    <img
                        className="music-album shadow"
                        onError={setFallbackAlbum}
                        src={musicItem?.artwork ?? albumImg}
                    ></img>
                    {canWatchMv || canSearchFullVersion || canSearchMv || canEditMeta ? (
                        <div className="music-options">
                            {canWatchMv ? (
                                <div
                                    className="music-option-button"
                                    role="button"
                                    title={t("music_detail.watch_mv")}
                                    onClick={() => {
                                        showMVPlayer({
                                            musicItem,
                                            videoItem: boundMv,
                                        });
                                    }}
                                >
                                    <SvgAsset iconName="motion-play"></SvgAsset>
                                    <span>{t("music_detail.watch_mv")}</span>
                                </div>
                            ) : null}
                            {canSearchFullVersion ? (
                                <div
                                    className="music-option-button"
                                    role="button"
                                    title={t("music_detail.search_full_version")}
                                    onClick={() => {
                                        showModal("MusicAlternatives", { musicItem });
                                    }}
                                >
                                    <SvgAsset iconName="magnifying-glass"></SvgAsset>
                                    <span>{t("music_detail.search_full_version")}</span>
                                </div>
                            ) : null}
                            {canSearchMv ? (
                                <div
                                    className="music-option-button"
                                    role="button"
                                    title={t("music_detail.search_mv")}
                                    onClick={() => {
                                        showModal("MusicVideoSearch", { musicItem });
                                    }}
                                >
                                    <SvgAsset iconName="film"></SvgAsset>
                                    <span>{t("music_detail.search_mv")}</span>
                                </div>
                            ) : null}
                            {canEditMeta ? (
                                <div
                                    className="music-option-button"
                                    role="button"
                                    title={t("music_detail.edit_music_meta")}
                                    onClick={() => {
                                        showModal("EditMusicMeta", { musicItem });
                                    }}
                                >
                                    <SvgAsset iconName="pencil-square"></SvgAsset>
                                    <span>{t("music_detail.edit_music_meta")}</span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <Lyric></Lyric>
            </div>
        </AnimatedDiv>
    );
}

MusicDetail.show = () => {
    musicDetailShownStore.setValue(true);
};

MusicDetail.hide = () => {
    musicDetailShownStore.setValue(false);
};

export default MusicDetail;
