import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import type { LdAttachment, LdFile, LdModel, LdMsg, LdResult, LdUi, LdUsage } from '../../types'
import {
  EFFORT_LABEL,
  PLUGINS,
  connect,
  downloadRemote,
  joinPath,
  loadChat,
  pickFiles,
  pickFolder,
  refreshHistory,
  runAsk,
  setSessionCwd,
  uuid,
} from './bridge'
import type { AskInput } from './bridge'
import { INITIAL, clearCookie, getCookie, getPrefs, setCookie, setPrefs, setUi } from './state'
import type { $T } from './state'

// The same session value state.ts writes; the scan wants it declared in each file that reads it.
const ui = atom({ plugin: 'aiconnect', key: 'langdockUi' } as const, INITIAL, { shape: 'ui-5' })

const TOOL_FULL = 'mcp__aiconnect__langdock_ask'

// Langdock's dark theme.
const C = {
  bg: '#1b1b1f',
  surface: '#2a2a2f',
  raised: '#323238',
  border: '#3b3b42',
  hover: '#3a3a41',
  text: '#ececf1',
  muted: '#a1a1aa',
  accent: '#3b82f6',
  bubble: '#2f2f35',
  red: '#f87171',
  green: '#34d399',
}

const PROVIDER_GLYPH: Record<string, { g: string; color: string }> = {
  anthropic: { g: '✳', color: '#d97757' },
  openai: { g: '❂', color: '#ececf1' },
  google: { g: '✦', color: '#60a5fa' },
  mistral: { g: '▙', color: '#fb923c' },
}
const glyph = (provider?: string) => PROVIDER_GLYPH[(provider ?? '').toLowerCase()] ?? { g: '❯', color: '#ececf1' }

const DOC_FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
  { value: 'md', label: 'Document' },
]

const GUIDE = [
  'Open app.langdock.com in Chrome and sign in.',
  'Press F12, open the Network tab, then press F5 to reload.',
  'Click the top row, "chat" (type "document").',
  'In the panel on the right, pick the Headers tab and scroll to Request Headers (not Response Headers).',
  'Find the "cookie:" line: one long run of name=value; pairs.',
  'Right-click it, then Copy value. No such option? Select the whole value and press Ctrl+C.',
  'Click Connect here, paste it, and press Enter. Leaving "cookie:" in front is fine.',
]

// ---------------------------------------------------------------- sending

function formatResult(r: LdResult): string {
  const lines: string[] = []
  if (r.error) lines.push(`Langdock error: ${r.error}`)
  if (r.text) lines.push(r.text)
  if (r.files.length) {
    lines.push('', `Saved from Langdock (${r.model}):`)
    for (const f of r.files) lines.push(`- ${f.path || f.url}  [${f.kind}]`)
  }
  return lines.join('\n').trim() || '(Langdock returned no text)'
}

/** Sends one message; the chat shows it whether the person or Claude sent it. */
async function send($: $T, input: AskInput, fromUi: boolean): Promise<string> {
  if (!(await getCookie($))) return 'Not connected: open /langdock and click Connect.'
  const prefs = await getPrefs($)
  const s = await read($, ui)
  if (s.busy) return 'Langdock is still working on the previous message.'
  const fresh = !!input.newConversation || !prefs.convId || (fromUi && s.view === 'home')
  const attachments = input.attachments ?? []
  const userMsg: LdMsg = {
    id: uuid(),
    role: 'user',
    text: input.prompt,
    files: attachments.map(a => ({ name: a.name, path: a.path, kind: 'attachment' })),
  }
  const pendId = uuid()
  await setUi($, u => ({
    busy: true,
    status: 'Working in Langdock…',
    view: 'chat',
    menu: 'none',
    chatTitle: fresh ? 'New chat' : u.chatTitle,
    messages: [...(fresh ? [] : u.messages), userMsg, { id: pendId, role: 'assistant', text: '', files: [], pending: true }],
    ...(fromUi ? { attachments: [], draft: u.draft + 1 } : {}),
  }))
  const settle = (m: Partial<LdMsg>) => setUi($, u => ({ messages: u.messages.map(x => (x.id === pendId ? { ...x, ...m, pending: false } : x)) }))
  try {
    const r = await runAsk($, { ...input, newConversation: fresh })
    await settle({ text: r.text, files: r.files, model: r.model, provider: r.modelProvider, ...(r.error ? { error: r.error } : {}) })
    await setUi($, { last: r, status: r.error ? 'Last message failed' : 'Connected' })
    return formatResult(r)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await settle({ error: msg })
    await setUi($, { status: msg.slice(0, 120) })
    return `Langdock error: ${msg}`
  } finally {
    await setUi($, { busy: false })
  }
}

async function newChat($: $T): Promise<void> {
  await setPrefs($, { convId: null, lastTurnId: null })
  await setUi($, u => ({ view: 'home', messages: [], chatTitle: '', menu: 'none', draft: u.draft + 1 }))
}

/** Called by the hub when the Langdock tile is opened: always lands on the home screen. */
export async function enterLangdock($: $T): Promise<void> {
  await newChat($)
  if (await getCookie($)) void refreshHistory($).catch(() => undefined)
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

async function openLocal($: $T, path: string): Promise<void> {
  await $.process.run(['cmd', '/c', 'start', '', path.replace(/\//g, '\\')], { timeoutMs: 10_000 })
}

// ---------------------------------------------------------------- drawing helpers

function fmtContext(n: number): string {
  if (!n) return '—'
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`
}

const BUCKETS = ['Low', 'Moderate', 'High', 'Very high']
const bucketOf = (pct: number) => Math.min(3, Math.max(0, Math.floor(pct / 25)))

function consumptionSvg(pct: number): string {
  const w = 300
  const x = 8 + ((w - 16) * Math.min(100, Math.max(0, pct))) / 100
  const active = bucketOf(pct)
  const labels = BUCKETS.map((b, i) => {
    const cx = 8 + ((w - 16) * (i * 25 + 12.5)) / 100
    const on = i === active
    return `<text x="${cx}" y="40" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="${on ? 600 : 400}" fill="${on ? '#34d399' : '#8a8a93'}">${b}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="48" viewBox="0 0 ${w} 48"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="0.35" stop-color="#eab308"/><stop offset="0.65" stop-color="#f97316"/><stop offset="0.85" stop-color="#ef4444"/><stop offset="1" stop-color="#c026d3"/></linearGradient></defs><rect x="8" y="10" width="${w - 16}" height="4" rx="2" fill="url(#g)"/><circle cx="${x}" cy="12" r="6" fill="#10b981" stroke="#1f1f23" stroke-width="2"/>${labels}</svg>`
}

function ringSvg(pct: number): string {
  const r = 8
  const c = 2 * Math.PI * r
  const p = Math.min(100, Math.max(0, pct)) / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="${r}" fill="none" stroke="#3b3b42" stroke-width="3"/><circle cx="11" cy="11" r="${r}" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 11 11)"/></svg>`
}

function sliderSvg(steps: number, index: number): string {
  const w = 260
  const gap = (w - 40) / Math.max(1, steps - 1)
  const xs = Array.from({ length: steps }, (_, i) => 20 + i * gap)
  const dots = xs.map((x, i) => `<circle cx="${x}" cy="18" r="${i === index ? 11 : 3}" fill="${i === index ? '#ffffff' : i < index ? '#dbeafe' : '#9ca3af'}"/>`).join('')
  const fill = xs[index] ?? 20
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="36" viewBox="0 0 ${w} 36"><rect x="4" y="6" width="${w - 8}" height="24" rx="12" fill="#3f3f46"/><rect x="4" y="6" width="${fill + 8}" height="24" rx="12" fill="#3b82f6"/>${dots}</svg>`
}

function resetText(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (d.toDateString() === now.toDateString()) return `Resets at ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Resets tomorrow at ${time}`
  return `Resets ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

// ---------------------------------------------------------------- register

/** Session setup, called by the hub's session.start hook once the session is bound. */
export async function startLangdock($: $T, cwd: string): Promise<void> {
  setSessionCwd(cwd)
  await $.tool.register({
    name: 'langdock_ask',
    isDeferred: false,
    description:
      "Send a task to the user's Langdock workspace (frontier models such as GPT-6.2 Astra, Fable 5.2, Opus 5.5, Gemini 4) and get the result back. " +
      'Langdock runs it in its own sandbox and can return text, code projects (written into the project, or into the folder the user picked), images, PDFs/Word/Markdown documents, videos and deep research. ' +
      'Use it when the user asks to use Langdock or one of its models, or for image/document/video generation. It continues the open Langdock chat unless newConversation is true. ' +
      "Leave model/reasoning/plugin empty to use what the user picked in the Langdock pane. The reply is Langdock's final answer plus the local paths of saved files.",
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The full task for the Langdock model.' },
        model: { type: 'string', description: 'Optional model display name, e.g. "GPT-6.2 Astra", "Fable 5.2", "Opus 5.5", or "Auto".' },
        reasoning: { type: 'string', enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], description: 'Optional reasoning effort.' },
        plugin: { type: 'string', enum: ['', ...PLUGINS.map(p => p.id)], description: 'Optional plugin: web_search, image_generation, write_document, internal_search, research.' },
        documentFormat: { type: 'string', enum: ['pdf', 'docx', 'md'], description: 'With plugin write_document: the output format.' },
        newConversation: { type: 'boolean', description: 'Start a new Langdock chat instead of continuing the open one.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Optional absolute paths of local files to attach.' },
      },
      required: ['prompt'],
    },
  })

  const prefs = await getPrefs($)
  const hasCookie = !!(await getCookie($))
  await setUi($, { prefs, hasCookie, busy: false })
  if (hasCookie) void connect($)
}

type On = Parameters<Register>[0]

/** Langdock's own hooks: hiding and serving the tool Claude can call. The hub registers the command, pane and session start. */
export function registerLangdock(on: On): void {
  // The mod is "on" while connected: with no cookie, Claude is not offered the tool at all.
  on('tool.list', async ($, e, next) => {
    const r = await next(e)
    if ((await getCookie($)) || !r.value) return r
    return { value: r.value.filter(t => t.name !== TOOL_FULL) }
  })

  on('tool.run', { tool: TOOL_FULL }, async ($, e) => {
    // The tool's arguments arrive flat on the event, beside `tool` and `tool_use_id`.
    const input = e as unknown as AskInput & { files?: unknown }
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) return { deny: 'prompt is required' }
    // `files` may arrive as a list, a JSON-encoded list, or one path.
    let files: unknown = input.files ?? []
    if (typeof files === 'string') {
      try {
        files = JSON.parse(files)
      } catch {
        files = [files]
      }
    }
    const paths = (Array.isArray(files) ? files : []).filter((p): p is string => typeof p === 'string' && !!p.trim())
    const attachments: LdAttachment[] = paths.map(p => ({ name: basename(p), path: p }))
    const { files: _f, ...rest } = input
    return { result: await send($, { ...rest, attachments }, false) }
  })
}

// ---------------------------------------------------------------- the chat pane

type RenderEvent = Parameters<$T['ui']['resolve']>[0]

/** Draws the Langdock chat; `onBack` returns to the AiConnect platform list. */
export async function renderLangdock($: $T, e: RenderEvent, onBack: () => Promise<void>): Promise<unknown> {
    const els = $.ui.resolve(e) as unknown as Record<string, any>
    const { Box, Text, Button, Input, Select, Markdown, Progress } = els
    const Svg = els.Svg
    const s: LdUi = await read($, ui)
    const p = s.prefs
    const model: LdModel | null = s.models.find(m => m.id === p.modelId) ?? null
    const effort = model && model.efforts.length ? (p.reasoning && model.efforts.includes(p.reasoning) ? p.reasoning : (model.defaultEffort ?? model.efforts[0] ?? null)) : null
    const plugin = PLUGINS.find(x => x.id === p.plugin) ?? null
    const imageModel: LdModel | null = s.imageModels.find(m => m.id === (p.imageModelId ?? s.defaultImageModelId)) ?? s.imageModels[0] ?? null
    const menu = (m: LdUi['menu']) => setUi($, u => ({ menu: u.menu === m ? 'none' : m }))

    // ---- usage ring: the card is a child of the ring's keyed Box, shown while the pointer is on it
    const u: LdUsage | null = s.usage
    const usageCard = u ? (
      <Box
        position="absolute"
        bottom={2}
        right={0}
        width={44}
        display="none"
        hover={{ display: 'flex' }}
        flexDirection="column"
        gap={1}
        padding={1}
        borderStyle="round"
        borderColor={C.border}
        backgroundColor={C.surface}
      >
        <Text size="caption" color={C.muted}>Plan usage limits</Text>
        <Progress label="Current session" value={u.sessionPercent} max={100} valueText={`${u.sessionPercent}% used`} color={C.accent} />
        <Text size="caption" color={C.muted}>{resetText(u.sessionResetsAt)}</Text>
        <Progress label="Weekly usage" value={u.weeklyPercent} max={100} valueText={`${u.weeklyPercent}% used`} color={C.accent} />
        <Text size="caption" color={C.muted}>{resetText(u.weeklyResetsAt)}</Text>
      </Box>
    ) : null
    const ring = (
      <Box key="usage-ring" paddingX={1}>
        {Svg && u ? <Svg source={ringSvg(u.sessionPercent)} alt={`Session usage ${u.sessionPercent}%`} width={22} height={22} /> : <Text color={C.muted}>◔</Text>}
        {usageCard}
      </Box>
    )

    // ---- model detail card (as Langdock's hover card)
    const detailCard = (m: LdModel, extra: Record<string, unknown> = {}) => (
      <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface} {...extra}>
        <Text>
          <Text color={glyph(m.provider).color}>{glyph(m.provider).g} </Text>
          <Text color={C.muted}>{m.hoster} / </Text>
          <Text weight="semibold" color={C.text}>{m.name}</Text>
        </Text>
        {m.description ? <Text size="caption" color={C.text}>{m.description}</Text> : null}
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={C.text}>Context</Text>
          <Text color={C.text}>{fmtContext(m.context)}</Text>
        </Box>
        <Text color={C.text}>Usage consumption</Text>
        {Svg ? <Svg source={consumptionSvg(m.consumption)} alt={`Usage consumption: ${BUCKETS[bucketOf(m.consumption)]}`} width={300} height={48} /> : <Text color={C.muted}>{BUCKETS.map((b, i) => (i === bucketOf(m.consumption) ? `[${b}]` : b)).join('  ')}</Text>}
      </Box>
    )

    // ---- top-left: connect / connected, with the guide
    const connectButton = s.hasCookie ? (
      <Button key="conn" plain label="● Connected" onPress={async () => { await menu('account') }} />
    ) : (
      <Button key="conn" variant="primary" label="Connect" onPress={async () => { await menu('connect') }} />
    )
    const topDrop =
      s.menu === 'connect' ? (
        <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Text size="caption" color={C.muted}>Paste your Langdock cookie value (tap ⓘ for how to get it).</Text>
          <Input
            key={'cookie-' + s.draft}
            placeholder="paste the cookie value"
            submitLabel="Connect"
            onSubmit={async (value: string) => {
              const cookie = value.replace(/^\s*cookie:\s*/i, '').trim()
              if (!cookie) return
              await setCookie($, cookie)
              await setUi($, { hasCookie: true, status: 'Connecting…', menu: 'none' })
              await connect($)
              $.ui.invalidate('tool.list')
            }}
          />
        </Box>
      ) : s.menu === 'guide' ? (
        <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Text weight="semibold" color={C.text}>How to connect</Text>
          {GUIDE.map((step, i) => (
            <Text size="caption" color={C.text}>{i + 1}. {step}</Text>
          ))}
          <Text size="caption" color={C.muted}>Treat the cookie like a password. It stays on this computer. If Langdock logs you out, repeat these steps.</Text>
        </Box>
      ) : s.menu === 'account' ? (
        <Box flexDirection="row" gap={1} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Text size="caption" color={C.muted}>{s.status}</Text>
          <Button key="refresh" label="Refresh" onPress={async () => { await connect($); await setUi($, { menu: 'none' }) }} />
          <Button
            key="disconnect"
            label="Disconnect"
            onPress={async () => {
              await clearCookie($)
              await setUi($, { hasCookie: false, models: [], usage: null, history: [], status: 'Not connected', menu: 'none' })
              $.ui.invalidate('tool.list')
            }}
          />
        </Box>
      ) : null

    // ---- the dropdown under the composer toolbar
    let dropdown: unknown = null
    let align: 'flex-start' | 'flex-end' = 'flex-start'
    if (s.menu === 'plus') {
      dropdown = (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Button
            key="m-files"
            plain
            label="📎  Add files"
            onPress={async () => {
              const picked = await pickFiles($)
              if (picked === null) return void setUi($, { menu: 'files', status: "Couldn't open the file dialog: paste a path instead" })
              if (picked.length) await setUi($, x => ({ attachments: [...x.attachments, ...picked.map(path => ({ name: basename(path), path }))], menu: 'none' }))
              else await setUi($, { menu: 'none' })
            }}
          />
          <Button
            key="m-folder"
            plain
            label="📁  Work in a folder"
            onPress={async () => {
              const picked = await pickFolder($)
              if (picked === null) return void setUi($, { menu: 'folder', status: "Couldn't open the folder dialog: paste a path instead" })
              const path = picked[0]?.replace(/[\\/]+$/, '')
              if (path) await setPrefs($, { workFolder: path })
              await setUi($, { menu: 'none' })
            }}
          />
        </Box>
      )
    } else if (s.menu === 'files') {
      dropdown = (
        <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Text size="caption" color={C.muted}>The file dialog could not open. Paste the file's full path:</Text>
          <Input
            key={'file-path-' + s.draft}
            placeholder="C:\path\to\file.pdf"
            submitLabel="Attach"
            onSubmit={async (value: string) => {
              const path = value.trim().replace(/^"|"$/g, '')
              if (!path || !(await $.fs.exists(path))) return void setUi($, { status: `File not found: ${path}` })
              await setUi($, x => ({ attachments: [...x.attachments, { name: basename(path), path }], menu: 'none' }))
            }}
          />
        </Box>
      )
    } else if (s.menu === 'folder') {
      dropdown = (
        <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Text size="caption" color={C.muted}>The folder dialog could not open. Paste the folder's full path:</Text>
          <Input
            key={'folder-' + s.draft}
            placeholder="C:\Users\you\projects\my-app"
            submitLabel="Use folder"
            onSubmit={async (value: string) => {
              const path = value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '')
              if (!path) return
              if (!(await $.fs.exists(path))) await $.fs.write(joinPath(path, '.langdock'), '')
              await setPrefs($, { workFolder: path })
              await setUi($, { menu: 'none' })
            }}
          />
        </Box>
      )
    } else if (s.menu === 'imageModels') {
      dropdown = (
        <Box flexDirection="column" width={44} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Text size="caption" color={C.muted}>Default image model</Text>
          {s.imageModels.map(m => (
            <Box key={'im-' + m.id} hover={{ backgroundColor: C.hover }} backgroundColor={m.id === imageModel?.id ? C.hover : undefined}>
              <Button plain label={`${glyph(m.provider).g}  ${m.name}`} onPress={async () => { await setPrefs($, { imageModelId: m.id }); await setUi($, { menu: 'none' }) }} />
              {/* the details sit on the right of the list while this row is hovered */}
              <Box position="absolute" top={0} left={46} width={42} display="none" hover={{ display: 'flex' }} flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface}>
                <Text>
                  <Text color={glyph(m.provider).color}>{glyph(m.provider).g} </Text>
                  <Text color={C.muted}>{m.hoster} / </Text>
                  <Text weight="semibold" color={C.text}>{m.name}</Text>
                </Text>
                {m.description ? <Text size="caption" color={C.text}>{m.description}</Text> : null}
              </Box>
            </Box>
          ))}
          <Button key="hd" plain label={`${p.imageHd ? '◉' : '○'}  Enable high definition`} onPress={async () => { await setPrefs($, { imageHd: !p.imageHd }) }} />
          <Text size="caption" color={C.muted}>Best for export-ready images</Text>
        </Box>
      )
    } else if (s.menu === 'model') {
      align = 'flex-end'
      dropdown = (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          {/* each row is one Button, so the whole row is clickable */}
          <Button key="row-model" plain label={`Model       ${model ? glyph(model.provider).g + ' ' + model.name : '❯ Auto'}  ›`} onPress={async () => { await setUi($, { menu: 'models', modelSearch: '' }) }} />
          {model && model.efforts.length ? (
            <Button key="row-reasoning" plain label={`Reasoning   ${EFFORT_LABEL[effort ?? ''] ?? effort}  ›`} onPress={async () => { await setUi($, { menu: 'reasoning' }) }} />
          ) : null}
        </Box>
      )
    } else if (s.menu === 'models') {
      align = 'flex-end'
      const q = s.modelSearch.toLowerCase()
      const list = s.models.filter(m => !q || m.name.toLowerCase().includes(q) || m.hoster.toLowerCase().includes(q))
      dropdown = (
        <Box flexDirection="column" width={42} padding={1} borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Input key="model-search" placeholder="Search models..." value={s.modelSearch} submitLabel="⌕" onInput={(v: string) => { void setUi($, { modelSearch: v }) }} onSubmit={(v: string) => { void setUi($, { modelSearch: v }) }} />
          {!q ? (
            <Box key="m-auto" hover={{ backgroundColor: C.hover }} flexDirection="row" justifyContent="space-between" alignItems="center">
              <Button plain label="❯  Auto" onPress={async () => { await setPrefs($, { modelId: 'auto', reasoning: null }); await setUi($, { menu: 'none' }) }} />
              <Text size="caption" color={C.accent}>Recommended</Text>
            </Box>
          ) : null}
          {list.map(m => (
            <Box key={'m-' + m.id} hover={{ backgroundColor: C.hover }} backgroundColor={m.id === p.modelId ? C.hover : undefined}>
              <Button plain label={`${glyph(m.provider).g}  ${m.name}`} onPress={async () => { await setPrefs($, { modelId: m.id, reasoning: m.defaultEffort }); await setUi($, { menu: 'none' }) }} />
              {/* the details sit on the left of the list while this row is hovered */}
              {detailCard(m, { position: 'absolute', top: 0, left: -46, width: 44, display: 'none', hover: { display: 'flex' } })}
            </Box>
          ))}
        </Box>
      )
    } else if (s.menu === 'reasoning' && model && model.efforts.length) {
      align = 'flex-end'
      const idx = Math.max(0, model.efforts.indexOf(effort ?? ''))
      dropdown = (
        <Box flexDirection="column" gap={1} padding={1} alignItems="center" borderStyle="round" borderColor={C.border} backgroundColor={C.raised}>
          <Text weight="semibold" color={C.text}>{EFFORT_LABEL[effort ?? ''] ?? effort}</Text>
          {Svg ? <Svg source={sliderSvg(model.efforts.length, idx)} alt={`Reasoning ${effort}`} width={260} height={36} /> : null}
          <Box flexDirection="row" gap={1} flexWrap="wrap" justifyContent="center">
            {model.efforts.map(ef => (
              <Button key={'ef-' + ef} variant={ef === effort ? 'primary' : 'secondary'} label={EFFORT_LABEL[ef] ?? ef} onPress={async () => { await setPrefs($, { reasoning: ef }) }} />
            ))}
          </Box>
          <Text size="caption" color={C.muted}>Higher reasoning consumes more usage and may take longer.</Text>
        </Box>
      )
    }

    // ---- composer
    const composer = (
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="column" gap={1} paddingX={1} paddingY={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface}>
          {s.attachments.length ? (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {s.attachments.map((a, i) => (
                <Button key={'att-' + i} label={`📄 ${a.name}  ✕`} onPress={async () => { await setUi($, x => ({ attachments: x.attachments.filter((_, j) => j !== i) })) }} />
              ))}
            </Box>
          ) : null}
          <Input
            key={'prompt-' + s.draft}
            placeholder={s.busy ? 'Langdock is working…' : 'Ask anything, @ for context and skills'}
            rows={2}
            submitLabel="↑"
            onSubmit={(value: string) => {
              if (!value.trim()) return
              void send($, { prompt: value, attachments: s.attachments }, true)
            }}
          />
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={1} alignItems="center">
              <Button key="plus" plain label="＋" onPress={async () => { await menu('plus') }} />
              {plugin ? (
                <Button key="plugin-pill" plain label={`${plugin.icon} ${plugin.label}  ✕`} onPress={async () => { await setPrefs($, { plugin: '' }); await setUi($, { menu: 'none' }) }} />
              ) : null}
              {plugin?.id === 'image_generation' && imageModel ? (
                <Button key="image-model" plain label={`${glyph(imageModel.provider).g} ${imageModel.name}`} onPress={async () => { await menu('imageModels') }} />
              ) : null}
              {plugin?.id === 'write_document' ? <Select key="docfmt" label="Format" options={DOC_FORMATS} value={p.docFormat} onSelect={async (v: string) => { await setPrefs($, { docFormat: v }) }} /> : null}
              {p.workFolder ? (
                <Button key="folder-chip" plain label={`📁 ${basename(p.workFolder)}  ✕`} onPress={async () => { await setPrefs($, { workFolder: null }) }} />
              ) : null}
            </Box>
            <Box flexDirection="row" gap={1} alignItems="center">
              <Button
                key="model-btn"
                plain
                label={model ? `${glyph(model.provider).g} ${model.name}${effort ? '  ' + (EFFORT_LABEL[effort] ?? effort) : ''}` : '❯ Auto'}
                onPress={async () => { await menu('model') }}
              />
              {ring}
            </Box>
          </Box>
        </Box>
        {dropdown ? (
          <Box marginTop={1} flexDirection="row" justifyContent={align}>
            {dropdown}
          </Box>
        ) : null}
        {s.busy ? <Text size="caption" color={C.muted}>Working…</Text> : null}
      </Box>
    )

    const recent = (
      <Select
        key="recent"
        label="Chats"
        options={[{ value: '', label: 'Recent chats' }, ...s.history.map(h => ({ value: h.id, label: h.name }))]}
        value=""
        onSelect={async (id: string) => {
          const ref = (await read($, ui)).history.find(h => h.id === id)
          if (!ref) return
          await setUi($, { view: 'chat', chatTitle: ref.name, messages: [], menu: 'none', status: 'Loading chat…' })
          try {
            const messages = await loadChat($, ref)
            await setUi($, { messages, status: 'Connected' })
          } catch (err) {
            await setUi($, { status: err instanceof Error ? err.message : String(err) })
          }
        }}
      />
    )

    const topBar = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Button key="back" plain label="‹ Platforms" onPress={async () => { await onBack() }} />
            {connectButton}
            <Button key="info" plain label="ⓘ" onPress={async () => { await menu('guide') }} />
            {s.view === 'chat' ? <Text weight="semibold" color={C.text} wrap="truncate">{s.chatTitle || 'Chat'}</Text> : null}
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            {recent}
            <Button key="new-chat" label="✎ New chat" onPress={async () => { await newChat($) }} />
          </Box>
        </Box>
        {topDrop}
      </Box>
    )

    const chips = (
      <Box flexDirection="row" gap={1} flexWrap="wrap" justifyContent="center" marginTop={1}>
        {PLUGINS.map(pl => (
          <Button key={'chip-' + pl.id} variant={p.plugin === pl.id ? 'primary' : 'secondary'} label={`${pl.icon} ${pl.label}`} onPress={async () => { await setPrefs($, { plugin: p.plugin === pl.id ? '' : pl.id }) }} />
        ))}
      </Box>
    )

    // ---- home
    if (s.view === 'home') {
      return (
        <Box flexDirection="column" padding={1} gap={1} backgroundColor={C.bg} flexGrow={1}>
          {topBar}
          <Box flexDirection="column" alignItems="center" gap={1} marginTop={2} marginBottom={1}>
            <Box paddingX={2} borderStyle="round" borderColor={C.border}>
              <Text color={C.text}>{s.workspace}</Text>
            </Box>
            <Text size="title" weight="bold" color={C.text}>What can I do for you?</Text>
          </Box>
          {composer}
          {chips}
        </Box>
      )
    }

    // ---- chat transcript
    const fileRow = (m: LdMsg, f: LdFile, i: number) =>
      f.path ? (
        <Button key={`f-${m.id}-${i}`} plain label={`📎 ${f.name}`} onPress={async () => { await openLocal($, f.path) }} />
      ) : f.url ? (
        <Button
          key={`f-${m.id}-${i}`}
          plain
          label={`⬇ ${f.name}`}
          onPress={async () => {
            const dest = await downloadRemote($, f)
            if (dest) await setUi($, x => ({ messages: x.messages.map(mm => (mm.id === m.id ? { ...mm, files: mm.files.map(ff => (ff.url === f.url ? { ...ff, path: dest } : ff)) } : mm)) }))
          }}
        />
      ) : (
        <Text key={`f-${m.id}-${i}`} size="caption" color={C.muted}>{f.name}</Text>
      )

    const messages = s.messages.map(m =>
      m.role === 'user' ? (
        <Box key={'msg-' + m.id} flexDirection="row" justifyContent="flex-end">
          <Box flexDirection="column" paddingX={2} paddingY={0} borderStyle="round" borderColor={C.bubble} backgroundColor={C.bubble}>
            <Text color={C.text}>{m.text}</Text>
            {m.files.map((f, i) => <Text key={`a-${m.id}-${i}`} size="caption" color={C.muted}>📄 {f.name}</Text>)}
          </Box>
        </Box>
      ) : (
        <Box key={'msg-' + m.id} flexDirection="row" gap={1} alignItems="flex-start">
          <Box paddingX={1} borderStyle="round" borderColor={C.border}>
            <Text color={glyph(m.provider).color}>{glyph(m.provider).g}</Text>
          </Box>
          <Box flexDirection="column" flexShrink={1} gap={1}>
            {m.pending ? <Text color={C.muted}>Thinking…</Text> : null}
            {m.text ? <Markdown text={m.text} /> : null}
            {m.error ? <Text color={C.red}>{m.error}</Text> : null}
            {m.files.map((f, i) => fileRow(m, f, i))}
            {!m.pending && m.model ? <Text size="caption" color={C.muted}>{m.model}</Text> : null}
          </Box>
        </Box>
      ),
    )

    return (
      <Box flexDirection="column" padding={1} gap={1} backgroundColor={C.bg} flexGrow={1}>
        {topBar}
        <Box flexDirection="column" gap={2} marginY={1}>{messages}</Box>
        {composer}
        {chips}
      </Box>
    )
}
