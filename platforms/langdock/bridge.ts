import { atom, read } from 'claude-code'

import type { LdAttachment, LdChatRef, LdFile, LdModel, LdMsg, LdPart, LdPreview, LdQuestion, LdResult, LdUsage } from '../../types'
import { INITIAL, getCookie, getPrefs, setPrefs, setUi } from './state'
import type { $T } from './state'

// Langdock bridge: plain HTTP, SSE parsing and file writes. No model call is
// made to move data between Langdock and Claude Code.

const ui = atom({ plugin: 'aiconnect', key: 'langdockUi' } as const, INITIAL, { shape: 'ui-5' })

export const BASE = 'https://app.langdock.com'
const ZERO_ID = '00000000-0000-0000-0000-000000000000'

// The first five entries of Langdock's Plugins menu, with the ids its engine takes.
export const PLUGINS: { id: string; label: string; icon: string }[] = [
  { id: 'web_search', label: 'Web search', icon: '🌐' },
  { id: 'image_generation', label: 'Generate image', icon: '🖼' },
  { id: 'write_document', label: 'Create document', icon: '📄' },
  { id: 'internal_search', label: 'Company knowledge', icon: '🗄' },
  { id: 'research', label: 'Deep research', icon: '🔭' },
]

// Labels exactly as Langdock's reasoning slider shows them.
export const EFFORT_LABEL: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Light',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

const MAKER: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  mistral: 'Mistral',
  zhipu: 'Z.ai',
  zai: 'Z.ai',
  meta: 'Meta',
  deepseek: 'DeepSeek',
}

let sessionCwd = '.'
let appVersion: string | null = null
let appliedImageModel: string | null = null

export function setSessionCwd(cwd: string): void {
  sessionCwd = cwd || '.'
}

export class LdError extends Error {}

// ---------------------------------------------------------------- HTTP

async function ld($: $T, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const cookie = await getCookie($)
  if (!cookie) throw new LdError('Not connected: click Connect in the Langdock screen of /AiConnect and paste your Langdock Cookie header.')
  const res = await $.http.fetch(BASE + path, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { cookie, origin: BASE, referer: BASE + '/chat', accept: '*/*', ...(init.headers ?? {}) },
  })
  if (res.status === 401 || res.status === 403) {
    await setUi($, { status: 'Session expired: paste a fresh Cookie header' })
    throw new LdError('Langdock session expired or invalid (HTTP ' + res.status + '). Click Connect in the Langdock screen of /AiConnect and paste a fresh Cookie header.')
  }
  return res
}

export async function trpc($: $T, procs: string[], inputs: unknown[]): Promise<unknown[]> {
  const inp: Record<string, { json: unknown }> = {}
  procs.forEach((_, i) => (inp[i] = { json: inputs[i] ?? null }))
  const res = await ld($, `/api/trpc/${procs.join(',')}?batch=1&input=${encodeURIComponent(JSON.stringify(inp))}`)
  if (!res.ok) throw new LdError(`Langdock API ${procs.join(',')} failed: HTTP ${res.status}`)
  const arr = JSON.parse(res.text) as { result?: { data?: { json?: unknown } } }[]
  return arr.map(x => x.result?.data?.json)
}

async function fetchVersion($: $T, force = false): Promise<string> {
  if (appVersion && !force) return appVersion
  const res = await $.http.fetch(BASE + '/chat')
  const m = res.text.match(/NEXT_PUBLIC_APP_VERSION["']?\s*:\s*["']([^"']+)["']/)
  if (!m) throw new LdError('Could not read Langdock app version from the web page.')
  appVersion = m[1] ?? ''
  return appVersion
}

// ---------------------------------------------------------------- workspace data

type RawModel = {
  id: string
  displayName: string
  provider: string
  descriptionEn?: string
  contextWindowSize?: number
  usageConsumptionPositionPercent?: number
  allowedReasoningEfforts?: string[] | null
  defaultReasoningEffort?: string | null
  supportsExtendedThinking?: boolean
  visible?: boolean
  maintenance?: boolean
}

export function makerOf(provider: string): string {
  return MAKER[provider.toLowerCase()] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

function mapModel(m: RawModel): LdModel {
  return {
    id: m.id,
    name: m.displayName,
    provider: m.provider,
    // The maker, as Langdock labels it ("Anthropic / Haiku 5.5"), not the cloud it runs on.
    hoster: makerOf(m.provider),
    description: m.descriptionEn ?? '',
    context: m.contextWindowSize ?? 0,
    consumption: m.usageConsumptionPositionPercent ?? 0,
    efforts: m.supportsExtendedThinking === false ? [] : (m.allowedReasoningEfforts ?? []),
    defaultEffort: m.defaultReasoningEffort ?? null,
  }
}

export async function refreshModels($: $T): Promise<LdModel[]> {
  const [raw, rawImg] = await Promise.all([
    trpc($, ['models.getModelsForSelector'], [{ onlyActive: true }]),
    trpc($, ['models.getModelsForSelector'], [{ onlyActive: true, modelTypes: ['image_generation'] }]),
  ])
  const usable = (list: unknown) => ((list as RawModel[]) ?? []).filter(m => m.visible !== false && !m.maintenance).map(mapModel)
  const models = usable(raw[0])
  await setUi($, { models, imageModels: usable(rawImg[0]) })
  return models
}

export async function refreshUsage($: $T): Promise<LdUsage | null> {
  const [raw] = await trpc($, ['usageSettings.getPersonalUsage'], [{}])
  const p = (raw as { planUsage?: Record<string, unknown> } | undefined)?.planUsage
  const usage: LdUsage | null = p
    ? {
        sessionPercent: Number(p.sessionUsagePercent ?? 0),
        sessionResetsAt: (p.sessionResetsAt as string) ?? null,
        weeklyPercent: Number(p.weeklyUsagePercent ?? 0),
        weeklyResetsAt: (p.weeklyResetsAt as string) ?? null,
        fetchedAt: new Date().toISOString(),
      }
    : null
  await setUi($, { usage })
  return usage
}

export async function refreshHistory($: $T): Promise<LdChatRef[]> {
  const [raw] = await trpc($, ['conversation.getConversationHistory'], [{}])
  const buckets = (raw as { buckets?: Record<string, { conversations?: { id: string; name?: string; updatedAt?: string }[] }> })?.buckets ?? {}
  const all: LdChatRef[] = []
  for (const key of ['pinned', 'today', 'last7Days', 'last30Days', 'older']) {
    for (const c of buckets[key]?.conversations ?? []) all.push({ id: c.id, name: c.name || 'Untitled chat', updatedAt: c.updatedAt ?? '' })
  }
  const seen = new Set<string>()
  const history = all.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, 30)
  await setUi($, { history })
  return history
}

async function refreshWorkspace($: $T): Promise<void> {
  const [raw] = await trpc($, ['workspace.getWorkspace'], [{}])
  const ws = raw as { name?: string; defaultImageGenerationModel?: string | null } | undefined
  await setUi($, u => ({ workspace: ws?.name || u.workspace, defaultImageModelId: ws?.defaultImageGenerationModel ?? null }))
}

export async function connect($: $T): Promise<string> {
  try {
    await fetchVersion($, true)
    const models = await refreshModels($)
    await Promise.all([refreshUsage($), refreshHistory($), refreshWorkspace($)])
    const s = `Connected · ${models.length} models`
    await setUi($, { status: s, hasCookie: true })
    return s
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setUi($, { status: msg })
    return msg
  }
}

// ---------------------------------------------------------------- helpers

export function uuid(): string {
  const h = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
    else if (i === 14) s += '4'
    else if (i === 19) s += h[8 + Math.floor(Math.random() * 4)]
    else s += h[Math.floor(Math.random() * 16)]
  }
  return s
}

type SseEvent = Record<string, unknown> & { type?: string }


function resolveModel(models: LdModel[], want: string | undefined, fallbackId: string): LdModel | null {
  const key = (want ?? '').trim().toLowerCase()
  if (!key) return fallbackId === 'auto' ? null : (models.find(m => m.id === fallbackId) ?? null)
  if (key === 'auto') return null
  const squash = (s: string) => s.toLowerCase().replace(/[\s.-]/g, '')
  return (
    models.find(m => m.id.toLowerCase() === key) ??
    models.find(m => m.name.toLowerCase() === key) ??
    models.find(m => squash(m.name) === squash(key)) ??
    models.find(m => m.name.toLowerCase().includes(key)) ??
    null
  )
}

function safeRel(p: string): string | null {
  const parts = p.replace(/\\/g, '/').split('/').filter(x => x && x !== '.')
  if (!parts.length || parts.some(x => x === '..' || /[:*?"<>|]/.test(x))) return null
  return parts.join('/')
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'run'
}

function stamp(): string {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

export function joinPath(a: string, b: string): string {
  return a.replace(/[\\/]+$/, '') + '/' + b
}

function storageUrl(u: string): string {
  if (/^https?:\/\//.test(u)) return u
  const p = u.replace(/^\/+/, '')
  return BASE + '/' + (p.startsWith('api/storage/') ? p : 'api/storage/' + p)
}

/** A path in `dir` for `rel` that does not overwrite an existing file. */
async function freePath($: $T, dir: string, rel: string): Promise<string> {
  let dest = joinPath(dir, rel)
  if (!(await $.fs.exists(dest))) return dest
  const dot = rel.lastIndexOf('.')
  const base = dot > 0 ? rel.slice(0, dot) : rel
  const ext = dot > 0 ? rel.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    dest = joinPath(dir, `${base} (${i})${ext}`)
    if (!(await $.fs.exists(dest))) return dest
  }
  return dest
}

async function curlDownload($: $T, url: string, dest: string): Promise<boolean> {
  const cookie = (await getCookie($)) ?? ''
  await $.fs.write(dest, '') // creates the folders
  const r = await $.process.run(['curl', '-sSL', '--fail', '-H', 'Cookie: ' + cookie, '-H', 'Referer: ' + BASE + '/chat', '-o', dest, url], {
    timeoutMs: 300_000,
  })
  return r.exitCode === 0
}

/** Where a request's outputs land: the chosen work folder, else <project>/langdock-output/<run>. */
async function outputDir($: $T, prompt: string): Promise<string> {
  const prefs = await getPrefs($)
  return prefs.workFolder ? prefs.workFolder : joinPath(sessionCwd, `langdock-output/${stamp()}-${slug(prompt)}`)
}

/** Downloads a file from an older chat into a temp cache (for its inline picture), once. */
export async function cacheRemote($: $T, f: LdFile): Promise<string | null> {
  if (!f.url) return null
  const tmp = (await $.env.get('TEMP')) ?? '.'
  const key = f.url.split('/').slice(-2).join('-').replace(/[^A-Za-z0-9._-]/g, '_')
  const dest = joinPath(joinPath(tmp, 'aiconnect-cache'), key)
  if (await $.fs.exists(dest)) return dest
  return (await curlDownload($, f.url, dest)) ? dest : null
}

/** Downloads one file that is still on Langdock (from an older chat). */
export async function downloadRemote($: $T, f: LdFile): Promise<string | null> {
  if (!f.url) return null
  const dir = await outputDir($, f.name)
  const dest = await freePath($, dir, safeRel(f.name) ?? 'file')
  return (await curlDownload($, f.url, dest)) ? dest : null
}

const MIME: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', js: 'text/javascript', ts: 'text/plain',
  py: 'text/x-python', html: 'text/html', css: 'text/css', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
}

/** Uploads a local file to Langdock and answers its attachment id. */
async function upload($: $T, a: LdAttachment, convId: string | null): Promise<string> {
  const cookie = (await getCookie($)) ?? ''
  const ext = (a.name.split('.').pop() ?? '').toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'document'
  const r = await $.process.run(
    [
      'curl', '-sS', '--fail-with-body', '-X', 'POST',
      '-H', 'Cookie: ' + cookie, '-H', 'Origin: ' + BASE, '-H', 'Referer: ' + BASE + '/chat',
      '-F', `file=@${a.path};type=${mime}`,
      '--form-string', `name=${a.name}`, '--form-string', `type=${type}`, '--form-string', `mimeType=${mime}`,
      '--form-string', 'source=CHAT', '--form-string', 'async=false',
      // A new chat doesn't exist on Langdock until its first message, so only an existing one is named.
      ...(convId ? ['--form-string', `conversationId=${convId}`] : []),
      BASE + '/api/storage/upload-attachment',
    ],
    { timeoutMs: 300_000 },
  )
  let id: string | undefined
  try {
    id = (JSON.parse(r.stdout) as { attachmentId?: string }).attachmentId
  } catch {
    // not JSON
  }
  if (r.exitCode !== 0 || !id) throw new LdError(`Upload of ${a.name} failed: ${(r.stdout || r.stderr).slice(0, 200)}`)
  return id
}

// Code fenced in the answer, labelled with a file name on the line above it.
function fencedFiles(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = []
  const re = /(?:^|\n)([^\n]*)\n```[^\n]*\n([\s\S]*?)\n```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const label = (m[1] ?? '').replace(/[*_`#>:]/g, ' ').trim()
    const name = label.match(/([\w.\-/]+\.[A-Za-z0-9]{1,8})(?:\s*\(.*\))?$/)?.[1] ?? label.match(/^([\w.\-/]+\.[A-Za-z0-9]{1,8})\b/)?.[1]
    const rel = name ? safeRel(name) : null
    if (rel) out.push({ path: rel, content: (m[2] ?? '') + '\n' })
  }
  return out
}

// ---------------------------------------------------------------- step labels, previews, projects, answers

const TOOL_LABELS: Record<string, string> = {
  bash: 'Running commands',
  write: 'Writing files',
  edit: 'Editing files',
  read: 'Reading files',
  list: 'Looking at files',
  image_generation: 'Generating an image',
  deliver_files: 'Preparing files',
  web_search: 'Searching the web',
  research: 'Researching',
}

function toolLabel(name: string, detail: string | undefined): string {
  const base = TOOL_LABELS[name] ?? name.replace(/_/g, ' ')
  return detail && detail.trim() ? `${base}: ${detail.trim()}` : base
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp)$/i

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name)
}

/** A small JPEG of an image file, as a data URI, sized to fit the pane's SVG element (128 KB). */
export async function previewOf($: $T, path: string): Promise<LdPreview | null> {
  if (!isImageName(path)) return null
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    "$p='" + path.replace(/\//g, '\\').replace(/'/g, "''") + "'",
    'try {',
    '  $img=[System.Drawing.Image]::FromFile($p)',
    '  $w=$img.Width; $h=$img.Height',
    '  $s=[Math]::Min(1.0, 640.0/[Math]::Max($w,$h))',
    '  $enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" } | Select-Object -First 1',
    '  while ($true) {',
    '    $nw=[Math]::Max(1,[int]($w*$s)); $nh=[Math]::Max(1,[int]($h*$s))',
    '    $bmp=New-Object System.Drawing.Bitmap($nw,$nh)',
    '    $g=[System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White)',
    "    $g.InterpolationMode='HighQualityBicubic'; $g.DrawImage($img,0,0,$nw,$nh); $g.Dispose()",
    '    $ms=New-Object System.IO.MemoryStream',
    '    $ep=New-Object System.Drawing.Imaging.EncoderParameters(1)',
    '    $ep.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[int64]72)',
    '    $bmp.Save($ms,$enc,$ep); $b=[Convert]::ToBase64String($ms.ToArray()); $bmp.Dispose()',
    '    if ($b.Length -lt 90000 -or $nw -lt 120) { break }',
    '    $s=$s*0.8',
    '  }',
    '  $img.Dispose()',
    '  Write-Output ("$nw|$nh|$b")',
    '} catch { exit 1 }',
  ].join('\n')
  try {
    const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 60_000 })
    if (r.exitCode !== 0) return null
    const [w, h, b64] = r.stdout.trim().split('|')
    if (!w || !h || !b64) return null
    return { uri: 'data:image/jpeg;base64,' + b64, w: Number(w), h: Number(h) }
  } catch {
    return null
  }
}

/** The page to open for a project: an index.html among the saved files, or inside an extracted zip. */
export async function findEntry($: $T, files: LdFile[]): Promise<string | null> {
  const direct = files.find(f => f.path && /(^|\/)index\.html$/i.test(f.name.replace(/\\/g, '/')))
  if (direct) return direct.path
  const look = async (dir: string, depth: number): Promise<string | null> => {
    let entries
    try {
      entries = await $.fs.list(dir)
    } catch {
      return null
    }
    const idx = entries.find(e => e.kind === 'file' && e.name.toLowerCase() === 'index.html')
    if (idx) return joinPath(dir, idx.name)
    if (depth > 0) {
      for (const e of entries) {
        if (e.kind === 'file' || e.name === 'node_modules' || e.name === '.git') continue
        const found = await look(joinPath(dir, e.name), depth - 1)
        if (found) return found
      }
    }
    return null
  }
  for (const f of files) {
    if (f.kind === 'folder' && f.path) {
      const found = await look(f.path, 2)
      if (found) return found
    }
  }
  return null
}

/** Sends the person's answer to a question Langdock is waiting on; the paused reply then continues. */
export async function answerQuestion($: $T, convId: string, part: { id: string; sessionId: string }, payload: unknown): Promise<boolean> {
  const r = await ld($, '/api/engine/complete-awakeable', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-version': await fetchVersion($) },
    body: JSON.stringify({ conversationId: convId, toolCallId: part.id, sessionId: part.sessionId, payload }),
  })
  return r.ok
}

// ---------------------------------------------------------------- ask

export type AskInput = {
  prompt: string
  model?: string
  reasoning?: string
  plugin?: string
  documentFormat?: string
  newConversation?: boolean
  attachments?: LdAttachment[]
}

/** Lets the caller show a reply as it streams in. */
export type AskHooks = {
  onParts: (parts: LdPart[]) => Promise<void> | void
  /** Langdock asked the person something and is waiting for the answer. */
  onAwaiting?: () => Promise<void> | void
}

type RawQuestion = { id?: string; question?: string; type?: string; options?: { id?: string; label?: string }[] }

export async function runAsk($: $T, input: AskInput, hooks?: AskHooks): Promise<LdResult & { convId: string; modelProvider?: string; parts: LdPart[] }> {
  const prefs = await getPrefs($)
  let models = (await read($, ui)).models
  if (!models.length) models = await refreshModels($)
  const model = resolveModel(models, input.model, prefs.modelId)
  if (input.model && input.model.toLowerCase() !== 'auto' && !model) {
    throw new LdError(`Unknown Langdock model "${input.model}". Available: Auto, ${models.map(m => m.name).join(', ')}`)
  }

  let effort: string | null = null
  if (model && model.efforts.length) {
    const want = (input.reasoning ?? (input.model ? '' : (prefs.reasoning ?? ''))).toLowerCase()
    const byLabel = Object.entries(EFFORT_LABEL).find(([, l]) => l.toLowerCase() === want)?.[0]
    const key = model.efforts.includes(want) ? want : byLabel && model.efforts.includes(byLabel) ? byLabel : null
    effort = key ?? model.defaultEffort ?? model.efforts[0] ?? null
  }

  const plugin = input.plugin !== undefined ? input.plugin : prefs.plugin
  if (plugin && !PLUGINS.some(p => p.id === plugin)) throw new LdError(`Unknown plugin "${plugin}". Use one of: ${PLUGINS.map(p => p.id).join(', ')}`)
  const docFormat = input.documentFormat ?? prefs.docFormat

  const fresh = input.newConversation || !prefs.convId
  const convId = fresh ? uuid() : (prefs.convId as string)
  const parentId = fresh ? ZERO_ID : (prefs.lastTurnId ?? ZERO_ID)
  const turnId = uuid()

  const attachmentIds: string[] = []
  for (const a of input.attachments ?? []) attachmentIds.push(await upload($, a, fresh ? null : convId))

  const body: Record<string, unknown> = {
    id: convId,
    conversationSource: 'WEB',
    userTimezone: 'Asia/Calcutta',
    modelSelection: model ? { kind: 'modelId', modelId: model.id } : { kind: 'auto' },
    extendedThinking: false,
    contextWindowMode: 'STANDARD',
    messages: [
      {
        id: turnId,
        role: 'user',
        parts: [{ type: 'text', text: input.prompt }],
        metadata: {
          parentId,
          threadId: turnId,
          selectedTool: plugin || null,
          selectedInternalSearchIntegrations: [],
          attachments: attachmentIds,
          taggedIntegrations: [],
          taggedKnowledgeFolders: [],
          taggedWorkflows: [],
          taggedAssistantId: null,
          modelId: model ? model.id : 'auto',
          modelProvider: model ? model.provider : null,
          modelName: model ? model.name : null,
          userFeedback: null,
          ...(model ? {} : { autoModelTier: 'auto' }),
          createdAt: new Date().toISOString(),
        },
      },
    ],
  }
  if (effort) body.reasoningEffort = effort
  if (plugin) body.selectedTool = plugin
  if (plugin === 'image_generation') {
    // The chosen image model is a per-user Langdock preference, not a request field.
    if (prefs.imageModelId && prefs.imageModelId !== appliedImageModel) {
      const r = await ld($, '/api/trpc/user.updatePreferences?batch=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ '0': { json: { defaultImageGenerationModel: prefs.imageModelId } } }),
      })
      if (r.ok) appliedImageModel = prefs.imageModelId
    }
    if (prefs.imageHd) body.imageGenerationHighDefinition = true
  }
  if (plugin === 'write_document') {
    body.documentFormat = docFormat
    body.modeContext = { mode: 'document', format: docFormat }
  }

  await setPrefs($, { convId, lastTurnId: turnId })

  // ---- stream the reply with curl, so a long answer is never cut at 30 s, and show it as it arrives
  const parts: LdPart[] = []
  const writes = new Map<string, string>()
  const remote = new Map<string, { name: string; url: string; kind: string }>()
  let error = ''
  let title = ''
  let sawEvents = false
  let lastFlush = 0
  let curText: LdPart | null = null
  let curThought: LdPart | null = null

  const flush = async (force = false): Promise<void> => {
    const now = Date.now()
    if (!force && now - lastFlush < 200) return
    lastFlush = now
    await hooks?.onParts(parts.map(p => ({ ...p })))
  }

  const apply = async (ev: SseEvent): Promise<void> => {
    const id = String(ev.toolCallId ?? '')
    switch (ev.type) {
      case 'reasoning-start':
        curThought = { kind: 'thought', text: '' }
        parts.push(curThought)
        break
      case 'reasoning-delta':
        if (curThought && curThought.kind === 'thought') curThought.text += String(ev.delta ?? '')
        break
      case 'text-start':
        curText = { kind: 'text', text: '' }
        parts.push(curText)
        break
      case 'text-delta':
        if (curText && curText.kind === 'text') curText.text += String(ev.delta ?? '')
        break
      case 'error':
        error = String(ev.errorText ?? 'Langdock error')
        break
      case 'data-conversation-title':
        title = String(ev.data ?? '')
        break
      case 'tool-input-start':
        if (ev.toolName !== 'ask_user_questions') parts.push({ kind: 'tool', id, label: toolLabel(String(ev.toolName ?? ''), undefined), state: 'running' })
        break
      case 'tool-input-available': {
        const inp = (ev.input ?? {}) as { path?: string; content?: string; name?: string }
        if (ev.toolName === 'write' && typeof inp.path === 'string' && typeof inp.content === 'string') writes.set(inp.path, inp.content)
        const t = parts.find(p => p.kind === 'tool' && p.id === id)
        if (t && t.kind === 'tool') t.label = toolLabel(String(ev.toolName ?? ''), inp.name)
        break
      }
      case 'tool-output-available': {
        const out = ev.output as { error?: unknown; dismissed?: unknown } | undefined
        const t = parts.find(p => (p.kind === 'tool' || p.kind === 'question') && p.id === id)
        if (t && t.kind === 'tool') t.state = out && typeof out.error === 'string' ? 'error' : 'done'
        if (t && t.kind === 'question') t.state = out && out.dismissed === true ? 'dismissed' : 'answered'
        for (const f of filesOf(ev.output)) remote.set(f.url, f)
        break
      }
      case 'data-tool-awaiting': {
        const d = (ev.data ?? {}) as { sessionId?: string; toolCallId?: string; toolName?: string; input?: { questions?: RawQuestion[] } }
        const cid = String(d.toolCallId ?? '')
        if (d.toolName === 'ask_user_questions') {
          const questions: LdQuestion[] = (d.input?.questions ?? []).map(q => ({
            id: String(q.id),
            text: String(q.question ?? ''),
            multi: q.type === 'multi_select',
            options: (q.options ?? []).map(o => ({ id: String(o.id), label: String(o.label ?? o.id) })),
          }))
          parts.push({ kind: 'question', id: cid, sessionId: String(d.sessionId ?? ''), questions, selected: {}, other: {}, state: 'open' })
        } else {
          parts.push({ kind: 'waiting', id: cid, label: 'Langdock is waiting for an action that only its web app can take. Open this chat on app.langdock.com to continue.' })
        }
        await flush(true)
        await hooks?.onAwaiting?.()
        break
      }
      case 'data-tool-awaiting-resolved': {
        const d = (ev.data ?? {}) as { toolCallId?: string }
        const q = parts.find(p => p.kind === 'question' && p.id === d.toolCallId)
        if (q && q.kind === 'question' && q.state !== 'dismissed') q.state = 'answered'
        break
      }
    }
  }

  const runStream = async (): Promise<{ plain: string; status: number | null }> => {
    const cookie = (await getCookie($)) ?? ''
    const argv = [
      'curl', '-sS', '-N', '-X', 'POST',
      '-H', 'Cookie: ' + cookie, '-H', 'Origin: ' + BASE, '-H', 'Referer: ' + BASE + '/chat',
      '-H', 'content-type: application/json', '-H', 'x-app-version: ' + (await fetchVersion($)), '-H', 'x-langdock-stream-end: waiting',
      '-w', '\n__HTTP__%{http_code}',
      '--data-binary', '@-',
      BASE + '/api/engine',
    ]
    const it = $.process.spawn({ argv, input: JSON.stringify(body) })
    let buf = ''
    let plain = ''
    let stderr = ''
    for (;;) {
      const n = await it.next()
      if (n.done) break
      if (n.value.stream === 'stderr') {
        stderr += n.value.text
        continue
      }
      buf += n.value.text
      plain = (plain + n.value.text).slice(-20000)
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        try {
          const ev = JSON.parse(line.slice(5).trim()) as SseEvent
          sawEvents = true
          await apply(ev)
        } catch {
          // a line that is not JSON
        }
      }
      await flush()
    }
    if (stderr.trim() && !sawEvents) plain = stderr
    const status = Number(plain.match(/__HTTP__(\d+)/)?.[1] ?? 0) || null
    return { plain, status }
  }

  let attempt = await runStream()
  if (!sawEvents && attempt.plain.includes('A new version of Langdock is available')) {
    await fetchVersion($, true)
    attempt = await runStream()
  }
  if (!sawEvents && (attempt.status === 401 || attempt.status === 403)) {
    await setUi($, { status: 'Session expired: paste a fresh Cookie header' })
    throw new LdError('Langdock session expired or invalid (HTTP ' + attempt.status + '). Click Connect and paste a fresh Cookie header.')
  }
  if (!sawEvents && !error) error = attempt.plain.replace(/__HTTP__\d+/, '').trim().slice(0, 300) || 'Empty response from Langdock'
  await flush(true)
  if (title) await setUi($, { chatTitle: title })

  // The answer is the text after the last tool step.
  const lastTool = parts.map(p => p.kind).lastIndexOf('tool')
  const text = parts
    .slice(lastTool + 1)
    .map(p => (p.kind === 'text' ? p.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n')

  // ---- land the outputs locally
  const outDir = await outputDir($, input.prompt)
  const files: LdFile[] = []
  const taken = new Set<string>()
  for (const f of remote.values()) {
    const name = safeRel(f.name.split('/').pop() ?? 'file') ?? 'file'
    taken.add(name)
    const dest = await freePath($, outDir, name)
    if (await curlDownload($, f.url, dest)) {
      files.push({ name, path: dest, kind: f.kind })
      if (/\.zip$/i.test(name)) {
        const dir = await freePath($, outDir, name.replace(/\.zip$/i, ''))
        await $.fs.write(joinPath(dir, '.keep'), '')
        const x = await $.process.run(['tar', '-xf', dest, '-C', dir], { timeoutMs: 120_000 })
        if (x.exitCode === 0) files.push({ name: name.replace(/\.zip$/i, '') + '/', path: dir, kind: 'folder' })
      }
    } else {
      files.push({ name, path: '', url: f.url, kind: 'download failed' })
    }
  }

  // Files the model wrote in its sandbox but never delivered.
  if (writes.size) {
    const dirs = [...writes.keys()].map(p => p.replace(/\\/g, '/').split('/').slice(0, -1))
    let common = dirs[0] ?? []
    for (const d of dirs) {
      let i = 0
      while (i < common.length && common[i] === d[i]) i++
      common = common.slice(0, i)
    }
    for (const [p, content] of writes) {
      const rel = safeRel(p.replace(/\\/g, '/').split('/').slice(common.length).join('/'))
      if (!rel || taken.has(rel.split('/').pop() as string)) continue
      taken.add(rel)
      const dest = await freePath($, outDir, rel)
      await $.fs.write(dest, content)
      files.push({ name: rel, path: dest, kind: 'file' })
    }
  }

  // Code blocks labelled with a file name, when nothing else produced them.
  for (const f of fencedFiles(text)) {
    if (taken.has(f.path) || taken.has(f.path.split('/').pop() as string)) continue
    taken.add(f.path)
    const dest = await freePath($, outDir, f.path)
    await $.fs.write(dest, f.content)
    files.push({ name: f.path, path: dest, kind: 'file' })
  }

  // Small inline pictures for image files, and the page to open for a project.
  for (const f of files) {
    if (f.path && isImageName(f.name)) {
      const preview = await previewOf($, f.path)
      if (preview) f.preview = preview
    }
  }
  const entry = files.length ? await findEntry($, files) : null
  const project = files.length && (entry || files.length > 1) ? { dir: outDir, entry } : undefined

  void refreshUsage($).catch(() => undefined)
  if (fresh) void refreshHistory($).catch(() => undefined)
  return {
    prompt: input.prompt,
    text,
    files,
    parts,
    ...(project ? { project } : {}),
    outDir: files.length ? outDir : '',
    model: model ? `${model.name}${effort ? ' · ' + (EFFORT_LABEL[effort] ?? effort) : ''}` : 'Auto',
    at: new Date().toISOString(),
    convId,
    ...(model ? { modelProvider: model.provider } : {}),
    ...(error ? { error } : {}),
  }
}

function filesOf(output: unknown): { name: string; url: string; kind: string }[] {
  const out = (output ?? {}) as {
    files?: { name?: string; url?: string; type?: string; mimeType?: string }[]
    images?: { name?: string; url?: string }[]
  }
  const list: { name: string; url: string; kind: string }[] = []
  for (const f of out.files ?? []) if (f.url) list.push({ name: f.name ?? 'file', url: storageUrl(f.url), kind: f.type ?? f.mimeType ?? 'file' })
  for (const im of out.images ?? []) if (im.url) list.push({ name: im.name ?? 'image.png', url: storageUrl(im.url), kind: 'image' })
  return list
}

// ---------------------------------------------------------------- an older chat

type RawPart = { type: string; text?: string; output?: unknown; state?: string }
type RawMsg = { id: string; role: string; parts?: RawPart[]; metadata?: { modelName?: string | null; modelProvider?: string | null } }

export async function loadChat($: $T, ref: LdChatRef): Promise<LdMsg[]> {
  const [raw] = await trpc($, ['message.getChatMessages'], [{ conversationId: ref.id }])
  const rows = (raw as RawMsg[]) ?? []
  const msgs: LdMsg[] = []
  let lastUser: string | null = null
  for (const r of rows) {
    if (r.role === 'user') {
      lastUser = r.id
      msgs.push({ id: r.id, role: 'user', text: (r.parts ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join('\n'), files: [] })
    } else if (r.role === 'assistant') {
      const parts = r.parts ?? []
      let lastTool = -1
      parts.forEach((p, i) => p.type.startsWith('tool-') && (lastTool = i))
      const text = parts.slice(lastTool + 1).filter(p => p.type === 'text').map(p => p.text ?? '').join('\n\n')
      const seen = new Set<string>()
      const files: LdFile[] = []
      for (const p of parts) for (const f of p.type.startsWith('tool-') ? filesOf(p.output) : []) if (!seen.has(f.url)) (seen.add(f.url), files.push({ name: f.name, path: '', url: f.url, kind: f.kind }))
      const hist: LdPart[] = []
      for (const p of parts) {
        if (p.type === 'reasoning' && p.text) hist.push({ kind: 'thought', text: p.text })
        else if (p.type === 'text' && p.text) hist.push({ kind: 'text', text: p.text })
      }
      msgs.push({ id: r.id, role: 'assistant', text, files, parts: hist, model: r.metadata?.modelName ?? undefined, provider: r.metadata?.modelProvider ?? undefined })
    }
  }
  await setPrefs($, { convId: ref.id, lastTurnId: lastUser })
  return msgs
}

// ---------------------------------------------------------------- native pickers

// A hidden always-on-top owner window keeps the dialog in front of the app.
const PS_HEAD =
  "Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
  "$o=New-Object System.Windows.Forms.Form; $o.TopMost=$true; $o.ShowInTaskbar=$false; $o.Opacity=0; $o.StartPosition='CenterScreen'; $o.Show(); $o.Activate(); "

/** Runs a Windows file or folder dialog; null when it could not open at all, [] when cancelled. */
async function psPick($: $T, body: string): Promise<string[] | null> {
  try {
    const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-STA', '-Command', PS_HEAD + body + '; $o.Dispose()'], {
      timeoutMs: 600_000,
    })
    if (r.exitCode !== 0) return null
    return r.stdout
      .split(/\r?\n/)
      .map(l => l.replace(/^\uFEFF/, '').trim())
      .filter(Boolean)
  } catch {
    return null
  }
}

export function pickFiles($: $T): Promise<string[] | null> {
  return psPick(
    $,
    "$d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; $d.Title='Attach files to Langdock'; if($d.ShowDialog($o) -eq 'OK'){ $d.FileNames }",
  )
}

export function pickFolder($: $T): Promise<string[] | null> {
  return psPick(
    $,
    "$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose the folder Langdock should work in'; $d.ShowNewFolderButton=$true; if($d.ShowDialog($o) -eq 'OK'){ $d.SelectedPath }",
  )
}
