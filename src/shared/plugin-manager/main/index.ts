import { app, ipcMain } from "electron";
import fs from "fs/promises";
import path from "path";
import * as chokidar from "chokidar";
import { Plugin } from "./plugin";
import { rimraf } from "rimraf";
import _axios from "axios";
import https from "https";
import voidCallback from "@/common/void-callback";
import { localPluginHash, localPluginName } from "@/common/constant";
import localPlugin from "./internal-plugins/local-plugin";
import { addRandomHash } from "@/common/normalize-util";
import { IWindowManager } from "@/types/main/window-manager";
import AppConfig from "@shared/app-config/main";
import { compare } from "compare-versions";
import { nanoid } from "nanoid";
import logger from "@shared/logger/main";

const axios = _axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false,
    }),
});

interface ICallPluginMethodParams<
    T extends keyof IPlugin.IPluginInstanceMethods,
> {
    hash: string;
    platform: string;
    method: T;
    args: Parameters<IPlugin.IPluginInstanceMethods[T]>;
}


class PluginManager {
    private clonedPlugins: IPlugin.IPluginDelegate[] = [];

    private inited = false;

    private pluginWatcher: chokidar.FSWatcher | null = null;

    private reloadTimer: NodeJS.Timeout | null = null;

    private _plugins: Plugin[] = [];
    public get plugins() {
        return this._plugins;
    }

    public set plugins(newPlugins: Plugin[]) {
        this._plugins = newPlugins;
        this.clonedPlugins = newPlugins.map((p) => {
            const sPlugin: IPlugin.IPluginDelegate = {} as any;
            sPlugin.supportedMethod = [];
            for (const k in p.instance) {
                // @ts-ignore
                if (typeof p.instance[k] === "function") {
                    sPlugin.supportedMethod.push(k);
                } else {
                    // @ts-ignore
                    sPlugin[k] = p.instance[k];
                }
            }
            sPlugin.hash = p.hash;
            sPlugin.path = p.path;
            return JSON.parse(JSON.stringify(sPlugin));
        });
    }

    private windowManager: IWindowManager;

    // 插件存储路径
    private _pluginBasePath: string;

    private get pluginBasePath() {
        if (this._pluginBasePath) {
            return this._pluginBasePath;
        }
        this._pluginBasePath = path.resolve(
            app.getPath("userData"),
            "./musicfree-plugins",
        );
        return this._pluginBasePath;
    }

    public async setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        // 1. setup events
        ipcMain.handle("@shared/plugin-manager/call-plugin-method", (_evt, data) => {
            return this.callPluginMethod(data);
        });

        ipcMain.handle("@shared/plugin-manager/get-all-plugins", () => this.clonedPlugins);

        ipcMain.handle("@shared/plugin-manager/load-all-plugins", async () => {
            if (!this.inited) {
                await this.loadAllPlugins();
            } else {
                this.syncPlugins();
            }
            return this.clonedPlugins;
        });

        ipcMain.handle("@shared/plugin-manager/uninstall-plugin", async (_, hash) => {
            await this.uninstallPlugin(hash);
            this.syncPlugins();
        });

        ipcMain.on("@shared/plugin-manager/update-all-plugins", this.updateAllPlugins);

        ipcMain.handle("@shared/plugin-manager/install-plugin-remote", async (_, urlLike) => {
            return await this.installPluginFromRemoteUrl(urlLike);
        });

        ipcMain.handle("@shared/plugin-manager/install-plugin-local", async (_, urlLike) => {
            return await this.installPluginFromLocalFile(urlLike);
        });

        // 2. check if folder exists
        let folderExists = true;
        try {
            const res = await fs.stat(this.pluginBasePath);
            if (!res.isDirectory()) {
                await rimraf(this.pluginBasePath);
                folderExists = false;
            }
        } catch {
            folderExists = false;
        }
        if (!folderExists) {
            await fs.mkdir(this.pluginBasePath, {
                recursive: true,
            }).catch(voidCallback);
        }

        // 3. load all plugins
        await this.loadAllPlugins();
        this.inited = true;

        // 4. 开发模式下监听插件目录，改完插件不用重启应用
        this.setupPluginWatcher();
    }

    private setupPluginWatcher() {
        if (app.isPackaged) {
            return;
        }
        this.pluginWatcher = chokidar.watch(this.pluginBasePath, {
            depth: 0,
            persistent: true,
            ignoreInitial: true,
            ignorePermissionErrors: true,
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 50,
            },
        });
        const onPluginFileChanged = () => this.scheduleReload();
        this.pluginWatcher.on("add", onPluginFileChanged);
        this.pluginWatcher.on("change", onPluginFileChanged);
        this.pluginWatcher.on("unlink", onPluginFileChanged);
        logger.logInfo("插件热重载已开启", { path: this.pluginBasePath });
    }

    private scheduleReload() {
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = null;
            this.loadAllPlugins().catch((e) => {
                logger.logError("插件热重载失败", e);
            });
        }, 300);
    }

    // 调用某个插件的方法
    private callPluginMethod({
        hash,
        platform,
        method,
        args,
    }: ICallPluginMethodParams<keyof IPlugin.IPluginInstanceMethods>,
    ) {
        let plugin: Plugin;
        if (hash === localPluginHash || platform === localPluginName) {
            plugin = localPlugin;
        } else if (hash) {
            plugin =
                this.plugins.find((item) => item.hash === hash) ??
                // hash 失效时兜底按平台名找，避免旧引用直接失效
                this.plugins.find((item) => item.name === platform);
        } else if (platform) {
            plugin = this.plugins.find((item) => item.name === platform);
        }
        if (!plugin) {
            return null;
        }
        return plugin.methods[method]?.apply?.({ plugin }, args);
    }

    private syncPlugins() {
        const mainWindow = this.windowManager.mainWindow;
        if (mainWindow) {
            mainWindow.webContents.send("@/shared/plugin-manager/sync-plugins", this.clonedPlugins);
        }
    }


    /********************** 安装插件 *******************/
    private async installPluginFromRawCodeImpl(funcCode: string) {
        const plugins = this.plugins;
        const plugin = new Plugin(funcCode, "");
        const pluginIndex = plugins.findIndex((p) => p.hash === plugin.hash);
        if (pluginIndex !== -1) {
            // 静默忽略
            return;
        }
        const oldVersionPlugin = plugins.find((p) => p.name === plugin.name);
        if (
            oldVersionPlugin &&
            !AppConfig.getConfig("plugin.notCheckPluginVersion")
        ) {
            if (
                compare(
                    oldVersionPlugin.instance.version ?? "",
                    plugin.instance.version ?? "",
                    ">",
                )
            ) {
                throw new Error("已安装更新版本的插件");
            }
        }

        if (plugin.hash !== "") {
            const fn = nanoid();
            const _pluginPath = path.resolve(this.pluginBasePath, `${fn}.js`);
            await fs.writeFile(_pluginPath, funcCode, "utf8");
            plugin.path = _pluginPath;
            let newPlugins = plugins.concat(plugin);
            if (oldVersionPlugin) {
                newPlugins = newPlugins.filter((_) => _.hash !== oldVersionPlugin.hash);
                try {
                    await rimraf(oldVersionPlugin.path);
                } catch {
                    // pass
                }
            }
            this.plugins = newPlugins;
            return;
        }
        throw new Error("插件无法解析!");
    }

    private async installPluginFromUrlImpl(urlLike: string) {
        const funcCode = (await axios.get(urlLike)).data;
        if (funcCode) {
            await this.installPluginFromRawCodeImpl(funcCode);
        }
    }

    // 加载所有插件
    public async loadAllPlugins() {
        const oldPluginMap = new Map(this.plugins.map((p) => [p.path, p]));
        const rawPluginNames = await fs.readdir(this.pluginBasePath);
        const pluginHashSet = new Set<string>();
        const plugins: Plugin[] = [];
        for (let i = 0; i < rawPluginNames.length; ++i) {
            try {
                const pluginPath = path.resolve(this.pluginBasePath, rawPluginNames[i]);
                const fileStat = await fs.stat(pluginPath);
                if (fileStat.isFile() && path.extname(pluginPath) === ".js") {
                    const funcCode = await fs.readFile(pluginPath, "utf-8");
                    const plugin = new Plugin(funcCode, pluginPath);
                    const oldPlugin = oldPluginMap.get(pluginPath);
                    if (plugin.hash === "") {
                        // 解析失败时保留上一个可用实例，改到一半也不会让插件整个消失
                        if (oldPlugin) {
                            plugins.push(oldPlugin);
                        }
                        continue;
                    }
                    if (oldPlugin && oldPlugin.name === plugin.name) {
                        // 同一个文件沿用旧 hash，页面上的旧引用才不会失效
                        plugin.hash = oldPlugin.hash;
                    }
                    if (pluginHashSet.has(plugin.hash)) {
                        continue;
                    }
                    pluginHashSet.add(plugin.hash);
                    plugins.push(plugin);
                }
            } catch (e) {
                logger.logError("插件加载失败", e);
            }
        }
        this.plugins = plugins;
        this.syncPlugins();
    }

    // 从本地文件安装插件
    public async installPluginFromLocalFile(urlLike: string) {
        try {
            const url = urlLike.trim();
            if (url.endsWith(".js")) {
                const rawCode = await fs.readFile(url, "utf8");
                await this.installPluginFromRawCodeImpl(rawCode);
            } else if (url.endsWith(".json")) {
                const jsonFile = JSON.parse(await fs.readFile(url, "utf8"));

                for (const cfg of jsonFile?.plugins ?? []) {
                    await this.installPluginFromUrlImpl(addRandomHash(cfg.url));
                }
            }
        } finally {
            this.syncPlugins();
        }
    }

    // 从远程url安装插件
    public async installPluginFromRemoteUrl(urlLike: string) {
        try {
            const url = urlLike.trim();
            if (url.endsWith(".js")) {
                await this.installPluginFromUrlImpl(addRandomHash(url));
            } else if (url.endsWith(".json")) {
                const jsonFile = (await axios.get(addRandomHash(url))).data;

                for (const cfg of jsonFile?.plugins ?? []) {
                    await this.installPluginFromUrlImpl(addRandomHash(cfg.url));
                }
            }
        } finally {
            this.syncPlugins();
        }
    }

    // 更新所有插件
    public async updateAllPlugins() {
        return Promise.allSettled(
            this.plugins.map((plg) =>
                plg.instance.srcUrl ? this.installPluginFromRemoteUrl(plg.instance.srcUrl) : null,
            ),
        );
    }

    // 卸载插件
    public async uninstallPlugin(hash: string) {
        const targetIndex = this.plugins.findIndex((_) => _.hash === hash);
        if (targetIndex !== -1) {
            try {
                await rimraf(this.plugins[targetIndex].path);
                this.plugins = this.plugins.filter((_) => _.hash !== hash);
            } catch {
                // pass
            }
        }
    }
}


export default new PluginManager();
