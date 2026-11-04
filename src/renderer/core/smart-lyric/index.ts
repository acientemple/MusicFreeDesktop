import {
    buildSearchQueries,
    isEmptyLyricSource,
    normalizeText,
    scoreCandidate,
} from "@/common/lyric-util";
import { getMediaPrimaryKey } from "@/common/media-util";
import { linkLyric } from "@renderer/core/link-lyric";
import PluginManager from "@shared/plugin-manager/renderer";
import smartLyricStore, { ISmartLyricCandidate } from "./store";

export type { ISmartLyricCandidate } from "./store";

export interface ISmartSearchOptions {
    /** 覆盖默认搜索词 */
    queries?: string[];
    /** 只在这些插件里搜索 */
    pluginHashes?: string[];
    /** 已经拿到得分不低于该值的候选就不再继续搜索 */
    stopWhenScore?: number;
}

/** 参与匹配的目标，可以只是一段识别出来的歌名 */
export interface ISmartLyricTarget {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    /** 单位：秒 */
    duration?: number | null;
    /** 来源平台，与 id 一起用于排除歌曲自身 */
    platform?: string | null;
    id?: string | null;
}

interface ILyricSearchTarget {
    plugin: IPlugin.IPluginDelegate;
    type: IMedia.SupportMediaType;
}

/** 最多保留多少个候选 */
const maxCandidateCount = 60;

/** 最多检查多少个候选是否真的有歌词 */
export const maxLyricCheckCount = 12;

/** 最多用几个搜索词 */
const maxSearchQueryCount = 5;

/** 两次查询之间的间隔，网易云这类接口请求密了会被风控 */
const searchQueryInterval = 700;

/** 空结果多半是被风控，等一会儿再试一次 */
const searchRetryInterval = 2000;

/** 被风控后要隔多久才继续用这个插件 */
const pluginLimitedDuration = 20000;

/** 最多翻几页。原作常被翻唱版本挤到第二页，但请求多了会被风控 */
const maxSecondPageCount = 2;

/** 达到这个得分就算找到了合适的候选 */
const defaultGoodScore = 0.8;

/** 检查前几个高分候选就能判断有没有找到合适的歌词 */
const goodCandidateCheckCount = 5;

/**
 * 「歌名 + 歌手」这种多段式搜索才算精准。
 * 精准的搜索结果里仍可能有大量翻唱版本，原作往往被挤到第二页
 */
const compoundQueryPattern = /^[^\s]{1,20}(\s+[^\s]{1,20})+$/;

/** 同时检查多少个候选的歌词 */
const lyricCheckConcurrency = 4;

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 分批执行，限制同时进行的请求数 */
async function runLimited<T>(
    items: T[],
    limit: number,
    handler: (item: T) => Promise<void>,
) {
    let cursor = 0;
    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        async () => {
            while (cursor < items.length) {
                const index = cursor++;
                await handler(items[index]);
            }
        },
    );
    await Promise.all(workers);
}

/**
 * 按平台交错排列。
 * 同一个插件往往能返回几十条结果，不交错的话列表会被它整个刷屏
 */
function interleaveByPlatform(candidates: ISmartLyricCandidate[]) {
    const groups = new Map<string, ISmartLyricCandidate[]>();
    candidates.forEach((candidate) => {
        const group = groups.get(candidate.platform);
        if (group) {
            group.push(candidate);
        } else {
            groups.set(candidate.platform, [candidate]);
        }
    });
    const queues = [...groups.values()];
    const result: ISmartLyricCandidate[] = [];
    for (let index = 0; result.length < candidates.length; index++) {
        let pushed = false;
        for (const queue of queues) {
            if (queue[index]) {
                result.push(queue[index]);
                pushed = true;
            }
        }
        if (!pushed) {
            break;
        }
    }
    return result;
}

/**
 * 同一首歌的判定依据：标题 + 歌手 + 时长
 */
function getContentKey(item: IMusic.IMusicItem) {
    const title = normalizeText(item.title);
    if (!title) {
        return null;
    }
    return `${title}|${normalizeText(item.artist)}|${Math.round(
        item.duration ?? 0,
    )}`;
}

/**
 * 合并内容相同的候选。
 * 热门歌单与音乐排行榜是同一份网易云歌单，同一首歌会以两个平台名各出现一次
 */
function mergeByContent(candidates: ISmartLyricCandidate[]) {
    const byContent = new Map<string, ISmartLyricCandidate>();
    const result: ISmartLyricCandidate[] = [];
    candidates.forEach((candidate) => {
        const key = getContentKey(candidate.item);
        if (!key) {
            result.push(candidate);
            return;
        }
        const exist = byContent.get(key);
        if (!exist) {
            byContent.set(key, candidate);
            result.push(candidate);
            return;
        }
        // 候选已按得分排序，先出现的得分更高，它当主来源
        exist.alternates = [...(exist.alternates ?? []), candidate];
    });
    return result;
}

/**
 * 找出可以用于歌词检索的插件。
 * 插件声明支持歌词检索时用歌词检索，否则退回歌曲检索——歌词候选本来就是歌
 */
function getLyricSearchPlugins(pluginHashes?: string[]): ILyricSearchTarget[] {
    const targets: ILyricSearchTarget[] = [];
    PluginManager.getSearchablePlugins().forEach((plugin) => {
        if (pluginHashes && !pluginHashes.includes(plugin.hash)) {
            return;
        }
        const types = (plugin.supportedSearchType ??
            []) as IMedia.SupportMediaType[];
        if (types.includes("lyric")) {
            targets.push({ plugin, type: "lyric" });
        } else if (types.includes("music")) {
            targets.push({ plugin, type: "music" });
        } else if (!types.length) {
            const fallback = plugin.defaultSearchType as
                | IMedia.SupportMediaType
                | undefined;
            targets.push({ plugin, type: fallback === "lyric" ? "lyric" : "music" });
        }
        // 只支持专辑 / 歌单检索的插件拿不到歌词候选
    });
    return targets;
}

/**
 * 在所有支持歌词搜索的插件里搜索候选，并按相似度排序
 */
export async function searchLyricCandidates(
    musicItem: ISmartLyricTarget,
    options?: ISmartSearchOptions,
): Promise<ISmartLyricCandidate[]> {
    const targets = getLyricSearchPlugins(options?.pluginHashes);
    if (!targets.length) {
        return [];
    }
    const queries = (options?.queries?.length
        ? options.queries
        : buildSearchQueries(musicItem)
    ).slice(0, maxSearchQueryCount);
    if (!queries.length) {
        return [];
    }

    const collected = new Map<string, ISmartLyricCandidate>();
    const stopWhenScore = options?.stopWhenScore;
    const goodScore = stopWhenScore ?? defaultGoodScore;
    // 提前结束时需要确认候选真的有歌词，同一个候选只查一次
    const lyricChecked = new Map<string, boolean>();
    const hasLyricCached = async (candidate: ISmartLyricCandidate) => {
        const key = getCandidateKey(candidate);
        if (!lyricChecked.has(key)) {
            lyricChecked.set(key, !!(await pickLyricSource(candidate)));
        }
        return lyricChecked.get(key) ?? false;
    };

    /** 被风控的插件先跳过，等恢复了再用 */
    const limitedUntil = new Map<string, number>();
    /** 与别的插件返回同一份结果的插件，后面不必再查 */
    const redundantPlugins = new Set<string>();
    /** 检索词与页码 -> 结果指纹，用来认出重复的来源 */
    const signatures = new Map<string, string>();
    let secondPageCount = 0;

    const collect = (
        response: { data?: unknown } | null | undefined,
        plugin: IPlugin.IPluginDelegate,
    ) => {
        const data = (response?.data ?? []) as ILyric.ILyricItem[];
        data.forEach((item) => {
            if (!item?.id) {
                return;
            }
            // 歌曲自身不需要匹配
            if (
                musicItem.platform &&
                musicItem.id &&
                item.platform === musicItem.platform &&
                item.id === musicItem.id
            ) {
                return;
            }
            const key = `${item.platform}@${item.id}`;
            if (collected.has(key)) {
                return;
            }
            const detail = scoreCandidate(item, musicItem);
            collected.set(key, {
                item,
                platform: item.platform,
                pluginHash: plugin.hash,
                score: detail.total,
                detail,
            });
        });
    };

    /** 是否已经有足够匹配、而且确实带歌词的候选 */
    const hasGoodCandidate = async () => {
        const best = [...collected.values()]
            .filter((it) => it.score >= goodScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, goodCandidateCheckCount);
        const flags = await Promise.all(best.map((it) => hasLyricCached(it)));
        return flags.some(Boolean);
    };

    /** 请求一页搜索结果 */
    const requestPage = async (
        query: string,
        page: number,
        plugin: IPlugin.IPluginDelegate,
        type: IMedia.SupportMediaType,
    ) => {
        try {
            const response = await PluginManager.callPluginDelegateMethod(
                plugin,
                "search",
                query,
                page,
                type,
            );
            return (response?.data ?? []) as ILyric.ILyricItem[];
        } catch (e) {
            console.log(e);
            return [];
        }
    };

    const runPage = async (query: string, page: number) => {
        for (const { plugin, type } of targets) {
            if (redundantPlugins.has(plugin.hash)) {
                continue;
            }
            if ((limitedUntil.get(plugin.hash) ?? 0) > Date.now()) {
                continue;
            }
            // 串行发起：几个插件可能共用同一个接口，
            // 同时打过去会有一半被风控挡掉
            await delay(searchQueryInterval);
            let items = await requestPage(query, page, plugin, type);
            if (!items.length) {
                // 空结果多半是被风控，等一会儿再试一次
                await delay(searchRetryInterval);
                items = await requestPage(query, page, plugin, type);
                if (!items.length) {
                    limitedUntil.set(
                        plugin.hash,
                        Date.now() + pluginLimitedDuration,
                    );
                    continue;
                }
            }
            limitedUntil.delete(plugin.hash);
            // 几个插件可能共用同一个接口，返回的是同一份结果，
            // 认出来之后就不用再花请求额度了
            const key = `${query}|${page}`;
            const signature = items
                .slice(0, 10)
                .map((it) => `${it.id}`)
                .join(",");
            const known = signatures.get(key);
            if (known !== undefined && known === signature) {
                redundantPlugins.add(plugin.hash);
                continue;
            }
            signatures.set(key, signature);
            collect({ data: items }, plugin);
        }
    };

    search: for (const query of queries) {
        await runPage(query, 1);
        // 得分高不代表有歌词，得确认真的能取到歌词才值得停下
        if (stopWhenScore !== undefined && (await hasGoodCandidate())) {
            break search;
        }
        // 歌名本身有大量翻唱版本时，原作会被挤到下一页去
        if (
            compoundQueryPattern.test(query) &&
            secondPageCount < maxSecondPageCount
        ) {
            secondPageCount++;
            await runPage(query, 2);
            if (stopWhenScore !== undefined && (await hasGoodCandidate())) {
                break search;
            }
        }
    }

    // 先按分数排，再按平台交错，避免单个插件刷屏
    const ranked = [...collected.values()].sort(
        (a, b) =>
            b.score - a.score ||
            a.pluginHash.localeCompare(b.pluginHash) ||
            a.platform.localeCompare(b.platform) ||
            a.item.id.localeCompare(b.item.id),
    );
    return interleaveByPlatform(mergeByContent(ranked)).slice(
        0,
        maxCandidateCount,
    );
}

/** 把候选与当前歌曲关联起来 */
export async function applyLyricCandidate(
    musicItem: IMusic.IMusicItem,
    candidate: ISmartLyricCandidate,
) {
    const source = await pickLyricSource(candidate);
    await linkLyric(musicItem, (source ?? candidate).item);
}

/** 候选歌曲是否真的能取到歌词 */
export async function hasLyric(candidate: ISmartLyricCandidate): Promise<boolean> {
    return !!(await pickLyricSource(candidate));
}

/** 某个来源能否取到歌词 */
async function fetchLyric(candidate: ISmartLyricCandidate) {
    try {
        const plugin = PluginManager.getPluginByHash(candidate.pluginHash);
        if (!plugin) {
            return false;
        }
        const source = await PluginManager.callPluginDelegateMethod(
            plugin,
            "getLyric",
            candidate.item,
        );
        return !isEmptyLyricSource(source?.rawLrc, source?.translation);
    } catch {
        return false;
    }
}

/**
 * 找出这个候选里真正能取到歌词的来源。
 * 同一首歌可能在多个插件里都有，主来源取不到时换一个再试
 */
async function pickLyricSource(
    candidate: ISmartLyricCandidate,
): Promise<ISmartLyricCandidate | null> {
    for (const source of [candidate, ...(candidate.alternates ?? [])]) {
        if (await fetchLyric(source)) {
            return source;
        }
    }
    return null;
}

/** 候选的唯一标识 */
export function getCandidateKey(candidate: ISmartLyricCandidate) {
    return `${candidate.platform}@${candidate.item.id}`;
}

/**
 * 检查靠前的候选是否真的有歌词。
 * 得分高的候选未必有歌词，这一步能把它们区分开
 */
export async function checkCandidateLyrics(
    candidates: ISmartLyricCandidate[],
    limit: number = maxLyricCheckCount,
): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    await runLimited(
        candidates.slice(0, limit),
        lyricCheckConcurrency,
        async (candidate) => {
            result.set(getCandidateKey(candidate), await hasLyric(candidate));
        },
    );
    return result;
}

/**
 * 找出得分最高且真的有歌词的候选
 */
export async function pickLyricCandidate(
    candidates: ISmartLyricCandidate[],
    minScore = 0,
    limit: number = maxLyricCheckCount,
): Promise<ISmartLyricCandidate | null> {
    // 候选是按平台交错排列的，这里要按得分从高到低找
    const targets = candidates
        .filter((it) => it.score >= minScore)
        .sort((a, b) => b.score - a.score);
    if (!targets.length) {
        return null;
    }
    const checked = await checkCandidateLyrics(targets, limit);
    for (const candidate of targets) {
        if (checked.get(getCandidateKey(candidate))) {
            return candidate;
        }
    }
    return null;
}

/**
 * 用一段识别出来的歌名去搜索候选。
 * 识别结果不一定对应某个插件里的歌曲，所以不写入搜索记录
 */
export async function searchLyricCandidatesByText(
    title: string,
    artist?: string,
): Promise<ISmartLyricCandidate[]> {
    return await searchLyricCandidates({ title, artist });
}

/** 是否已经尝试过智能匹配 */
export function hasSearched(musicItem: IMusic.IMusicItem) {
    return smartLyricStore.getValue().searched.includes(
        getMediaPrimaryKey(musicItem),
    );
}

/** 标记为已搜索过，避免重复请求 */
export function markSearched(musicItem: IMusic.IMusicItem) {
    const pk = getMediaPrimaryKey(musicItem);
    smartLyricStore.setValue((prev) => {
        if (prev.searched.includes(pk)) {
            return prev;
        }
        const searched = [...prev.searched, pk];
        return {
            ...prev,
            searched:
                searched.length > 200 ? searched.slice(searched.length - 200) : searched,
        };
    });
}

/** 搜索没找到东西时撤销标记，下次播放还能再试 */
export function unmarkSearched(musicItem: IMusic.IMusicItem) {
    const pk = getMediaPrimaryKey(musicItem);
    smartLyricStore.setValue((prev) => {
        if (!prev.searched.includes(pk)) {
            return prev;
        }
        return {
            ...prev,
            searched: prev.searched.filter((it) => it !== pk),
        };
    });
}

/** 记录搜索结果 */
export function recordCandidates(
    musicItem: IMusic.IMusicItem,
    candidates: ISmartLyricCandidate[],
) {
    const pk = getMediaPrimaryKey(musicItem);
    smartLyricStore.setValue((prev) => ({
        ...prev,
        candidates: {
            ...prev.candidates,
            [pk]: candidates,
        },
    }));
}

/** 读取已保存的候选 */
export function getCandidates(
    musicItem: IMusic.IMusicItem,
): ISmartLyricCandidate[] {
    return (
        smartLyricStore.getValue().candidates[getMediaPrimaryKey(musicItem)] ??
        []
    );
}

/** 清空某首歌的搜索记录，用于重新搜索 */
export function clearSearched(musicItem: IMusic.IMusicItem) {
    const pk = getMediaPrimaryKey(musicItem);
    smartLyricStore.setValue((prev) => ({
        searched: prev.searched.filter((it) => it !== pk),
        candidates: {
            ...prev.candidates,
            [pk]: [],
        },
    }));
}
