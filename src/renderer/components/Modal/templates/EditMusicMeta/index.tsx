import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Base from "../Base";
import "./index.scss";
import { hideModal } from "../..";
import {
    applyMusicMeta,
    clearMusicMeta,
    getMusicMeta,
    setMusicMeta,
    useMusicMeta,
} from "@/renderer/core/music-meta";

interface IProps {
    musicItem?: IMusic.IMusicItem;
}

export default function EditMusicMeta(props: IProps) {
    const { musicItem } = props;
    const { t } = useTranslation();
    const musicMeta = useMusicMeta();

    const effective = useMemo(
        () => (musicItem ? applyMusicMeta(musicItem) : null),
        [musicItem?.platform, musicItem?.id, musicMeta],
    );
    const hasOverride = !!getMusicMeta(musicItem);

    const [title, setTitle] = useState(effective?.title ?? "");
    const [artist, setArtist] = useState(effective?.artist ?? "");
    const [album, setAlbum] = useState(effective?.album ?? "");

    useEffect(() => {
        setTitle(effective?.title ?? "");
        setArtist(effective?.artist ?? "");
        setAlbum(effective?.album ?? "");
    }, [effective]);

    async function onSave() {
        if (!musicItem) {
            hideModal();
            return;
        }
        const newTitle = title.trim();
        if (!newTitle) {
            toast.error(t("modal.edit_music_meta_title_empty"));
            return;
        }
        // 与原始信息一致的字段不写进覆盖里，等同于「恢复默认」
        const override: Partial<Record<"title" | "artist" | "album", string>> = {};
        if (newTitle !== (musicItem.title ?? "").trim()) {
            override.title = newTitle;
        }
        const newArtist = artist.trim();
        if (newArtist !== (musicItem.artist ?? "").trim()) {
            override.artist = newArtist;
        }
        const newAlbum = album.trim();
        if (newAlbum !== (musicItem.album ?? "").trim()) {
            override.album = newAlbum;
        }
        try {
            await setMusicMeta(musicItem, override);
            hideModal();
            toast.success(t("modal.edit_music_meta_saved"));
        } catch (e) {
            toast.error(
                t("modal.edit_music_meta_save_fail", {
                    reason: e?.message ?? "",
                }),
            );
        }
    }

    async function onReset() {
        if (!musicItem) {
            hideModal();
            return;
        }
        try {
            await clearMusicMeta(musicItem);
            hideModal();
            toast.success(t("modal.edit_music_meta_reset_done"));
        } catch (e) {
            toast.error(
                t("modal.edit_music_meta_reset_fail", {
                    reason: e?.message ?? "",
                }),
            );
        }
    }

    return (
        <Base withBlur={false}>
            <div className="modal--edit-music-meta-container shadow backdrop-color">
                <Base.Header>
                    <div className="header-title">
                        {t("modal.edit_music_meta")}
                    </div>
                </Base.Header>
                <div className="edit-music-meta-body">
                    <div className="edit-music-meta-item">
                        <div className="label">
                            {t("media.media_title")}
                        </div>
                        <input
                            autoFocus
                            value={title}
                            onChange={(e) => {
                                setTitle(e.target.value);
                            }}
                        ></input>
                    </div>
                    <div className="edit-music-meta-item">
                        <div className="label">
                            {t("media.media_type_artist")}
                        </div>
                        <input
                            value={artist}
                            onChange={(e) => {
                                setArtist(e.target.value);
                            }}
                        ></input>
                    </div>
                    <div className="edit-music-meta-item">
                        <div className="label">
                            {t("media.media_type_album")}
                        </div>
                        <input
                            value={album}
                            onChange={(e) => {
                                setAlbum(e.target.value);
                            }}
                        ></input>
                    </div>
                </div>
                <div className="edit-music-meta-operation">
                    {hasOverride ? (
                        <div
                            role="button"
                            className="reset-button"
                            onClick={onReset}
                        >
                            {t("modal.edit_music_meta_reset")}
                        </div>
                    ) : null}
                    <div
                        role="button"
                        className="cancel-button"
                        onClick={hideModal}
                    >
                        {t("common.cancel")}
                    </div>
                    <div
                        role="button"
                        data-type="primaryButton"
                        onClick={onSave}
                    >
                        {t("common.confirm")}
                    </div>
                </div>
            </div>
        </Base>
    );
}
