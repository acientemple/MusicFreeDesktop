import {
    getInternalData,
    getMediaPrimaryKey,
    setInternalData,
} from "@/common/media-util";
import { LRUCache } from "lru-cache";
import musicSheetDB from "../db/music-sheet-db";
import PluginManager from "@shared/plugin-manager/renderer";

const linkLyricCache = new LRUCache({
    max: 500,
    allowStale: false,
});

const linkLyricTextCache = new LRUCache<string, ILinkedLyricText>({
    max: 500,
    allowStale: false,
});

const linkLyricKey = "associatedLrc";
const linkLyricTextKey = "associatedLrcText";

export interface ILinkedLyricText {
    rawLrc: string;
    translation?: string;
}

export async function linkLyric(
    from: IMusic.IMusicItem,
    to: IMusic.IMusicItem,
) {
    // 如果歌曲已经入库，更新数据库中的meta信息
    const filteredMusicItem: IMedia.IUnique = {
        platform: to.platform,
        id: to.id,
    };
    for (const toPk of PluginManager.getPluginPrimaryKey(to)) {
        filteredMusicItem[toPk] = to[toPk];
    }
    const fromPk = getMediaPrimaryKey(from);
    linkLyricCache.set(fromPk, filteredMusicItem);

    try {
        await musicSheetDB.transaction("rw", musicSheetDB.musicStore, async () => {
            const musicItem = await musicSheetDB.musicStore.get([
                from.platform,
                from.id,
            ]);
            if (musicItem) {
                await musicSheetDB.musicStore.put(
                    setInternalData(musicItem, linkLyricKey, filteredMusicItem, true),
                );
            }
        });
    } catch (e) {
        console.log(e);
    }
}

export async function unlinkLyric(musicItem: IMusic.IMusicItem) {
    const pk = getMediaPrimaryKey(musicItem);
    const cachedItem = linkLyricCache.get(pk);
    if (cachedItem) {
        linkLyricCache.delete(pk);
    }

    try {
        await musicSheetDB.transaction("rw", musicSheetDB.musicStore, async () => {
            const dbMusicItem = await musicSheetDB.musicStore.get([
                musicItem.platform,
                musicItem.id,
            ]);
            if (dbMusicItem) {
                await musicSheetDB.musicStore.put(
                    setInternalData(dbMusicItem, linkLyricKey, undefined, true),
                );
                await musicSheetDB.musicStore.put(
                    setInternalData(
                        dbMusicItem,
                        linkLyricTextKey,
                        undefined,
                        true,
                    ),
                );
            }
        });
    } catch {}
}

/** 直接把一段歌词文本关联到歌曲上（声音识别等场景） */
export async function linkLyricText(
    from: IMusic.IMusicItem,
    text: ILinkedLyricText,
) {
    const fromPk = getMediaPrimaryKey(from);
    linkLyricTextCache.set(fromPk, text);

    try {
        await musicSheetDB.transaction("rw", musicSheetDB.musicStore, async () => {
            const musicItem = await musicSheetDB.musicStore.get([
                from.platform,
                from.id,
            ]);
            if (musicItem) {
                await musicSheetDB.musicStore.put(
                    setInternalData(musicItem, linkLyricTextKey, text, true),
                );
            }
        });
    } catch (e) {
        console.log(e);
    }
}

/** 读取关联的歌词文本 */
export async function getLinkedLyricText(
    musicItem: IMusic.IMusicItem,
): Promise<ILinkedLyricText | null> {
    const pk = getMediaPrimaryKey(musicItem);

    const cached = linkLyricTextCache.get(pk);
    if (cached) {
        return cached;
    }
    try {
        const result = await musicSheetDB.transaction(
            "r",
            musicSheetDB.musicStore,
            async () => {
                const dbMusicItem = await musicSheetDB.musicStore.get([
                    musicItem.platform,
                    musicItem.id,
                ]);
                if (dbMusicItem) {
                    return getInternalData<
                        Record<typeof linkLyricTextKey, ILinkedLyricText>,
                        typeof linkLyricTextKey
                    >(dbMusicItem, linkLyricTextKey);
                }
            },
        );
        if (result) {
            linkLyricTextCache.set(pk, result);
            return result;
        }
    } catch (e) {
        console.log(e);
    }
    return null;
}

export async function getLinkedLyric(musicItem: IMusic.IMusicItem) {
    const pk = getMediaPrimaryKey(musicItem);

    const cachedItem = linkLyricCache.get(pk);

    if (cachedItem) {
        return cachedItem as IMusic.IMusicItem;
    }
    try {
        const result = await musicSheetDB.transaction(
            "r",
            musicSheetDB.musicStore,
            async () => {
                const dbMusicItem = await musicSheetDB.musicStore.get([
                    musicItem.platform,
                    musicItem.id,
                ]);
                if (dbMusicItem) {
                    const linkedLyric = getInternalData(dbMusicItem, linkLyricKey);
                    return linkedLyric;
                }
            },
        );
        if (result) {
            linkLyricCache.set(pk, result);
            return result;
        }
    } catch (e) {
        console.log(e);
    }
    return null;
}
