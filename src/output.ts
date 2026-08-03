import pico from "picocolors";

/**
 * Output adapters. CLI commands call `out.json(value)` for the data
 * payload and `out.note(...)` for human-readable side commentary.
 *
 * When `--json` is set we suppress notes entirely so the stdout is
 * pure machine-readable JSON suitable for piping into `jq`.
 *
 * When stdout is a TTY we add color; when it isn't (piped, captured
 * by an agent), we emit plain text.
 */

export interface OutputAdapter {
  json: (value: unknown) => void;
  note: (msg: string) => void;
  ok: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  /** Print a key→value table. Accepts ordered tuples. */
  kv: (rows: ReadonlyArray<[string, string]>) => void;
}

export function createOutput(args: { json: boolean }): OutputAdapter {
  const isTty = !!process.stdout.isTTY;
  const useColor = isTty && !args.json && !process.env.NO_COLOR;
  const c = {
    bold: useColor ? pico.bold : (s: string) => s,
    dim: useColor ? pico.dim : (s: string) => s,
    green: useColor ? pico.green : (s: string) => s,
    yellow: useColor ? pico.yellow : (s: string) => s,
    red: useColor ? pico.red : (s: string) => s,
    cyan: useColor ? pico.cyan : (s: string) => s,
  };

  if (args.json) {
    return {
      json: (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n"),
      note: () => undefined,
      ok: () => undefined,
      warn: (m) => process.stderr.write(m + "\n"),
      error: (m) => process.stderr.write(m + "\n"),
      kv: () => undefined,
    };
  }

  return {
    json: (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n"),
    note: (m) => process.stderr.write(c.dim(m) + "\n"),
    ok: (m) => process.stderr.write(c.green("\u2714 ") + m + "\n"),
    warn: (m) => process.stderr.write(c.yellow("! ") + m + "\n"),
    error: (m) => process.stderr.write(c.red("\u2717 ") + m + "\n"),
    kv: (rows) => {
      const width = rows.reduce((w, [k]) => Math.max(w, k.length), 0);
      for (const [k, v] of rows) {
        process.stdout.write(`${c.dim(k.padEnd(width))}  ${v}\n`);
      }
    },
  };
}
