import fs from "fs/promises";
import originalFs from "fs";
import path from "path";
import unzipper from "unzipper";
import { rimraf } from "rimraf";

export async function isFile(target: string) {
    try {
        return (await fs.stat(target)).isFile();
    } catch {
        return false;
    }
}

export async function isDir(target: string) {
    try {
        return (await fs.stat(target)).isDirectory();
    } catch {
        return false;
    }
}

/** 解压 zip 到 staging 目录 */
export async function extractZip(zipPath: string, stagingRoot: string) {
    await fs.mkdir(stagingRoot, { recursive: true });
    await originalFs
        .createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: stagingRoot }))
        .promise();
    return stagingRoot;
}

/**
 * 解压后找到真正的应用根目录（压缩包里套了一层同名目录）。
 * 优先找含 MusicFree.exe 的，其次找含 resources 的，最后单目录兜底。
 */
export async function locateAppRoot(stagingRoot: string) {
    const entries = await fs.readdir(stagingRoot, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());

    for (const dir of dirs) {
        const candidate = path.join(stagingRoot, dir.name);
        if (await isFile(path.join(candidate, "MusicFree.exe"))) {
            return candidate;
        }
    }
    for (const dir of dirs) {
        const candidate = path.join(stagingRoot, dir.name);
        if (await isDir(path.join(candidate, "resources"))) {
            return candidate;
        }
    }
    if (dirs.length === 1) {
        return path.join(stagingRoot, dirs[0].name);
    }
    throw new Error("无法识别解压后的目录结构");
}

/**
 * 压缩包自带的空 portable 目录会把安装版切成便携模式（静默换掉 userData），
 * 必须在铺进安装目录之前删掉。
 */
export async function removePortableDir(appRoot: string) {
    const portableDir = path.resolve(appRoot, "portable");
    if (await isDir(portableDir)) {
        await rimraf(portableDir);
        return true;
    }
    return false;
}
