import { expect, test } from 'claude-code/testing'

const pane = {
  plugin: 'langdock',
  component: 'Pane',
  requestId: 'langdock',
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

const seed = (patch: Record<string, unknown>) => () => ({ value: { value: { shape: 'ui-4', value: { ...BASE_UI, ...patch } }, version: 1 } })

test('not connected: Connect and the info icon sit top left', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface })
    expect(await ui.find({ type: 'Button', key: 'conn' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'info' })).toBeTruthy()
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

