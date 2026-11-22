export type LdModel = {
  id: string
  name: string
  provider: string
  hoster: string
  description: string
  context: number
  /** 0-100: where the model sits on Langdock's usage-consumption scale. */
  consumption: number
  efforts: string[]
  defaultEffort: string | null
}

export type LdUsage = {
  sessionPercent: number
  sessionResetsAt: string | null
  weeklyPercent: number
  weeklyResetsAt: string | null
  fetchedAt: string
}

/** A small inline picture of an image file (a JPEG as a data URI, with its size). */
export type LdPreview = { uri: string; w: number; h: number }

/** A file in a message: saved locally (`path`) or still on Langdock (`url`). */
export type LdFile = { name: string; path: string; kind: string; url?: string; preview?: LdPreview }

export type LdResult = {
  prompt: string
  text: string
  files: LdFile[]
  project?: LdProject
  outDir: string
  model: string
  at: string
  error?: string
}

export type LdPrefs = {
  modelId: string
  reasoning: string | null
  plugin: string
  docFormat: string
  convId: string | null
  lastTurnId: string | null
  /** Local folder outputs are written into; null = <project>/langdock-output. */
  workFolder: string | null
  /** Image model for Generate image; null = Langdock's default. */
  imageModelId: string | null
  imageHd: boolean
}

/** One multiple-choice question Langdock asks the person (its ask_user_questions tool). */
export type LdQuestion = {
  id: string
  text: string
  multi: boolean
  options: { id: string; label: string }[]
}

/** The steps of an assistant message, in order, as they stream in. */
export type LdPart =
  | { kind: 'thought'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; label: string; state: 'running' | 'done' | 'error' }
  | {
      kind: 'question'
      id: string
      sessionId: string
      questions: LdQuestion[]
      selected: Record<string, string[]>
      other: Record<string, string>
      state: 'open' | 'sending' | 'answered' | 'dismissed'
    }
  | { kind: 'waiting'; id: string; label: string }

/** A saved project: its folder, and the page to open in a browser if it has one. */
export type LdProject = { dir: string; entry: string | null }

export type LdMsg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  files: LdFile[]
  parts?: LdPart[]
  project?: LdProject
  seconds?: number
  model?: string
  provider?: string
  pending?: boolean
  error?: string
}

export type LdChatRef = { id: string; name: string; updatedAt: string }

export type LdAttachment = { name: string; path: string }

export type LdMenu =
  | 'none'
  | 'plus'
  | 'files'
  | 'folder'
  | 'plugins'
  | 'model'
  | 'models'
  | 'imageModels'
  | 'reasoning'
  | 'connect'
  | 'guide'
  | 'account'

export type LdUi = {
  prefs: LdPrefs
  hasCookie: boolean
  workspace: string
  models: LdModel[]
  imageModels: LdModel[]
  defaultImageModelId: string | null
  usage: LdUsage | null
  status: string
  busy: boolean
  last: LdResult | null
  view: 'home' | 'chat'
  chatTitle: string
  messages: LdMsg[]
  history: LdChatRef[]
  menu: LdMenu
  modelSearch: string
  attachments: LdAttachment[]
  draft: number
}

/** The AiConnect hub: which platform's screen is open (null = the platform list). */
export type HubUi = { platform: string | null }

declare module 'claude-code' {
  interface PluginState {
    aiconnect: { langdockUi: Shaped<LdUi>; hub: Shaped<HubUi> }
  }
}
