# Suno 伴奏接入开发计划

日期：2026-10-07。承接《Suno接入调研与实施方案》，用户已要求开始开发，并确认没有 API Key，先实现后提供开通步骤。

目标：在当前创作室增加文字生成器乐伴奏、任务恢复、导入/试听伴奏、保留原声的混合导出。无 Key 时可导入合法取得的伴奏；不伪造 Suno 生成结果。第一期不上传录音、不做 Cover/续写/分轨，不新增生产依赖。

架构：保留 Next.js 单体。本机 Kie 适配使用 fetch；服务端持 Key、任务 JSON 和结果音频。浏览器保存工程、任务关联，独立混合伴奏与原声。生成 BPM 仅为要求，检测值需要试听确认；固定拍速校准不承诺处理任意速度漂移。

技术栈：现有 Next.js / React / TypeScript、Node 内置文件与测试 API、Web Audio、IndexedDB。总改动会超过 200 行，按任务与音频职责拆分，避免加入队列服务、数据库、通用 DAW 或多服务商平台。

## 修改范围

下列路径均位于 `/Users/bytedance/Desktop/tx-hackthon/MelodyMate`，在应用改动前列出：

- 新增 `docs/Suno开发计划.md`、`docs/Suno测试与开通指南.md`。
- 修改 `docs/Suno接入调研与实施方案.md`：补充免费额度核实结果和本期落地边界。
- 新增 `lib/music-types.ts`、`lib/music-provider.ts`、`lib/music-jobs.ts`、`lib/music-handler.ts`：合同、供应商请求、持久任务与 HTTP 校验。
- 新增 `app/api/music/config/route.ts`、`app/api/music/jobs/route.ts`、`app/api/music/jobs/[id]/route.ts`、`app/api/music/jobs/[id]/audio/[index]/route.ts`。
- 新增 `lib/backing-grid.ts`、`lib/backing-audio.ts`，修改 `lib/wav.ts`：伴奏节拍估测/原声调度、立体声混合与导出。
- 新增 `lib/music-session.ts`、`lib/song-storage.ts`、`lib/use-music-generation.ts`：任务关联、原声工程保存、客户端提交与恢复。
- 新增 `components/CloudMusicPanel.tsx`、`components/BackingMixer.tsx`。
- 修改 `components/SongStudio.tsx`、`lib/use-song-studio.ts`、`app/globals.css`：嵌入伴奏流程、播放协调、持久化提示和样式。
- 修改 `.env.example`、`.gitignore`、`README.md`：配置、私有音频目录忽略和运行指引。
- 新增 `tests/music-provider.test.ts`、`tests/music-jobs.test.ts`、`tests/music-handler.test.ts`、`tests/backing.test.ts`、`tests/music-session.test.ts`、`tests/song-storage.test.ts`，修改 `tests/wav.test.ts`。

若测试需要修正同一功能的边界，仍限定上述模块；不重写原四小节实验台。

## 一、生成任务（服务端）

- [x] 先写合同测试：纯音乐参数、查询解析、未配置报错、不泄露 Key、重复请求不重复提交、超时状态未知且占预算、错误和文件上限。
- [x] 实现 `MusicBrief` 与任务快照，保存 revision 和 sourceIds；同幂等键但不同内容返回冲突。
- [x] Kie 新版接口只发送文字、器乐要求和时长，不发送原声内容。固定上游域名，模型配置由服务端控制。
- [x] 生成入口要求同源和演示口令，配置接口仅返回是否就绪；请求限制 16 KiB，本机每天默认最多 12 个任务。
- [x] 上游提交前落盘，最多一个进行中的任务；提交不确定不自动重试。状态查询可安全重试，错误不泄露上游完整响应。
- [x] 结果通过受限 HTTPS 下载保存到私有目录，同源受保护 API 读取；下载失败可重试保存，不重新生成。
- [x] 关闭浏览器后不承诺后台保存，重新打开恢复查询；上游资源失效时明确报错。已补充同任务刷新地址、临时查询失败重启恢复、缓存曲目身份隔离回归。

客户端合同：

```ts
type MusicBrief = { prompt: string; bpm: number; durationSec: 120 | 150 | 180; sourceLabels: string[] };
type MusicJobRequest = { requestId: string; projectRevision: number; sourceIds: string[]; brief: MusicBrief };
type MusicStatus = "submitting" | "pending" | "generating" | "ready" | "failed" | "unknown";
type MusicCandidate = { id: string; title: string; durationSec: number | null; audioUrl: string };
// GET config -> { configured, provider: "kie", message, maxJobsPerDay }
// POST jobs -> 202 + MusicJob；GET jobs/:id -> MusicJob。
// MusicJob 包含请求快照字段、id、provider、createdAt、status、message、candidates。
// 所有受保护请求使用 x-demo-token；API Key 只出现在本机环境变量。
```

## 二、原声与独立伴奏（音频）

- [x] 先写测试：拍点估测只作建议，静音/不稳定输入不伪造可信拍点；按实际伴奏时长调度原声，保持段落变化；混音保留双声道与峰值保护。
- [x] 导入 10～360 秒、最多 50 MiB 音频，走独立解码入口，不受短原声导入上限影响。
- [x] 提供实际拍速/首拍校准和试听确认；没有确认时可预听，不标记为已对齐成品。伴奏音高不因速度校准而改变。
- [x] 用当前录音切片和原声节奏组成独立轨，提供原声/伴奏/混合三种试听；生成轨不使用本地钢琴/低音/铺底滑块。
- [x] 实际长度不足 120 秒标明短片段，不能冒充完整两分钟作品；不通过复制背景音乐或补静音凑时长。
- [x] 原声与伴奏分别调音量，立体声 WAV 导出；取消/换素材后旧渲染不覆盖当前作品。

## 三、客户端与数据恢复

- [x] 提交前持久化 requestId/快照，同键重试先取原任务；浏览器刷新恢复任务。演示口令不写入长期存储。
- [x] 原声 PCM/元数据和 SongPlan 保存到 IndexedDB，刷新重建 AudioBuffer；存储失败有明确提示。
- [x] 无 Key 状态解释开通步骤、允许本地导入，不放假成功结果；错误、额度不足、未知提交状态各有下一步。
- [x] 旧 revision 的生成结果标为旧版本候选，用户明确选择后才试听；不自动改写乐谱。
- [x] 原工作台与新播放器互斥；录音、换源、停止操作能取消新渲染。
- [x] 沿用页面现有视觉风格与帮助卡片，手机宽度可操作。

## 四、验证与交付

- [x] `npm run check`（含测试与类型检查）137 项通过；`npm run build` 通过。
- [x] 浏览器检查无 Key 提示、124 秒伴奏导入/分段试听/混合导出、修改音量后重置确认、20 秒伴奏禁止成品导出、原声刷新恢复和 390px 无横向溢出。旧任务版本匹配、重复提交及恢复由自动测试覆盖。
- [x] 写入免费额度的一手来源、注册获取 Key 步骤、环境变量配置和未实测事项。
- [x] 本轮不注册、不充值、不消耗真实生成额度。合同测试使用明确的模拟上游，不将其当作音质验收。
- [ ] 取得 Key 后验证真实接口返回、费用、成曲时长与人工听感，详见开通指南的待办。此项不作为无 Key 开发已完成的能力。

真实账号到位后的六次试听实验仍是上线主流程的依据：比较纯文字整曲、原声参考改编、独立伴奏的完整听感与原声辨识度。第一期只实现其中独立伴奏路线的产品接入。
