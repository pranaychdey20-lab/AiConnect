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

/** A file in a message: saved locally (`path`) or still on Langdock (`url`). */
export type LdFile = { name: string; path: string; kind: string; url?: string }

export type LdResult = {
  prompt: string
  text: string
  files: LdFile[]
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

export type LdMsg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  files: LdFile[]
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

declare module 'claude-code' {
  interface PluginState {
    langdock: { ui: Shaped<LdUi> }
  }
}
