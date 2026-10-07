import { musicHandlers } from "../../../../../../../lib/music-handler.ts";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await context.params;
  return musicHandlers.audio(request, id, index);
}
