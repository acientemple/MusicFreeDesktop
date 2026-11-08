/**
 * 自定义窗口缩放：
 *
 * 无边框窗口（frame: false）在 Windows 上没有系统缩放边框，
 * 拖窗口边缘是缩不动的。这里自己实现一套：
 * 渲染进程在边缘按下鼠标后算出新的窗口边界，主进程照着设置。
 */

import { BrowserWindow, ipcMain } from "electron";
import { IWindowBounds } from "@/common/window-resize-util";

class WindowResize {
    setup() {
        // 取当前窗口边界（跟渲染进程同一个坐标体系，都是 DIP）
        ipcMain.handle(
            "@shared/window-resize/get-bounds",
            (evt): IWindowBounds | null => {
                const win = BrowserWindow.fromWebContents(evt.sender);
                if (!win || win.isDestroyed()) {
                    return null;
                }
                return win.getBounds();
            },
        );

        // 设置窗口边界
        ipcMain.on(
            "@shared/window-resize/set-bounds",
            (evt, bounds: IWindowBounds) => {
                const win = BrowserWindow.fromWebContents(evt.sender);
                if (!win || win.isDestroyed() || win.isMaximized()) {
                    return;
                }
                if (
                    !bounds ||
                    !isFinite(bounds.width) ||
                    !isFinite(bounds.height)
                ) {
                    return;
                }
                win.setBounds({
                    x: Math.round(bounds.x),
                    y: Math.round(bounds.y),
                    width: Math.round(bounds.width),
                    height: Math.round(bounds.height),
                });
            },
        );
    }
}

export default new WindowResize();
