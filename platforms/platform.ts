import type { EngineInterface, Register } from 'claude-code'

export type $T = EngineInterface
export type On = Parameters<Register>[0]
export type RenderEvent = Parameters<$T['ui']['resolve']>[0]

/**
 * What the AiConnect hub shows for a platform. The platform's behaviour lives in
 * its own folder as plain functions (isConnected, enter, render, start, register);
 * hooks/register.tsx calls them by name, because a Claude Code mod may only pass
 * `$` and `on` to functions it names or imports.
 */
export type PlatformInfo = {
  id: string
  name: string
  /** One character shown beside the name in the platform list. */
  glyph: string
  blurb: string
}
