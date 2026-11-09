# MusicFree Desktop（本地定制版）

基于上游 `maotoumao/MusicFreeDesktop` v0.0.8 的本地定制版，在上游基础上增加了 MV 播放/搜索、
歌词增强、歌曲信息编辑、时长校正、窗口置顶等能力。

## 目录关系（最容易搞混的部分）

| 位置 | 作用 |
| --- | --- |
| `D:\work\MusicFreeDesktop` | **源码仓库**（改代码在这里） |
| `D:\work\MusicFreeDesktop\out\MusicFree-win32-x64` | 打包产物 |
| `D:\BaiduYunDownload\Softwares\MusicFree-0.0.8-win32-x64-portable` | 用户实际在用的便携版 |
| `…\portable\userData` | 用户的插件、设置、数据库，**发布时不要动** |
| `D:\work\OneDrive\Desktop\MusicFree-0.0.8-win32-x64-portable` | 改动前的原始构建，可作回滚备份 |

便携版靠 exe 同级的 `portable/` 目录存放用户数据（见 `src/main/index.ts` 的 portable 逻辑）。

## 改完代码之后怎么发布

```bash
npx tsc --noEmit            # 类型检查
npm run package             # electron-forge 打包到 out/
robocopy out\MusicFree-win32-x64 "<便携版目录>" /E /R:1 /W:1 /NFL /NDL
```

- robocopy **不要加 `/MIR`**，否则会删掉 `portable/` 里的用户数据。
- 覆盖前先结束正在运行的 `MusicFree.exe`，否则 exe 被占用。
- 打包体积大（exe 160MB+），整包构建约 5 分钟。

## 插件

- 插件文件在 `portable\userData\musicfree-plugins\`，运行时会热重载，改完直接刷新即可。
- 仓库里的 `plugins\` 只是副本，改插件时两边同步。
- **插件协议加参数要改三处**：`src/types/plugin.d.ts`（类型）、
  `src/shared/plugin-manager/main/plugin-methods.ts`（主进程包装层，参数是按位置透传的）、
  插件自身的实现。

## 调试

```bash
MUSICFREE_DEBUG_PORT=9225 ./MusicFree.exe      # 开 CDP 远程调试端口
# http://127.0.0.1:9225/json/list 拿 target，再用 ws 连过去 Runtime.evaluate
```

## 约定

- 新增文案要同时补 `res/lang/zh-CN.json`、`en-US.json`、`zh-TW.json` 三个文件。
- 配置项是**扁平**的：键名形如 `normal.alwaysOnTop`，直接写在 `config.json` 顶层，不要嵌套。
- 渲染进程的数据落在 IndexedDB（`musicSheetDB`），加表要在
  `src/renderer/core/db/music-sheet-db.ts` 里递增 Dexie 版本号。

## 窗口缩放（自绘感应条）

无边框窗口（`frame: false`）在 Windows 上没有系统缩放边框，拖边缘没反应，
所以自己实现了一套：

| 文件 | 作用 |
| --- | --- |
| `src/common/window-resize-util.ts` | `calculateResizeBounds()` 纯函数，按方向算新边界、夹最小尺寸、防拖出屏幕 |
| `src/shared/window-resize/main.ts` | IPC：`get-bounds` / `set-bounds`（最大化时忽略 setBounds） |
| `src/shared/window-resize/preload.ts` | 暴露 `window["@shared/window-resize"]` |
| `src/renderer/components/WindowResize/` | 8 个感应条 + 指针捕获拖拽 |

要点：

- 坐标体系：**渲染进程 CSS px == Electron DIP == Win32 逻辑 px**。
  用 `e.screenX`（屏幕坐标）做位移量、窗口边界用 `win.getBounds()`（DIP），两边同一体系，不用换算。
- 感应条是 `position: fixed` + `z-index: 999999` + `-webkit-app-region: no-drag`，
  按下时 `setPointerCapture`，否则鼠标拖出窗口后事件就断了。
- 最小尺寸在 `src/common/constant.ts` 的 `mainWindowMinSize`（400×320）。
- 想再加一条缩放方向，改 `IResizeDirection` + `calculateResizeBounds` + 组件里的 `directions` 数组 + SCSS。

## 播放队列定位到歌单

- `src/renderer/core/music-locate/index.ts`：定位请求的全局 Store（`requestLocateMusic` / `clearLocateTarget` / `useLocateTarget`）。
- 播放队列面板 `src/renderer/components/Panel/templates/PlayList/index.tsx` 里，单击（无 Ctrl/Shift）
  调 `locateMusicInSheet()`：遍历 `MusicSheet.frontend.getAllSheets()` 找含这首歌的歌单（取 `timeStampSymbol` 最新的），
  没有就退到「最近播放」（`getRecentlyPlaylist()`，sheet id 是 `recently-play`），再没有就 toast 提示。
- 定位请求带 `sheetId`，只有对应歌单的 MusicList 会消费它，避免当前页面抢先消费。
- 歌单页消费的逻辑在 `src/renderer/components/MusicList/index.tsx`（滚动 + `setActiveItems`）。

## 唱卡拉OK

| 文件 | 作用 |
| --- | --- |
| `src/renderer/utils/word-lyric.ts` | 逐字歌词解析：增强型 LRC（`<mm:ss.xx>`）、网易云 yrc / QQ qrc（`(start,duration,0)`）；都没有时按行均分生成「伪逐字」 |
| `src/renderer/core/karaoke/recorder.ts` | 麦克风采集 + 自相关法测基频（降到 8k 再算，省算力），时间轴与播放进度对齐 |
| `src/renderer/core/karaoke/scorer.ts` | 按词时间轴判定命中，算节奏 / 完整度 / 音高连贯性 |
| `src/renderer/components/Modal/templates/Karaoke/` | 全屏 KTV 界面：逐字扫光、录音打分、伴奏切换 |

要点：

- **逐字歌词是「有则用真、无则伪造」**：插件能拿到词级时间戳就用真的（`ILyricSource.wordLyric`），
  拿不到就按行内字数均分生成伪逐字，扫光效果照样有。公开接口目前基本不给真逐字
  （网易云 klyric 要登录、QQ qrc 要登录 cookie、酷狗 KRC 是加密格式），
  所以伪逐字是常态而不是异常。
- 插件协议加方法要改三处：`src/types/plugin.d.ts`、`src/shared/plugin-manager/main/plugin-methods.ts`、
  插件自身实现。`getInstrumental`（伴奏音源）就是走这套。
- **换伴奏不动歌单**：用 `trackPlayer.switchAudioSource()` 只换声音，
  `trackPlayer.getCurrentMediaSource()` 留着原唱音源好切回去。
  切源后音频元数据还没就绪，直接设 `currentTime` 会被忽略，
  所以 `audio-controller` 里加了 `pendingSeek`，等 `loadedmetadata` 再补跳。
- 伴奏本身是另一首歌，所以 KTV 界面是挨个问一遍支持 `getInstrumental` 的插件，谁能给就用谁。
- 录音打分受物理限制：放原唱时麦克风会拾到原唱，分数会虚高；用耳机跟唱、切到伴奏版会准得多。


