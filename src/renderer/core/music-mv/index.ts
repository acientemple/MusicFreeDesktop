/**
 * 歌曲与 MV 的绑定：用户挑过一个 MV 之后就记住它，
 * 下次直接看同一个，不用再搜一遍。绑定写进本地数据库，重启后依然有效。
 */

import { getMediaPrimaryKey } from "@/common/media-util";
import Store from "@/common/store";
import musicSheetDB from "@/renderer/core/db/music-sheet-db";

/** 内存缓存，key 为 platform@id */
const mvMap = new Map<string, IMusic.IMusicItem>();
/** 供界面订阅用 */
const mvStore = new Store<Record<string, IMusic.IMusicItem>>({});

function notify() {
    const obj: Record<string, IMusic.IMusicItem> = {};
    mvMap.forEach((value, key) => {
        obj[key] = value;
    });
    mvStore.setValue(obj);
}

/** 启动时把绑定读进内存 */
export async function setupMusicMv() {
    try {
        const all = await musicSheetDB.musicMv.toArray();
        mvMap.clear();
        all.forEach((item) => {
            mvMap.set(getMediaPrimaryKey(item), item.mv);
        });
        notify();
    } catch (e) {
        console.log(e);
    }
}

/** 订阅绑定关系的变化 */
export function useMusicMv() {
    return mvStore.useValue();
}

/** 取某首歌绑定的 MV */
export function getMusicMv(
    musicItem?: IMedia.IMediaBase | null,
): IMusic.IMusicItem | null {
    if (!musicItem) {
        return null;
    }
    return mvMap.get(getMediaPrimaryKey(musicItem)) ?? null;
}

/** 记住这首歌挑的 MV */
export async function setMusicMv(
    musicItem: IMusic.IMusicItem,
    mv: IMusic.IMusicItem,
) {
    const key = getMediaPrimaryKey(musicItem);
    await musicSheetDB.musicMv.put({
        platform: musicItem.platform,
        id: musicItem.id,
        mv,
    });
    mvMap.set(key, mv);
    notify();
}

/** 不再用 MV */
export async function clearMusicMv(musicItem: IMusic.IMusicItem) {
    const key = getMediaPrimaryKey(musicItem);
    await musicSheetDB.musicMv.delete([musicItem.platform, musicItem.id]);
    mvMap.delete(key);
    notify();
}
