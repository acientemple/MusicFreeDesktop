import { musicRefSymbol } from "@/common/constant";
import Dexie, { Table } from "dexie";

class MusicSheetDB extends Dexie {
    // 歌单信息，其中musiclist只存有platform和id
    sheets: Table<IMusic.IDBMusicSheetItem>;
    // musicstore 存有歌单内保存所有的音乐信息
    musicStore: Table<
    IMusic.IMusicItem & {
        [musicRefSymbol]: number; // 某个歌曲在歌单中被引用几次，数字
    }
    >;
    localMusicStore: Table<IMusic.IMusicItem & {
        $$localPath: string; // 本地地址
    }>;
    /** 用户手动改过的歌曲信息，只存被改过的字段 */
    musicMeta: Table<IMusic.IMusicMetaItem>;
    /** 歌曲挑定的 MV */
    musicMv: Table<IMusic.IMusicMvItem>;
    /** 校正过的歌曲时长 */
    musicDuration: Table<IMusic.IMusicDurationItem>;

    constructor() {
        super("musicSheetDB");
        this.version(1.1).stores({
            sheets: "&id, title, artist, createAt, $$sortIndex",
            musicStore: "[platform+id], title, artist, album",
            /** 本地音乐 */
            localMusicStore: "[platform+id], title, artist, album, $$localPath",
        });
        this.version(1.2).stores({
            sheets: "&id, title, artist, createAt, $$sortIndex",
            musicStore: "[platform+id], title, artist, album",
            /** 本地音乐 */
            localMusicStore: "[platform+id], title, artist, album, $$localPath",
            /** 歌曲信息覆盖 */
            musicMeta: "[platform+id]",
        });
        this.version(1.3).stores({
            sheets: "&id, title, artist, createAt, $$sortIndex",
            musicStore: "[platform+id], title, artist, album",
            /** 本地音乐 */
            localMusicStore: "[platform+id], title, artist, album, $$localPath",
            /** 歌曲信息覆盖 */
            musicMeta: "[platform+id]",
            /** 歌曲挑定的 MV */
            musicMv: "[platform+id]",
        });
        this.version(1.4).stores({
            sheets: "&id, title, artist, createAt, $$sortIndex",
            musicStore: "[platform+id], title, artist, album",
            /** 本地音乐 */
            localMusicStore: "[platform+id], title, artist, album, $$localPath",
            /** 歌曲信息覆盖 */
            musicMeta: "[platform+id]",
            /** 歌曲挑定的 MV */
            musicMv: "[platform+id]",
            /** 校正过的歌曲时长 */
            musicDuration: "[platform+id]",
        });
    }
}

const musicSheetDB = new MusicSheetDB();
export default musicSheetDB;
