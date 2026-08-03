import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearConfig,
  configPath,
  loadConfig,
  saveConfig,
  type CliConfig,
} from "./config";

let tempPath: string;
const ENV_TO_CLEAR = [
  "TOPCAL_API_URL",
  "TOPCAL_API_KEY",
  "TOPCAL_AGENT_INTENT",
] as const;
const ENV_BACKUP: Partial<Record<(typeof ENV_TO_CLEAR)[number], string>> = {};

beforeEach(() => {
  for (const k of ENV_TO_CLEAR) {
    if (process.env[k] !== undefined) ENV_BACKUP[k] = process.env[k];
    delete process.env[k];
  }
  const dir = mkdtempSync(join(tmpdir(), "topcal-cli-"));
  tempPath = join(dir, "config.json");
  process.env.TOPCAL_CONFIG_PATH = tempPath;
});

afterEach(() => {
  delete process.env.TOPCAL_CONFIG_PATH;
  for (const k of ENV_TO_CLEAR) {
    if (ENV_BACKUP[k] !== undefined) {
      process.env[k] = ENV_BACKUP[k];
      delete ENV_BACKUP[k];
    }
  }
});

describe("CLI config store", () => {
  it("returns the default API URL when no file or env is set", () => {
    expect(configPath()).toBe(tempPath);
    const cfg = loadConfig();
    expect(cfg.apiUrl).toBe("http://localhost:3000");
    expect(cfg.apiKey).toBeUndefined();
  });

  it("env vars override file values", () => {
    saveConfig({ apiUrl: "https://book.example.com", apiKey: "tofu_test_filekey" });
    process.env.TOPCAL_API_URL = "https://override.example.com";
    process.env.TOPCAL_API_KEY = "tofu_test_envkey";
    const cfg = loadConfig();
    expect(cfg.apiUrl).toBe("https://override.example.com");
    expect(cfg.apiKey).toBe("tofu_test_envkey");
  });

  it("persists with mode 0600 and round-trips fields", () => {
    const saved = saveConfig({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test_key",
      intentToken: "jwt.sample",
      intentExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      principalId: "00000000-0000-0000-0000-000000000001",
    });
    expect(saved.apiKey).toBe("tofu_test_key");

    const stat = statSync(tempPath);
    // Mode bits — verify the owner-only RW pattern (0600). We mask
    // the file-type bits so the assertion isn't OS-specific.
    expect(stat.mode & 0o777).toBe(0o600);

    const reloaded = loadConfig();
    expect(reloaded.apiUrl).toBe("https://book.example.com");
    expect(reloaded.apiKey).toBe("tofu_test_key");
    expect(reloaded.intentToken).toBe("jwt.sample");
    expect(reloaded.principalId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("clears expired intent tokens on load", () => {
    saveConfig({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test_key",
      intentToken: "jwt.expired",
      intentExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const cfg = loadConfig();
    expect(cfg.intentToken).toBeUndefined();
    expect(cfg.intentExpiresAt).toBeUndefined();
  });

  it("clearConfig wipes credentials but keeps API URL", () => {
    saveConfig({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test_key",
      intentToken: "jwt.sample",
    });
    clearConfig();
    const cfg = loadConfig();
    expect(cfg.apiUrl).toBe("https://book.example.com");
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.intentToken).toBeUndefined();
  });

  it("survives a corrupt config file by treating it as empty", () => {
    saveConfig({ apiUrl: "https://book.example.com", apiKey: "tofu_test" });
    writeFileSync(tempPath, "{not json", "utf8");
    const cfg = loadConfig();
    expect(cfg.apiUrl).toBe("http://localhost:3000");
    expect(cfg.apiKey).toBeUndefined();
  });

  it("round-trips through JSON without leaking undefined values", () => {
    saveConfig({ apiUrl: "https://book.example.com" });
    const raw = readFileSync(tempPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toEqual({ apiUrl: "https://book.example.com" } satisfies Partial<CliConfig>);
  });
});
