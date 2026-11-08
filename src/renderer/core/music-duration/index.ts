/**
 * 歌曲时长校正：
 *
 * 插件给的时长并不总是可靠的 —— 有的插件用毫秒当秒返回，有的干脆不返回，
 * 有的还返回了另一首歌的长度。真正准的时长是音频文件本身的长度，
 * 所以这里以「实际播出来的音频长度」为准做校正，校正结果写进本地数据库，
 * 之后歌单、播放列表里显示的就是校正后的时长。
 */

import { getMediaPrimaryKey } from "@/common/media-util";
import Store from "@/common/store";
import musicSheetDB from "@/renderer/core/db/music-sheet-db";

/** 超过这个秒数（3 小时）基本可以断定是把毫秒当成秒了 */
const MAX_PLAUSIBLE_DURATION = 3 * 60 * 60;
/** 播出来的音频比标称时长短这么多，说明是试听片段，不拿它当歌曲时长 */
const PREVIEW_RATIO = 0.6;
/** 两者相差在这个范围内才算同一首歌，差得太多就以插件给的为准 */
const SAME_SONG_RATIO = 0.7;

/** 内存缓存，key 为 platform@id */
const durationMap = new Map<string, number>();
/** 供界面订阅用 */
const durationStore = new Store<Record<string, number>>({});

function notify() {
    const obj: Record<string, number> = {};
    durationMap.forEach((value, key) => {
        obj[key] = value;
    });
    durationStore.setValue(obj);
}

/** 启动时把校正过的时长读进内存 */
export async function setupMusicDuration() {
    try {
        const all = await musicSheetDB.musicDuration.toArray();
        durationMap.clear();
        all.forEach((item) => {
            durationMap.set(getMediaPrimaryKey(item), item.duration);
        });
        notify();
    } catch (e) {
        console.log(e);
    }
}

/** 订阅校正结果的变化 */
export function useVerifiedDurations() {
    return durationStore.useValue();
}

/** 取某首歌校正后的时长 */
export function getVerifiedDuration(
    musicItem?: IMedia.IMediaBase | null,
): number | undefined {
    if (!musicItem) {
        return undefined;
    }
    return durationMap.get(getMediaPrimaryKey(musicItem));
}

/**
 * 把插件给的时长归一化成秒。
 * 毫秒写成了秒的情况很常见（数值大得离谱），这里一并纠正。
 */
export function normalizeDuration(duration?: number | null): number | undefined {
    if (typeof duration !== "number" || !isFinite(duration) || duration <= 0) {
        return undefined;
    }
    if (duration > MAX_PLAUSIBLE_DURATION) {
        const asMs = duration / 1000;
        if (asMs > 0 && asMs <= MAX_PLAUSIBLE_DURATION) {
            return Math.round(asMs);
        }
        return undefined;
    }
    return Math.round(duration);
}

/** 记下这首歌的时长 */
export async function setVerifiedDuration(
    musicItem: IMusic.IMusicItem,
    duration: number,
) {
    const normalized = normalizeDuration(duration);
    if (!normalized) {
        return;
    }
    const key = getMediaPrimaryKey(musicItem);
    const old = durationMap.get(key);
    if (old !== undefined && Math.abs(old - normalized) < 1) {
        return;
    }
    try {
        await musicSheetDB.musicDuration.put({
            platform: musicItem.platform,
            id: musicItem.id,
            duration: normalized,
        });
    } catch (e) {
        console.log(e);
    }
    durationMap.set(key, normalized);
    notify();
}

/** 恢复成插件给的时长 */
export async function clearVerifiedDuration(musicItem: IMusic.IMusicItem) {
    const key = getMediaPrimaryKey(musicItem);
    try {
        await musicSheetDB.musicDuration.delete([musicItem.platform, musicItem.id]);
    } catch (e) {
        console.log(e);
    }
    durationMap.delete(key);
    notify();
}

/**
 * 用实际播出来的音频长度校正歌曲时长。
 *
 * @param musicItem 正在播放的歌曲
 * @param measuredDuration 音频元素的实际时长（秒）
 * @returns 是否做了校正
 */
export async function correctDurationByMeasured(
    musicItem: IMusic.IMusicItem | null | undefined,
    measuredDuration: number,
): Promise<boolean> {
    if (!musicItem || !isFinite(measuredDuration) || measuredDuration <= 0) {
        return false;
    }
    const declared = normalizeDuration(musicItem.duration);
    if (declared) {
        const ratio = measuredDuration / declared;
        // 明显是试听片段或者另一首歌，别拿它覆盖
        if (ratio < PREVIEW_RATIO || ratio > 1 / PREVIEW_RATIO) {
            return false;
        }
        // 差得不多就不用改了
        if (Math.abs(measuredDuration - declared) <= 2) {
            return false;
        }
        // 差得太离谱（超过 1.4 倍）多半不是同一首歌
        if (ratio < SAME_SONG_RATIO || ratio > 1 / SAME_SONG_RATIO) {
            return false;
        }
    } else if (measuredDuration < 30) {
        // 插件没给时长，测到的又太短，多半是片段而不是整首歌
        return false;
    }
    await setVerifiedDuration(musicItem, measuredDuration);
    return true;
}

/**
 * 展示用的时长：优先用校正过的，没有就用插件给的（归一化后）。
 */
export function getDisplayDuration(
    musicItem?: IMedia.IMediaBase | null,
): number | undefined {
    if (!musicItem) {
        return undefined;
    }
    return getVerifiedDuration(musicItem) ?? normalizeDuration(musicItem.duration);
}
