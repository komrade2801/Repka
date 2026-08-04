import { create } from "zustand"

import type { ChatMessage } from "@/types/chat"

type UiState = {
  selectedTaskId: number | null
  isChatOpen: boolean
  messages: ChatMessage[]
  setSelectedTaskId: (id: number | null) => void
  setChatOpen: (open: boolean) => void
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
}

export const useUiStore = create<UiState>((set) => ({
  selectedTaskId: null,
  isChatOpen: true,
  messages: [],
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setChatOpen: (open) => set({ isChatOpen: open }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),
}))
