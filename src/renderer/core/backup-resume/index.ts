import MusicSheet from "../music-sheet";

/**
 * 剔除失效的歌曲项。备份里可能存着 null（歌曲已被删除），
 * 直接导入会让 addMusicToSheet 抛错并静默丢掉整张歌单的歌曲。
 */
function validMusicList(musicList?: IMusic.IMusicItem[]) {
    return (musicList ?? []).filter((item) =>
        Boolean(item && item.platform && item.id),
    );
}

/**
 * 恢复
 * @param data 数据
 * @param overwrite 是否覆写歌单
 */
async function resume(data: string | Record<string, any>, overwrite?: boolean) {
    const dataObj = typeof data === "string" ? JSON.parse(data) : data;

    const currentSheets = MusicSheet.frontend.getAllSheets();
    const allSheets: IMusic.IMusicSheetItem[] = dataObj.musicSheets;

    let importedDefaultSheet;
    for (const sheet of allSheets) {
        if (sheet.id === MusicSheet.defaultSheet.id) {
            // 默认歌单不新建同名副本，统一并入「我喜欢」
            importedDefaultSheet = sheet;
            continue;
        }
        const newSheet = await MusicSheet.frontend.addSheet(sheet.title);
        await MusicSheet.frontend.addMusicToSheet(
            validMusicList(sheet.musicList),
            newSheet.id,
        );
    }
    if (importedDefaultSheet) {
        if (overwrite) {
            await MusicSheet.frontend.clearSheet(MusicSheet.defaultSheet.id);
        }
        await MusicSheet.frontend.addMusicToFavorite(
            validMusicList(importedDefaultSheet.musicList),
        );
    }
    if (overwrite) {
        for (const sheet of currentSheets) {
            await MusicSheet.frontend.removeSheet(sheet.id);
        }
    }
}

const BackupResume = {
    resume,
};
export default BackupResume;
