import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Base from "../Base";
import "./index.scss";
import Loading from "@/renderer/components/Loading";
import Empty from "@/renderer/components/Empty";
import CandidateList from "./candidateList";
import {
    applyLyricCandidate,
    checkCandidateLyrics,
    clearSearched,
    getCandidateKey,
    getCandidates,
    hasLyric,
    recordCandidates,
    searchLyricCandidates,
} from "@renderer/core/smart-lyric";
import { ISmartLyricCandidate } from "@renderer/core/smart-lyric";
import trackPlayer from "@renderer/core/track-player";
import { hideModal } from "../..";
import { applyMusicMeta } from "@/renderer/core/music-meta";

interface IProps {
    musicItem?: IMusic.IMusicItem;
}

export default function SmartLyric(props: IProps) {
    const { musicItem } = props;
    const { t } = useTranslation();

    const [candidates, setCandidates] = useState<ISmartLyricCandidate[]>([]);
    const [lyricFlags, setLyricFlags] = useState<Map<string, boolean>>(new Map());
    const [loading, setLoading] = useState(false);

    // 得分高的候选未必真的有歌词，挨个确认一遍
    const checkLyrics = useCallback(async (list: ISmartLyricCandidate[]) => {
        if (!list.length) {
            return;
        }
        const flags = await checkCandidateLyrics(list);
        setLyricFlags(flags);
    }, []);

    const doSearch = useCallback(async () => {
        if (!musicItem) {
            return;
        }
        setLoading(true);
        try {
            const result = await searchLyricCandidates(musicItem);
            recordCandidates(musicItem, result);
            setCandidates(result);
            void checkLyrics(result);
        } catch (e) {
            console.log(e);
            toast.error(`${t("modal.smart_lyric_search_failed")} ${e?.message ?? e}`);
        } finally {
            setLoading(false);
        }
    }, [musicItem, t, checkLyrics]);

    useEffect(() => {
        if (!musicItem) {
            return;
        }
        const cached = getCandidates(musicItem);
        if (cached.length) {
            setCandidates(cached);
            void checkLyrics(cached);
            return;
        }
        void doSearch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSelect = useCallback(
        async (candidate: ISmartLyricCandidate) => {
            if (!musicItem) {
                return;
            }
            try {
                if (!(await hasLyric(candidate))) {
                    toast.error(t("modal.smart_lyric_no_lyric"));
                    return;
                }
                await applyLyricCandidate(musicItem, candidate);
                if (trackPlayer.isCurrentMusic(musicItem)) {
                    await trackPlayer.fetchCurrentLyric(true);
                }
                toast.success(t("modal.smart_lyric_applied"));
                hideModal();
            } catch (e) {
                toast.error(
                    `${t("modal.smart_lyric_apply_failed")} ${e?.message ?? e}`,
                );
            }
        },
        [musicItem, t],
    );

    return (
        <Base defaultClose withBlur={false}>
            <div className="modal--smart-lyric-container shadow backdrop-color">
                <Base.Header>
                    <div className="header-title">
                        {t("modal.smart_lyric")}
                        <span className="header-subtitle">
                            {musicItem ? applyMusicMeta(musicItem).title : ""}
                        </span>
                    </div>
                </Base.Header>
                <div className="smart-lyric-toolbar">
                    <div className="hint">{t("modal.smart_lyric_hint")}</div>
                    <div
                        className="research-button opacity-button"
                        role="button"
                        onClick={() => {
                            if (!musicItem) {
                                return;
                            }
                            clearSearched(musicItem);
                            void doSearch();
                        }}
                    >
                        {t("modal.smart_lyric_research")}
                    </div>
                </div>
                <div className="smart-lyric-content">
                    {loading ? (
                        <Loading></Loading>
                    ) : candidates.length ? (
                        <CandidateList
                            candidates={candidates}
                            lyricFlags={lyricFlags}
                            onSelect={handleSelect}
                        ></CandidateList>
                    ) : (
                        <>
                            <Empty></Empty>
                            <div className="hint">
                                {t("modal.smart_lyric_no_candidate")}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Base>
    );
}
