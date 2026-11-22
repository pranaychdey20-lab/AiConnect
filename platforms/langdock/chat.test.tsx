import { expect, test } from 'claude-code/testing'

const pane = {
  plugin: 'aiconnect',
  component: 'Pane',
  requestId: 'aiconnect',
  props: { title: 'Langdock', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const BASE_UI = {
  prefs: { modelId: 'm1', reasoning: 'low', plugin: '', docFormat: 'pdf', convId: null, lastTurnId: null, workFolder: null, imageModelId: null, imageHd: false },
  hasCookie: true,
  workspace: 'My Workspace',
  models: [
    { id: 'm1', name: 'GPT-6.1 Terra', provider: 'openai', hoster: 'OpenAI', description: 'Efficient model.', context: 270000, consumption: 13.25, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
    { id: 'm2', name: 'Haiku 5.5', provider: 'anthropic', hoster: 'Anthropic', description: 'Fast.', context: 270000, consumption: 5, efforts: ['low', 'medium'], defaultEffort: 'medium' },
  ],
  imageModels: [
    { id: 'i1', name: 'GPT Image 2.5 Flare', provider: 'openai', hoster: 'OpenAI', description: 'Fast images.', context: 0, consumption: 0, efforts: [], defaultEffort: null },
    { id: 'i2', name: 'GPT Image 2.6 Sunburst', provider: 'openai', hoster: 'OpenAI', description: 'Detailed images.', context: 0, consumption: 0, efforts: [], defaultEffort: null },
  ],
  defaultImageModelId: 'i1',
  usage: { sessionPercent: 26, sessionResetsAt: null, weeklyPercent: 64, weeklyResetsAt: null, fetchedAt: '2026-11-22T00:00:00Z' },
  status: 'Connected Â· 2 models',
  busy: false,
  last: null,
  view: 'home',
  chatTitle: '',
  messages: [],
  history: [{ id: 'c1', name: 'Romantic Verse', updatedAt: '2026-11-22T09:00:00Z' }],
  menu: 'none',
  modelSearch: '',
  attachments: [],
  draft: 0,
}

// The hub says Langdock is open; Langdock's own state is the seeded value.
const seed = (patch: Record<string, unknown>) => (_: unknown, e: { key: string }) =>
  e.key === 'hub'
    ? { value: { value: { shape: 'hub-1', value: { platform: 'langdock' } }, version: 1 } }
    : { value: { value: { shape: 'ui-5', value: { ...BASE_UI, ...patch } }, version: 1 } }

test('not connected: Connect and the info icon sit top left', async ($, on) => {
  on('state.get', seed({ hasCookie: false }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface })
    expect(await ui.find({ type: 'Button', key: 'conn' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'info' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'back' })).toBeTruthy()
    await ui.unmount()
  }
})

test('the guide opens from the info icon state', async ($, on) => {
  on('state.get', seed({ hasCookie: false, menu: 'guide' }))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /How to connect/ }))?.text).toBe('How to connect')
  expect(await ui.find({ type: 'Text', text: /Request Headers/ })).toBeTruthy()
  await ui.unmount()
})

test('the connect box opens under the Connect button', async ($, on) => {
  on('state.get', seed({ hasCookie: false, menu: 'connect' }))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Input', key: 'cookie-0' })).toBeTruthy()
  await ui.unmount()
})

test('chat home: greeting, composer, model button, usage ring, chips', async ($, on) => {
  on('state.get', seed({}))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface })
    expect((await ui.find({ type: 'Text', text: /What can I do for you/ }))?.text).toBe('What can I do for you?')
    expect(await ui.find({ type: 'Input', key: 'prompt-0' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'model-btn' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'plus' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'usage-ring' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'chip-research' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'chip-web_search' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'plugins' })).toBeUndefined()
    expect(await ui.find({ type: 'Select', key: 'recent' })).toBeTruthy()
    await ui.unmount()
  }
})

test('the plus menu has one entry for files and one for a folder', async ($, on) => {
  on('state.get', seed({ menu: 'plus' }))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'm-files' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'm-folder' })).toBeTruthy()
  await ui.unmount()
})

test('model menu: whole-row buttons for Model and Reasoning', async ($, on) => {
  on('state.get', seed({ menu: 'model' }))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'row-model' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'row-reasoning' })).toBeTruthy()
  await ui.unmount()
})

test('model list draws a row per model', async ($, on) => {
  on('state.get', seed({ menu: 'models' }))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Box', key: 'm-m2' })).toBeTruthy()
  await ui.unmount()
})

test('reasoning menu draws the levels', async ($, on) => {
  on('state.get', seed({ menu: 'reasoning' }))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'ef-xhigh' })).toBeTruthy()
  await ui.unmount()
})

test('chat view: messages above, composer below', async ($, on) => {
  on(
    'state.get',
    seed({
      view: 'chat',
      chatTitle: 'Romantic Verse',
      messages: [
        { id: 'u1', role: 'user', text: 'write me a poem on love', files: [] },
        { id: 'a1', role: 'assistant', text: 'Love is not always thunder,', files: [{ name: 'poem.pdf', path: '', url: 'https://x/y', kind: 'document' }], model: 'GPT-6.1 Terra Â· Medium', provider: 'openai' },
      ],
    }),
  )
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface })
    expect(await ui.find({ type: 'Box', key: 'msg-u1' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'msg-a1' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'f-a1-0' })).toBeTruthy()
    expect(await ui.find({ type: 'Input', key: 'prompt-0' })).toBeTruthy()
    await ui.unmount()
  }
})

test('Generate image shows its model button; the model list has the HD switch', async ($, on) => {
  on('state.get', seed({ prefs: { ...BASE_UI.prefs, plugin: 'image_generation' }, menu: 'imageModels' }))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'plugin-pill' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'image-model' })).toBeTruthy()
  expect(await ui.find({ type: 'Box', key: 'im-i2' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'hd' })).toBeTruthy()
  await ui.unmount()
})

test('the usage text is not repeated', async ($, on) => {
  on('state.get', seed({}))
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Current session$/ })).toBeUndefined()
  await ui.unmount()
})


test('a live reply shows thought, a message, a tool step and a question card', async ($, on) => {
  on(
    'state.get',
    seed({
      view: 'chat',
      busy: true,
      messages: [
        { id: 'u1', role: 'user', text: 'make a game', files: [] },
        {
          id: 'a1',
          role: 'assistant',
          text: '',
          files: [],
          pending: true,
          parts: [
            { kind: 'thought', text: 'Planning the game' },
            { kind: 'text', text: 'Two quick questions first.' },
            { kind: 'tool', id: 't1', label: 'Running commands', state: 'running' },
            {
              kind: 'question',
              id: 'q1',
              sessionId: 's1',
              questions: [{ id: 'q_1', text: 'Where should it run?', multi: false, options: [{ id: 'app', label: 'As an app' }, { id: 'chat', label: 'In this chat' }] }],
              selected: {},
              other: {},
              state: 'open',
            },
          ],
        },
      ],
    }),
  )
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface })
    expect(await ui.find({ type: 'Text', text: /Two quick questions/ })).toBeUndefined() // drawn by Markdown, not Text
    expect(await ui.find({ type: 'Text', text: /Thought/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Running commands/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'qo-q1-q_1-app' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'qo-q1-q_1-other' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'qs-q1' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'qd-q1' })).toBeTruthy()
    await ui.unmount()
  }
})

test('images show inline, videos get a Play card, projects get a Preview button', async ($, on) => {
  on(
    'state.get',
    seed({
      view: 'chat',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          text: 'done',
          files: [
            { name: 'red.png', path: 'C:/x/red.png', kind: 'image', preview: { uri: 'data:image/jpeg;base64,AAAA', w: 64, h: 64 } },
            { name: 'clip.mp4', path: 'C:/x/clip.mp4', kind: 'video' },
          ],
          project: { dir: 'C:/x/game', entry: 'C:/x/game/index.html' },
        },
      ],
    }),
  )
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ type: 'Box', key: 'img-a1-0' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'play-a1-1' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'preview-a1' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'folder-a1' })).toBeTruthy()
  await ui.unmount()
})
