import Store from "@/common/store";

interface IMVPlayerInfo {
    visible: boolean;
    musicItem?: IMusic.IMusicItem;
    /** 画面来源；搜索 MV 时与音频不是同一条 */
    videoItem?: IMusic.IMusicItem;
    quality?: IMusic.IQualityKey;
}

const mvPlayerStore = new Store<IMVPlayerInfo>({
    visible: false,
});

export function showMVPlayer(payload: {
    musicItem?: IMusic.IMusicItem;
    videoItem?: IMusic.IMusicItem;
    quality?: IMusic.IQualityKey;
}) {
    mvPlayerStore.setValue({
        visible: true,
        ...payload,
    });
}

export function hideMVPlayer() {
    mvPlayerStore.setValue({
        visible: false,
    });
}

export function useMVPlayerState() {
    return mvPlayerStore.useValue();
}

export default mvPlayerStore;
