declare namespace ICommon {
  export type WithMusicList<T> = T & {
    musicList?: IMusic.IMusicItem[];
  };

  export type PaginationResponse<T> = {
    isEnd?: boolean;
    data?: T[];
  };

  interface IUpdateInfo {
    version: string;
    update?: {
      version: string;
      changeLog: string[];
      download: string[];
      /** 是否是预发布版本 */
      prerelease?: boolean;
      /** Release 页面地址 */
      releasePage?: string;
      /** 当前平台对应的资产文件名 */
      assetName?: string;
      /** 资产大小（字节） */
      assetSize?: number;
      /** 当前环境是否支持一键安装 */
      installable?: boolean;
    };
  }

  interface IUpdaterProgress {
    /** 0 ~ 1 */
    percent: number;
    /** 已下载字节数 */
    downloaded: number;
    /** 总字节数，未知时为 0 */
    total: number;
    /** 字节/秒 */
    speed: number;
  }

  type IUpdaterStatus =
    | "idle"
    | "downloading"
    | "ready"
    | "installing"
    | "error"
    | "done";

  interface IPoint {
    x: number;
    y: number;
  }

  interface ISize {
    width: number;
    height: number;
  }

  interface IThemePack {
    id?: string;
    /** 主题 */
    name: string;
    /** 加载之后的路径，内部属性 */
    hash?: string;
    path: string;
    /** 缩略图 */
    thumb?: string;
    /** 预览图 */
    preview: string;
    /** 主题更新链接 */
    srcUrl?: string;
    /** 主题作者 */
    author?: string;
    /** 版本号 */
    version?: string;
    description?: string;
    iframe?: Record<
      "app" | "header" | "body" | "music-bar" | "side-bar" | "page",
      string
    >;
  }

  interface IDownloadFileSize {
    /** 当前下载的大小 */
    currentSize?: number;
    /** 总大小 */
    totalSize?: number;
  }

  type ICommonReturnType = [
    boolean,
    {
      msg?: string;
      [k: string]: any;
    }?
  ];

  interface ICommand {
    SetPlayerState: PlayerState;
    SkipToPrevious: void;
    SkipToNext: void;
    SetRepeatMode: RepeatMode;
    PlayMusic: IMusic.IMusicItem;
  }

  type ICommandKey = keyof ICommand;
}
