/**
 * 窗口缩放的边界计算（纯函数，渲染进程与主进程共用同一套规则）
 */

import { mainWindowMinSize } from "@/common/constant";

export type IResizeDirection =
    | "n"
    | "s"
    | "e"
    | "w"
    | "ne"
    | "nw"
    | "se"
    | "sw";

export interface IWindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * 按拖动方向与鼠标位移算出新的窗口边界
 */
export function calculateResizeBounds(
    origin: IWindowBounds,
    direction: IResizeDirection,
    dx: number,
    dy: number,
): IWindowBounds {
    let { x, y, width, height } = origin;

    const moveWest = direction.includes("w");
    const moveEast = direction.includes("e");
    const moveNorth = direction.includes("n");
    const moveSouth = direction.includes("s");

    if (moveEast) {
        width = origin.width + dx;
    }
    if (moveWest) {
        width = origin.width - dx;
        x = origin.x + dx;
    }
    if (moveSouth) {
        height = origin.height + dy;
    }
    if (moveNorth) {
        height = origin.height - dy;
        y = origin.y + dy;
    }

    // 小于最小尺寸时把边拉回来
    if (width < mainWindowMinSize.width) {
        width = mainWindowMinSize.width;
        if (moveWest) {
            x = origin.x + origin.width - width;
        }
    }
    if (height < mainWindowMinSize.height) {
        height = mainWindowMinSize.height;
        if (moveNorth) {
            y = origin.y + origin.height - height;
        }
    }
    // 不要把窗口拖到屏幕外
    if (x < 0) {
        if (moveWest) {
            width += x;
        }
        x = 0;
    }
    if (y < 0) {
        if (moveNorth) {
            height += y;
        }
        y = 0;
    }

    return { x, y, width, height };
}
