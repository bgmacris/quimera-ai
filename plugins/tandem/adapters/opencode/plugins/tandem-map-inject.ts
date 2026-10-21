import type { Plugin } from "@opencode-ai/plugin";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tandemRoot = join(here, "..", "..", "..");

const { normalizeHost } = await import(
  pathToFileURL(join(tandemRoot, "scripts/host.mjs")).href
);
// Shared logic lives in upstream scripts/map-inject-core.mjs (also used by the Claude
// Code hook and the Cursor adapter); this plugin is the OpenCode entry point.
const { tryInjectProfile, cleanupSessionMarkers } = await import(
  pathToFileURL(join(tandemRoot, "scripts/map-inject-core.mjs")).href
);
// Leases (scripts/session-hook.mjs): an OpenCode session using the shared Chrome must hold one, or the
// last Claude Code session to end stops the browser under it. Touched on every browser tool; dropped
// on session.deleted WITHOUT stopping Chrome (a lease left by a crash expires after its TTL).
const { touchLease, dropLease } = await import(
  pathToFileURL(join(tandemRoot, "scripts/session-hook.mjs")).href
);
const { dataDir: resolveDataDir } = await import(
  pathToFileURL(join(tandemRoot, "scripts/paths.mjs")).href
);

const dataDir = resolveDataDir();

function isBrowserNavigate(tool: string): boolean {
  return /browser_navigate$/i.test(tool) || tool === "browser_navigate";
}

export const TandemMapInject: Plugin = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      if (/browser_/i.test(input.tool)) {
        try { touchLease(dataDir, input.sessionID); } catch { /* never break the tool */ }
      }
      if (!isBrowserNavigate(input.tool)) return;

      const url = input.args?.url;
      const result = tryInjectProfile({
        url: typeof url === "string" ? url : null,
        sessionId: input.sessionID,
        dataDir,
        normalizeHost,
      });
      if (!result.ok) return;

      // ponytail: append to tool output; OpenCode has no PostToolUse additionalContext yet.
      output.output = `${output.output}\n\n--- tandem:map profile (${result.host}) ---\n${result.context}`;
    },

    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      const sessionID = (event.properties as { sessionID?: string })?.sessionID;
      if (!sessionID) return;
      cleanupSessionMarkers(sessionID, dataDir);
      try { dropLease(dataDir, sessionID); } catch { /* best effort */ }
    },
  };
};
