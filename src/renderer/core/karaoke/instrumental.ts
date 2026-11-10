/**
 * 伴奏候选
 *
 * 唱卡拉OK 时可以挑一个伴奏版本：挨个问一遍支持 getMusicInstrumentals
 * 的插件，把它们给的候选合并、去重、排个序。
 */

import PluginManager from "@shared/plugin-manager/renderer";

/**
 * 伴奏候选条目。
 * 除了音乐条目的基本信息，还带几个用于挑选的标记：
 * isKaraoke（卡拉OK伴唱，人声可分离）、hasMv（带 MV 画面）
 */
export type IInstrumentalCandidate = IPlugin.IMusicInstrumentalItem;

/**
 * 取这首歌的伴奏候选
 */
export async function fetchInstrumentalCandidates(
    musicItem: IMusic.IMusicItem,
): Promise<IInstrumentalCandidate[]> {
    if (!musicItem?.platform || !musicItem?.id) {
        return [];
    }
    const supports = PluginManager.getSupportedPlugin("getMusicInstrumentals");
    if (!supports.length) {
        return [];
    }
    const settled = await Promise.allSettled(
        supports.map((plugin) =>
            PluginManager.callPluginDelegateMethod(
                { platform: plugin.platform, hash: plugin.hash },
                "getMusicInstrumentals",
                musicItem,
                1,
            ),
        ),
    );
    const merged: IInstrumentalCandidate[] = [];
    for (const result of settled) {
        if (result.status === "fulfilled" && result.value?.data) {
            merged.push(...(result.value.data as IInstrumentalCandidate[]));
        }
    }
    return dedupeCandidates(merged);
}

/**
 * 候选排序用的权重。
 * 优先给「人声可分离」和「带 MV」的资源：
 * 卡拉OK伴唱 > 原唱伴奏 > 普通伴奏，带 MV 的再往前挪一挪
 */
function candidateScore(item: IInstrumentalCandidate): number {
    let score = 0;
    if (item.isKaraoke) {
        score += 4;
    }
    if (item.hasMv) {
        score += 2;
    }
    if (item.isOriginArtist) {
        score += 1;
    }
    return score;
}

/**
 * 去重并排序：
 * 同一首歌在几个平台重复上传的只留一条，
 * 卡拉OK伴唱与带 MV 的排前面，原唱歌手的伴奏排前面，时长差小的排前面
 */
export function dedupeCandidates(
    candidates: IInstrumentalCandidate[],
): IInstrumentalCandidate[] {
    const seen = new Map<string, IInstrumentalCandidate>();
    for (const item of candidates) {
        if (!item?.id || !item?.platform) {
            continue;
        }
        const key = [
            item.platform,
            String(item.title ?? "").trim(),
            String(item.artist ?? "").trim(),
            Math.round(Number(item.duration) || 0),
        ].join("|");
        const existing = seen.get(key);
        if (!existing) {
            seen.set(key, item);
            continue;
        }
        // 同一首歌保留信息更全的那条
        if (!existing.url && item.url) {
            seen.set(key, item);
        } else if (
            !existing.isKaraoke &&
            item.isKaraoke
        ) {
            // 标记更明确的优先
            seen.set(key, {
                ...existing,
                isKaraoke: item.isKaraoke,
                hasMv: existing.hasMv || item.hasMv,
            });
        }
    }
    return Array.from(seen.values()).sort((a, b) => {
        const scoreA = candidateScore(a);
        const scoreB = candidateScore(b);
        if (scoreA !== scoreB) {
            return scoreB - scoreA;
        }
        const diffA = Math.abs(Number(a.durationDelta) || 0);
        const diffB = Math.abs(Number(b.durationDelta) || 0);
        if (diffA !== diffB) {
            return diffA - diffB;
        }
        return String(a.title ?? "").localeCompare(String(b.title ?? ""));
    });
}
