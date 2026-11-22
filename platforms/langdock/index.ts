import type { $T, PlatformInfo } from '../platform'
import { getCookie } from './state'

export { enterLangdock, registerLangdock, renderLangdock, startLangdock } from './chat'

/** What the AiConnect platform list shows for Langdock. */
export const langdock: PlatformInfo = {
  id: 'langdock',
  name: 'Langdock',
  glyph: '◆',
  blurb: 'GPT, Claude, Gemini and more from your Langdock workspace',
}

export async function isLangdockConnected($: $T): Promise<boolean> {
  return !!(await getCookie($))
}
