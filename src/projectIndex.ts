/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
/**
 * ProjectIndex maintains a structural map of the workspace to provide the AI 
 * with high-level architectural context without needing to read every file.
 */

import { invoke } from "./native";

export interface ProjectNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ProjectNode[];
  symbols?: string[]; // Functions, Classes, Interfaces
}

export interface ProjectMap {
  root: string;
  nodes: ProjectNode[];
  lastUpdated: number;
}

export async function generateProjectMap(root: string): Promise<ProjectMap> {
  const nodes: ProjectNode[] = [];
  
  try {
    // In a real Tauri app, we'd use a recursive fs_list_dir.
    // For now, we implement the logic that the Agent will use to "index" the project.
    const entries = await invoke<Array<{
      name: string;
      path: string;
      is_dir: boolean;
      size?: number | null;
    }>>("fs_list_dir", { path: root });
    
    const indexed = await Promise.all(
      entries.map(async (entry: {
        name: string;
        path: string;
        is_dir: boolean;
        size?: number | null;
      }) => ({
        name: entry.name,
        path: entry.path,
        type: entry.is_dir ? 'directory' as const : 'file' as const,
        symbols: entry.is_dir ? [] : await extractSymbols(entry.path, entry.size),
      }))
    );
    nodes.push(...indexed);
  } catch (e) {
    console.error("Indexing failed", e);
  }

  return {
    root,
    nodes,
    lastUpdated: Date.now(),
  };
}

/** Extensions worth scanning for symbols (skips binaries like .png/.exe). */
const TEXT_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "c", "h", "cpp",
  "hpp", "java", "kt", "rb", "php", "md", "markdown", "json", "toml", "yaml",
  "yml", "html", "css", "scss", "txt", "sh", "bat", "ps1", "sql", "vue", "svelte",
]);
/** Don't slurp huge files just for symbols. */
const MAX_INDEX_BYTES = 512 * 1024;

async function extractSymbols(path: string, size?: number | null): Promise<string[]> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!TEXT_EXTS.has(ext)) return []; // binary or unknown type — skip
  if (typeof size === "number" && size > MAX_INDEX_BYTES) return []; // too big
  try {
    const content = await invoke<string>("fs_read_file", { path });
    const symbols: string[] = [];
    
    // Simple regex for JS/TS/Rust symbols (Class, Function, Interface, Const)
    const patterns = [
      /class\s+([a-zA-Z_]\w*)/g,
      /function\s+([a-zA-Z_]\w*)/g,
      /interface\s+([a-zA-Z_]\w*)/g,
      /const\s+([a-zA-Z_]\w*)\s*=\s*\(/g, // Arrow functions
      /pub\s+fn\s+([a-zA-Z_]\w*)/g,       // Rust
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        symbols.push(match[1]);
      }
    }
    return [...new Set(symbols)];
  } catch {
    return [];
  }
}

// Use a singleton to hold the map in memory for the session
let currentMap: ProjectMap | null = null;

export async function getProjectContext(root: string): Promise<string> {
  if (!currentMap || currentMap.root !== root) {
    currentMap = await generateProjectMap(root);
  }

  let output = "PROJECT ARCHITECTURE MAP:\n";
  currentMap.nodes.forEach(node => {
    const typeIcon = node.type === 'directory' ? '[D]' : '[F]';
    const symbols = node.symbols && node.symbols.length > 0 
      ? ` (Symbols: ${node.symbols.slice(0, 5).join(', ')}${node.symbols.length > 5 ? '...' : ''})` 
      : '';
    output += `${typeIcon} ${node.name}${symbols}\n`;
  });

  return output;
}
