import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(
  new URL('../src-tauri/resources/neo-chat-bridge/extension.js', import.meta.url),
  'utf8',
)
const manifest = JSON.parse(await readFile(
  new URL('../src-tauri/resources/neo-chat-bridge/package.json', import.meta.url),
  'utf8',
))
assert.deepEqual(manifest.enabledApiProposals, ['chatProvider', 'defaultChatParticipant'])
assert.deepEqual(manifest.contributes.authentication, [
  { id: 'neo-supabase', label: 'Neo' },
])
assert.equal(manifest.contributes.chatParticipants[0].isDefault, true)
assert.deepEqual(manifest.contributes.languageModelChatProviders, [
  { vendor: 'neo', displayName: 'Neo' },
])

let snapshot = {
  ai: { provider: 'openai', model: 'gpt-4o-mini', apiKeyConfigured: true },
  models: [
    { provider: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', active: true },
    { provider: 'anthropic', label: 'Anthropic', model: 'claude-3-5-sonnet', active: false },
  ],
  messages: [],
  isLoading: false,
  error: null,
}
const actionBodies = []
const prompts = []
let participantHandler
let registeredModelProvider

class FakeEventEmitter {
  event() {
    return { dispose() {} }
  }
  fire() {}
  dispose() {}
}

const vscode = {
  EventEmitter: FakeEventEmitter,
  Uri: { joinPath: (...parts) => parts.join('/') },
  window: {
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
  },
  authentication: {
    registerAuthenticationProvider: () => ({ dispose() {} }),
  },
  LanguageModelChatMessageRole: { User: 1 },
  LanguageModelChatMessage: {
    User: (content) => ({ role: 1, content }),
  },
  LanguageModelTextPart: class {
    constructor(value) {
      this.value = value
    }
  },
  lm: {
    registerLanguageModelChatProvider: (vendor, provider) => {
      assert.equal(vendor, 'neo')
      registeredModelProvider = provider
      return { dispose() {} }
    },
  },
  chat: {
    createChatParticipant: (_id, handler) => {
      participantHandler = handler
      return {}
    },
  },
}

class FakeResponse {
  constructor(value, status = 200) {
    this.value = value
    this.status = status
    this.ok = status >= 200 && status < 300
  }
  async json() {
    return this.value
  }
  async text() {
    return JSON.stringify(this.value)
  }
}

const context = {
  module: { exports: {} },
  exports: {},
  process: {
    env: {
      STRUCT_NEO_BRIDGE_URL: 'http://127.0.0.1:4444',
      STRUCT_NEO_BRIDGE_TOKEN: 'test-token',
    },
  },
  require: (name) => {
    if (name === 'vscode') return vscode
    if (name === 'crypto') return { randomUUID: () => 'request-id' }
    throw new Error(`Unexpected module requested by extension test: ${name}`)
  },
  fetch: async (url, options = {}) => {
    if (url.endsWith('/auth-session')) return new FakeResponse({ accessToken: null, user: null })
    if (url.endsWith('/state')) return new FakeResponse(snapshot)
    if (url.endsWith('/models') && options.method === 'POST') {
      const body = JSON.parse(options.body)
      actionBodies.push(body)
      if (body.provider && body.model) {
        snapshot = {
          ...snapshot,
          ai: { ...snapshot.ai, provider: body.provider, model: body.model },
          models: snapshot.models.map((entry) => ({
            ...entry,
            active: entry.provider === body.provider && entry.model === body.model,
          })),
        }
      }
      return new FakeResponse({ accepted: true }, 202)
    }
    if (url.endsWith('/prompt') && options.method === 'POST') {
      const body = JSON.parse(options.body)
      prompts.push(body)
      snapshot = {
        ...snapshot,
        messages: [
          { role: 'user', content: body.text, bridgeRequestId: body.requestId },
          { role: 'assistant', content: 'Neo response' },
        ],
        isLoading: false,
      }
      return new FakeResponse({ accepted: true }, 202)
    }
    throw new Error(`Unexpected bridge request: ${options.method ?? 'GET'} ${url}`)
  },
  setInterval: () => 1,
  clearInterval() {},
  setTimeout,
  clearTimeout,
  URL,
  console,
}

vm.runInNewContext(source, context, { filename: 'neo-chat-bridge/extension.js' })
const extension = context.module.exports
const subscriptions = []
extension.activate({ subscriptions, extensionUri: 'file:///neo-chat-bridge' })
await Promise.resolve()
assert.equal(typeof participantHandler, 'function')
assert.equal(typeof registeredModelProvider?.provideLanguageModelChatInformation, 'function')

const registeredModels = await registeredModelProvider.provideLanguageModelChatInformation({}, {
  isCancellationRequested: false,
})
assert.deepEqual(
  registeredModels.map(({ id, isDefault, isBYOK }) => ({ id, isDefault, isBYOK })),
  [
    { id: 'openai:gpt-4o-mini', isDefault: true, isBYOK: true },
    { id: 'anthropic:claude-3-5-sonnet', isDefault: false, isBYOK: true },
  ],
)

const noSelection = []
await participantHandler(
  { command: 'models', prompt: '' },
  {},
  { markdown: (value) => noSelection.push(value) },
  { isCancellationRequested: false },
)
const modelListOutput = noSelection.join('').replaceAll('\\-', '-')
assert.match(modelListOutput, /Models synced from Neo/)
assert.match(modelListOutput, /CODE-OSS chat model picker/)
assert.match(modelListOutput, /openai:gpt-4o-mini/)
assert.match(modelListOutput, /anthropic:claude-3-5-sonnet/)
assert.deepEqual(actionBodies[0], {})

const selection = []
await participantHandler(
  { command: 'models', prompt: 'anthropic:claude-3-5-sonnet' },
  {},
  { markdown: (value) => selection.push(value) },
  { isCancellationRequested: false },
)
assert.match(selection.join(''), /Switched Neo/)
assert.deepEqual(actionBodies[1], {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet',
})

snapshot = {
  ...snapshot,
  ai: { ...snapshot.ai, provider: 'openai', model: 'gpt-4o-mini' },
  models: snapshot.models.map((entry) => ({
    ...entry,
    active: entry.provider === 'openai',
  })),
}
const providerOutput = []
await registeredModelProvider.provideLanguageModelChatResponse(
  { id: 'anthropic:claude-3-5-sonnet' },
  [{ role: 1, content: [{ value: 'Answer through the selected Neo model' }] }],
  {},
  { report: (part) => providerOutput.push(part.value) },
  { isCancellationRequested: false },
)
assert.deepEqual(actionBodies[2], {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet',
})
assert.equal(prompts[0].text, 'Answer through the selected Neo model')
assert.deepEqual(providerOutput, ['Neo response'])

const participantOutput = []
await participantHandler(
  {
    command: undefined,
    prompt: 'Use the selected model',
    model: {
      sendRequest: async () => ({
        text: (async function* () {
          yield 'Model response from Neo'
        })(),
      }),
    },
  },
  {},
  { markdown: (value) => participantOutput.push(value) },
  { isCancellationRequested: false },
)
assert.deepEqual(participantOutput, ['Model response from Neo'])

const invalidSelection = []
await participantHandler(
  { command: 'models', prompt: 'unknown:not-configured' },
  {},
  { markdown: (value) => invalidSelection.push(value) },
  { isCancellationRequested: false },
)
assert.match(invalidSelection.join(''), /not in Neo’s synced model list/)
assert.equal(actionBodies.length, 3)

console.log('Neo model sync smoke test passed.')
