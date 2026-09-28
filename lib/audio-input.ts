export async function decodeAudio(blob: Blob, recording = false): Promise<AudioBuffer> {
  if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("请选择不超过 10 MiB 的有效音频");
  const context = new OfflineAudioContext(1, 1, 44100);
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error("无法读取这个音频，请尝试 WAV、MP3 或重新录音");
  }
  if (decoded.duration < 0.05 || (!recording && decoded.duration > 10)) {
    throw new Error("音频时长须为 0.05～10 秒");
  }
  if (!recording || decoded.duration <= 2) return decoded;
  const length = Math.min(decoded.length, Math.round(decoded.sampleRate * 2));
  const trimmed = context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    trimmed.getChannelData(channel).set(decoded.getChannelData(channel).subarray(0, length));
  }
  return trimmed;
}

export async function startRecording(): Promise<{ stop: () => void; result: Promise<Blob> }> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("当前浏览器无法录音，请使用 HTTPS 或 localhost 下的桌面 Chrome");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } });
  } catch {
    throw new Error("未能使用麦克风，请检查权限或导入音频文件");
  }
  const closeTracks = () => stream.getTracks().forEach((track) => track.stop());
  let recorder: MediaRecorder;
  try {
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    closeTracks();
    throw new Error("无法启动录音格式，请改用音频导入");
  }
  const chunks: Blob[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let fail!: () => void;
  const cleanup = () => { clearTimeout(timer); closeTracks(); };
  const result = new Promise<Blob>((resolve, reject) => {
    fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("录音中断，请重新录制或导入音频"));
    };
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = fail;
    recorder.onstop = () => {
      cleanup();
      if (settled) return;
      settled = true;
      if (!chunks.length) reject(new Error("没有录到声音，请重新尝试"));
      else resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0].type }));
    };
  });
  const stop = () => {
    clearTimeout(timer);
    if (settled) return;
    try {
      if (recorder.state !== "inactive") recorder.stop();
      closeTracks();
    } catch { fail(); }
  };
  try {
    recorder.start();
    timer = setTimeout(stop, 2000);
  } catch { fail(); }
  return { stop, result };
}
