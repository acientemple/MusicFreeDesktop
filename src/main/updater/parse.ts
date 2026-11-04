import { compare } from "compare-versions";

export interface IGithubAsset {
    name: string;
    browser_download_url: string;
    size: number;
}

export interface IGithubRelease {
    tag_name: string;
    name: string;
    body: string;
    prerelease: boolean;
    draft: boolean;
    published_at: string;
    html_url: string;
    assets: IGithubAsset[];
}

export interface IUpdateCandidate {
    version: string;
    changeLog: string[];
    download: string[];
    prerelease?: boolean;
    releasePage?: string;
    assetName?: string;
    assetSize?: number;
}

/** 各平台可用的资产类型，按优先级排列 */
export const assetKindPriority: Record<string, string[]> = {
    "win32-x64": [
        "portable.zip",
        "setup.exe",
        "legacy-portable.zip",
        "legacy-setup.exe",
    ],
    "darwin-arm64": ["dmg"],
    "darwin-x64": ["dmg"],
    "linux-amd64": ["deb", "rpm"],
};

export function normalizeVersion(version: string) {
    return (version ?? "").trim().replace(/^v/i, "");
}

export function isNewerThan(candidate: string, current: string) {
    try {
        // compare-versions 依赖 semver，非法版本号会抛异常
        return compare(candidate, current, ">");
    } catch {
        return false;
    }
}

export function getPlatformToken(
    platform: string = process.platform,
    arch: string = process.arch,
) {
    if (platform === "win32" && arch === "x64") {
        return "win32-x64";
    }
    if (platform === "darwin" && arch === "arm64") {
        return "darwin-arm64";
    }
    if (platform === "darwin" && arch === "x64") {
        return "darwin-x64";
    }
    if (platform === "linux" && arch === "x64") {
        return "linux-amd64";
    }
    return null;
}

/**
 * 从资产名里切出类型 token。
 * MusicFree-1.0.0-win32-x64-portable.zip -> portable.zip
 * MusicFree-1.0.0-darwin-arm64.dmg -> dmg
 */
export function getAssetKind(name: string, platformToken: string) {
    const kinds = assetKindPriority[platformToken];
    if (!kinds) {
        return null;
    }
    const marker = `-${platformToken}`;
    const index = name.indexOf(marker);
    if (index < 0) {
        return null;
    }
    const rest = name.slice(index + marker.length);
    const token =
        rest.startsWith("-") || rest.startsWith(".") ? rest.slice(1) : "";
    return kinds.includes(token) ? token : null;
}

export function pickAsset(
    assets: IGithubAsset[],
    platformToken: string | null = getPlatformToken(),
) {
    if (!platformToken) {
        return null;
    }
    for (const kind of assetKindPriority[platformToken]) {
        const found = assets.find(
            (asset) => getAssetKind(asset.name, platformToken) === kind,
        );
        if (found) {
            return found;
        }
    }
    return null;
}

export function parseChangeLog(body: string) {
    if (!body) {
        return [];
    }
    return body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 50);
}

/** 从 release 列表里挑出当前平台可用的候选 */
export function releaseToCandidate(
    release: IGithubRelease,
    platformToken: string | null = getPlatformToken(),
): IUpdateCandidate | null {
    const version = normalizeVersion(release.tag_name);
    if (!version) {
        return null;
    }
    const asset = pickAsset(release.assets ?? [], platformToken);
    if (!asset) {
        return null;
    }
    return {
        version,
        changeLog: parseChangeLog(release.body),
        download: [asset.browser_download_url],
        prerelease: release.prerelease,
        releasePage: release.html_url,
        assetName: asset.name,
        assetSize: asset.size,
    };
}

/** 取比当前版本新的候选里 semver 最高的那个 */
export function selectBestCandidate(
    candidates: IUpdateCandidate[],
    currentVersion: string,
) {
    let best: IUpdateCandidate | null = null;
    for (const candidate of candidates) {
        if (!isNewerThan(candidate.version, currentVersion)) {
            continue;
        }
        if (!best || isNewerThan(candidate.version, best.version)) {
            best = candidate;
        }
    }
    return best;
}
