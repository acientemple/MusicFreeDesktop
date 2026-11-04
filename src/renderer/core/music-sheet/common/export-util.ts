import { musicRefSymbol } from "@/common/constant";

/** Windows 文件名非法字符 */
const ILLEGAL_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * 导出时的歌单结构。
 * 故意放宽：歌单对象有多种来源（数据库里的 IDBMusicSheetItem 只存 id，
 * 补全后的详情才是完整歌曲），这里只关心导出真正用到的字段。
 */
interface IExportSheet {
    title?: string;
    musicList?: any[];
    [k: string]: any;
}

/**
 * 清洗歌单，供导出使用。
 * 剔除已失效的歌曲项（数据库里查不到时会是 undefined，序列化后变成 null，
 * 回导时会让整张歌单的歌曲被静默丢弃），并去掉内部引用计数字段。
 */
export function sanitizeSheetForExport(
    sheet: IExportSheet,
): IExportSheet {
    const musicList = (sheet.musicList ?? []).filter(
        (item) => Boolean(item && item.platform && item.id),
    );
    return {
        ...sheet,
        musicList: musicList.map((item) => {
            const rest = { ...item };
            delete rest[musicRefSymbol];
            return rest;
        }),
    };
}

/** 构建可被「恢复歌单」读回的备份 JSON */
export function buildSheetBackupJson(sheets: IExportSheet[]): string {
    return JSON.stringify({
        musicSheets: sheets.map(sanitizeSheetForExport),
    });
}

/** 生成导出文件名 */
export function buildExportFileName(title?: string): string {
    const now = new Date();
    const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const cleaned = String(title ?? "")
        .replace(ILLEGAL_FILE_NAME_CHARS, "_")
        .replace(/[. ]+$/, "")
        .trim()
        .slice(0, 60);
    return `MusicFree-${cleaned || "playlist"}-${date}.json`;
}
