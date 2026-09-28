"use client";

import { useState } from "react";
import type { Project, Proposal, SourceAnalysis, SuggestResponse, SuggestTarget } from "../lib/types";
import HelpCard from "./HelpCard";
import Icon from "./Icons";

type Props = {
  project: Project | null; analysis: SourceAnalysis | null; response: SuggestResponse | null;
  pending: boolean; disabled: boolean; token: string; onToken: (value: string) => void;
  onExplore: () => void; onLocalExplore: () => void;
  onEdit: (message: string, target: SuggestTarget) => void;
  onPreview: (proposal: Proposal) => void; onAdopt: (proposal: Proposal) => void;
};

const promptExamples = [
  { message: "少敲几下，留一点呼吸感", target: "source" },
  { message: "整体慢一点", target: "global" },
  { message: "把我的声音变柔和一点", target: "source" },
] as const;

export default function SuggestionsPanel({ project, analysis, response, pending, disabled, token, onToken, onExplore, onLocalExplore, onEdit, onPreview, onAdopt }: Props) {
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<SuggestTarget>("source");
  const unavailable = disabled || pending || !project || !analysis || analysis.quality === "nearSilent";
  const stale = Boolean(response && project && response.baseRevision !== project.revision);
  const selectedTarget = target === "backing" && !project?.backingAllowed ? "source" : target;
  return <section className="panel suggestions-panel" aria-labelledby="suggestions-heading">
    <div className="panel-heading"><span className="section-index mono">03</span><div><h2 id="suggestions-heading">一起找找灵感</h2><p>先听见不同，再选择喜欢的。</p></div></div>
    <HelpCard title="建议怎样变成作品？" role="创作助手 · 帮你比较编排方向">
      <p>生成方向不会自动播放或改变作品。点“试听这个方向”比较，喜欢再点“采纳这个方向”。</p>
      <p>AI 参考文字描述、当前参数和声音测量指标，不直接听原音，也不生成人声或完整歌曲。</p>
      <p className="help-example">还没连接 AI？点“用本地方案试试”也能得到两个方向，再到“给声音一点节奏”区域继续调整。</p>
    </HelpCard>
    <div className="suggestion-lead"><div className="spark-seal"><Icon name="spark" size={25} /></div><h3>这个声音，<br />还可以是什么样？</h3><p>从你的原声出发，<br />试试两种不同的节奏走向。</p><button type="button" className="button button-explore" onClick={onExplore} disabled={unavailable}><Icon name="spark" />{pending ? "正在寻找灵感…" : "生成两个方向"}<Icon name="arrow" size={17} /></button><button type="button" className="text-button local-explore" disabled={unavailable} onClick={onLocalExplore}>用本地方案试试</button></div>
    {pending && <div className="thinking-indicator" role="status"><span /><span /><span /><p>正在为这段声音寻找合适的位置</p></div>}
    <div className="suggestion-results" aria-live="polite">
      <p className="next-step-note">试听不改变作品，采纳后再用底部播放按钮听整段。</p>
      {!response && !pending && <p className="fine-print">{!project ? "先在“一段生活里的声音”中录音、导入文件或选择合成示例，再来生成方向。" : analysis?.quality === "nearSilent" ? "这段声音太轻，先移动选区或重新录制，再生成方向。" : "点击上方按钮生成方向，不会自动播放；结果出现后，再点击“试听这个方向”。"}</p>}
      {response && !pending && <><div className="label-row"><span>{response.source === "ai" ? "AI 创作建议" : "本地预设"}</span><span className="suggestion-origin">{response.source === "ai" ? "参考声音指标" : "本地规则"}</span></div>{response.message && <p className="response-message">{response.message}</p>}{stale && <p className="notice">作品已经有了新的变化，重新获取建议后再试听、采纳。</p>}{response.status === "suggestions" && response.proposals.slice(0, 2).map((proposal, index) => <article className="proposal" key={proposal.id}><span className="proposal-number mono">0{index + 1}</span><div className="proposal-body"><h4>{proposal.title}</h4><p>{proposal.explanation}</p><div className="proposal-actions"><button type="button" className="button button-small button-secondary" disabled={unavailable || stale} onClick={() => onPreview(proposal)}><Icon name="play" size={12} />试听这个方向</button><button type="button" className="text-button" disabled={unavailable || stale} onClick={() => onAdopt(proposal)}>采纳这个方向<Icon name="arrow" size={14} /></button></div></div></article>)}</>}
    </div>
    <form className="edit-request" onSubmit={(event) => { event.preventDefault(); if (!unavailable && message.trim()) onEdit(message.trim(), selectedTarget); }}><label htmlFor="creative-message">再说一点你的想法</label><div className="target-options" role="group" aria-label="想调整的部分">{(["source", "backing", "global"] as const).map((value) => <button type="button" key={value} className={selectedTarget === value ? "is-selected" : ""} aria-pressed={selectedTarget === value} disabled={unavailable || (value === "backing" && !project?.backingAllowed)} onClick={() => setTarget(value)}>{value === "source" ? "原声节奏" : value === "backing" ? "和声伴奏" : "整体感觉"}</button>)}</div><div className="message-input"><textarea id="creative-message" value={message} maxLength={300} disabled={unavailable} onChange={(event) => setMessage(event.target.value)} placeholder="例如：少敲几下，留一点呼吸感" rows={3} /><div><span className="mono">{message.length} / 300</span><button type="submit" aria-label="发送调整想法" disabled={unavailable || !message.trim()}><Icon name="arrow" size={17} /></button></div></div>
      <div className="prompt-examples" role="group" aria-label="点选一个调整想法，只填入文本"><span className="fine-print">点一个例子填入，再决定是否发送：</span>{promptExamples.map((example) => <button type="button" className="prompt-example" key={example.message} disabled={unavailable} onClick={() => { setMessage(example.message); setTarget(example.target); }}>{example.message}</button>)}</div>
      {!token.trim() && <p className="next-step-note">文字调整需要在“创作设置”中连接 AI。现在也可以用本地方案，或到“给声音一点节奏”区域调整节奏、速度和音色。</p>}
      <p className="fine-print">可以调整节奏、快慢、音量和层次。暂不支持歌词、唱歌或添加新音轨。</p>
    </form>
    <details className="connection-settings"><summary>创作设置<span>＋</span></summary><label htmlFor="demo-token">演示口令</label><input id="demo-token" type="password" value={token} onChange={(event) => onToken(event.target.value)} autoComplete="off" spellCheck={false} placeholder="输入口令，连接 AI 建议" /><p className="fine-print">口令只在当前页面内存中保留。原音不上云；文字描述、工程参数和声音指标会发送给 AI。</p></details>
  </section>;
}
