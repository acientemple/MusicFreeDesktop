import Store from "@/common/store";
import { ICandidateScore } from "@/common/lyric-util";

export interface ISmartLyricCandidate {
    /** 候选歌曲信息 */
    item: IMusic.IMusicItem;
    /** 候选所属平台 */
    platform: string;
    /** 提供候选的插件 */
    pluginHash: string;
    /** 综合得分 */
    score: number;
    /** 各维度得分 */
    detail: ICandidateScore;
    /** 同一首歌在其它插件里的来源，取歌词失败时可以换一个再试 */
    alternates?: ISmartLyricCandidate[];
}

interface ISmartLyricState {
    /** 已经尝试过智能匹配的歌曲主键 */
    searched: string[];
    /** 候选结果，按歌曲主键索引 */
    candidates: Record<string, ISmartLyricCandidate[]>;
}

/** 最多保留多少条搜索记录 */
const maxSearchedCount = 200;

const smartLyricStore = new Store<ISmartLyricState>({
    searched: [],
    candidates: {},
});

export default smartLyricStore;
