import type { ReactNode } from "react";

export default function HelpCard({ title, role, children }: { title: string; role: string; children: ReactNode }) {
  return <details className="help-card">
    <summary><span className="help-mark" aria-hidden="true">?</span><span>{title}</span><span className="help-toggle" aria-hidden="true">＋</span></summary>
    <div className="help-card-body"><span className="help-role">{role}</span>{children}</div>
  </details>;
}
