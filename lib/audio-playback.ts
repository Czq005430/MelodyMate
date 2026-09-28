export type PlaybackContext = Pick<AudioContext,
  "currentTime" | "state" | "destination" | "resume" | "close" | "createBufferSource">;

export class AudioPlayer {
  private context: PlaybackContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private duration = 0;
  private position = 0;
  private factory: () => PlaybackContext;

  constructor(factory: () => PlaybackContext = () => new AudioContext()) {
    this.factory = factory;
  }

  async unlock(): Promise<void> {
    if (!this.context || this.context.state === "closed") this.context = this.factory();
    const context = this.context;
    try {
      if (context.state !== "running") await context.resume();
    } catch {
      throw new Error("无法启动播放，请再次点击播放按钮");
    }
    if (this.context !== context || context.state !== "running") {
      throw new Error("播放尚未就绪，请再次点击播放按钮");
    }
  }

  play(buffer: AudioBuffer, onEnded?: () => void): void {
    const context = this.context;
    if (!context || context.state !== "running") throw new Error("请点击播放按钮启用音频");
    if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("没有可播放的音频");
    this.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.source = source;
    this.duration = buffer.duration;
    this.startedAt = context.currentTime;
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.position = this.duration;
      source.disconnect();
      onEnded?.();
    };
    try {
      source.start();
    } catch {
      this.source = null;
      source.onended = null;
      source.disconnect();
      this.duration = 0;
      throw new Error("播放启动失败，请再次点击播放按钮");
    }
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    this.position = 0;
    this.duration = 0;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
  }

  close(): void {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }

  get elapsed(): number {
    return this.source && this.context
      ? Math.max(0, Math.min(this.duration, this.context.currentTime - this.startedAt))
      : this.position;
  }
}
