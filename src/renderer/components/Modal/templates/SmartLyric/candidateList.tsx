import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { getCandidateKey, ISmartLyricCandidate } from "@renderer/core/smart-lyric";
import "./candidateList.scss";

interface ICandidateListProps {
    candidates: ISmartLyricCandidate[];
    /** 候选是否有歌词，key 为候选标识 */
    lyricFlags?: Map<string, boolean>;
    onSelect: (candidate: ISmartLyricCandidate) => void;
}

function formatDuration(duration?: number | null) {
    if (!duration || !isFinite(duration)) {
        return null;
    }
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function CandidateList(props: ICandidateListProps) {
    const { candidates, lyricFlags, onSelect } = props;
    const { t } = useTranslation();

    // 有歌词的候选排在前面，同样条件下得分高的优先
    const sorted = useMemo(() => {
        if (!lyricFlags?.size) {
            return candidates;
        }
        return [...candidates].sort((a, b) => {
            const ha = lyricFlags.get(getCandidateKey(a));
            const hb = lyricFlags.get(getCandidateKey(b));
            if (ha === hb) {
                return b.score - a.score;
            }
            return ha ? -1 : 1;
        });
    }, [candidates, lyricFlags]);

    return (
        <div className="smart-lyric-candidate-list">
            {sorted.map((candidate) => {
                const percent = Math.round(candidate.score * 100);
                const duration = formatDuration(candidate.item.duration);
                const hasLyric = lyricFlags?.get(getCandidateKey(candidate));
                return (
                    <div
                        className="candidate-item"
                        key={getCandidateKey(candidate)}
                        role="button"
                        onClick={() => {
                            onSelect(candidate);
                        }}
                    >
                        <img
                            className="artwork"
                            src={candidate.item.artwork ?? albumImg}
                            onError={setFallbackAlbum}
                        ></img>
                        <div className="info">
                            <div className="title">{candidate.item.title}</div>
                            <div className="artist">
                                {candidate.item.artist || "-"}
                            </div>
                            <div className="meta">
                                {candidate.item.album ? (
                                    <span>{candidate.item.album}</span>
                                ) : null}
                                {duration ? <span>{duration}</span> : null}
                                {hasLyric === true ? (
                                    <span className="lyric-tag" data-has-lyric="true">
                                        {t("modal.smart_lyric_has_lyric")}
                                    </span>
                                ) : hasLyric === false ? (
                                    <span className="lyric-tag" data-has-lyric="false">
                                        {t("modal.smart_lyric_no_lyric_tag")}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        <div
                            className="score"
                            data-level={
                                percent >= 80 ? "high" : percent >= 60 ? "mid" : "low"
                            }
                            title={t("modal.smart_lyric_score_detail", {
                                title: Math.round(candidate.detail.title * 100),
                                artist: Math.round(candidate.detail.artist * 100),
                                album: Math.round(candidate.detail.album * 100),
                                duration: Math.round(candidate.detail.duration * 100),
                            })}
                        >
                            {percent}%
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default memo(CandidateList);
