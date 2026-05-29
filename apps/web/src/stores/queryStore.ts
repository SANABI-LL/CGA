import { create } from 'zustand'
import type { AIAnswerState, QueryRecord } from '@campusgeo/shared-types'

interface QueryState {
  currentQuery: string
  queryHistory: QueryRecord[]
  aiAnswer: AIAnswerState | null
  isLoading: boolean
  sessionId: string

  setCurrentQuery: (q: string) => void
  startQuery: (query: string) => void
  appendAIText: (text: string) => void
  addToolCall: (toolName: string) => void
  completeToolCall: (toolName: string) => void
  finishQuery: () => void
  setError: (message: string) => void
  addToHistory: (record: QueryRecord) => void
  clearHistory: () => void
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useQueryStore = create<QueryState>((set, get) => ({
  currentQuery: '',
  queryHistory: [],
  aiAnswer: null,
  isLoading: false,
  sessionId: generateSessionId(),

  setCurrentQuery: (q) => set({ currentQuery: q }),

  startQuery: (query) =>
    set({
      isLoading: true,
      currentQuery: query,
      aiAnswer: {
        text: '',
        isStreaming: true,
        features: null,
        toolCalls: [],
      },
    }),

  appendAIText: (text) =>
    set((state) => ({
      aiAnswer: state.aiAnswer
        ? { ...state.aiAnswer, text: state.aiAnswer.text + text }
        : null,
    })),

  addToolCall: (toolName) =>
    set((state) => ({
      aiAnswer: state.aiAnswer
        ? {
            ...state.aiAnswer,
            toolCalls: [
              ...state.aiAnswer.toolCalls,
              { toolName, status: 'pending' as const },
            ],
          }
        : null,
    })),

  completeToolCall: (toolName) =>
    set((state) => ({
      aiAnswer: state.aiAnswer
        ? {
            ...state.aiAnswer,
            toolCalls: state.aiAnswer.toolCalls.map((tc) =>
              tc.toolName === toolName ? { ...tc, status: 'done' as const } : tc
            ),
          }
        : null,
    })),

  finishQuery: () =>
    set((state) => {
      const answer = state.aiAnswer
      if (!answer) return { isLoading: false }

      const record: QueryRecord = {
        queryId: `q-${Date.now()}`,
        queryText: state.currentQuery,
        aiResponse: answer.text,
        featureIds: state.aiAnswer?.features?.features.map((f) => String(f.id)) ?? [],
        timestamp: Date.now(),
        sessionId: state.sessionId,
      }

      // Persist to sessionStorage for anonymous users
      try {
        const existing = JSON.parse(sessionStorage.getItem('campusgeo-history') ?? '[]')
        sessionStorage.setItem(
          'campusgeo-history',
          JSON.stringify([record, ...existing].slice(0, 50))
        )
      } catch {
        // Storage not available
      }

      return {
        isLoading: false,
        aiAnswer: answer ? { ...answer, isStreaming: false } : null,
        queryHistory: [record, ...state.queryHistory],
      }
    }),

  setError: (message) =>
    set({
      isLoading: false,
      aiAnswer: {
        text: `Error: ${message}`,
        isStreaming: false,
        features: null,
        toolCalls: [],
      },
    }),

  addToHistory: (record) =>
    set((state) => ({ queryHistory: [record, ...state.queryHistory] })),

  clearHistory: () => set({ queryHistory: [] }),
}))
