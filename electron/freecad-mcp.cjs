/*
 * Author: Lumorix Studios
 * Check the LICENSE in the GitHub repo for more information on permissions to use this code.
 */

/*
 * FreeCAD MCP bridge.
 *
 * FreeCAD's MCP addon exposes an XML-RPC server on 127.0.0.1:9875. This script
 * is a small stdio MCP server (JSON-RPC one message per line) that translates
 * MCP tool calls into those XML-RPC calls. It is launched by the Struct MCP
 * client as a normal stdio server, so the renderer and agent loop need no
 * FreeCAD-specific transport.
 *
 * Configuration (environment):
 *   FREECAD_MCP_HOST   default 127.0.0.1
 *   FREECAD_MCP_PORT   default 9875
 *   FREECAD_MCP_TOKEN  optional bearer token set in the FreeCAD addon
 */

const http = require('node:http')
const { writeFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { XMLParser } = require('fast-xml-parser')

const HOST = process.env.FREECAD_MCP_HOST || '127.0.0.1'
const PORT = Number(process.env.FREECAD_MCP_PORT || 9875) || 9875
const TOKEN = (process.env.FREECAD_MCP_TOKEN || '').trim()

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => name === 'param' || name === 'member' || name === 'value' || name === 'data',
})

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function xmlValue(value) {
  if (value === null || value === undefined) return '<value><nil/></value>'
  if (typeof value === 'boolean') return `<value><boolean>${value ? 1 : 0}</boolean></value>`
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? `<value><int>${value}</int></value>`
      : `<value><double>${value}</double></value>`
  }
  if (typeof value === 'string') return `<value><string>${escapeXml(value)}</string></value>`
  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(xmlValue).join('')}</data></array></value>`
  }
  if (typeof value === 'object') {
    const members = Object.entries(value)
      .map(([key, item]) => `<member><name>${escapeXml(key)}</name>${xmlValue(item)}</member>`)
      .join('')
    return `<value><struct>${members}</struct></value>`
  }
  return `<value><string>${escapeXml(String(value))}</string></value>`
}

function first(array) {
  return Array.isArray(array) ? array[0] : array
}

/** Convert one parsed XML-RPC <value> node into a plain JS value. */
function fromXmlValue(node) {
  const value = first(node)
  if (value === undefined || value === null) return null
  if (typeof value !== 'object') return value
  if ('string' in value) return String(value.string ?? '')
  if ('int' in value) return Number.parseInt(value.int, 10)
  if ('i4' in value) return Number.parseInt(value.i4, 10)
  if ('double' in value) return Number.parseFloat(value.double)
  if ('boolean' in value) return String(value.boolean) === '1' || String(value.boolean) === 'true'
  if ('nil' in value) return null
  if ('base64' in value) return String(value.base64 ?? '')
  if ('dateTime.iso8601' in value) return String(value['dateTime.iso8601'] ?? '')
  if ('array' in value) {
    const data = first(value.array?.data)
    const values = data?.value
    if (values === undefined) return []
    return (Array.isArray(values) ? values : [values]).map((item) => fromXmlValue([item]))
  }
  if ('struct' in value) {
    const members = value.struct?.member
    const list = members === undefined ? [] : Array.isArray(members) ? members : [members]
    const out = {}
    for (const member of list) {
      const name = String(member?.name ?? '')
      if (name) out[name] = fromXmlValue(member.value)
    }
    return out
  }
  // Untyped <value>text</value> arrives as a bare string and is handled above.
  return null
}

function xmlRpcCall(method, params = [], timeoutMs = 120_000) {
  const body =
    '<?xml version="1.0"?>' +
    '<methodCall>' +
    `<methodName>${escapeXml(method)}</methodName>` +
    `<params>${params.map((param) => `<param>${xmlValue(param)}</param>`).join('')}</params>` +
    '</methodCall>'
  const headers = {
    'Content-Type': 'text/xml',
    'Content-Length': Buffer.byteLength(body),
  }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: '/', method: 'POST', headers },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          text += chunk
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`FreeCAD RPC returned HTTP ${res.statusCode}`))
            return
          }
          let parsed
          try {
            parsed = parser.parse(text)
          } catch (error) {
            reject(new Error(`Could not parse FreeCAD RPC response: ${error.message}`))
            return
          }
          const response = parsed?.methodResponse
          if (!response) {
            reject(new Error('FreeCAD RPC response was missing methodResponse'))
            return
          }
          if (response.fault) {
            const fault = fromXmlValue(response.fault.value)
            const message =
              fault && typeof fault === 'object'
                ? fault.faultString || JSON.stringify(fault)
                : String(fault ?? 'FreeCAD RPC fault')
            reject(new Error(message))
            return
          }
          const param = response.params?.param
          if (param === undefined) {
            resolve(null)
            return
          }
          const list = Array.isArray(param) ? param : [param]
          resolve(list.length === 1 ? fromXmlValue(list[0].value) : list.map((p) => fromXmlValue(p.value)))
        })
      }
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`FreeCAD RPC "${method}" timed out after ${Math.round(timeoutMs / 1000)}s`))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function text(value) {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function success(message, details) {
  return details === undefined ? message : `${message}\n${text(details)}`
}

function failure(message, details) {
  return details === undefined ? message : `${message}\n${text(details)}`
}

function isOk(result) {
  return Boolean(result && typeof result === 'object' && result.success === true)
}

const TOOLS = [
  {
    name: 'freecad_status',
    description:
      'Check the connection to the running FreeCAD session. Returns FreeCAD/addon versions, open documents, and GUI dispatch state.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async run() {
      const status = await xmlRpcCall('get_rpc_status', [], 10_000)
      return { text: text(status) }
    },
  },
  {
    name: 'list_documents',
    description: 'List the names of all documents currently open in FreeCAD.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async run() {
      const docs = await xmlRpcCall('list_documents')
      return { text: text(docs) }
    },
  },
  {
    name: 'create_document',
    description: 'Create a new document in FreeCAD.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name for the new document.' } },
      required: ['name'],
    },
    async run(args) {
      const result = await xmlRpcCall('create_document', [String(args.name ?? '')])
      if (isOk(result)) return { text: `Document '${result.document_name}' created successfully` }
      return { text: failure(`Failed to create document: ${result?.error ?? 'unknown error'}`, result), isError: true }
    },
  },
  {
    name: 'get_objects',
    description: 'List every object in a document, with serialized properties and shapes.',
    inputSchema: {
      type: 'object',
      properties: { doc_name: { type: 'string', description: 'Document name.' } },
      required: ['doc_name'],
    },
    async run(args) {
      const result = await xmlRpcCall('get_objects', [String(args.doc_name ?? '')])
      return { text: text(result) }
    },
  },
  {
    name: 'get_object',
    description: 'Inspect one object in a document, including volume, area, and bounding box when available.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_name: { type: 'string', description: 'Document name.' },
        obj_name: { type: 'string', description: 'Object name inside the document.' },
      },
      required: ['doc_name', 'obj_name'],
    },
    async run(args) {
      const result = await xmlRpcCall('get_object', [
        String(args.doc_name ?? ''),
        String(args.obj_name ?? ''),
      ])
      return { text: text(result) }
    },
  },
  {
    name: 'create_object',
    description:
      'Create an object in a FreeCAD document. obj_type must be a registered FreeCAD type such as Part::Box, Part::Cylinder, Part::Cut, PartDesign::Body, or Fem::AnalysisPython. Pass properties in obj_properties (for example {"Length": 10, "Width": 20, "Height": 5}).',
    inputSchema: {
      type: 'object',
      properties: {
        doc_name: { type: 'string', description: 'Document name.' },
        obj_type: { type: 'string', description: 'Registered FreeCAD object type.' },
        obj_name: { type: 'string', description: 'Name for the new object.' },
        analysis_name: { type: 'string', description: 'Optional FEM analysis name.' },
        obj_properties: {
          type: 'object',
          description: 'Property values to apply to the new object.',
          additionalProperties: true,
        },
      },
      required: ['doc_name', 'obj_type', 'obj_name'],
    },
    async run(args) {
      const objData = {
        Name: String(args.obj_name ?? ''),
        Type: String(args.obj_type ?? ''),
        Properties: args.obj_properties && typeof args.obj_properties === 'object' ? args.obj_properties : {},
        Analysis: args.analysis_name ?? null,
      }
      const result = await xmlRpcCall('create_object', [String(args.doc_name ?? ''), objData])
      if (isOk(result)) return { text: `Object '${result.object_name}' created successfully` }
      return { text: failure(`Failed to create object: ${result?.error ?? 'unknown error'}`, result), isError: true }
    },
  },
  {
    name: 'edit_object',
    description: 'Edit properties of an existing object in a FreeCAD document.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_name: { type: 'string', description: 'Document name.' },
        obj_name: { type: 'string', description: 'Object name.' },
        obj_properties: {
          type: 'object',
          description: 'Property values to apply.',
          additionalProperties: true,
        },
      },
      required: ['doc_name', 'obj_name', 'obj_properties'],
    },
    async run(args) {
      const result = await xmlRpcCall('edit_object', [
        String(args.doc_name ?? ''),
        String(args.obj_name ?? ''),
        { Properties: args.obj_properties && typeof args.obj_properties === 'object' ? args.obj_properties : {} },
      ])
      if (isOk(result)) return { text: `Object '${result.object_name}' edited successfully` }
      return { text: failure(`Failed to edit object: ${result?.error ?? 'unknown error'}`, result), isError: true }
    },
  },
  {
    name: 'delete_object',
    description: 'Delete an object from a FreeCAD document.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_name: { type: 'string', description: 'Document name.' },
        obj_name: { type: 'string', description: 'Object name.' },
      },
      required: ['doc_name', 'obj_name'],
    },
    async run(args) {
      const result = await xmlRpcCall('delete_object', [
        String(args.doc_name ?? ''),
        String(args.obj_name ?? ''),
      ])
      if (isOk(result)) return { text: `Object '${result.object_name}' deleted successfully` }
      return { text: failure(`Failed to delete object: ${result?.error ?? 'unknown error'}`, result), isError: true }
    },
  },
  {
    name: 'execute_code',
    description:
      'Execute Python code inside the running FreeCAD session and return its console output. Use this for operations the typed tools do not cover.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python code to run inside FreeCAD.' },
        timeout: { type: 'number', description: 'Optional execution timeout in seconds.' },
      },
      required: ['code'],
    },
    async run(args) {
      const timeout = typeof args.timeout === 'number' ? args.timeout : null
      const result = await xmlRpcCall('execute_code', [String(args.code ?? ''), timeout])
      if (isOk(result)) return { text: `Code executed successfully: ${result.message ?? ''}` }
      let message = `Failed to execute code: ${result?.error ?? 'unknown error'}`
      if (result?.output) message += `\nOutput before failure:\n${result.output}`
      return { text: failure(message, result), isError: true }
    },
  },
  {
    name: 'reload_document',
    description: 'Reload a document from disk so changes written outside the GUI become visible.',
    inputSchema: {
      type: 'object',
      properties: { doc_name: { type: 'string', description: 'Document name.' } },
      required: ['doc_name'],
    },
    async run(args) {
      const result = await xmlRpcCall('reload_document', [String(args.doc_name ?? '')])
      return { text: text(result) }
    },
  },
  {
    name: 'get_parts_list',
    description: 'List parts available in the FreeCAD parts library addon.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async run() {
      const result = await xmlRpcCall('get_parts_list')
      return { text: text(result) }
    },
  },
  {
    name: 'insert_part_from_library',
    description: 'Insert a part from the FreeCAD parts library into the active document.',
    inputSchema: {
      type: 'object',
      properties: {
        relative_path: { type: 'string', description: 'Relative path returned by get_parts_list.' },
      },
      required: ['relative_path'],
    },
    async run(args) {
      const result = await xmlRpcCall('insert_part_from_library', [String(args.relative_path ?? '')])
      return { text: text(result) }
    },
  },
  {
    name: 'get_view',
    description:
      'Capture a screenshot of the active FreeCAD 3D view and save it to a temporary PNG. Returns the file path.',
    inputSchema: {
      type: 'object',
      properties: {
        view_name: {
          type: 'string',
          description: 'View orientation: Isometric, Front, Top, Right, Back, Left, Bottom, Dimetric, or Trimetric.',
        },
        width: { type: 'number', description: 'Optional image width in pixels.' },
        height: { type: 'number', description: 'Optional image height in pixels.' },
        focus_object: { type: 'string', description: 'Optional object name to focus on.' },
        doc_name: { type: 'string', description: 'Optional document name to restrict the capture to.' },
      },
      required: [],
    },
    async run(args) {
      const image = await xmlRpcCall('get_active_screenshot', [
        String(args.view_name ?? 'Isometric'),
        typeof args.width === 'number' ? args.width : null,
        typeof args.height === 'number' ? args.height : null,
        args.focus_object ? String(args.focus_object) : null,
        args.doc_name ? String(args.doc_name) : null,
      ])
      if (!image) return { text: 'No active 3D view was available to capture.', isError: true }
      const dir = join(tmpdir(), 'struct-freecad')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `view-${Date.now()}.png`)
      writeFileSync(file, Buffer.from(String(image), 'base64'))
      return { text: `Screenshot saved to ${file}` }
    },
  },
  {
    name: 'run_fem_analysis',
    description: 'Run an existing FEM analysis in a FreeCAD document.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_name: { type: 'string', description: 'Document name.' },
        analysis_name: { type: 'string', description: 'FEM analysis object name.' },
        timeout: { type: 'number', description: 'Optional timeout in seconds.' },
      },
      required: ['doc_name', 'analysis_name'],
    },
    async run(args) {
      const timeout = typeof args.timeout === 'number' ? Math.trunc(args.timeout) : 600
      const result = await xmlRpcCall('run_fem_analysis', [
        String(args.doc_name ?? ''),
        String(args.analysis_name ?? ''),
        timeout,
      ])
      return { text: text(result), isError: result && result.success === false }
    },
  },
  {
    name: 'execute_code_async',
    description: 'Run Python code in a background job inside FreeCAD. Poll get_async_status with the returned job_id.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Python code to run.' } },
      required: ['code'],
    },
    async run(args) {
      const result = await xmlRpcCall('execute_code_async', [String(args.code ?? '')])
      return { text: text(result), isError: result && result.success === false }
    },
  },
  {
    name: 'get_async_status',
    description: 'Read the status of a background code job started by execute_code_async.',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Job id returned by execute_code_async.' } },
      required: ['job_id'],
    },
    async run(args) {
      const result = await xmlRpcCall('get_async_status', [String(args.job_id ?? '')])
      return { text: text(result) }
    },
  },
  {
    name: 'get_task_status',
    description: 'Read the status of a long-running GUI task in FreeCAD.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Optional task id.' } },
      required: [],
    },
    async run(args) {
      const result = await xmlRpcCall('get_task_status', [args.task_id ? String(args.task_id) : null])
      return { text: text(result) }
    },
  },
]

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]))

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') {
    sendError(null, -32700, 'Invalid JSON-RPC message')
    return
  }
  const { id, method, params } = message
  const isNotification = id === undefined || id === null

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: params?.protocolVersion || '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'freecad', version: '1.0.0' },
    })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'ping') {
    if (!isNotification) sendResult(id, {})
    return
  }
  if (method === 'tools/list') {
    sendResult(id, {
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    })
    return
  }
  if (method === 'tools/call') {
    const name = String(params?.name ?? '')
    const tool = TOOL_MAP.get(name)
    if (!tool) {
      if (!isNotification) sendResult(id, { content: [{ type: 'text', text: `Unknown FreeCAD tool: ${name}` }], isError: true })
      return
    }
    try {
      const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}
      const result = await tool.run(args)
      if (!isNotification) {
        sendResult(id, {
          content: [{ type: 'text', text: result.text }],
          isError: Boolean(result.isError),
        })
      }
    } catch (error) {
      if (!isNotification) {
        sendResult(id, {
          content: [{ type: 'text', text: `FreeCAD tool "${name}" failed: ${error.message}` }],
          isError: true,
        })
      }
    }
    return
  }
  if (isNotification) return
  sendError(id, -32601, `Method not found: ${method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        sendError(null, -32700, 'Invalid JSON')
      }
      if (message) {
        void handleMessage(message)
      }
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
