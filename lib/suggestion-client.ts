import type { SuggestRequest, SuggestResponse } from "./types.ts";
import { validateSuggestRequest } from "./validation.ts";
import { validateModelResponse } from "./proposals.ts";
import { createPresetSuggestions } from "./presets.ts";

class HttpRejection extends Error {}

export async function fetchSuggestions(input: SuggestRequest, token: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SuggestResponse> {
  validateSuggestRequest(input);
  try {
    const response = await fetcher("/api/suggest", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "X-Demo-Token": token },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      let message = "AI 建议暂时不可用，可尝试本地探索。";
      try {
        const body = await response.json();
        if (typeof body?.error?.message === "string") message = body.error.message;
      } catch { /* An explicit HTTP rejection must remain a rejection. */ }
      throw new HttpRejection(message);
    }
    const data = await response.json();
    if (data?.baseRevision !== input.project.revision || !["ai", "preset"].includes(data?.source)) throw new Error("建议响应已过期或格式不正确");
    const result = validateModelResponse(data, input);
    result.source = data.source;
    if (result.source === "preset") result.message = "以下是本地规则编排，不是 AI 生成结果。";
    return result;
  } catch (error) {
    if (error instanceof HttpRejection) throw error;
    if (input.mode === "edit") throw new Error("AI 连接未完成，作品没有改变，请稍后重试。");
    const result = createPresetSuggestions(input);
    result.message = "AI 连接未完成，已提供本地预置方向。";
    return result;
  }
}
