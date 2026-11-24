/*
 * Author: Lumorix Studios
 * Check the LICENSE in the GitHub repo for more information on permissions to use this code.
 */

/**
 * FreeCAD plugin bridge.
 *
 * FreeCAD itself stays an external desktop app. The Electron main process
 * detects it, installs the bundled MCP addon, launches it, and hands us the
 * command that starts the stdio MCP bridge. This module turns that into a
 * normal MCP server entry so the agent loop can discover FreeCAD tools the
 * same way it discovers every other MCP server.
 */
import { invoke } from "./native";
import {
  loadMcpServers,
  makeServerId,
  saveMcpServers,
  stopStdio,
  type McpServerConfig,
} from "./mcp";

export interface FreeCadMcpCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface FreeCadStatus {
  platform: string;
  executable: string | null;
  appDataDir: string;
  addonDir: string;
  addonInstalled: boolean;
  addonVersion: string | null;
  settingsPath: string;
  rpcRunning: boolean;
  launched?: boolean;
  alreadyRunning?: boolean;
  /** False when this connect call was the one that installed the addon. */
  addonWasInstalled?: boolean;
  mcp?: FreeCadMcpCommand;
}

export const FREECAD_SERVER_NAME = "FreeCAD";

export async function freecadStatus(): Promise<FreeCadStatus> {
  return invoke<FreeCadStatus>("freecad_status");
}

export async function freecadConnect(): Promise<FreeCadStatus> {
  return invoke<FreeCadStatus>("freecad_connect");
}

export async function freecadDisable(): Promise<FreeCadStatus> {
  return invoke<FreeCadStatus>("freecad_disable");
}

export async function freecadMcpCommand(): Promise<FreeCadMcpCommand> {
  return invoke<FreeCadMcpCommand>("freecad_mcp_command");
}

/** True for the MCP entry this plugin owns, regardless of its display name. */
export function isFreeCadServer(server: McpServerConfig): boolean {
  // Match the bridge command first so renames and app moves still resolve.
  if ((server.args ?? []).some((arg) => arg.replace(/\\/g, "/").endsWith("/freecad-mcp.cjs"))) {
    return true;
  }
  return server.name === FREECAD_SERVER_NAME && server.transport === "stdio";
}

export function freecadServer(): McpServerConfig | null {
  return loadMcpServers().find(isFreeCadServer) ?? null;
}

export function freecadConnected(): boolean {
  const server = freecadServer();
  return Boolean(server?.enabled);
}

/**
 * Add or refresh the stdio MCP entry for FreeCAD. The command points at the
 * Electron executable with ELECTRON_RUN_AS_NODE, so no Python/uv install is
 * needed on the user's machine.
 */
export async function ensureFreeCadMcpServer(): Promise<McpServerConfig> {
  const mcp = await freecadMcpCommand();
  const servers = loadMcpServers();
  const existing = servers.find(isFreeCadServer);
  const next: McpServerConfig = {
    id: existing?.id ?? makeServerId(),
    name: FREECAD_SERVER_NAME,
    enabled: true,
    transport: "stdio",
    command: mcp.command,
    args: mcp.args,
    env: mcp.env,
  };
  const updated = existing
    ? servers.map((server) => (isFreeCadServer(server) ? next : server))
    : [...servers, next];
  saveMcpServers(updated);
  // Let the settings panel and agent UI reload their MCP lists immediately.
  window.dispatchEvent(new Event("struct:mcp-servers-restored"));
  return next;
}

/** Remove the MCP entry and stop its bridge process if it is running. */
export function removeFreeCadMcpServer(): void {
  const servers = loadMcpServers();
  const removed = servers.filter(isFreeCadServer);
  if (removed.length === 0) return;
  for (const server of removed) void stopStdio(server.id);
  saveMcpServers(servers.filter((server) => !isFreeCadServer(server)));
  window.dispatchEvent(new Event("struct:mcp-servers-restored"));
}
