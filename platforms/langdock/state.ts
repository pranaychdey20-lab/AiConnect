import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LdPrefs, LdUi } from '../../types'

export type $T = EngineInterface

export const DEFAULT_PREFS: LdPrefs = {
  modelId: 'auto',
  reasoning: null,
  plugin: '',
  docFormat: 'pdf',
  convId: null,
  lastTurnId: null,
  workFolder: null,
  imageModelId: null,
  imageHd: false,
}

export const INITIAL: LdUi = {
  prefs: DEFAULT_PREFS,
  hasCookie: false,
  workspace: 'Langdock',
  models: [],
  imageModels: [],
  defaultImageModelId: null,
  usage: null,
  status: 'Not connected',
  busy: false,
  last: null,
  view: 'home',
  chatTitle: '',
  messages: [],
  history: [],
  menu: 'none',
  modelSearch: '',
  attachments: [],
  draft: 0,
}

// Change the tag when LdUi's fields change: an older stored value is then read as absent.
export const ui = atom({ plugin: 'aiconnect', key: 'langdockUi' } as const, INITIAL, { shape: 'ui-5' })

export async function getPrefs($: $T): Promise<LdPrefs> {
  const stored = (await $.store.get('langdock.prefs')) as Partial<LdPrefs> | undefined
  return { ...DEFAULT_PREFS, ...(stored ?? {}) }
}

export async function setPrefs($: $T, patch: Partial<LdPrefs>): Promise<LdPrefs> {
  const next = { ...(await getPrefs($)), ...patch }
  await $.store.set('langdock.prefs', next)
  await update($, ui, u => ({ ...u, prefs: next }))
  return next
}

export async function setUi($: $T, patch: Partial<LdUi> | ((u: LdUi) => Partial<LdUi>)): Promise<void> {
  await update($, ui, u => ({ ...u, ...(typeof patch === 'function' ? patch(u) : patch) }))
}

export async function getCookie($: $T): Promise<string | undefined> {
  const c = (await $.store.get('langdock.cookie')) as string | undefined
  return c && c.trim() ? c.trim() : undefined
}

export async function setCookie($: $T, cookie: string): Promise<void> {
  await $.store.set('langdock.cookie', cookie)
}

export async function clearCookie($: $T): Promise<void> {
  await $.store.delete('langdock.cookie')
}
