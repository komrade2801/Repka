export type ChatRole = "user" | "assistant"

export type ChatHistoryMessage = {
  role: ChatRole
  content: string
}

export type ChatRequest = {
  message: string
  history?: ChatHistoryMessage[]
}

export type ChatResponse = {
  reply: string
  tools_used: string[]
}

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  toolsUsed?: string[]
  isError?: boolean
}
