import Store from "@/common/store";
import AppConfig from "@shared/app-config/renderer";
import useAppConfig from "@/hooks/useAppConfig";
import { useMemo } from "react";

interface IPluginDelegateLike {
    platform?: string;
    hash?: string;
}

interface IMod {
    onPluginUpdated: (callback: (plugins: IPlugin.IPluginDelegate[]) => void) => void,

    callPluginMethod<
        T extends keyof IPlugin.IPluginInstanceMethods,
    >(
        pluginDelegate: IPluginDelegateLike,
        method: T,
        ...args: Parameters<IPlugin.IPluginInstanceMethods[T]>
    ): ReturnType<IPlugin.IPluginInstanceMethods[T]>,

    reloadPlugins: () => Promise<void>;
    uninstallPlugin: (hash: string) => Promise<void>;
    updateAllPlugins: () => Promise<void>;
    installPluginFromRemote: (url: string) => Promise<void>,
    installPluginFromLocal: (rawCode: string) => Promise<void>,
}

const mod = window["@shared/plugin-manager" as any] as unknown as IMod;


const delegatePluginsStore = new Store<IPlugin.IPluginDelegate[]>([]);

mod.onPluginUpdated((plugins) => {
    delegatePluginsStore.setValue(plugins);
});

function getSupportedPlugin(
    featureMethod: keyof IPlugin.IPluginInstanceMethods,
) {
    return delegatePluginsStore
        .getValue()
        .filter((_) => _.supportedMethod.includes(featureMethod));
}

function getSortedSupportedPlugin(
    featureMethod: keyof IPlugin.IPluginInstanceMethods,
) {
    const meta = AppConfig.getConfig("private.pluginMeta") ?? {};
    return delegatePluginsStore
        .getValue()
        .filter((_) => _.supportedMethod.includes(featureMethod))
        .sort((a, b) => {
            return (meta[a.platform]?.order ?? Infinity) -
            (meta[b?.platform]?.order ?? Infinity) <
            0
                ? -1
                : 1;
        });
}

function getSearchablePlugins(
    supportedSearchType?: IMedia.SupportMediaType,
) {
    return getSupportedPlugin("search").filter((_) =>
        supportedSearchType && _.supportedSearchType
            ? _.supportedSearchType.includes(supportedSearchType)
            : true,
    );
}


function getSortedSearchablePlugins(
    supportedSearchType?: IMedia.SupportMediaType,
) {
    return getSortedSupportedPlugin("search").filter((_) =>
        supportedSearchType && _.supportedSearchType
            ? _.supportedSearchType.includes(supportedSearchType)
            : true,
    );
}

function getPluginByHash(hash: string) {
    return delegatePluginsStore.getValue().find((item) => item.hash === hash);
}

/**
 * platform 是数据键，改名会让历史条目与用户变量配置失效，
 * 所以显示名单独放在 displayName 上，这里做一次映射。
 */
function getPluginDisplayName(platform?: string) {
    if (!platform) {
        return platform;
    }
    return (
        delegatePluginsStore
            .getValue()
            .find((item) => item.platform === platform)?.displayName ||
        platform
    );
}

function getPluginByPlatform(platform: string) {
    return delegatePluginsStore.getValue().find((item) => item.platform === platform);
}

function isSupportFeatureMethod(platform: string, featureMethod: keyof IPlugin.IPluginInstanceMethods) {
    if (!platform) {
        return false;
    }
    return delegatePluginsStore.getValue().find((item) => item.platform === platform)?.supportedMethod?.includes?.(featureMethod) ?? false;
}


function getPluginPrimaryKey(pluginItem: IPluginDelegateLike) {
    return (
        delegatePluginsStore
            .getValue()
            .find((it) => it.platform === pluginItem.platform)?.primaryKey ?? []
    );
}


async function setup() {
    await mod.reloadPlugins();
}

const PluginManager = {
    setup,
    getSortedSupportedPlugin,
    getSupportedPlugin,
    getSearchablePlugins,
    getSortedSearchablePlugins,
    getPluginByHash,
    getPluginByPlatform,
    getPluginDisplayName,
    isSupportFeatureMethod,
    getPluginPrimaryKey,
    callPluginDelegateMethod: mod.callPluginMethod,
    updateAllPlugins: mod.updateAllPlugins,
    uninstallPlugin: mod.uninstallPlugin,
    installPluginFromRemote: mod.installPluginFromRemote,
    installPluginFromLocal: mod.installPluginFromLocal,
};

export default PluginManager;

export function useSupportedPlugin(
    featureMethod: keyof IPlugin.IPluginInstanceMethods,
) {
    return delegatePluginsStore
        .useValue()
        .filter((_) => _.supportedMethod.includes(featureMethod));
}

export function useSortedSupportedPlugin(
    featureMethod: keyof IPlugin.IPluginInstanceMethods,
) {
    const meta = AppConfig.getConfig("private.pluginMeta") ?? {};
    return delegatePluginsStore
        .useValue()
        .filter((_) => _.supportedMethod.includes(featureMethod))
        .sort((a, b) => {
            return (meta[a.platform]?.order ?? Infinity) -
            (meta[b?.platform]?.order ?? Infinity) <
            0
                ? -1
                : 1;
        });
}

export function useSortedPlugins() {
    const plugins = delegatePluginsStore.useValue();
    const meta = useAppConfig("private.pluginMeta") ?? {};

    return useMemo(() => {
        return [...plugins].sort((a, b) => {
            return (meta[a.platform]?.order ?? Infinity) -
            (meta[b?.platform]?.order ?? Infinity) <
            0
                ? -1
                : 1;
        });
    }, [plugins, meta]);
}

/** 条目上的 platform 是数据键，展示时映射成插件的显示名 */
export function usePluginDisplayName(platform?: string) {
    const plugins = delegatePluginsStore.useValue();
    return useMemo(() => {
        if (!platform) {
            return platform;
        }
        return (
            plugins.find((item) => item.platform === platform)?.displayName ||
            platform
        );
    }, [plugins, platform]);
}
