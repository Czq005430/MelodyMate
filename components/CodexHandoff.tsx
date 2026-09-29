"use client";

import { useState } from "react";

type Props = {
  project: string;
  disabled: boolean;
  onSubmit: (value: unknown) => Promise<boolean>;
};

export default function CodexHandoff({ project, disabled, onSubmit }: Props) {
  const [proposal, setProposal] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (disabled || submitting || !proposal.trim()) return;
    let value: unknown;
    try { value = JSON.parse(proposal); }
    catch { setError("提案不是有效的 JSON，请让 Codex 检查格式后重新提交。"); return; }
    setError("");
    setSubmitting(true);
    try {
      if (await onSubmit(value)) setProposal("");
      else setError("提案未被接受，请让 Codex 核对当前工程版本和编排内容后重试。内容已保留。");
    } catch {
      setError("这次提案未能提交，请稍后重试。内容已保留。");
    } finally { setSubmitting(false); }
  };

  return <details className="song-handoff">
    <summary>Codex 兼容交接</summary>
    <p>由当前 Codex 读取工程并填写提案，你不用手动复制或编写 JSON。提交后仍需在页面试听、采纳，才会改变作品。</p>
    <p>这是通过页面操作完成的兼容交接，不代表 WebMCP 已连接。</p>
    <label>当前工程（只读）<textarea aria-label="当前编曲工程" value={project} readOnly rows={6} spellCheck={false} /></label>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>编曲提案<textarea aria-label="Codex 编曲提案 JSON" value={proposal} onChange={event => { setProposal(event.target.value); setError(""); }} maxLength={40000} disabled={disabled || submitting} rows={6} spellCheck={false} placeholder="由当前 Codex 在这里填写编曲提案" /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="button button-secondary" disabled={disabled || submitting || !proposal.trim()}>提交编曲提案</button>
      {submitting && <p role="status">正在检查编曲提案…</p>}
    </form>
  </details>;
}
