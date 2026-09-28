import type { CSSProperties, ReactNode } from "react";

export type IconName = "upload" | "mic" | "play" | "stop" | "undo" | "download" | "spark" | "headphones" | "check" | "glass" | "wood" | "shaker" | "arrow";

const paths: Record<IconName, ReactNode> = {
  upload: <><path d="M12 16V3m-4 4 4-4 4 4" /><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>,
  mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>,
  play: <path d="m8 4 12 8-12 8Z" fill="currentColor" strokeLinejoin="round" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />,
  undo: <><path d="M4 9h10a6 6 0 0 1 0 12h-3M4 9l5-5M4 9l5 5" /></>,
  download: <><path d="M12 3v13m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  spark: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 2v4m-2-2h4" /></>,
  headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  glass: <><path d="m6 3 1 10a5 5 0 0 0 10 0l1-10ZM7 7h10M12 18v4m-4 0h8" /></>,
  wood: <><path d="m4 15 12-9 4 5L8 20ZM5 15l4 5M7 11l9-7M4 7l3-2" /></>,
  shaker: <><rect x="7" y="4" width="10" height="16" rx="4" transform="rotate(25 12 12)" /><path d="m9 9 7 3M4 3 2 5m18 14 2 2" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
};

export default function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
