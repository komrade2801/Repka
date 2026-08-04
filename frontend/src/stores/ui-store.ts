import { create } from "zustand"

import type { ChatMessage } from "@/types/chat"

type UiState = {
  selectedTaskId: number | null
  isCreatingTask: boolean
  isChatOpen: boolean
  messages: ChatMessage[]
  setSelectedTaskId: (id: number | null) => void
  openCreateTask: () => void
  closeTaskDialog: () => void
  setChatOpen: (open: boolean) => void
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
}

export const useUiStore = create<UiState>((set) => ({
  selectedTaskId: null,
  isCreatingTask: false,
  isChatOpen: true,
  messages: [],
  setSelectedTaskId: (id) =>
    set({
      selectedTaskId: id,
      isCreatingTask: false,
      ...(id !== null ? { isChatOpen: false } : {}),
    }),
  openCreateTask: () =>
    set({
      isCreatingTask: true,
      selectedTaskId: null,
      isChatOpen: false,
    }),
  closeTaskDialog: () =>
    set({
      selectedTaskId: null,
      isCreatingTask: false,
    }),
  setChatOpen: (open) =>
    set((state) => {
      if (
        open &&
        (state.selectedTaskId !== null || state.isCreatingTask)
      ) {
        return state
      }
      return { isChatOpen: open }
    }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),
}))
