import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Persistent CLI config. Stored at `~/.topcal/config.json` with mode
 * 0600 so other users on the box can't read the API key.
 *
 * Resolution order for any field:
 *   1. Explicit CLI flag (handled by command code)
 *   2. Environment variable (`TOPCAL_*`)
 *   3. Persisted file
 *   4. Built-in default (only for `apiUrl`)
 */

export interface CliConfig {
  /** Base URL of the topcal API, e.g. `https://app.topcal.ai`. */
  apiUrl: string;
  /** Workspace API key (`tofu_(live|test)_...`). Optional for `health` etc. */
  apiKey?: string | undefined;
  /**
   * Most-recently-issued agent intent JWT. Stored so `topcal user signup`
   * and `topcal billing checkout` work without the user pasting it.
   * Cleared automatically once expired.
   */
  intentToken?: string | undefined;
  intentExpiresAt?: string | undefined;
  /** Most-recently-active principal id (uuid). Convenience for chained commands. */
  principalId?: string | undefined;
  /** Workspace metadata from device-auth approve. */
  workspaceId?: string | undefined;
  workspaceName?: string | undefined;
  workspaceSlug?: string | undefined;
  /** Pending device-auth handshake (auth register --wait no). */
  pendingDeviceCode?: string | undefined;
  pendingUserCode?: string | undefined;
}

const DEFAULT_API_URL = "https://app.topcal.ai";
const LEGACY_API_HOSTS = new Set(["topcal.app", "www.topcal.app"]);

export function canonicalApiUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (LEGACY_API_HOSTS.has(parsed.hostname.toLowerCase())) {
      return "https://app.topcal.ai";
    }
    return parsed.origin;
  } catch {
    return trimmed || DEFAULT_API_URL;
  }
}

export function configPath(): string {
  return process.env.TOPCAL_CONFIG_PATH ?? join(homedir(), ".topcal", "config.json");
}

export function loadConfig(): CliConfig {
  const path = configPath();
  let fileConfig: Partial<CliConfig> = {};
  if (existsSync(path)) {
    try {
      fileConfig = JSON.parse(readFileSync(path, "utf8")) as Partial<CliConfig>;
    } catch {
      fileConfig = {};
    }
  }

  const merged: CliConfig = {
    apiUrl: canonicalApiUrl(
      process.env.TOPCAL_API_URL?.trim() ||
        fileConfig.apiUrl?.trim() ||
        DEFAULT_API_URL,
    ),
    apiKey: process.env.TOPCAL_API_KEY?.trim() || fileConfig.apiKey,
    intentToken:
      process.env.TOPCAL_AGENT_INTENT?.trim() || fileConfig.intentToken,
    intentExpiresAt: fileConfig.intentExpiresAt,
    principalId: fileConfig.principalId,
    workspaceId: fileConfig.workspaceId,
    workspaceName: fileConfig.workspaceName,
    workspaceSlug: fileConfig.workspaceSlug,
    pendingDeviceCode: fileConfig.pendingDeviceCode,
    pendingUserCode: fileConfig.pendingUserCode,
  };

  if (
    merged.intentExpiresAt &&
    new Date(merged.intentExpiresAt).getTime() <= Date.now()
  ) {
    delete merged.intentToken;
    delete merged.intentExpiresAt;
  }

  return merged;
}

export function saveConfig(patch: Partial<CliConfig>): CliConfig {
  const path = configPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  let current: Partial<CliConfig> = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as Partial<CliConfig>;
    } catch {
      current = {};
    }
  }

  const next: CliConfig = {
    apiUrl: canonicalApiUrl(
      patch.apiUrl ?? current.apiUrl ?? DEFAULT_API_URL,
    ),
    apiKey: patch.apiKey ?? current.apiKey,
    intentToken: patch.intentToken ?? current.intentToken,
    intentExpiresAt: patch.intentExpiresAt ?? current.intentExpiresAt,
    principalId: patch.principalId ?? current.principalId,
    workspaceId: patch.workspaceId ?? current.workspaceId,
    workspaceName: patch.workspaceName ?? current.workspaceName,
    workspaceSlug: patch.workspaceSlug ?? current.workspaceSlug,
    pendingDeviceCode:
      patch.pendingDeviceCode !== undefined
        ? patch.pendingDeviceCode || undefined
        : current.pendingDeviceCode,
    pendingUserCode:
      patch.pendingUserCode !== undefined
        ? patch.pendingUserCode || undefined
        : current.pendingUserCode,
  };

  const cleaned = Object.fromEntries(
    Object.entries(next).filter(([, v]) => v !== undefined && v !== ""),
  );

  writeFileSync(path, JSON.stringify(cleaned, null, 2) + "\n", { mode: 0o600 });
  return next;
}

/**
 * Wipe credentials while preserving the configured API URL.
 */
export function clearConfig(): void {
  const path = configPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  let current: Partial<CliConfig> = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as Partial<CliConfig>;
    } catch {
      current = {};
    }
  }
  const surviving = current.apiUrl ? { apiUrl: current.apiUrl } : {};
  writeFileSync(path, JSON.stringify(surviving, null, 2) + "\n", { mode: 0o600 });
}
