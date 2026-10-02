import { chatResponse } from "@/server/chat";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 180;
export const POST = handle(chatResponse);
