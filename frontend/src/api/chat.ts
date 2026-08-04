import { api } from "@/lib/api"
import type { ChatRequest, ChatResponse } from "@/types/chat"

/** LLM + tools can take well over the default API timeout. */
const CHAT_TIMEOUT_MS = 120_000

export async function sendChatMessage(
  payload: ChatRequest,
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>("/chat", payload, {
    timeout: CHAT_TIMEOUT_MS,
  })
  return data
}
