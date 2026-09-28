"use client";

type Props = { hasSource: boolean; needsNewSelection: boolean; busy: boolean; onExample: () => void };
const steps = [
  { cue: "先", title: "选一个声音", text: "录一声轻敲，或直接用示例。选出最好听的一小段。", href: "#source-heading" },
  { cue: "再", title: "让它有节奏", text: "点亮格子安排发声，按底部“播放作品”听整段。", href: "#pattern-heading" },
  { cue: "然后", title: "找喜欢的感觉", text: "生成两个方向，分别试听；喜欢哪个，再采纳。", href: "#suggestions-heading" },
  { cue: "最后", title: "保存你的小品", text: "随时撤销重来。满意后点“导出作品”保存音频。", href: "#work-player" },
];

export default function CreationGuide({ hasSource, needsNewSelection, busy, onExample }: Props) {
  return <section className="creation-guide" aria-labelledby="guide-heading">
    <div className="guide-heading"><div><span className="eyebrow">从第一声开始</span><h2 id="guide-heading">不会做音乐，也可以从这四步开始。</h2><p>先做一段 8～12 秒的音乐小品：让你的声音当主角，再加一点节奏和和声。</p></div><span className="guide-badge">无需先连接 AI</span></div>
    <ol className="guide-route">{steps.map(step => <li key={step.title}><a href={step.href}><span className="guide-cue">{step.cue}</span><strong>{step.title}<span aria-hidden="true">↗</span></strong><span>{step.text}</span></a></li>)}</ol>
    <div className="guide-next"><p><strong>{needsNewSelection ? "先找一个更清楚的片段" : hasSource ? "你已经有了第一份节奏" : "第一次来，可以先跟着示例试试"}</strong><span>{needsNewSelection ? "当前选区几乎没有声音，移动选区或重新录制后再继续。" : hasSource ? "先按底部“播放作品”听初稿，再加减几格。各区的问号卡片会解释它们的作用。" : "点下面的按钮载入玻璃轻敲，再按底部“播放作品”。你的声音也可以这样开始。"}</span></p>{!hasSource ? <button className="button button-primary" type="button" disabled={busy} onClick={() => { onExample(); document.getElementById("source-heading")?.scrollIntoView({ block: "start" }); }}>用玻璃示例开始 <span aria-hidden="true">→</span></button> : <a className="button button-secondary" href={needsNewSelection ? "#source-heading" : "#pattern-heading"}>{needsNewSelection ? "回到声音选区" : "去调整节奏"}<span aria-hidden="true">→</span></a>}</div>
    <details className="feeling-guide"><summary>有想要的感觉，但不知道怎么调？<span aria-hidden="true">＋</span></summary><div className="feeling-recipes">
      <article><span className="recipe-mood">想松弛一点</span><p>选 <strong>80 · 松弛</strong>，只留第 <strong>1、9 格</strong>，再选“有起有落”。</p><small>少一些敲击，多一点留白。</small></article>
      <article><span className="recipe-mood">想跳跃一点</span><p>选 <strong>120 · 跃动</strong>，点亮 <strong>1、4、5、7、9、12、13、15 格</strong>，试“循环铺开”。</p><small>多一些错开的敲击，听起来更活跃。</small></article>
      <article><span className="recipe-mood">想温柔一点</span><p>选 <strong>80 · 松弛</strong>和<strong>“柔和一点”</strong>。需要背景时，再试少量“暖色和声”。</p><small>柔化尖锐感；和声不搭时就关闭。</small></article>
    </div><p className="recipe-note">这些是手动调整的起点，不会自动更改作品。每改一项就播放听听；目前先做短音乐片段，暂不制作带歌词和演唱的完整歌曲。</p></details>
  </section>;
}
