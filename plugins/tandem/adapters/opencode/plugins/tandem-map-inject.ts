import type { Plugin } from "@opencode-ai/plugin";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tandemRoot = join(here, "..", "..", "..");

const { normalizeHost } = await import(
  pathToFileURL(join(tandemRoot, "scripts/host.mjs")).href
);
const { tryInjectProfile, cleanupSessionMarkers } = await import(
  pathToFileURL(join(tandemRoot, "adapters/shared/map-inject-core.mjs")).href
);

function isBrowserNavigate(tool: string): boolean {
  return /browser_navigate$/i.test(tool) || tool === "browser_navigate";
}

export const TandemMapInject: Plugin = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      if (!isBrowserNavigate(input.tool)) return;

      const url = input.args?.url;
      const result = tryInjectProfile({
        url: typeof url === "string" ? url : null,
        sessionId: input.sessionID,
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
      cleanupSessionMarkers(sessionID);
    },
  };
};
