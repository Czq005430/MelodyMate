import { createRequestGuard, readJsonBody, RequestError, type ServerEnv } from "./request-guard.ts";
import { modelConfigured, requestModel } from "./model-client.ts";
import { validateSuggestRequest } from "./validation.ts";
import { validateModelResponse } from "./proposals.ts";
import { createPresetSuggestions } from "./presets.ts";
import type { SuggestRequest } from "./types.ts";

const headers = { "Cache-Control": "no-store" };
function unavailable(): RequestError {
  return new RequestError(503, "MODEL_UNAVAILABLE", "云端建议暂时不可用，作品未改变；可以继续手动制作或使用本地预置。");
}

export function createSuggestHandler(deps: { env?: ServerEnv; fetch?: typeof fetch; clock?: () => number } = {}) {
  const env = deps.env ?? process.env;
  const fetcher = deps.fetch ?? fetch;
  const guard = createRequestGuard({ env, clock: deps.clock });
  return async function handle(request: Request): Promise<Response> {
    try {
      guard.check(request);
      const body = await readJsonBody(request);
      let input: SuggestRequest;
      try {
        input = validateSuggestRequest(body);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "SOURCE_TOO_QUIET") {
          throw new RequestError(400, "SOURCE_TOO_QUIET", "声音太轻，请重新录制或调整选区。");
        }
        throw new RequestError(400, "INVALID_REQUEST", "请求参数无效，请检查素材、选区和修改内容。");
      }
      if (!modelConfigured(env)) {
        if (input.mode === "edit") throw unavailable();
        return Response.json(createPresetSuggestions(input), { headers });
      }
      const release = guard.acquire();
      try {
        const raw = await requestModel(input, env, fetcher);
        return Response.json(validateModelResponse(raw, input), { headers });
      } catch (error) {
        if (error instanceof RequestError) throw error;
        if (input.mode === "edit") throw unavailable();
        return Response.json(createPresetSuggestions(input), { headers });
      } finally {
        release();
      }
    } catch (error) {
      const safe = error instanceof RequestError ? error : unavailable();
      return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers });
    }
  };
}

export const handleSuggest = createSuggestHandler();
