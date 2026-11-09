/**
 * 卡拉OK 录音采集
 *
 * 用麦克风采集演唱声，边采边算基频，
 * 得到一条「时间 - 音高」的轨迹，后面拿去跟歌词时间轴对齐打分。
 */

/** 一个采样点 */
export interface IPitchSample {
    /** 对应歌曲里的时间（秒） */
    time: number;
    /** 基频（Hz），没有检测到人声时为 0 */
    frequency: number;
    /** 音量（RMS） */
    volume: number;
}

/** 分析用的降采样率。基频都在人声范围，降下来算省算力 */
const ANALYSIS_RATE = 8000;
/** 判断为「有人在唱」的音量下限 */
const MIN_RMS = 0.012;
/** 基频搜索范围 */
const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1100;

export class KaraokeRecorderError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(message);
        this.name = "KaraokeRecorderError";
    }
}

/**
 * 自相关法检测基频
 * 先降到 8k 再算，lag 范围小很多，计算量能接受
 */
export function detectPitch(
    buffer: Float32Array,
    sampleRate: number,
): { frequency: number; rms: number } {
    let sum = 0;
    for (let i = 0; i < buffer.length; ++i) {
        sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / Math.max(buffer.length, 1));
    if (rms < MIN_RMS) {
        return { frequency: 0, rms };
    }

    const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQUENCY));
    const maxLag = Math.min(
        Math.floor(buffer.length / 2),
        Math.ceil(sampleRate / MIN_FREQUENCY),
    );
    if (maxLag <= minLag) {
        return { frequency: 0, rms };
    }

    let bestLag = -1;
    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag; ++lag) {
        let correlation = 0;
        for (let i = 0; i < buffer.length - lag; ++i) {
            correlation += buffer[i] * buffer[i + lag];
        }
        correlation /= buffer.length - lag;
        if (correlation > bestScore) {
            bestScore = correlation;
            bestLag = lag;
        }
    }
    if (bestLag < 0 || bestScore < rms * rms * 0.6) {
        return { frequency: 0, rms };
    }
    const frequency = sampleRate / bestLag;
    if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) {
        return { frequency: 0, rms };
    }
    return { frequency, rms };
}

/** 把一段采样降采样到 8k 左右 */
function downsample(buffer: Float32Array, ratio: number): Float32Array {
    if (ratio <= 1) {
        return buffer;
    }
    const length = Math.floor(buffer.length / ratio);
    const result = new Float32Array(length);
    for (let i = 0; i < length; ++i) {
        let sum = 0;
        const start = i * ratio;
        for (let j = 0; j < ratio; ++j) {
            sum += buffer[start + j] ?? 0;
        }
        result[i] = sum / ratio;
    }
    return result;
}

export type GetSongTime = () => number;

/**
 * 录音采集器
 *
 * 时间对齐：录音开始时记下歌曲进度，之后用 AudioContext 的时间推算。
 * 用户拖动进度条会让两边对不上，检测到偏差就重新对齐
 */
export class KaraokeRecorder {
    private stream?: MediaStream;
    private audioContext?: AudioContext;
    private source?: MediaStreamAudioSourceNode;
    private processor?: ScriptProcessorNode;
    private silentGain?: GainNode;

    private samples: IPitchSample[] = [];

    /** 录音开始时的 AudioContext 时间 */
    private startCtxTime = 0;
    /** 录音开始时的歌曲进度 */
    private startSongTime = 0;

    private getSongTime?: GetSongTime;

    get isRecording() {
        return !!this.processor;
    }

    /** 已采集的采样点 */
    getSamples(): IPitchSample[] {
        return this.samples;
    }

    /** 清空已采集的数据 */
    reset() {
        this.samples = [];
    }

    async start(getSongTime: GetSongTime): Promise<void> {
        if (this.processor) {
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new KaraokeRecorderError("当前环境不支持麦克风录音");
        }
        this.getSongTime = getSongTime;
        this.stream = await navigator.mediaDevices.getUserMedia({
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
            this.releaseStream();
            throw new KaraokeRecorderError("当前环境不支持麦克风录音");
        }

        const audioContext = new AudioContextCtor();
        this.audioContext = audioContext;
        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }
        this.startCtxTime = audioContext.currentTime;
        this.startSongTime = getSongTime();

        const source = audioContext.createMediaStreamSource(this.stream);
        this.source = source;
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        this.processor = processor;

        const sampleRate = audioContext.sampleRate;
        const ratio = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));

        processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            const reduced = downsample(input, ratio);
            const { frequency, rms } = detectPitch(reduced, sampleRate / ratio);
            this.pushSample(frequency, rms);
        };

        // 麦克风不接输出，避免回授
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        this.silentGain = silentGain;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);
    }

    private pushSample(frequency: number, rms: number) {
        if (!this.audioContext || !this.getSongTime) {
            return;
        }
        const elapsed = this.audioContext.currentTime - this.startCtxTime;
        let songTime = this.startSongTime + elapsed;

        // 播放进度被拖动过就重新对齐
        const actual = this.getSongTime();
        if (Math.abs(actual - songTime) > 0.5) {
            this.startSongTime = actual - elapsed;
            songTime = actual;
        }
        this.samples.push({ time: songTime, frequency, volume: rms });
    }

    /** 停止录音，释放麦克风 */
    stop(): IPitchSample[] {
        if (this.processor) {
            this.processor.onaudioprocess = null;
            this.processor.disconnect();
            this.processor = undefined;
        }
        this.source?.disconnect();
        this.source = undefined;
        this.silentGain?.disconnect();
        this.silentGain = undefined;
        if (this.audioContext) {
            void this.audioContext.close();
            this.audioContext = undefined;
        }
        this.releaseStream();
        return this.samples;
    }

    private releaseStream() {
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = undefined;
    }
}

/** 音高转成半音（相对 A4 = 440Hz） */
export function frequencyToSemitone(frequency: number): number {
    return 12 * Math.log2(frequency / 440);
}
