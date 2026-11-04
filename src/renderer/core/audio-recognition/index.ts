import axios from "axios";
import { fsUtil } from "@shared/utils/renderer";

/** 识别服务地址 */
const RECOGNITION_API = "https://api.audd.io/";

/** 识别采样率，audd.io 建议 16k */
const RECOGNITION_SAMPLE_RATE = 16000;

/** 上传大小上限，audd.io 建议不超过 10MB */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** 默认录音时长 */
const DEFAULT_CAPTURE_DURATION = 10_000;

/** 抓取音源的超时时间 */
const CAPTURE_TIMEOUT = 30_000;

/** 常见扩展名对应的 MIME 类型，识别服务按类型决定怎么解码 */
const mimeTypes: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".webm": "audio/webm",
};

export interface IAudioClip {
    /** 音频内容 */
    blob: Blob;
    /** 上传时使用的文件名 */
    fileName: string;
    /** 音频 MIME 类型 */
    mimeType: string;
}

export interface IRecognitionResult {
    title: string;
    artist: string;
    album?: string;
    artwork?: string;
    /** 识别服务附带的歌词（部分服务会返回） */
    lyrics?: string;
    /** 服务返回的原始数据 */
    raw: any;
}

export class RecognitionError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(message);
        this.name = "RecognitionError";
    }
}

/** 把浮点采样编码为 16bit 单声道 WAV */
export function encodeWavToBlob(
    samples: Float32Array,
    sampleRate: number,
): Blob {
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    const writeString = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(
            offset,
            sample < 0 ? sample * 0x8000 : sample * 0x7fff,
            true,
        );
        offset += bytesPerSample;
    }

    return new Blob([buffer], { type: "audio/wav" });
}

/** 线性插值重采样 */
export function resample(
    samples: Float32Array,
    fromRate: number,
    toRate: number,
): Float32Array {
    if (!samples.length || fromRate === toRate) {
        return samples;
    }
    const ratio = fromRate / toRate;
    const length = Math.max(1, Math.round(samples.length / ratio));
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        const position = i * ratio;
        const index = Math.floor(position);
        const fraction = position - index;
        const current = samples[index] ?? 0;
        const next = samples[index + 1] ?? current;
        result[i] = current + (next - current) * fraction;
    }
    return result;
}

/** 从 url 里取出真实的资源地址（请求转发器会把原地址放在 query 里） */
function extractRealUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const inner = parsed.searchParams.get("url");
        if (inner) {
            return inner;
        }
    } catch {
        // pass
    }
    return url;
}

/** 从地址里推断扩展名 */
function guessExtension(url: string): string {
    try {
        const path = new URL(url).pathname;
        const matched = path.match(/\.([a-z0-9]{2,5})$/i);
        if (matched) {
            const ext = matched[1].toLowerCase();
            // 分片 mp4 换成通用的 m4a，识别服务更容易解出来
            return ext === "m4s" ? ".m4a" : `.${ext}`;
        }
    } catch {
        // pass
    }
    return ".mp3";
}

/** file:// 地址转成本地路径 */
function fileUrlToPath(fileUrl: string): string {
    let result = decodeURIComponent(fileUrl.replace(/^file:\/\//, ""));
    if (/^\/[a-zA-Z]:/.test(result)) {
        result = result.slice(1);
    }
    return result;
}

/** 带大小上限地读取响应体 */
async function readBlobWithLimit(
    response: Response,
    maxBytes: number,
): Promise<Blob> {
    if (!response.body) {
        return await response.blob();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (!value) {
            continue;
        }
        chunks.push(value);
        size += value.byteLength;
        if (size >= maxBytes) {
            await reader.cancel().catch(() => undefined);
            break;
        }
    }
    return new Blob(chunks as BlobPart[], {
        type: response.headers.get("content-type") ?? "",
    });
}

/** 从麦克风录一段音频 */
export async function captureFromMicrophone(options?: {
    durationMs?: number;
    onProgress?: (percent: number) => void;
}): Promise<IAudioClip> {
    const durationMs = options?.durationMs ?? DEFAULT_CAPTURE_DURATION;

    if (!navigator.mediaDevices?.getUserMedia) {
        throw new RecognitionError("当前环境不支持录音");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        },
    });

    const AudioContextCtor: typeof AudioContext | undefined =
        window.AudioContext ??
        ((window as any).webkitAudioContext as typeof AudioContext | undefined);
    if (!AudioContextCtor) {
        stream.getTracks().forEach((track) => track.stop());
        throw new RecognitionError("当前环境不支持录音");
    }

    const audioContext = new AudioContextCtor();
    const sourceSampleRate = audioContext.sampleRate;

    let stopped = false;
    let received = 0;
    const chunks: Float32Array[] = [];

    try {
        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        const expected = sourceSampleRate * (durationMs / 1000);
        processor.onaudioprocess = (event: AudioProcessingEvent) => {
            if (stopped) {
                return;
            }
            const input = event.inputBuffer.getChannelData(0);
            chunks.push(new Float32Array(input));
            received += input.length;
            options?.onProgress?.(
                expected > 0 ? Math.min(1, received / expected) : 0,
            );
        };

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        await new Promise<void>((resolve) => {
            setTimeout(resolve, durationMs);
        });
    } finally {
        stopped = true;
        stream.getTracks().forEach((track) => track.stop());
        await audioContext.close().catch(() => undefined);
    }

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (!total) {
        throw new RecognitionError("没有录到声音");
    }
    const merged = new Float32Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
        merged.set(chunk, offset);
        offset += chunk.length;
    });

    const blob = encodeWavToBlob(
        resample(merged, sourceSampleRate, RECOGNITION_SAMPLE_RATE),
        RECOGNITION_SAMPLE_RATE,
    );

    return {
        blob,
        fileName: "sample.wav",
        mimeType: "audio/wav",
    };
}

/** 直接抓取当前播放的音源 */
export async function captureFromUrl(url: string): Promise<IAudioClip> {
    const realUrl = extractRealUrl(url);
    const extension = guessExtension(realUrl);

    if (realUrl.startsWith("file://")) {
        return await captureFromLocalFile(fileUrlToPath(realUrl), extension);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            // 只取开头一段，整首下载下来既慢又没必要
            headers: { Range: `bytes=0-${MAX_UPLOAD_BYTES - 1}` },
        });
        if (!response.ok) {
            throw new RecognitionError(`抓取音源失败：${response.status}`);
        }
        const blob = await readBlobWithLimit(response, MAX_UPLOAD_BYTES);
        if (!blob.size) {
            throw new RecognitionError("抓取到的音源是空的");
        }
        // 音源服务器给的类型不准，按扩展名纠正后再上传
        const mimeType = mimeTypes[extension] ?? "audio/mpeg";
        return {
            blob: new Blob([blob], { type: mimeType }),
            fileName: `sample${extension}`,
            mimeType,
        };
    } catch (e) {
        if (e instanceof RecognitionError) {
            throw e;
        }
        throw new RecognitionError(
            controller.signal.aborted
                ? "抓取音源超时"
                : String(e?.message ?? e),
        );
    } finally {
        clearTimeout(timer);
    }
}

/** 读取本地音乐文件 */
export async function captureFromLocalFile(
    filePath: string,
    extension?: string,
): Promise<IAudioClip> {
    const raw = (await fsUtil.readFile(filePath)) as unknown as Uint8Array;
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (!bytes.byteLength) {
        throw new RecognitionError("本地文件是空的");
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new RecognitionError("本地文件过大，无法识别");
    }
    const ext = extension ?? guessExtension(filePath);
    const mimeType = mimeTypes[ext] ?? "audio/mpeg";
    return {
        blob: new Blob([bytes], { type: mimeType }),
        fileName: `sample${ext}`,
        mimeType,
    };
}

/** 调用识别服务 */
export async function recognizeAudio(
    clip: IAudioClip,
    token: string,
): Promise<IRecognitionResult> {
    const accessToken = token?.trim();
    if (!accessToken) {
        throw new RecognitionError("缺少识别服务的 token");
    }

    const formData = new FormData();
    formData.append("token", accessToken);
    formData.append("file", clip.blob, clip.fileName);

    let data: any;
    try {
        const response = await axios.post(RECOGNITION_API, formData, {
            headers: {
                Authorization: `token ${accessToken}`,
            },
            timeout: 60_000,
        });
        data = response.data;
    } catch (e: any) {
        const message =
            e?.response?.data?.error?.error_message ??
            e?.message ??
            "识别请求失败";
        throw new RecognitionError(String(message));
    }

    if (data?.status === "error" || data?.error?.error_message) {
        throw new RecognitionError(
            String(data?.error?.error_message ?? "识别失败"),
        );
    }

    const result = data?.result;
    if (!result?.title) {
        // 识别不出来和 token 无效时，识别服务都只回一个空结果
        throw new RecognitionError(
            "没有识别出歌曲，请确认音频清晰且 token 有效",
        );
    }

    return {
        title: String(result.title),
        artist: String(result.artist ?? ""),
        album: result.album ? String(result.album) : undefined,
        artwork: result.artwork ? String(result.artwork) : undefined,
        lyrics: result.lyrics ? String(result.lyrics) : undefined,
        raw: data,
    };
}
