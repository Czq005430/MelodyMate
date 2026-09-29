# 钢琴采样来源与许可

本目录中的 `C3.mp3`、`C4.mp3`、`C5.mp3` 为 **Salamander Grand Piano** 的真实钢琴录音，作者 **Alexander Holm**。采用 Tone.js 官方音频资源仓库公开分发的 MP3 文件；本项目未安装 Tone.js，也未把振荡器当作钢琴采样。

- 原作者署名与许可声明：[Tonejs/audio 的 Salamander README](https://github.com/Tonejs/audio/blob/master/salamander/README)
- 音频来源：[Tonejs/audio/salamander](https://github.com/Tonejs/audio/tree/master/salamander)
- 许可：[Creative Commons Attribution 3.0 Unported（CC BY 3.0）](https://creativecommons.org/licenses/by/3.0/)
- 完整许可条款：[CC BY 3.0 legal code](https://creativecommons.org/licenses/by/3.0/legalcode)
- 取得日期：2026-09-29。

CC BY 3.0 允许在保留署名、许可链接和改动说明的条件下复制、分发与改编，包括商业用途。作者没有为本项目或生成作品背书。本说明适用于上述采样素材，不代替项目其他代码或用户录音的许可。

## 改动说明与文件核对

MP3 文件按上游字节原样保存，没有重新编码。运行时浏览器会解码/混为单声道，并为编曲进行有限的音高移调、音量包络、混音及淡出。三个根音 MIDI 编号分别为 48、60、72；这是一套为演示压缩体积的采样子集，不是完整钢琴音源或完整力度层。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| C3.mp3 | 78036 | bb70dd921d81b3dda561c19b5c029292ae5a6fba1947e364bf274218ce19a9d1 |
| C4.mp3 | 78718 | 689eaa4c2fd7f29a2cc0e386eec462156d523a87d701269e5e2458e66056f4f6 |
| C5.mp3 | 68920 | 2f5b0f7422063010fb379e684bfdf2daa3911dcd2251413d79fa2a53029fdc30 |

原始下载地址为 `https://raw.githubusercontent.com/Tonejs/audio/master/salamander/` 下对应同名文件。总音频体积为 225674 字节，约 220.4 KiB。

分发本项目或采样时请保留本说明；分享包含这些钢琴采样的作品时请附上简明致谢：

> Piano samples: Salamander Grand Piano by Alexander Holm, CC BY 3.0. Samples distributed via Tone.js; pitch-shifted and mixed in MelodyMate.

许可链接：https://creativecommons.org/licenses/by/3.0/
