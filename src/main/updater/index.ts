import { app, ipcMain } from "electron";
import axios from "axios";
import fs from "fs/promises";
import originalFs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { rimraf } from "rimraf";
import logger from "@shared/logger/main";
import AppConfig from "@shared/app-config/main";
import {
    appUpdateSources,
    githubReleaseApiBase,
    githubRequestHeaders,
} from "@/common/constant";
import { installScript } from "./install-script";
import {
    extractZip,
    isFile,
    locateAppRoot,
    removePortableDir,
} from "./extract";
import {
    IUpdateCandidate,
    IGithubRelease,
    isNewerThan,
    normalizeVersion,
    releaseToCandidate,
    selectBestCandidate,
} from "./parse";
import { IWindowManager } from "@/types/main/window-manager";

/** 更新前需要备份的 userData 内容 */
const backupItems = [
    "config.json",
    "databases",
    "app-database",
    "musicfree-plugins",
    "musicfree-themepacks",
    "blob_storage",
    "appData",
];

/** portable 模式下 <exe 目录>/portable 存在 */
function isPortableMode() {
    try {
        const portablePath = path.resolve(app.getPath("exe"), "../portable");
        return originalFs.statSync(portablePath).isDirectory();
    } catch {
        return false;
    }
}

/**
 * 只有「已打包 + Windows + 便携版」才允许自动安装。
 * 安装版目录里铺 portable zip 会凭空造出 portable 目录，
 * 让应用静默切换 userData。
 */
function canAutoInstall() {
    return (
        app.isPackaged && process.platform === "win32" && isPortableMode()
    );
}

class Updater {
    private windowManager: IWindowManager;
    private downloadController: AbortController | null = null;
    private downloadedFilePath: string | null = null;
    /** 本次下载是否被用户主动取消 */
    private downloadCancelled = false;

    public setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;

        ipcMain.handle("@shared/utils/check-update", () => this.checkUpdate());
        ipcMain.handle("@shared/updater/download", (_, payload) =>
            this.download(payload),
        );
        ipcMain.handle("@shared/updater/cancel-download", () =>
            this.cancelDownload(),
        );
        ipcMain.handle("@shared/updater/install", (_, payload) =>
            this.install(payload),
        );
        ipcMain.handle("@shared/updater/last-result", () =>
            this.readLastResult(),
        );
    }

    private sendProgress(progress: {
        percent: number;
        downloaded: number;
        total: number;
        speed: number;
    }) {
        this.windowManager.getAllWindows().forEach((window) => {
            window.webContents.send("@shared/updater/progress", progress);
        });
    }

    private sendStatus(status: string) {
        this.windowManager.getAllWindows().forEach((window) => {
            window.webContents.send("@shared/updater/status", status);
        });
    }

    private async fetchGithubReleases(): Promise<IGithubRelease[]> {
        const response = await axios.get(githubReleaseApiBase, {
            headers: githubRequestHeaders,
            timeout: 15000,
        });
        return Array.isArray(response.data) ? response.data : [];
    }

    /**
     * 跨所有更新源收集候选，取 semver 最高的一个。
     * releases/latest 拿不到预发布版本，所以必须列全部 releases。
     */
    private async checkUpdate(): Promise<ICommon.IUpdateInfo> {
        const currentVersion = app.getVersion();
        const includePrerelease = !!AppConfig.getConfig(
            "normal.checkPrerelease",
        );
        const updateInfo: ICommon.IUpdateInfo = {
            version: currentVersion,
        };

        const candidates: IUpdateCandidate[] = [];

        for (const source of appUpdateSources) {
            try {
                const rawInfo = (await axios.get(source)).data;
                if (rawInfo?.version) {
                    candidates.push({
                        version: normalizeVersion(rawInfo.version),
                        changeLog: Array.isArray(rawInfo.changeLog)
                            ? rawInfo.changeLog
                            : [],
                        download: Array.isArray(rawInfo.download)
                            ? rawInfo.download
                            : [],
                    });
                }
            } catch (e) {
                logger.logError(`检查更新源 ${source} 失败`, e);
            }
        }

        try {
            const releases = await this.fetchGithubReleases();
            for (const release of releases) {
                if (release.draft) {
                    continue;
                }
                if (release.prerelease && !includePrerelease) {
                    continue;
                }
                const candidate = releaseToCandidate(release);
                if (candidate) {
                    candidates.push(candidate);
                }
            }
        } catch (e) {
            logger.logError("获取 GitHub Release 列表失败", e);
        }

        const best = selectBestCandidate(candidates, currentVersion);

        if (best) {
            updateInfo.update = {
                ...best,
                installable: canAutoInstall() && !!best.assetName,
            };
        }
        return updateInfo;
    }

    private async download(payload: {
        assetUrl: string;
        assetName: string;
    }) {
        const { assetUrl, assetName } = payload ?? ({} as any);
        if (!assetUrl || !assetName) {
            throw new Error("Invalid download payload");
        }

        const updatesDir = path.resolve(app.getPath("userData"), "updates");
        await fs.mkdir(updatesDir, { recursive: true });
        const filePath = path.resolve(updatesDir, assetName);
        this.downloadedFilePath = filePath;

        this.downloadController = new AbortController();
        this.downloadCancelled = false;
        const controller = this.downloadController;
        const startedAt = Date.now();
        let downloaded = 0;
        let lastNotify = 0;

        this.sendStatus("downloading");
        try {
            const response = await axios.get(assetUrl, {
                responseType: "stream",
                signal: controller.signal,
                timeout: 0,
                headers: {
                    "user-agent": githubRequestHeaders["user-agent"],
                },
            });
            const total = Number(response.headers["content-length"]) || 0;
            const writer = originalFs.createWriteStream(filePath);

            response.data.on("data", (chunk: Buffer) => {
                downloaded += chunk.length;
                const now = Date.now();
                if (now - lastNotify > 200) {
                    lastNotify = now;
                    const elapsed = (now - startedAt) / 1000;
                    this.sendProgress({
                        percent:
                            total > 0
                                ? Math.min(1, downloaded / total)
                                : 0,
                        downloaded,
                        total,
                        speed: elapsed > 0 ? downloaded / elapsed : 0,
                    });
                }
            });

            await new Promise<void>((resolve, reject) => {
                response.data.pipe(writer);
                writer.on("finish", resolve);
                writer.on("error", reject);
                response.data.on("error", reject);
                response.data.on("aborted", () =>
                    reject(new Error("Download aborted")),
                );
            });

            this.sendProgress({
                percent: 1,
                downloaded,
                total: total || downloaded,
                speed: 0,
            });
            this.sendStatus("ready");
            return { filePath };
        } catch (e) {
            // 用户主动取消不算失败，否则弹窗会误显示「更新失败」
            if (this.downloadCancelled) {
                throw e;
            }
            logger.logError("下载更新包失败", e);
            this.sendStatus("error");
            throw e;
        }
    }

    private async cancelDownload() {
        this.downloadCancelled = true;
        this.downloadController?.abort();
        this.downloadController = null;
        this.sendStatus("idle");
    }

    private async backupUserData(userDataDir: string, stamp: string) {
        const backupDir = path.resolve(userDataDir, "backups", stamp);
        await fs.mkdir(backupDir, { recursive: true });
        for (const item of backupItems) {
            const src = path.resolve(userDataDir, item);
            try {
                await fs.cp(src, path.resolve(backupDir, item), {
                    recursive: true,
                    force: true,
                    errorOnExist: false,
                });
            } catch (e) {
                logger.logError(`备份 ${item} 失败`, e);
            }
        }
        logger.logInfo(`用户数据已备份到 ${backupDir}`);
    }

    private async install(payload: { version: string }) {
        const zipPath = this.downloadedFilePath;
        if (!zipPath || !(await isFile(zipPath))) {
            throw new Error("没有可安装的更新包");
        }
        if (!canAutoInstall()) {
            throw new Error("当前环境不支持自动安装");
        }

        this.sendStatus("installing");

        const targetDir = path.dirname(app.getPath("exe"));
        const userDataDir = app.getPath("userData");
        const updatesDir = path.resolve(userDataDir, "updates");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");

        await this.backupUserData(userDataDir, stamp);

        // 解压到临时目录，不能放在目标目录里面，否则 robocopy 会递归拷贝自己
        const stagingRoot = path.join(os.tmpdir(), `musicfree-update-${stamp}`);
        await extractZip(zipPath, stagingRoot);
        const appRoot = await locateAppRoot(stagingRoot);

        // 压缩包自带的空 portable 目录会把安装版切成便携模式，必须删掉
        await removePortableDir(appRoot);

        await fs.mkdir(updatesDir, { recursive: true });
        const scriptPath = path.join(os.tmpdir(), `musicfree-install-${stamp}.ps1`);
        const logPath = path.resolve(updatesDir, `install-${stamp}.log`);
        const resultPath = path.resolve(updatesDir, "last-install-result.txt");
        await fs.writeFile(scriptPath, installScript, "utf-8");

        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                scriptPath,
                "-AppPid",
                String(process.pid),
                "-Target",
                targetDir,
                "-Staging",
                appRoot,
                "-Log",
                logPath,
                "-Result",
                resultPath,
            ],
            { detached: true, stdio: "ignore" },
        );
        child.unref();
        logger.logInfo(
            `更新安装器已启动: ${payload?.version ?? "?"} -> ${targetDir}`,
        );

        // 退出以释放 exe / dll 的文件锁，helper 会等进程消失后再替换
        setTimeout(() => app.exit(0), 300);
        return { ok: true, logPath };
    }

    private async readLastResult() {
        const resultPath = path.resolve(
            app.getPath("userData"),
            "updates",
            "last-install-result.txt",
        );
        try {
            const content = (await fs.readFile(resultPath, "utf-8")).trim();
            await rimraf(resultPath);
            return content;
        } catch {
            return null;
        }
    }
}

export default new Updater();
