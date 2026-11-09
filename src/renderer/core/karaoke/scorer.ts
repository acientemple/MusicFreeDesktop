/**
 * 卡拉OK 演唱打分
 *
 * 拿麦克风采到的音高轨迹跟歌词的词时间轴对齐，算三个分：
 * - 节奏：唱得准不准（每个词起唱时刻与歌词时间的偏差）
 * - 完整度：该唱的词唱到了没有
 * - 音高连贯性：相邻词之间有没有离谱的跳跃
 */

import { IWordItem } from "@renderer/utils/word-lyric";
import { frequencyToSemitone, IPitchSample } from "./recorder";

export interface IScoreResult {
    /** 综合分 0~100 */
    total: number;
    /** 节奏准确度 0~100 */
    timing: number;
    /** 完整度 0~100 */
    coverage: number;
    /** 音高连贯性 0~100 */
    pitch: number;
    /** 唱到的词数 */
    hitWords: number;
    /** 该唱的词数 */
    singableWords: number;
}

/** 每个词的判定结果 */
export interface IWordJudgement {
    word: IWordItem;
    /** 有没有唱到 */
    hit: boolean;
    /** 起唱偏差（秒），没唱到时为 null */
    offset: number | null;
    /** 这个词唱到的音高（Hz） */
    frequency: number | null;
}

/** 允许的起唱提前量与拖后量（秒） */
const LEAD_TOLERANCE = 0.3;
const TAIL_TOLERANCE = 0.3;
/** 偏差小于这个值算踩得很准 */
const PERFECT_OFFSET = 0.12;
/** 偏差超过这个值基本算没跟上 */
const MISS_OFFSET = 0.6;

/** 词是不是值得唱（纯标点不算） */
function isSingable(text: string): boolean {
    return /[\w\u4e00-\u9fff\u3040-\u30ff]/.test(text);
}

/** 取窗口内所有有人声的采样 */
function voicedIn(
    samples: IPitchSample[],
    from: number,
    to: number,
): IPitchSample[] {
    return samples.filter(
        (sample) =>
            sample.frequency > 0 && sample.time >= from && sample.time <= to,
    );
}

/** 一组采样里的中位音高，避免被个别毛刺带偏 */
function medianFrequency(samples: IPitchSample[]): number {
    if (!samples.length) {
        return 0;
    }
    const sorted = samples
        .map((sample) => sample.frequency)
        .sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 相邻两个词的音高差算多少分
 * 差两个半音以内是正常旋律，超过八度多半是跑调或者换了个八度
 */
function pitchStepScore(semitoneDiff: number): number {
    const diff = Math.abs(semitoneDiff);
    if (diff <= 2) {
        return 1;
    }
    if (diff <= 5) {
        return 0.7;
    }
    if (diff <= 9) {
        return 0.4;
    }
    return 0.15;
}

/**
 * 逐词判定
 */
export function judgeWords(
    words: IWordItem[],
    samples: IPitchSample[],
): IWordJudgement[] {
    const judgements: IWordJudgement[] = [];
    for (const word of words) {
        if (!isSingable(word.text)) {
            continue;
        }
        const from = word.time - LEAD_TOLERANCE;
        const to = word.time + word.duration + TAIL_TOLERANCE;
        const voiced = voicedIn(samples, from, to);
        if (!voiced.length) {
            judgements.push({
                word,
                hit: false,
                offset: null,
                frequency: null,
            });
            continue;
        }
        // 取离歌词时间最近的那次发声作为起唱点
        let best = voiced[0];
        let bestDiff = Math.abs(best.time - word.time);
        for (const sample of voiced) {
            const diff = Math.abs(sample.time - word.time);
            if (diff < bestDiff) {
                best = sample;
                bestDiff = diff;
            }
        }
        judgements.push({
            word,
            hit: true,
            offset: best.time - word.time,
            frequency: medianFrequency(voiced),
        });
    }
    return judgements;
}

/**
 * 计算分数
 * @param words 歌词的词时间轴
 * @param samples 录音采到的音高轨迹
 */
export function scorePerformance(
    words: IWordItem[],
    samples: IPitchSample[],
): IScoreResult {
    const judgements = judgeWords(words, samples);
    const singableWords = judgements.length;
    if (!singableWords) {
        return {
            total: 0,
            timing: 0,
            coverage: 0,
            pitch: 0,
            hitWords: 0,
            singableWords: 0,
        };
    }

    const hits = judgements.filter((item) => item.hit);
    const hitWords = hits.length;
    const coverage = hitWords / singableWords;

    // 节奏：偏差越小分越高，超过 MISS_OFFSET 记 0
    let timingSum = 0;
    for (const item of hits) {
        const diff = Math.abs(item.offset ?? 0);
        if (diff <= PERFECT_OFFSET) {
            timingSum += 1;
        } else if (diff >= MISS_OFFSET) {
            timingSum += 0;
        } else {
            timingSum +=
                1 - (diff - PERFECT_OFFSET) / (MISS_OFFSET - PERFECT_OFFSET);
        }
    }
    const timing = singableWords ? timingSum / singableWords : 0;

    // 音高连贯性：只看连续唱到的词
    let pitchSum = 0;
    let pitchCount = 0;
    let lastFrequency: number | null = null;
    for (const item of hits) {
        if (!item.frequency) {
            continue;
        }
        if (lastFrequency !== null) {
            const diff = frequencyToSemitone(item.frequency) -
                frequencyToSemitone(lastFrequency);
            pitchSum += pitchStepScore(diff);
            pitchCount += 1;
        }
        lastFrequency = item.frequency;
    }
    const pitch = pitchCount ? pitchSum / pitchCount : coverage;

    return {
        total: Math.round(
            (0.45 * timing + 0.35 * coverage + 0.2 * pitch) * 100,
        ),
        timing: Math.round(timing * 100),
        coverage: Math.round(coverage * 100),
        pitch: Math.round(pitch * 100),
        hitWords,
        singableWords,
    };
}

/**
 * 算到某一时刻为止的分数，用于实时反馈
 */
export function scoreUpTo(
    words: IWordItem[],
    samples: IPitchSample[],
    currentTime: number,
): IScoreResult {
    const passed = words.filter((word) => word.time <= currentTime);
    return scorePerformance(passed, samples);
}
