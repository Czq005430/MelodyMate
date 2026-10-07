import { musicHandlers } from "../../../../../lib/music-handler.ts";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return musicHandlers.get(request, (await context.params).id);
}
