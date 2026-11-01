import { calendarAccountData, restoreCalendar } from "../googleCalendar";
import { gmailAccountData, restoreGmail } from "../gmail";
import { githubAccountData, restoreGitHub } from "../github";
import { loadMcpServers, restoreMcpServers, type McpServerConfig } from "../mcp";
import { spotifyAccountData, restoreSpotify } from "../spotify";
import { loadPluginData, savePluginData } from "./pluginCloud";

const OWNER_KEY = "struct.plugin-account-owner.v1";

/** Load connections for the signed-in account, or seed that account once from this device. */
export async function bootstrapAccountPlugins(userId: string): Promise<void> {
  const cloud = await loadPluginData();
  if (!cloud) return;
  let previousOwner = "";
  try { previousOwner = localStorage.getItem(OWNER_KEY) ?? ""; } catch { /* no local storage */ }
  const mayMigrateDeviceData = !previousOwner;

  const current = {
    gmail: gmailAccountData(),
    spotify: spotifyAccountData(),
    calendar: calendarAccountData(),
    github: githubAccountData(),
    mcp: loadMcpServers(),
  };
  for (const plugin of ["gmail", "spotify", "calendar", "github", "mcp"] as const) {
    if (Object.prototype.hasOwnProperty.call(cloud, plugin)) continue;
    // A previously linked account with no row means the user deleted that
    // cloud connection. Keep this device's local copy, but do not resurrect it.
    const local = current[plugin];
    if (previousOwner === userId) {
      cloud[plugin] = local;
      continue;
    }
    if (mayMigrateDeviceData && local && (plugin !== "mcp" || (Array.isArray(local) && local.length > 0))) {
      await savePluginData(plugin, local);
      cloud[plugin] = local;
    } else {
      cloud[plugin] = null;
    }
  }

  restoreGmail(cloud.gmail);
  restoreSpotify(cloud.spotify);
  restoreCalendar(cloud.calendar);
  restoreGitHub(cloud.github);
  restoreMcpServers(Array.isArray(cloud.mcp) ? cloud.mcp as McpServerConfig[] : []);
  try { localStorage.setItem(OWNER_KEY, userId); } catch { /* in-memory app remains usable */ }
}
