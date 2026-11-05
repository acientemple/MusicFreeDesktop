import { useRef, useState } from "react";
import trackPlayer from "@renderer/core/track-player";
import { usePlayerState, useProgress } from "@renderer/core/track-player/hooks";
import { PlayerState } from "@/common/constant";
import SvgAsset from "@renderer/components/SvgAsset";
import { useTranslation } from "react-i18next";

interface IProps {
    /** 画面元素，进度与播放状态都要跟它对齐 */
    videoRef?: React.RefObject<HTMLVideoElement>;
}

function formatDuration(seconds: number) {
    if (!isFinite(seconds) || seconds < 0) {
        return "--:--";
    }
    const s = Math.floor(seconds % 60);
    const m = Math.floor(seconds / 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function PlayerControl({ videoRef }: IProps) {
    const { t } = useTranslation();
    const { currentTime, duration } = useProgress();
    const playerState = usePlayerState();
    const isPlaying = playerState === PlayerState.Playing;

    const barRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const [dragPercent, setDragPercent] = useState<number | null>(null);

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

    return (
        <div className="mv-player-control">
            <span className="mv-player-time">{formatDuration(currentTime)}</span>
            <div
                className="mv-player-progress"
                ref={barRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            >
                <div className="mv-player-progress-active" style={{ width: `${percent * 100}%` }}></div>
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
        </div>
    );
}
