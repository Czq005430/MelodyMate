import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MelodyMate · 把生活，做成音乐",
  description: "从一个生活声音出发，亲手编排属于你的四小节音乐。",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
