# MelodyMate MVP 开发计划

> 实施方式：按 subagent-driven-development 分工，核心算法与接口先写行为测试，完成后做需求与代码审查。设计依据为《软件架构设计-MVP》v1.1。

目标：交付可运行的单页创作工作台，完成导入/录音、波形裁切、四小节编排、AI 建议、撤销、试听及 WAV 导出。

架构：Next.js 单体；音频只在浏览器处理。工程与派生分析分离，模型只输出受限参数提案。没有模型配置时明确使用本地预置探索，不冒充 AI。

技术栈：Next.js、React、TypeScript、CSS、原生 Web Audio；测试使用 Node test runner。生产依赖已获用户确认并安装。沿用现有独立 MelodyMate 仓库，在 codex/melodymate-mvp 分支保留尚未提交的架构修订；不修改父目录旧文件。

## 本轮文件清单

以下均位于 `/Users/bytedance/Desktop/tx-hackthon/MelodyMate/`，除 README.md 外均为新增文件；已有架构与需求文档不改动。

```text
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/package.json
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/package-lock.json
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tsconfig.json
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/next-env.d.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/next.config.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/.gitignore
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/.env.example
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/README.md
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/app/layout.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/app/page.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/app/globals.css
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/app/api/suggest/route.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/components/SourcePanel.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/components/Waveform.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/components/PatternEditor.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/components/SuggestionsPanel.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/components/TransportBar.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/components/Icons.tsx
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/types.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/project.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/validation.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/presets.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/proposals.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/source-analysis.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/arrangement.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/audio-render.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/audio-input.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/audio-playback.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/wav.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/demo-samples.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/model-client.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/request-guard.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/suggest-handler.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/suggestion-client.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/lib/use-studio.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/source-analysis.test.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/arrangement.test.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/wav.test.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/project.test.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/validation.test.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/suggest.test.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/playback.test.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/tests/fixtures.ts
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/docs/MVP开发计划.md
/Users/bytedance/Desktop/tx-hackthon/MelodyMate/docs/MVP验收记录.md
```

## 执行顺序与验收

- [x] 1. 初始化最小工程、类型契约和 npm 脚本。脚本：dev/start、build、typecheck、test、check。新增生产依赖仅 next/react/react-dom，锁定实际安装版本。
- [x] 2. 先测试音频分析、默认选区、四小节事件与 WAV 头/幅度，再实现纯函数。断言静音不除零、6 倍上限、48 kHz 索引正确、结尾兜底、四小节时长为 8/9.6/12 秒。
- [x] 3. 先测试工程校验与历史，再实现默认状态、一次提交一个快照、单调 revision、最多五次撤销、换素材清空历史、音量/伴奏许可和质量约束。
- [ ] 4. 实现浏览器音频入口、播放解锁、离线渲染与缓存、统一停止通道；导出复用当前已采纳版本，忽略临时独奏状态。测试停止后异步渲染不补播。
- [x] 5. 实现单页工作台：深色背景、暖橙波形与节奏、黄绿色播放状态；一眼看到从声音到作品。功能按钮必须连接真实行为；合成示例明确标注，不冒充自录声音。
- [x] 6. 先测试 API 输入/口令/Origin/限频/异常，再实现 TokenHub fetch 适配、白名单 patch、实际差异说明与预置降级。无配置不伪造 AI 返回。已通过注入模型响应的自动测试，真实 TokenHub 联调单独待验收。
- [x] 7. 串联两个方向、候选试听/采纳、自然语言局部修改、过期响应失效。请求期间手动修改仍生效；旧版本结果不能覆盖。真实模型联调另列于验收记录。
- [x] 8. 执行 npm run check 和 npm run build；通过真实浏览器验证示例载入、裁切、节奏修改、伴奏、候选、撤销与一次导出。麦克风和真实 TokenHub 调用依赖用户授权/本地凭证，未实测部分明确记录。
- [x] 9. 需求审查通过后做代码质量审查，修复可重现问题；更新 README、环境模板和验收记录，保留可运行的本地服务供用户体验。

## 共享接口

当前进度：全部 MVP 模块已实现，51 项核心测试、类型检查、生产构建通过。内置浏览器已验证本地创作主要流程，服务位于 http://127.0.0.1:3000 。第 4 项实现完成，但完整渲染竞态与真实录音矩阵仍待现场验证；真实 TokenHub 联调、有效文件导入和连续下载等具体未验场景见《MVP验收记录》。导出增加了显式“保存上次导出”链接，不再仅依赖自动下载。

所有业务类型集中在 lib/types.ts，采用架构文档定义的 Project / SourceAnalysis / SuggestRequest / SuggestResponse。测试通过 `.ts` 相对导入，避免运行器额外路径别名。

音频纯函数接收 `AudioData`（sampleRate、length、numberOfChannels、getChannelData），与 AudioBuffer 结构兼容。`analyzeSource(source, sourceId, trim)` 返回 `{analysis, samples, trim}`，samples 是单声道去直流 PCM；`suggestTrim(source)` 返回合法默认选区；`expandArrangement(params)` 返回 `{bar, step, time, velocity}[]`。`encodeWav(samples, sampleRate)` 返回 ArrayBuffer。

`createProject(sourceId, label, duration, trim, revision)` 创建工程；`projectReducer` 维护 `{project, history}`；校验函数抛出有中文原因的错误。`validateProject(project, analysis?)`、`validateSuggestRequest(body)`、`validatePatch(patch, target, project, analysis)` 为统一入口。

`createPresetSuggestions(request)` 返回两个可听不同的预置方向。`validateModelResponse(raw, request)` 严格校验模型提案并派生说明。`handleSuggest(request)` 返回标准 Response，Next Route Handler 只转调，不加入第二套业务逻辑。

## 完成标准

有可运行的真实工作台、通过的核心行为测试、可生产构建及清晰的凭证配置说明。原声音频不上传，AI 与本地预置标识明确；任何未具备条件的外部验证如实列出，不使用静态假结果代替。
