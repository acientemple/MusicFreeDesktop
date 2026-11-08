/**
 * 定位歌曲在列表中的位置：
 *
 * 在播放队列里点一首歌时，找到它所在的歌单，跳过去并把那一行滚到眼前、
 * 选中它，这样就不用自己在歌单里翻找了。
 */

import { getMediaPrimaryKey } from "@/common/media-util";
import Store from "@/common/store";

interface ILocateTarget {
    /** platform@id */
    key: string;
    /** 要定位到哪个歌单（id），只有这个歌单里的列表才会响应 */
    sheetId?: string;
    /** 每次请求都会变，用来触发订阅方 */
    nonce: number;
}

const locateStore = new Store<ILocateTarget>({
    key: "",
    nonce: 0,
});

/** 请求定位到某首歌（指定歌单） */
export function requestLocateMusic(
    musicItem: IMedia.IMediaBase,
    sheetId?: string,
) {
    const current = locateStore.getValue();
    locateStore.setValue({
        key: getMediaPrimaryKey(musicItem),
        sheetId,
        nonce: current.nonce + 1,
    });
}

/** 定位到了就清掉，免得以后打开同一个列表又乱跳 */
export function clearLocateTarget() {
    const current = locateStore.getValue();
    if (!current.key) {
        return;
    }
    locateStore.setValue({
        key: "",
        nonce: current.nonce + 1,
    });
}

/** 订阅定位请求 */
export function useLocateTarget() {
    return locateStore.useValue();
}
