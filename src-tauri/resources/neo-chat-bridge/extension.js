'use strict';

const vscode = require('vscode');

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 200;

function activate(context) {
  const output = vscode.window.createOutputChannel('Neo Chat');
  const baseUrl = (process.env.STRUCT_NEO_BRIDGE_URL || '').replace(/\/+$/, '');
  const bridgeToken = process.env.STRUCT_NEO_BRIDGE_TOKEN || '';
  if (!baseUrl || !bridgeToken) {
    output.appendLine('Neo chat bridge is not configured; launch CODE-OSS from Neo to connect chat.');
    context.subscriptions.push(output);
    return;
  }

  const headers = { authorization: `Bearer ${bridgeToken}` };
  const authChangeEmitter = new vscode.EventEmitter();
  let currentAuthSession;
  let authSyncPromise;
  const syncAuthSession = async () => {
    if (authSyncPromise) return authSyncPromise;
    authSyncPromise = (async () => {
      const next = await getAuthSession(baseUrl, headers);
      const previous = currentAuthSession;
      currentAuthSession = next;
      if (!previous && next) {
        authChangeEmitter.fire({ added: [next], removed: undefined, changed: undefined });
      } else if (previous && !next) {
        authChangeEmitter.fire({ added: undefined, removed: [previous], changed: undefined });
      } else if (
        previous &&
        next &&
        (previous.accessToken !== next.accessToken || previous.account.label !== next.account.label)
      ) {
        authChangeEmitter.fire({ added: undefined, removed: undefined, changed: [next] });
      }
      return next;
    })().finally(() => {
      authSyncPromise = undefined;
    });
    return authSyncPromise;
  };
  const authProvider = {
    onDidChangeSessions: authChangeEmitter.event,
    getSessions: async () => {
      const session = await syncAuthSession();
      return session ? [session] : [];
    },
    createSession: async () => {
      await postAction(baseUrl, headers, 'account');
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        const session = await syncAuthSession();
        if (session) return session;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error('Timed out waiting for Neo account sign-in.');
    },
    removeSession: async (sessionId) => {
      const session = currentAuthSession;
      if (!session || session.id !== sessionId) return;
      await postAction(baseUrl, headers, 'signout');
      const deadline = Date.now() + 30 * 1000;
      while (Date.now() < deadline) {
        if (!(await syncAuthSession())) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('Neo did not confirm account sign-out.');
    },
  };
  const authRegistration = vscode.authentication.registerAuthenticationProvider(
    'neo-supabase',
    'Neo',
    authProvider,
  );
  const authPoll = setInterval(() => {
    void syncAuthSession().catch((error) => {
      output.appendLine(`[neo account] ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 2000);
  context.subscriptions.push(
    authRegistration,
    authChangeEmitter,
    { dispose: () => clearInterval(authPoll) },
  );
  void syncAuthSession().catch((error) => {
    output.appendLine(`[neo account] ${error instanceof Error ? error.message : String(error)}`);
  });

  const participant = vscode.chat.createChatParticipant('neo.agent', async (request, _chatContext, stream, token) => {
    try {
      if (request.command === 'models') {
        const snapshot = await getSnapshot(baseUrl, headers, token);
        const selection = request.prompt.trim();
        if (selection) {
          const model = (snapshot.models || []).find(
            (entry) => `${entry.provider}:${entry.model}` === selection,
          );
          if (!model) {
            stream.markdown(`Model \`${escapeMarkdown(selection)}\` is not in Neo’s synced model list. Run \`@neo /models\` to see available models.`);
            return;
          }
          await postAction(baseUrl, headers, 'models', token, {
            provider: model.provider,
            model: model.model,
          });
          stream.markdown(`Switched Neo to **${escapeMarkdown(model.label)} / ${escapeMarkdown(model.model)}**. Neo’s chat and CODE-OSS will use this model.`);
          return;
        }
        await postAction(baseUrl, headers, 'models', token);
        stream.markdown(formatModels(snapshot));
        return;
      }
      if (request.command === 'account') {
        const snapshot = await getSnapshot(baseUrl, headers, token);
        stream.markdown(formatAccountStatus(snapshot));
        return;
      }
      if (request.command === 'settings') {
        const snapshot = await getSnapshot(baseUrl, headers, token);
        stream.markdown(formatSettings(snapshot));
        return;
      }

      const prompt = request.prompt.trim();
      if (!prompt) return;
      if (!request.model || typeof request.model.sendRequest !== 'function') {
        throw new Error('No Neo model is selected in the CODE-OSS chat model picker.');
      }
      const response = await request.model.sendRequest(
        [vscode.LanguageModelChatMessage.User(prompt)],
        {},
        token,
      );
      for await (const chunk of response.text) {
        stream.markdown(chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[neo] ${message}`);
      stream.markdown(`Neo chat failed: ${message}`);
    }
  });
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'neo.svg');
  const modelChangeEmitter = new vscode.EventEmitter();
  const modelProvider = {
    onDidChangeLanguageModelChatInformation: modelChangeEmitter.event,
    provideLanguageModelChatInformation: async (_options, token) => {
      const snapshot = await getSnapshot(baseUrl, headers, token);
      return normalizeModels(snapshot).map((model) => ({
        id: `${model.provider}:${model.model}`,
        name: `${model.label} ${model.model}`,
        family: model.provider,
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: { toolCalling: true },
        isBYOK: true,
        isUserSelectable: true,
        isDefault: model.active,
        tooltip: 'Configured in Neo. The provider key remains in Neo.',
      }));
    },
    provideLanguageModelChatResponse: async (model, messages, _options, progress, token) => {
      const separator = model.id.indexOf(':');
      if (separator <= 0 || separator === model.id.length - 1) {
        throw new Error(`Invalid Neo model identifier: ${model.id}`);
      }
      const provider = model.id.slice(0, separator);
      const modelName = model.id.slice(separator + 1);
      const prompt = latestUserMessage(messages);
      if (!prompt) throw new Error('The chat request does not contain a user message.');

      const before = await getSnapshot(baseUrl, headers, token);
      if (before.ai?.provider !== provider || before.ai?.model !== modelName) {
        await postAction(baseUrl, headers, 'models', token, { provider, model: modelName });
      }
      await waitForSelectedModel(baseUrl, headers, provider, modelName, token);

      const requestId = require('crypto').randomUUID();
      await postPrompt(baseUrl, headers, prompt, requestId, token);
      await streamNeoReply(
        baseUrl,
        headers,
        requestId,
        before.error,
        { markdown: (text) => progress.report(new vscode.LanguageModelTextPart(text)) },
        token,
      );
    },
    provideTokenCount: async (_model, text) => {
      const value = typeof text === 'string' ? text : messageText(text);
      return Math.ceil(value.length / 4);
    },
  };
  const modelRegistration = vscode.lm.registerLanguageModelChatProvider('neo', modelProvider);
  let previousModelSet = '';
  let modelSyncPromise;
  const refreshModels = async () => {
    if (modelSyncPromise) return modelSyncPromise;
    modelSyncPromise = getSnapshot(baseUrl, headers)
      .then((snapshot) => {
        const serialized = JSON.stringify(normalizeModels(snapshot));
        if (serialized !== previousModelSet) {
          previousModelSet = serialized;
          modelChangeEmitter.fire();
        }
      })
      .finally(() => {
        modelSyncPromise = undefined;
      });
    return modelSyncPromise;
  };
  const modelPoll = setInterval(() => {
    void refreshModels().catch((error) => {
      output.appendLine(`[neo models] ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 2000);
  void refreshModels().catch((error) => {
    output.appendLine(`[neo models] ${error instanceof Error ? error.message : String(error)}`);
  });
  context.subscriptions.push(
    participant,
    modelRegistration,
    modelChangeEmitter,
    { dispose: () => clearInterval(modelPoll) },
    output,
  );
}

function normalizeModels(snapshot) {
  if (!Array.isArray(snapshot.models)) return [];
  return snapshot.models.filter(
    (model) =>
      model &&
      typeof model.provider === 'string' &&
      model.provider &&
      typeof model.model === 'string' &&
      model.model &&
      typeof model.label === 'string',
  );
}

function messageText(message) {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return '';
  if (typeof message.value === 'string') return message.value;
  return '';
}

function latestUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== vscode.LanguageModelChatMessageRole.User) continue;
    return message.content.map(messageText).filter(Boolean).join('');
  }
  return '';
}

async function waitForSelectedModel(baseUrl, headers, provider, model, token) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    throwIfCancelled(token);
    const snapshot = await getSnapshot(baseUrl, headers, token);
    if (snapshot.ai?.provider === provider && snapshot.ai?.model === model) return;
    await delay(200, token);
  }
  throw new Error(`Neo did not switch to ${provider}:${model}.`);
}

function formatAccountStatus(snapshot) {
  const account = snapshot.account;
  const ai = snapshot.ai;
  const model = ai?.model ? `${ai.provider} / ${ai.model}` : 'Neo’s active AI settings';
  if (!account?.signedIn) {
    return `Neo account: signed out. Chat requests still run through Neo using its active provider settings (${model}). Sign in to Neo to use account-stored provider keys and cloud chat sync.`;
  }
  const identity = [account.name, account.email].filter(Boolean).join(' — ');
  const signInMethod = account.provider ? ` (${account.provider})` : '';
  return `Neo account: ${identity || 'signed in'}${signInMethod}. Active model: ${model}. Chat requests use Neo’s account session and stored provider key; credentials stay in Neo and are not sent to CODE-OSS.`;
}



function redactEndpoint(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'custom endpoint (not displayed)';
  }
}

function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
}

async function getAuthSession(baseUrl, headers) {
  const response = await fetch(`${baseUrl}/auth-session`, { headers });
  if (!response.ok) throw new Error(`Neo account bridge returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.accessToken || !payload.user?.id) return undefined;
  return {
    id: payload.user.id,
    accessToken: payload.accessToken,
    account: {
      id: payload.user.id,
      label: payload.user.name || payload.user.email || 'Neo account',
    },
    scopes: ['profile', 'email'],
  };
}

function formatSettings(snapshot) {
  const ai = snapshot.ai;
  if (!ai) return 'Neo has not published its active AI configuration yet. Keep Neo open and try again.';
  const account = snapshot.account;
  const endpoint = redactEndpoint(ai.baseUrl);
  const config = [
    `Neo account: ${account?.signedIn ? [account.name, account.email].filter(Boolean).join(' — ') || 'signed in' : 'signed out'}`,
    `Provider: ${ai.provider || 'unknown'}`,
    `Model: ${ai.model || 'provider default'}`,
    `Endpoint: ${endpoint}`,
    `Temperature: ${ai.temperature}`,
    `Tool allowance: ${ai.toolAllowance || 'all'}`,
    `Automatic tool approval: ${ai.autoApproveTools ? 'on' : 'off'}`,
    `Provider key available in Neo: ${ai.apiKeyConfigured ? 'yes' : 'no'}`,
    'The provider key itself stays in Neo and is never copied into CODE-OSS.',
    'System prompt:',
    ...String(ai.systemPrompt || '').split(/\r?\n/).map((line) => `> ${escapeMarkdown(line)}`),
  ];
  return config.join('\n\n');
}

function formatModels(snapshot) {
  const models = Array.isArray(snapshot.models) ? snapshot.models : [];
  if (!models.length) {
    const ai = snapshot.ai;
    return ai?.model
      ? `Neo’s active model is **${escapeMarkdown(ai.provider)} / ${escapeMarkdown(ai.model)}**. The synced model list is not available yet; keep Neo open and try again.`
      : 'Neo has not published its model configuration yet. Keep Neo open and try again.';
  }
  const rows = models.map((model) =>
    `- ${model.active ? '**Active** — ' : ''}\`${escapeMarkdown(model.provider)}:${escapeMarkdown(model.model)}\` — ${escapeMarkdown(model.label)}`,
  );
  return [
    '### Models synced from Neo',
    '',
    ...rows,
    '',
    'Select **Neo** in the CODE-OSS chat model picker to use one of these models in the existing chat panel.',
    'Choose a synced model with `@neo /models provider:model` (for example, `@neo /models openai:gpt-4o-mini`). The API key stays in Neo.',
    'Neo’s AI settings are open so you can edit custom provider and model settings there.',
  ].join('\n');
}

function redactEndpoint(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'custom endpoint (not displayed)';
  }
}

function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
}

function deactivate() {}

async function getSnapshot(baseUrl, headers, token) {
  throwIfCancelled(token);
  const response = await fetch(`${baseUrl}/state`, { headers });
  if (!response.ok) throw new Error(`Neo chat bridge returned HTTP ${response.status}`);
  return await response.json();
}

async function postPrompt(baseUrl, headers, text, requestId, token) {
  throwIfCancelled(token);
  const response = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ text, requestId }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Neo rejected the prompt (HTTP ${response.status}): ${detail}`);
  }
}

async function postAction(baseUrl, headers, action, token, body = {}) {
  throwIfCancelled(token);
  const response = await fetch(`${baseUrl}/${action}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Neo rejected the ${action} request (HTTP ${response.status})`);
}

async function streamNeoReply(baseUrl, headers, requestId, previousError, stream, token) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let previousReply = '';

  while (Date.now() < deadline) {
    throwIfCancelled(token);
    const snapshot = await getSnapshot(baseUrl, headers, token);
    const userMessageIndex = snapshot.messages.findIndex(
      (message) => message.role === 'user' && message.bridgeRequestId === requestId,
    );
    if (userMessageIndex >= 0) {
      let reply = '';
      for (const message of snapshot.messages.slice(userMessageIndex + 1)) {
        if (message.role === 'assistant') reply = message.content;
      }
      if (reply.startsWith(previousReply)) {
        const delta = reply.slice(previousReply.length);
        if (delta) stream.markdown(delta);
      } else if (reply) {
        stream.markdown(reply);
      }
      previousReply = reply;

      if (!snapshot.isLoading) {
        if (reply) return;
        if (snapshot.error) throw new Error(snapshot.error);
      }
    } else if (!snapshot.isLoading && snapshot.error && snapshot.error !== previousError) {
      throw new Error(snapshot.error);
    }
    await delay(POLL_INTERVAL_MS, token);
  }
  throw new Error('Timed out waiting for Neo to finish responding.');
}

function delay(ms, token) {
  return new Promise((resolve, reject) => {
    if (token.isCancellationRequested) {
      reject(new Error('Request cancelled.'));
      return;
    }
    let subscription;
    const timer = setTimeout(() => {
      subscription?.dispose();
      resolve();
    }, ms);
    subscription = token.onCancellationRequested(() => {
      clearTimeout(timer);
      subscription.dispose();
      reject(new Error('Request cancelled.'));
    });
  });
}

function throwIfCancelled(token) {
  if (token?.isCancellationRequested) throw new Error('Request cancelled.');
}

module.exports = { activate, deactivate };
