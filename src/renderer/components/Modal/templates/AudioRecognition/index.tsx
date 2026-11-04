import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Base from "../Base";
import "./index.scss";
import Loading from "@/renderer/components/Loading";
import Empty from "@/renderer/components/Empty";
import CandidateList from "../SmartLyric/candidateList";
import {
    captureFromMicrophone,
    captureFromUrl,
    recognizeAudio,
} from "@renderer/core/audio-recognition";
import {
    applyLyricCandidate,
    checkCandidateLyrics,
    hasLyric,
    searchLyricCandidatesByText,
} from "@renderer/core/smart-lyric";
import { ISmartLyricCandidate } from "@renderer/core/smart-lyric";
import { linkLyricText } from "@renderer/core/link-lyric";
import AppConfig from "@shared/app-config/renderer";
import trackPlayer from "@renderer/core/track-player";
import { hideModal } from "../..";

interface IProps {
    musicItem?: IMusic.IMusicItem;
}

type IStage = "idle" | "capturing" | "recognizing" | "searching" | "done";

export default function AudioRecognition(props: IProps) {
    const { musicItem } = props;
    const { t } = useTranslation();

    const [token, setToken] = useState(
        AppConfig.getConfig("lyric.recognition.token") ?? "",
    );
    const [stage, setStage] = useState<IStage>("idle");
    const [progress, setProgress] = useState(0);
    const [recognized, setRecognized] = useState<{
        title: string;
        artist: string;
    } | null>(null);
    const [candidates, setCandidates] = useState<ISmartLyricCandidate[]>([]);
    const [lyricFlags, setLyricFlags] = useState<Map<string, boolean>>(new Map());
    const [recognizedLyrics, setRecognizedLyrics] = useState<string | null>(null);

    useEffect(() => {
        AppConfig.setConfig({ "lyric.recognition.token": token.trim() });
    }, [token]);

    const ensureToken = useCallback(() => {
        const value = token.trim();
        if (!value) {
            toast.error(t("modal.audio_recognition_token_missing"));
            return null;
        }
        AppConfig.setConfig({ "lyric.recognition.token": value });
        return value;
    }, [token, t]);

    const searchLyrics = useCallback(
        async (title: string, artist: string) => {
            setStage("searching");
            try {
                const result = await searchLyricCandidatesByText(title, artist);
                setCandidates(result);
                void checkCandidateLyrics(result).then(setLyricFlags);
            } catch (e) {
                console.log(e);
                toast.error(`${t("modal.audio_recognition_search_failed")} ${e?.message ?? e}`);
            } finally {
                setStage("done");
            }
        },
        [t],
    );

    const runRecognition = useCallback(
        async (clip: { blob: Blob; fileName: string; mimeType: string }) => {
            const accessToken = ensureToken();
            if (!accessToken) {
                return;
            }
            setStage("recognizing");
            setProgress(0);
            try {
                const result = await recognizeAudio(clip, accessToken);
                setRecognized({ title: result.title, artist: result.artist });
                setRecognizedLyrics(result.lyrics ?? null);
                await searchLyrics(result.title, result.artist);
            } catch (e) {
                console.log(e);
                toast.error(`${t("modal.audio_recognition_failed")} ${e?.message ?? e}`);
                setStage("idle");
            }
        },
        [ensureToken, searchLyrics, t],
    );

    const recognizeCurrentTrack = useCallback(async () => {
        const url = trackPlayer.currentSourceUrl;
        if (!url) {
            toast.error(t("modal.audio_recognition_no_source"));
            return;
        }
        setStage("capturing");
        try {
            const clip = await captureFromUrl(url);
            await runRecognition(clip);
        } catch (e) {
            console.log(e);
            toast.error(`${t("modal.audio_recognition_failed")} ${e?.message ?? e}`);
            setStage("idle");
        }
    }, [runRecognition, t]);

    const recognizeFromMicrophone = useCallback(async () => {
        setStage("capturing");
        setProgress(0);
        try {
            const clip = await captureFromMicrophone({
                onProgress: (value) => {
                    setProgress(value);
                },
            });
            await runRecognition(clip);
        } catch (e) {
            console.log(e);
            toast.error(`${t("modal.audio_recognition_failed")} ${e?.message ?? e}`);
            setStage("idle");
        }
    }, [runRecognition, t]);

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

    /** 插件里没有匹配项时，退回到识别服务自带的歌词 */
    const useRecognizedLyrics = useCallback(async () => {
        if (!musicItem || !recognizedLyrics) {
            return;
        }
        try {
            await linkLyricText(musicItem, { rawLrc: recognizedLyrics });
            if (trackPlayer.isCurrentMusic(musicItem)) {
                await trackPlayer.fetchCurrentLyric(true);
            }
            toast.success(t("modal.smart_lyric_applied"));
            hideModal();
        } catch (e) {
            toast.error(`${t("modal.smart_lyric_apply_failed")} ${e?.message ?? e}`);
        }
    }, [musicItem, recognizedLyrics, t]);

    const busy = stage === "capturing" || stage === "recognizing" || stage === "searching";

    return (
        <Base defaultClose withBlur={false}>
            <div className="modal--audio-recognition-container shadow backdrop-color">
                <Base.Header>
                    <div className="header-title">{t("modal.audio_recognition")}</div>
                </Base.Header>
                <div className="audio-recognition-body">
                    <div className="token-row">
                        <input
                            className="token-input"
                            type="password"
                            spellCheck={false}
                            placeholder={t("modal.audio_recognition_token_placeholder")}
                            value={token}
                            onChange={(evt) => {
                                setToken(evt.target.value);
                            }}
                        ></input>
                    </div>
                    <div className="action-row">
                        <div
                            className="action-button"
                            data-disabled={busy}
                            role="button"
                            onClick={() => {
                                if (!busy) {
                                    void recognizeCurrentTrack();
                                }
                            }}
                        >
                            {t("modal.audio_recognition_current_track")}
                        </div>
                        <div
                            className="action-button"
                            data-disabled={busy}
                            role="button"
                            onClick={() => {
                                if (!busy) {
                                    void recognizeFromMicrophone();
                                }
                            }}
                        >
                            {t("modal.audio_recognition_microphone")}
                        </div>
                    </div>
                    <div className="status-row">
                        {stage === "capturing" ? (
                            <span>
                                {progress > 0
                                    ? t(
                                          "modal.audio_recognition_recording_progress",
                                          {
                                              percent: Math.round(progress * 100),
                                          },
                                      )
                                    : t("modal.audio_recognition_capturing")}
                            </span>
                        ) : null}
                        {stage === "recognizing" ? (
                            <span>{t("modal.audio_recognition_recognizing")}</span>
                        ) : null}
                        {stage === "searching" ? (
                            <span>{t("modal.audio_recognition_searching")}</span>
                        ) : null}
                    </div>
                    {recognized ? (
                        <div className="recognized-info">
                            <div className="label">{t("modal.audio_recognition_result")}</div>
                            <div className="title">{recognized.title}</div>
                            <div className="artist">{recognized.artist || "-"}</div>
                        </div>
                    ) : null}
                    <div className="candidate-area">
                        {stage === "searching" ? (
                            <Loading></Loading>
                        ) : candidates.length ? (
                            <CandidateList
                                candidates={candidates}
                                lyricFlags={lyricFlags}
                                onSelect={handleSelect}
                            ></CandidateList>
                        ) : recognized && recognizedLyrics ? (
                            <div
                                className="fallback-lyric"
                                role="button"
                                onClick={() => {
                                    void useRecognizedLyrics();
                                }}
                            >
                                {t("modal.audio_recognition_use_original_lyric")}
                            </div>
                        ) : recognized ? (
                            <>
                                <Empty></Empty>
                                <div className="hint">
                                    {t("modal.audio_recognition_no_candidate")}
                                </div>
                            </>
                        ) : (
                            <div className="hint">{t("modal.audio_recognition_hint")}</div>
                        )}
                    </div>
                </div>
            </div>
        </Base>
    );
}
