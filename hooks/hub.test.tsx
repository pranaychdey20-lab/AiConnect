import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'aiconnect',
  component: 'Pane',
  requestId: 'aiconnect',
  props: { title: 'AiConnect', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('the hub lists the platforms; Langdock is not connected without a cookie', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^AiConnect$/ }))?.text).toBe('AiConnect')
    expect(await ui.find({ type: 'Text', text: /AVAILABLE PLATFORMS/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'open-langdock' })).toBeTruthy()
    await ui.unmount()
  }
})

test('with a cookie, Langdock is listed under connected platforms', async ($, on) => {
  on('store.get', () => ({ value: 'a-cookie-value' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /CONNECTED PLATFORMS/ })).toBeTruthy()
  expect(await ui.find({ type: 'Box', key: 'platform-langdock' })).toBeTruthy()
  await ui.unmount()
})
