/**
 * 歌词智能匹配使用的文本处理工具。
 * 纯函数，不依赖运行环境，渲染进程与主进程通用。
 */

/** 中文场景下常见的画质 / 版本 / 渠道修饰词，按长度倒序剥离 */
const CJK_NOISE_WORDS = [
    "超高品音质",
    "臻品音质",
    "无损音质",
    "超高音质",
    "高品音质",
    "最高音质",
    "高音质",
    "无损",
    "高清",
    "超清",
    "完整版",
    "官方版",
    "DJ版",
    "现场版",
    "电台版",
    "录音室版",
    "原版",
    "动态歌词",
    "歌词版",
    "纯音乐",
    "纯歌",
    "钢琴伴奏",
    "人声伴奏",
    "伴奏",
    "抢先听",
    "免费",
    "试听",
    "首发",
    "独家",
    "限时",
    "热播",
    "320K",
    "128K",
    "FLAC",
    "WAV",
    "MP3",
    "APE",
];

/** 英文修饰词，只在独立成词时才会被剥离 */
const LATIN_NOISE_WORDS = [
    "remastered",
    "remaster",
    "instrumental",
    "explicit",
    "lossless",
    "flac",
    "hq",
    "sq",
    "hi-res",
    "hires",
    "4k",
    "1080p",
    "1440p",
    "2160p",
    "dsd",
    "24bit",
    "96khz",
    "192khz",
];

/** 画质类的英文写法，出现在括号里时整段都只是修饰 */
const LATIN_NOISE_PATTERNS = [
    "hi-res",
    "hires",
    "4k",
    "1080p",
    "1440p",
    "2160p",
    "dsd",
    "24bit",
    "96khz",
    "192khz",
];

/** 括号 / 方括号 / 书名号中的修饰内容 */
const NOISE_TAG_PATTERN =
    /^(live|remix|cover|ver\.?|version|instrumental|explicit|demo|mv|feat\.?|ft\.?|featuring|remaster(ed)?|伴奏|纯音乐|纯歌|现场版|官方版|原版|完整版|高清|超清|无损|高音质|超高音质|臻品音质|动态歌词|歌词版|免费|试听|抢先听|首发|独家|无损音质)/i;

const BRACKET_PAIRS: [string, string][] = [
    ["【", "】"],
    ["《", "》"],
    ["「", "」"],
    ["『", "』"],
    ["“", "”"],
    ["‘", "’"],
    ["(", ")"],
    ["（", "）"],
    ["[", "]"],
    ["［", "］"],
    ["{", "}"],
];

/** 标题首尾常见的装饰符号 */
const DECORATION_PATTERN =
    /^[|｜·•・\-–—_~～!！?？:：;；,，.。、'"“”‘’《》「」『』【】()（）[\]{}]+|[|｜·•・\-–—_~～!！?？:：;；,，.。、'"“”‘’《》「」『』【】()（）[\]{}]+$/g;

/** 去掉标题首尾的装饰符号 */
function trimDecoration(text: string): string {
    return text.replace(DECORATION_PATTERN, "").replace(/\s+/g, " ").trim();
}

/** 全角转半角 */
export function toHalfWidth(text: string): string {
    return text
        .replace(/[！-～]/g, (ch) =>
            String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
        )
        .replace(/　/g, " ");
}

/**
 * 归一化：转半角、转小写、去掉所有空白与标点，只保留字母数字与中日韩文字
 */
export function normalizeText(text?: string | null): string {
    if (!text) {
        return "";
    }
    return toHalfWidth(text)
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿぀-ヿ가-힯]/g, "");
}

/**
 * 分词：拉丁文按单词，中日韩按字与相邻二字组
 */
export function tokenize(text?: string | null): Set<string> {
    const result = new Set<string>();
    if (!text) {
        return result;
    }
    const source = toHalfWidth(text).toLowerCase();
    (source.match(/[a-z0-9]+/g) ?? []).forEach((word) => result.add(word));
    const cjk = source.replace(/[^一-鿿぀-ヿ가-힯]/g, "");
    for (let i = 0; i < cjk.length; i++) {
        result.add(cjk[i]);
        if (i + 1 < cjk.length) {
            result.add(cjk.slice(i, i + 2));
        }
    }
    return result;
}

/** Dice 系数 */
export function diceCoefficient(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) {
        return 0;
    }
    let intersection = 0;
    a.forEach((item) => {
        if (b.has(item)) {
            intersection++;
        }
    });
    return (2 * intersection) / (a.size + b.size);
}

/** 括号内容是否属于修饰词 */
function isNoiseTag(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) {
        return false;
    }
    if (NOISE_TAG_PATTERN.test(trimmed)) {
        return true;
    }
    const lower = trimmed.toLowerCase();
    if (LATIN_NOISE_PATTERNS.some((word) => lower.includes(word))) {
        return true;
    }
    return CJK_NOISE_WORDS.some((word) => lower.includes(word.toLowerCase()));
}

/**
 * 取出括号中的修饰词。修饰词会被丢弃，其余内容保留但去掉括号。
 * 非修饰的括号内容会单独返回，它往往就是原曲名
 */
function extractBracketed(text: string) {
    const tags: string[] = [];
    const contents: string[] = [];
    let result = text;
    for (const [open, close] of BRACKET_PAIRS) {
        let guard = 0;
        while (guard++ < 20) {
            const start = result.indexOf(open);
            if (start < 0) {
                break;
            }
            const end = result.indexOf(close, start + open.length);
            if (end < 0) {
                break;
            }
            const content = result.slice(start + open.length, end).trim();
            if (isNoiseTag(content)) {
                tags.push(content);
                result = result.slice(0, start) + " " + result.slice(end + close.length);
            } else {
                if (content) {
                    contents.push(content);
                }
                result =
                    result.slice(0, start) +
                    " " +
                    content +
                    " " +
                    result.slice(end + close.length);
            }
        }
    }
    return { text: result, tags, contents };
}

/** 剥离独立的修饰词 */
function stripNoiseWords(text: string): string {
    let result = text;
    // feat. / ft. 后面的合作歌手不属于歌名
    result = result.replace(
        /\b(feat|ft|featuring)\.?\s+[^,，、\-–—()（）[\]]+/gi,
        " ",
    );
    for (const word of CJK_NOISE_WORDS) {
        result = result.split(word).join(" ");
    }
    for (const word of LATIN_NOISE_WORDS) {
        result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), " ");
    }
    return result.replace(/\s+/g, " ").trim();
}

/** 歌手名是否大致相同 */
export function isSameName(a?: string | null, b?: string | null): boolean {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) {
        return false;
    }
    return na === nb || na.includes(nb) || nb.includes(na);
}

export interface IPreparedTitle {
    /** 原始标题 */
    raw: string;
    /** 去掉修饰词后的标题 */
    core: string;
    /** 被剥离的修饰词 */
    tags: string[];
    /** 标题按分隔符拆出的各段，通常混着歌名、歌手与歌词片段 */
    segments: string[];
    /** 所有可能的标题写法，用于打分时取最高相似度 */
    variants: string[];
}

/**
 * 按分隔符把标题拆成几段。
 * 杂乱标题形如「《青花瓷》- 周杰伦 - '天青色等烟雨 而我在等你'」，
 * 拆开后歌名、歌手与歌词片段就分开了
 */
function splitSegments(text: string): string[] {
    const result: string[] = [];
    text.split(/[-–—_｜]+/).forEach((part) => {
        const trimmed = trimDecoration(part);
        if (trimmed && !result.includes(trimmed)) {
            result.push(trimmed);
        }
    });
    return result;
}

/**
 * 从「A - B」里挑出更像歌名的一侧。
 * 先看已知的歌手名，再看括号里给出的原曲名，
 * 都判断不出来时按中文标题常见的「歌名 - 歌手」写法取左边
 */
function pickSongName(
    left: string,
    right: string,
    artist?: string | null,
    contents?: string[],
): string {
    const artistKey = normalizeText(artist);
    if (artistKey) {
        if (normalizeText(left) === artistKey) {
            return right;
        }
        if (normalizeText(right) === artistKey) {
            return left;
        }
    }
    // 括号里往往直接写着原曲名
    const leftKey = normalizeText(left);
    const rightKey = normalizeText(right);
    const hit = (contents ?? []).some((content) => {
        const key = normalizeText(content);
        return key && (key === leftKey || key === rightKey);
    });
    if (hit) {
        return contents?.some((content) => normalizeText(content) === rightKey)
            ? right
            : left;
    }
    return left;
}

/**
 * 清洗标题：剥离括号修饰词与画质/版本后缀，并给出所有可能的标题写法
 */
export function prepareTitle(
    title?: string | null,
    artist?: string | null,
): IPreparedTitle {
    const raw = (title ?? "").trim();
    if (!raw) {
        return { raw: "", core: "", tags: [], segments: [], variants: [] };
    }
    const { text, tags, contents } = extractBracketed(raw);
    let core = trimDecoration(stripNoiseWords(text) || raw);

    const segments = splitSegments(core);

    const variants = new Set<string>();
    const addVariant = (value?: string | null) => {
        const trimmed = (value ?? "").trim();
        if (trimmed) {
            variants.add(trimmed);
        }
    };
    addVariant(raw);

    // "歌手 - 歌名" / "歌名 - 歌手" 两种写法都可能出现，用已知歌手消歧
    const separator = core.match(/^(.{1,48}?)\s*[-–—_｜]\s*(.+)$/);
    if (separator) {
        const left = trimDecoration(separator[1]);
        const right = trimDecoration(separator[2]);
        if (left && right && !isNoiseTag(left)) {
            // 两侧都留着，既用来打分也用来拼检索词
            addVariant(left);
            addVariant(right);
            core = pickSongName(left, right, artist, contents);
        }
    }

    // 括号里的内容往往就是原曲名
    contents.forEach((content) => {
        addVariant(trimDecoration(stripNoiseWords(content)));
    });
    addVariant(core);

    return {
        raw,
        core,
        tags,
        segments,
        variants: [...variants].filter(Boolean),
    };
}

/** 标题里夹带的歌手名一般不长，太长的多半是歌词片段 */
const embeddedArtistMaxLength = 6;

/** 太长的写法多半是歌词片段，拿去检索只会带回来一堆噪声 */
const maxQueryLength = 16;

/**
 * 构造搜索词：先用「歌名 + 歌手」这种精准的写法，
 * 再退回到只搜歌名，最后是标题的其它可能写法
 */
export function buildSearchQueries(musicItem: {
    title?: string | null;
    artist?: string | null;
}): string[] {
    const prepared = prepareTitle(musicItem.title, musicItem.artist);
    const artist = (musicItem.artist ?? "").trim();
    const queries: string[] = [];
    const push = (query?: string | null) => {
        const trimmed = (query ?? "").trim();
        if (!trimmed) {
            return;
        }
        if (queries.includes(trimmed)) {
            return;
        }
        if (queries.length >= 8) {
            return;
        }
        if (trimmed.length > maxQueryLength) {
            return;
        }
        queries.push(trimmed);
    };

    // 杂乱标题里常常写着真正的歌手，元数据里的歌手反而可能是歌单名，
    // 用标题里夹带的歌手去检索能精确得多。
    // 歌手一般就写在歌名旁边，再往后多半是歌词片段
    const coreIndex = prepared.segments.findIndex((segment) =>
        isSameName(segment, prepared.core),
    );
    const neighbourSegments =
        coreIndex < 0
            ? prepared.segments
            : [
                  ...(coreIndex > 0 ? [prepared.segments[coreIndex - 1]] : []),
                  ...(coreIndex + 1 < prepared.segments.length
                      ? [prepared.segments[coreIndex + 1]]
                      : []),
              ];
    const embeddedArtists = neighbourSegments
        .map((segment) => segment.split(/\s+/)[0] ?? "")
        .filter(
            (segment) =>
                segment &&
                segment.length <= embeddedArtistMaxLength &&
                !isSameName(segment, prepared.core),
        )
        .sort((a, b) => a.length - b.length);

    // 接口请求额度有限，精准的检索词排在前面
    embeddedArtists.forEach((segment) => push(`${prepared.core} ${segment}`));

    if (artist && prepared.core && !isSameName(prepared.core, artist)) {
        push(`${prepared.core} ${artist}`);
    }

    push(prepared.core);

    if (artist && prepared.core && !isSameName(prepared.core, artist)) {
        push(`${artist} ${prepared.core}`);
    }

    prepared.variants.forEach(push);

    return queries;
}

export interface ICandidateScore {
    /** 综合得分 0 ~ 1 */
    total: number;
    title: number;
    artist: number;
    album: number;
    duration: number;
}

interface IScorableItem {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    /** 单位：秒 */
    duration?: number | null;
}

/** 标题相似度 */
function compareTitle(a: string, b: string): number {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) {
        return 0.3;
    }
    if (na === nb) {
        return 1;
    }
    if (na.includes(nb) || nb.includes(na)) {
        const ratio =
            Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
        return 0.6 + 0.3 * ratio;
    }
    return diceCoefficient(tokenize(a), tokenize(b)) * 0.75;
}

/** 人名 / 专辑名相似度 */
function compareName(a?: string | null, b?: string | null): number {
    if (!a || !b) {
        return 0.5;
    }
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) {
        return 0.5;
    }
    if (na === nb) {
        return 1;
    }
    if (na.includes(nb) || nb.includes(na)) {
        return 0.9;
    }
    return diceCoefficient(tokenize(a), tokenize(b)) * 0.85;
}

/** 时长相似度 */
function compareDuration(a?: number | null, b?: number | null): number {
    if (!a || !b) {
        return 0.5;
    }
    const diff = Math.abs(a - b);
    if (diff <= 3) {
        return 1;
    }
    if (diff <= 10) {
        return 1 - ((diff - 3) / 7) * 0.4;
    }
    if (diff <= 30) {
        return 0.6 - ((diff - 10) / 20) * 0.4;
    }
    return 0.1;
}

/**
 * 歌手相似度。杂乱标题里常常写着真正的歌手，所以标题里的歌手名也要参与比较
 */
function compareArtist(
    candidate: IScorableItem,
    target: IScorableItem,
): number {
    const direct = compareName(candidate.artist, target.artist);
    const inTitle = compareName(candidate.artist, target.title);
    return Math.max(direct, inTitle);
}

/**
 * 给候选歌词打分。两侧都会拆出标题的所有可能写法，取最高相似度
 */
export function scoreCandidate(
    candidate: IScorableItem,
    target: IScorableItem,
): ICandidateScore {
    const targetVariants = prepareTitle(target.title, target.artist).variants;
    const candidateVariants = prepareTitle(
        candidate.title,
        candidate.artist,
    ).variants;

    const sourceVariants = candidateVariants.length
        ? candidateVariants
        : [candidate.title ?? ""];
    const sinkVariants = targetVariants.length
        ? targetVariants
        : [target.title ?? ""];

    let title = 0;
    sourceVariants.forEach((source) => {
        sinkVariants.forEach((sink) => {
            title = Math.max(title, compareTitle(source, sink));
        });
    });

    const artist = compareArtist(candidate, target);
    const album = compareName(candidate.album, target.album);
    const duration = compareDuration(candidate.duration, target.duration);

    const total =
        0.5 * title + 0.25 * artist + 0.1 * album + 0.15 * duration;

    return { total, title, artist, album, duration };
}

/**
 * 判断歌词内容是否为空（插件常用「[00:00.00]暂无歌词」占位）
 */
export function isEmptyLyricSource(
    rawLrc?: string | null,
    translation?: string | null,
): boolean {
    if (translation?.trim()) {
        return false;
    }
    if (!rawLrc?.trim()) {
        return true;
    }
    const lines = rawLrc
        .split(/\r?\n/)
        .map((line) =>
            line
                .replace(/\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/g, "")
                .trim(),
        )
        .filter(Boolean);
    if (!lines.length) {
        return true;
    }
    if (
        lines.length === 1 &&
        /暂无(歌词|字幕|文本)|无(歌词|字幕)|歌词不存在|未找到歌词|no\s*lyrics?|lyrics?\s*not\s*found|not\s*found/i.test(
            lines[0],
        )
    ) {
        return true;
    }
    return false;
}
