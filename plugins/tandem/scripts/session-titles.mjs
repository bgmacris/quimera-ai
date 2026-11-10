// session-titles.mjs — 0.13: a readable name for each agent's tab group, instead of "main · <folder>" / "sub b7c2".
//   main     → the session's title: the one you gave it (/rename, "custom-title") or else Claude Code's own
//              ("ai-title", the one /resume shows)
//   subagent → "↳ " + the description it was launched with (subagents/agent-<id>.meta.json), or its type
// Read from Claude Code's files next to the transcript. They are NOT an API: undocumented, may change in any
// version (seen in 2.1.322, 2026-11-10). Anything missing or unreadable → null, and the caller falls back to the
// 0.12 title. The transcript path comes from the PreToolUse hook (autostart.mjs, `agent_transcript`); only a
// .jsonl under Claude Code's projects folder is read, so a path put there by anyone else reads nothing.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const MAX_TITLE = 28;
const TAIL_START = 256 * 1024;
const TAIL_MAX = 32 * 1024 * 1024;

export function projectsDir(env = process.env) {
  return resolve(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

// A transcript path we are willing to read: absolute, .jsonl, inside the projects folder.
export function okTranscript(p, env = process.env) {
  if (typeof p !== 'string' || !p.endsWith('.jsonl')) return false;
  const norm = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
  const root = norm(projectsDir(env)) + sep;
  return norm(resolve(p)).startsWith(root);
}

// One line, no control characters, at most `max` characters (an ellipsis when cut).
export function tidy(s, max = MAX_TITLE) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const chars = [...t];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : t;
}

// The last chunk of the file (bytes), growing until a title shows up or the whole file was read.
function lastTitles(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    for (let want = TAIL_START; ; want *= 2) {
      const len = Math.min(size, want, TAIL_MAX);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      let custom = null; let ai = null;
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.includes('"custom-title"') && !line.includes('"ai-title"')) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }   // the first line of a chunk may be cut
        if (o?.type === 'custom-title' && typeof o.customTitle === 'string') custom = o.customTitle;
        if (o?.type === 'ai-title' && typeof o.aiTitle === 'string') ai = o.aiTitle;
      }
      if (custom || ai || len >= size || len >= TAIL_MAX) return { custom, ai };
    }
  } catch { return { custom: null, ai: null }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

export function sessionTitle(transcript, env = process.env) {
  if (!okTranscript(transcript, env)) return null;
  const { custom, ai } = lastTitles(transcript);
  return tidy(custom) || tidy(ai);
}

// The subagent's meta file. Its hook may carry the session's transcript (…/<session>.jsonl → …/<session>/subagents/)
// or its own (…/subagents/agent-<id>.jsonl → the file next to it): both are handled.
export function subagentMetaPath(transcript, agent) {
  const b = basename(transcript, '.jsonl');
  if (b.startsWith('agent-')) return join(dirname(transcript), `agent-${agent}.meta.json`);
  return join(dirname(transcript), b, 'subagents', `agent-${agent}.meta.json`);
}

export function subagentTitle(transcript, agent, env = process.env) {
  if (!okTranscript(transcript, env) || !/^[\w.-]{1,64}$/.test(String(agent))) return null;
  let meta; try { meta = JSON.parse(readFileSync(subagentMetaPath(transcript, agent), 'utf8')); } catch { return null; }
  const what = tidy(meta?.description, MAX_TITLE - 2) || tidy(meta?.agentType, MAX_TITLE - 2);
  return what ? `↳ ${what}` : null;
}

// Per-agent title, re-read at most every ttlMs. note(agent, transcript) on every call (cheap); title(agent) when
// a group is made or touched. changed(agent) → true once when a re-read gave a different title (a /rename).
export function titler({ ttlMs = 30_000, env = process.env, now = Date.now } = {}) {
  const seen = new Map();   // agent → { transcript, title, at }
  const read = (agent, transcript) => (agent === 'main' ? sessionTitle(transcript, env) : subagentTitle(transcript, agent, env));
  const fresh = (agent) => {
    const s = seen.get(agent);
    if (!s?.transcript) return s ?? null;
    if (s.at == null || now() - s.at >= ttlMs) {
      const t = read(agent, s.transcript);
      if (s.at != null && t !== s.title) s.dirty = true;
      s.title = t; s.at = now();
    }
    return s;
  };
  return {
    note(agent, transcript) {
      if (!okTranscript(transcript, env)) return;
      const s = seen.get(agent);
      if (!s || s.transcript !== transcript) seen.set(agent, { transcript, title: null, at: null });
    },
    title: (agent) => fresh(agent)?.title ?? null,
    changed(agent) {
      const s = fresh(agent);
      if (!s?.dirty) return false;
      s.dirty = false; return true;
    },
    forget: (agent) => { seen.delete(agent); },
  };
}
