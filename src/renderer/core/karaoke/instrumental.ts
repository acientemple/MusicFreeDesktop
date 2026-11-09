/**
 * 伴奏候选
 *
 * 唱卡拉OK 时可以挑一个伴奏版本：挨个问一遍支持 getMusicInstrumentals
 * 的插件，把它们给的候选合并、去重、排个序。
 */

import PluginManager from "@shared/plugin-manager/renderer";
import trackPlayer from "@renderer/core/track-player";

/** 伴奏候选条目 */
export interface IInstrumentalCandidate extends IMusic.IMusicItem {
    /** 是不是原唱歌手发布的伴奏 */
    isOriginArtist?: boolean;
    /** 与原曲的时长差（秒） */
    durationDelta?: number | null;
}

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
 * 去重并排序：
 * 同一首歌在几个平台重复上传的只留一条，
 * 原唱歌手的伴奏排前面，时长差小的排前面
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
        }
    }
    return Array.from(seen.values()).sort((a, b) => {
        if (!!b.isOriginArtist !== !!a.isOriginArtist) {
            return b.isOriginArtist ? 1 : -1;
        }
        const diffA = Math.abs(Number(a.durationDelta) || 0);
        const diffB = Math.abs(Number(b.durationDelta) || 0);
        if (diffA !== diffB) {
            return diffA - diffB;
        }
        return String(a.title ?? "").localeCompare(String(b.title ?? ""));
    });
}

/**
 * 换到某个伴奏候选。
 * 候选只是另一首歌，得自己再取一次音源
 */
export async function switchToInstrumental(
    candidate: IInstrumentalCandidate,
): Promise<boolean> {
    if (!candidate?.platform || !candidate?.id) {
        return false;
    }
    const quality = trackPlayer.currentQuality;
    const source = await PluginManager.callPluginDelegateMethod(
        { platform: candidate.platform },
        "getMediaSource",
        candidate,
        quality,
    );
    if (!source?.url) {
        return false;
    }
    return trackPlayer.switchAudioSource(source);
}
