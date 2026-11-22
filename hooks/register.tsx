import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { enterLangdock, isLangdockConnected, langdock, registerLangdock, renderLangdock, startLangdock } from '../platforms/langdock'
import type { $T, PlatformInfo, RenderEvent } from '../platforms/platform'

// AiConnect hub: /AiConnect opens a list of platforms; opening one shows that platform's own screen.
// To add a platform: create a folder under platforms/ (see platforms/langdock), list its PlatformInfo
// below, and add a line for it in each of the four helpers and in `register`.
// (A mod may only pass `$` and `on` to functions it names or imports, so the hub dispatches by name.)
const PLATFORMS: PlatformInfo[] = [langdock]

async function isConnected($: $T, id: string): Promise<boolean> {
  if (id === 'langdock') return isLangdockConnected($)
  return false
}

async function enter($: $T, id: string): Promise<void> {
  if (id === 'langdock') await enterLangdock($)
}

async function draw($: $T, e: RenderEvent, id: string, back: () => Promise<void>): Promise<unknown> {
  if (id === 'langdock') return renderLangdock($, e, back)
  return null
}

async function start($: $T, cwd: string): Promise<void> {
  await startLangdock($, cwd)
}

const PANE = 'aiconnect'

const hub = atom({ plugin: 'aiconnect', key: 'hub' } as const, { platform: null }, { shape: 'hub-1' })

// Same dark theme as the Langdock screen.
const C = {
  bg: '#1b1b1f',
  surface: '#2a2a2f',
  border: '#3b3b42',
  hover: '#3a3a41',
  text: '#ececf1',
  muted: '#a1a1aa',
  green: '#34d399',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'AiConnect', description: 'Open AiConnect: your connected AI platforms' })
    await start($, e.cwd)
    return started
  })

  registerLangdock(on)

  on('command.run', { command: 'AiConnect' }, async $ => {
    await update($, hub, () => ({ platform: null }))
    await $.ui.open({ id: PANE, title: 'AiConnect' })
    return { text: 'AiConnect opened.', isTextDisplayOnly: true }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { platform: openId } = await read($, hub)
    const open = PLATFORMS.find(p => p.id === openId)
    const goBack = async () => {
      await update($, hub, () => ({ platform: null }))
    }
    // A platform's own screen, drawn by the platform.
    if (open) return (await draw($, e, open.id, goBack)) as never

    const { Box, Text, Button } = $.ui.resolve(e) as unknown as Record<string, any>
    const rows = await Promise.all(PLATFORMS.map(async p => ({ p, connected: await isConnected($, p.id) })))
    const connected = rows.filter(r => r.connected)
    const available = rows.filter(r => !r.connected)

    const card = ({ p, connected: isOn }: { p: PlatformInfo; connected: boolean }) => (
      <Box key={'platform-' + p.id} hover={{ backgroundColor: C.hover }} flexDirection="column" padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface}>
        <Button
          key={'open-' + p.id}
          plain
          label={`${p.glyph}  ${p.name}   ${isOn ? '● Connected' : '○ Not connected'}  ›`}
          onPress={async () => {
            await update($, hub, () => ({ platform: p.id }))
            await enter($, p.id)
          }}
        />
        <Text size="caption" color={C.muted}>{p.blurb}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" padding={2} gap={1} backgroundColor={C.bg} flexGrow={1}>
        <Text size="title" weight="bold" color={C.text}>AiConnect</Text>
        <Text color={C.muted}>Use your AI platforms inside Claude Code.</Text>
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text size="footnote" weight="semibold" color={C.muted}>CONNECTED PLATFORMS</Text>
          {connected.length ? connected.map(card) : <Text size="caption" color={C.muted}>No platform is connected yet. Open one below and connect it.</Text>}
        </Box>
        {available.length ? (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text size="footnote" weight="semibold" color={C.muted}>AVAILABLE PLATFORMS</Text>
            {available.map(card)}
          </Box>
        ) : null}
      </Box>
    )
  })
}
