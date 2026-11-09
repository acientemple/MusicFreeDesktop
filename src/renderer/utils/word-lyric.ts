/**
 * 逐字歌词解析
 *
 * 支持三类来源：
 * 1. 增强型 LRC（酷狗 / QQ 风格）：`[00:12.34]<00:12.34>我们<00:12.80>都是`
 * 2. 网易云 YRC / QQ QRC：`[12340,2400](12340,2400,0)我们(12800,460,0)都是`
 * 3. 没有真逐字时，用行级 LRC 按字均分生成「伪逐字」，
 *    这样只有普通歌词时卡拉OK 的扫光效果照样能用。
 */

/** 一个词（字/音节）的时间信息 */
export interface IWordItem {
    /** 词文本 */
    text: string;
    /** 词开始时间（秒） */
    time: number;
    /** 词时长（秒） */
    duration: number;
}

/** 逐字歌词的一行 */
export interface IWordLyricLine {
    /** 行开始时间（秒） */
    time: number;
    /** 行内所有词 */
    words: IWordItem[];
}

export interface IWordLyric {
    lines: IWordLyricLine[];
    /** true = 来自真实词级时间戳，false = 按行均分生成 */
    exact: boolean;
}

/** 行首时间戳 [mm:ss.xxx] 或 [start,duration] */
const lineTimeReg = /\[(\d+):(\d+(?:\.\d+)?)\]/;
const lineTimeRegMs = /^\s*\[(\d+),(\d+)\]/;
/** 词级时间戳 <mm:ss.xxx> */
const wordTagReg = /<(\d+):(\d+(?:\.\d+)?)>/g;
/** 词级时间戳 (start,duration,0) */
const wordPairReg = /\((\d+),(\d+)(?:,\d+)?\)/g;

/** 中文按字切，英文按单词切，数字整体保留 */
const tokenReg = /[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:[.:-]\d+)*|[\u4e00-\u9fff\u3040-\u30ff]|[^\s]/g;

/** 至少给每个词留这么长时间，避免一闪而过 */
const MIN_WORD_DURATION = 0.12;

function toSeconds(min: string, sec: string): number {
    return +min * 60 + +sec;
}

/**
 * 把一行文本切成词
 * 标点、空白等零散字符会并入前一个词，不单独占时间
 */
export function tokenize(text: string): string[] {
    const tokens = text.match(tokenReg) ?? [];
    const merged: string[] = [];
    for (const token of tokens) {
        // 纯标点/符号跟在前一个词后面
        if (merged.length && /^[^\w\u4e00-\u9fff\u3040-\u30ff]$/.test(token)) {
            merged[merged.length - 1] += token;
            continue;
        }
        merged.push(token);
    }
    return merged;
}

/**
 * 把一行文本按字/词均分成带时间轴的词
 * 真逐字歌词里偶尔混着没有词级时间戳的行（副歌标题、作词信息等），
 * 这些行也用这个方式补上，不至于在界面上整行消失
 */
function splitPseudoWords(
    text: string,
    startTime: number,
    endTime: number,
): IWordItem[] {
    const tokens = tokenize(text);
    if (!tokens.length) {
        return [];
    }
    const span = Math.max(MIN_WORD_DURATION, endTime - startTime);
    // 按字数分配时间，字多的词占得久一点
    const totalWeight = tokens.reduce(
        (sum, token) => sum + Math.max(token.length, 1),
        0,
    );
    let cursor = startTime;
    const words: IWordItem[] = [];
    for (const token of tokens) {
        const weight = Math.max(token.length, 1);
        const duration = Math.max(MIN_WORD_DURATION, (span * weight) / totalWeight);
        words.push({ text: token, time: cursor, duration });
        cursor += duration;
    }
    return words;
}

/** 去掉行首时间戳与词级标记，只留正文 */
function stripTags(text: string): string {
    return text
        .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "")
        .replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, "")
        .replace(/^\s*\[\d+,\d+\]/, "")
        .trim();
}

/** 往后找下一个有时间的行 */
function nextLineTime(lineTimes: Array<number | null>, from: number): number | null {
    for (let i = from + 1; i < lineTimes.length; ++i) {
        if (lineTimes[i] !== null) {
            return lineTimes[i];
        }
    }
    return null;
}

/**
 * 解析增强型 LRC（词级时间戳用尖括号）
 */
function parseEnhancedLrc(raw: string): IWordLyricLine[] {
    const rows = raw
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter(Boolean);
    const lineTimes = rows.map((row) => {
        const match = row.match(lineTimeReg);
        return match ? toSeconds(match[1], match[2]) : null;
    });

    const lines: IWordLyricLine[] = [];
    for (let i = 0; i < rows.length; ++i) {
        const text = rows[i];
        const lineTime = lineTimes[i];
        if (lineTime === null) {
            continue;
        }

        // 把行拆成 [标记前文本, 标记1, 标记1后文本, 标记2, ...]
        const parts = text.split(/<\d+:\d+(?:\.\d+)?>/);
        const tags = Array.from(text.matchAll(wordTagReg)).map((m) =>
            toSeconds(m[1], m[2]),
        );

        if (!tags.length) {
            // 这一行没有词级时间戳，整行按字均分
            const end = nextLineTime(lineTimes, i) ?? lineTime + 4;
            const words = splitPseudoWords(stripTags(text), lineTime, end);
            if (words.length) {
                lines.push({ time: lineTime, words });
            }
            continue;
        }

        const words: IWordItem[] = [];
        // parts[0] 是第一个标记之前的文本，一般是空的
        for (let j = 0; j < tags.length; ++j) {
            const wordText = (parts[j + 1] ?? "").trim();
            if (!wordText) {
                continue;
            }
            const start = tags[j];
            const next = tags[j + 1] ?? start + MIN_WORD_DURATION;
            words.push({
                text: wordText,
                time: start,
                duration: Math.max(MIN_WORD_DURATION, next - start),
            });
        }
        if (words.length) {
            lines.push({ time: lineTime, words });
        }
    }
    return lines;
}

/**
 * 解析 YRC / QRC（词级时间戳用圆括号，单位毫秒）
 */
function parseYrcLike(raw: string): IWordLyricLine[] {
    const rows = raw
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter(Boolean);
    const lineTimes = rows.map((row) => {
        const match = row.match(lineTimeRegMs);
        return match ? +match[1] / 1000 : null;
    });

    const lines: IWordLyricLine[] = [];
    for (let i = 0; i < rows.length; ++i) {
        const text = rows[i];
        const lineTime = lineTimes[i];
        if (lineTime === null) {
            continue;
        }

        const words: IWordItem[] = [];
        // 逐个匹配 (start,duration)，词文本在标记之后、下一个标记之前
        const marks = Array.from(text.matchAll(wordPairReg));
        for (let j = 0; j < marks.length; ++j) {
            const start = +marks[j][1] / 1000;
            const duration = +marks[j][2] / 1000;
            const end = text.indexOf(")", marks[j].index ?? 0) + 1;
            const nextMarkIndex = marks[j + 1]?.index ?? text.length;
            const wordText = text.slice(end, nextMarkIndex).trim();
            if (!wordText) {
                continue;
            }
            words.push({
                text: wordText,
                time: start,
                duration: Math.max(MIN_WORD_DURATION, duration),
            });
        }

        if (!words.length) {
            // 这一行没有词级时间戳，整行按字均分
            const end = nextLineTime(lineTimes, i) ?? lineTime + 4;
            const pseudo = splitPseudoWords(stripTags(text), lineTime, end);
            if (pseudo.length) {
                lines.push({ time: lineTime, words: pseudo });
            }
            continue;
        }

        lines.push({ time: lineTime, words });
    }
    return lines;
}

/**
 * 解析逐字歌词文本
 * 认不出来的时候返回 null，交给上层降级成伪逐字
 */
export function parseWordLyric(raw?: string | null): IWordLyric | null {
    const text = String(raw ?? "").trim();
    if (!text) {
        return null;
    }
    // 整段文本里一个词级时间戳都没有，说明只是普通行级歌词，
    // 这种情况交给上层按行均分，不要冒充真逐字
    const hasWordTags =
        /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(text) ||
        /\(\d+,\d+(?:,\d+)?\)/.test(text);
    if (!hasWordTags) {
        return null;
    }
    let lines = parseYrcLike(text);
    if (!lines.length) {
        lines = parseEnhancedLrc(text);
    }
    if (!lines.length) {
        return null;
    }
    lines.sort((a, b) => a.time - b.time);
    return { lines, exact: true };
}

/**
 * 用行级 LRC 生成伪逐字
 * 行内按字数比例分配时长，中文逐字、英文逐词
 */
export function buildPseudoWordLyric(
    lrcItems: Array<{ time: number; lrc: string }>,
): IWordLyric {
    const lines: IWordLyricLine[] = [];
    for (let i = 0; i < lrcItems.length; ++i) {
        const item = lrcItems[i];
        const text = String(item.lrc ?? "").trim();
        if (!text) {
            continue;
        }
        // 以副歌、间奏之类的空行为界，时间跳到下一句
        const next = lrcItems[i + 1];
        const lineEnd = next ? next.time : item.time + 4;

        const words = splitPseudoWords(text, item.time, lineEnd);
        if (words.length) {
            lines.push({ time: item.time, words });
        }
    }
    return { lines, exact: false };
}

/** 逐字歌词在某一时刻的进度 */
export interface IWordPosition {
    /** 当前行 */
    line: IWordLyricLine | null;
    /** 当前行索引 */
    lineIndex: number;
    /** 已经唱完的词数 */
    finishedWords: number;
    /** 当前词的进度 0~1 */
    wordProgress: number;
    /** 当前行整体进度 0~1 */
    lineProgress: number;
}

export function getWordPosition(
    wordLyric: IWordLyric | null,
    position: number,
): IWordPosition {
    const empty: IWordPosition = {
        line: null,
        lineIndex: -1,
        finishedWords: 0,
        wordProgress: 0,
        lineProgress: 0,
    };
    if (!wordLyric?.lines.length) {
        return empty;
    }
    const lines = wordLyric.lines;
    let index = -1;
    for (let i = 0; i < lines.length; ++i) {
        if (position >= lines[i].time) {
            index = i;
        } else {
            break;
        }
    }
    if (index < 0) {
        return empty;
    }
    const line = lines[index];
    let finished = 0;
    let wordProgress = 0;
    for (const word of line.words) {
        if (position >= word.time + word.duration) {
            finished += 1;
            continue;
        }
        if (position >= word.time) {
            wordProgress = (position - word.time) / Math.max(word.duration, 0.001);
        }
        break;
    }
    const lineEnd = line.words.reduce(
        (max, word) => Math.max(max, word.time + word.duration),
        line.time,
    );
    const lineProgress = Math.min(
        1,
        Math.max(0, (position - line.time) / Math.max(lineEnd - line.time, 0.001)),
    );
    return {
        line,
        lineIndex: index,
        finishedWords: finished,
        wordProgress,
        lineProgress,
    };
}
