/**
 * 歌曲信息覆盖：用户手动改过标题/作者/专辑后，原始数据仍在插件那边，
 * 这里只保存「被改过的字段」，展示层套用即可。
 */

import { getMediaPrimaryKey } from "@/common/media-util";
import Store from "@/common/store";
import musicSheetDB from "@/renderer/core/db/music-sheet-db";

export type IMetaField = "title" | "artist" | "album";

const metaFields: IMetaField[] = ["title", "artist", "album"];

/** 内存缓存，key 为 platform@id */
const metaMap = new Map<string, IMusic.IMusicMetaItem>();
/** 供界面订阅用 */
const metaStore = new Store<Record<string, IMusic.IMusicMetaItem>>({});

function notify() {
    const obj: Record<string, IMusic.IMusicMetaItem> = {};
    metaMap.forEach((value, key) => {
        obj[key] = value;
    });
    metaStore.setValue(obj);
}

/** 启动时把覆盖信息读进内存 */
export async function setupMusicMeta() {
    try {
        const all = await musicSheetDB.musicMeta.toArray();
        metaMap.clear();
        all.forEach((item) => {
            metaMap.set(getMediaPrimaryKey(item), item);
        });
        notify();
    } catch (e) {
        console.log(e);
    }
}

/** 订阅覆盖信息的变化 */
export function useMusicMeta() {
    return metaStore.useValue();
}

/** 取某首歌的覆盖信息 */
export function getMusicMeta(
    musicItem?: IMedia.IMediaBase | null,
): IMusic.IMusicMetaItem | null {
    if (!musicItem) {
        return null;
    }
    return metaMap.get(getMediaPrimaryKey(musicItem)) ?? null;
}

/** 套用覆盖信息，返回新对象，不修改原对象 */
export function applyMusicMeta<T extends IMusic.IMusicItem>(musicItem: T): T {
    const meta = getMusicMeta(musicItem);
    if (!meta) {
        return musicItem;
    }
    const newItem = { ...musicItem };
    metaFields.forEach((field) => {
        const value = meta[field];
        if (value !== undefined) {
            newItem[field] = value;
        }
    });
    return newItem;
}

/** 批量套用覆盖信息 */
export function applyMusicMetaToList<T extends IMusic.IMusicItem>(
    musicList: T[],
): T[] {
    if (!metaMap.size) {
        return musicList;
    }
    return musicList.map((item) => applyMusicMeta(item));
}

/**
 * 保存覆盖信息，override 里只放要改的字段
 * 没放的字段表示「恢复原始信息」
 */
export async function setMusicMeta(
    musicItem: IMusic.IMusicItem,
    override: Partial<Record<IMetaField, string>>,
) {
    const key = getMediaPrimaryKey(musicItem);
    const merged: IMusic.IMusicMetaItem = {
        platform: musicItem.platform,
        id: musicItem.id,
    };
    const changed: IMetaField[] = [];
    metaFields.forEach((field) => {
        const value = override[field];
        if (value !== undefined) {
            merged[field] = value;
            changed.push(field);
        }
    });

    if (!changed.length) {
        await clearMusicMeta(musicItem);
        return;
    }
    await musicSheetDB.musicMeta.put(merged);
    metaMap.set(key, merged);
    notify();
}

/** 恢复默认信息 */
export async function clearMusicMeta(musicItem: IMusic.IMusicItem) {
    const key = getMediaPrimaryKey(musicItem);
    await musicSheetDB.musicMeta.delete([musicItem.platform, musicItem.id]);
    metaMap.delete(key);
    notify();
}
