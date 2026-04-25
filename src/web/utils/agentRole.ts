// ============================================================
// QwenTrace — Qwen Code agent role detection
// ------------------------------------------------------------
// Single source of truth for "who is making this LLM call?".
//
// Qwen Code's `chat/completions` traffic comes from many places: the main
// interactive agent, automated memory subagents, session services, user-
// invoked subagents, etc. Every one of them ships a hardcoded system prompt
// constant defined in qwen-code source (verified manually, see references
// below). Detection is therefore a simple prefix/contains match — no regex,
// no LLM, no heuristics.
//
// When Qwen Code adds a new role, append it here. Order matters: the first
// matching pattern wins, so put the most specific signatures first.
//
// Source references (qwen-code @ commit ~v0.15.2):
//   main             → core/src/core/prompts.ts:146
//   memory-select    → core/src/memory/relevanceSelector.ts:15
//   memory-extract   → core/src/memory/extractionAgentPlanner.ts:152
//   memory-dream     → core/src/memory/dreamAgentPlanner.ts:151
//   session-recap    → core/src/services/sessionRecap.ts:15
//   session-title    → core/src/services/sessionTitle.ts:18
//   compression      → core/src/core/prompts.ts:380 getCompressionPrompt()
//   subagent-general → core/src/subagents/builtin-agents.ts:22
//   subagent-explore → core/src/subagents/builtin-agents.ts:48
//   subagent-status  → core/src/subagents/builtin-agents.ts:108
//   subagent-architect → core/src/utils/subagentGenerator.ts:11
// ============================================================

import type { TraceEntry } from '../../types.js';

/** Stable machine-readable identifiers used by filters and analytics. */
export type AgentRoleId =
  | 'main'
  | 'memory-select'
  | 'memory-extract'
  | 'memory-dream'
  | 'session-recap'
  | 'session-title'
  | 'compression'
  | 'subagent-general'
  | 'subagent-explore'
  | 'subagent-statusline'
  | 'subagent-architect'
  | 'unknown';

/** Broad grouping for filter chips and color hints. */
export type AgentRoleGroup =
  | 'main'
  | 'memory'
  | 'session'
  | 'compression'
  | 'subagent'
  | 'unknown';

export interface AgentRoleMeta {
  id: AgentRoleId;
  /** Full descriptive label, used in detail panel and tooltips. */
  label: string;
  /** Compact label for badges (≤ 14 chars), used in sidebar rows. */
  shortLabel: string;
  /** Single grapheme/symbol used as a visual prefix (no emoji — keeps with skill rules). */
  symbol: string;
  group: AgentRoleGroup;
  /** Hex color used for the badge background tint and dot. */
  color: string;
  /** One-sentence explanation suitable for a tooltip / detail row. */
  description: string;
}

/**
 * Palette chosen to coexist with the existing dark UI:
 *   - main     → app accent (blue)        → primary action of the session
 *   - memory   → muted teal               → background bookkeeping
 *   - session  → muted purple             → session lifecycle services
 *   - subagent → muted amber              → user-invoked specialist agents
 *   - compression → muted rose            → rare, attention-worthy
 *   - unknown  → neutral grey             → custom / MCP / future role
 */
export const AGENT_ROLE_META: Record<AgentRoleId, AgentRoleMeta> = {
  main: {
    id: 'main',
    label: 'Main agent',
    shortLabel: 'Main',
    symbol: '◆',
    group: 'main',
    color: '#74c7ec',
    description:
      'The interactive Qwen Code CLI agent — the one that responds to your message.',
  },
  'memory-select': {
    id: 'memory-select',
    label: 'Memory selector',
    shortLabel: 'Mem · select',
    symbol: '◐',
    group: 'memory',
    color: '#94e2d5',
    description:
      'Side query that picks which existing memory files are relevant to your current query.',
  },
  'memory-extract': {
    id: 'memory-extract',
    label: 'Memory extractor',
    shortLabel: 'Mem · extract',
    symbol: '◑',
    group: 'memory',
    color: '#94e2d5',
    description:
      'Subagent that scans the latest turn and writes durable facts back into managed memory.',
  },
  'memory-dream': {
    id: 'memory-dream',
    label: 'Memory dream',
    shortLabel: 'Mem · dream',
    symbol: '◍',
    group: 'memory',
    color: '#94e2d5',
    description:
      'Reflective pass that consolidates duplicate memory entries and refreshes the index.',
  },
  'session-recap': {
    id: 'session-recap',
    label: 'Session recap',
    shortLabel: 'Recap',
    symbol: '⟲',
    group: 'session',
    color: '#cba6f7',
    description:
      'Generates a 1-2 sentence "where you left off" recap when you return to an existing session.',
  },
  'session-title': {
    id: 'session-title',
    label: 'Session title',
    shortLabel: 'Title',
    symbol: '⟐',
    group: 'session',
    color: '#cba6f7',
    description:
      'Produces a concise 3-7 word title for the session, like a git commit subject.',
  },
  compression: {
    id: 'compression',
    label: 'Context compressor',
    shortLabel: 'Compress',
    symbol: '⇲',
    group: 'compression',
    color: '#f38ba8',
    description:
      'Distills the entire chat history into a structured XML snapshot when context overflows.',
  },
  'subagent-general': {
    id: 'subagent-general',
    label: 'Subagent · general-purpose',
    shortLabel: 'Sub · general',
    symbol: '◇',
    group: 'subagent',
    color: '#fab387',
    description:
      'User- or agent-invoked general-purpose research subagent for multi-step tasks.',
  },
  'subagent-explore': {
    id: 'subagent-explore',
    label: 'Subagent · Explore',
    shortLabel: 'Sub · Explore',
    symbol: '◈',
    group: 'subagent',
    color: '#fab387',
    description:
      'Read-only file search specialist used for exploring codebases quickly.',
  },
  'subagent-statusline': {
    id: 'subagent-statusline',
    label: 'Subagent · statusline-setup',
    shortLabel: 'Sub · statusline',
    symbol: '◉',
    group: 'subagent',
    color: '#fab387',
    description: "Configures the user's Qwen Code status line setting.",
  },
  'subagent-architect': {
    id: 'subagent-architect',
    label: 'Subagent · agent architect',
    shortLabel: 'Sub · architect',
    symbol: '◎',
    group: 'subagent',
    color: '#fab387',
    description:
      'Crafts new subagent configurations from a natural-language description.',
  },
  unknown: {
    id: 'unknown',
    label: 'Unknown role',
    shortLabel: 'Unknown',
    symbol: '○',
    group: 'unknown',
    color: '#9399b2',
    description:
      'No matching Qwen Code system prompt — likely a custom subagent, MCP server, or a new role added upstream.',
  },
};

// ── Detection rules ─────────────────────────────────────────
//
// Each rule is `(systemPrompt) => boolean`. We intentionally avoid regex —
// these signatures are stable string literals copied straight from the
// qwen-code source, so a substring check is both faster and easier to audit.
//
// Order matters: more specific patterns must come before more generic ones
// (e.g. memory-extract before memory-dream, both before any future generic
// "memory" rule).

interface DetectionRule {
  id: AgentRoleId;
  matches: (systemPrompt: string) => boolean;
}

const RULES: DetectionRule[] = [
  // — Main interactive agent —
  // Most frequent role; placed first so the common path is the cheapest.
  {
    id: 'main',
    matches: (s) =>
      s.startsWith('You are Qwen Code, an interactive CLI agent'),
  },

  // — Memory family —
  {
    id: 'memory-select',
    matches: (s) => s.startsWith('You are selecting memories'),
  },
  {
    id: 'memory-extract',
    matches: (s) =>
      s.startsWith(
        'You are now acting as the managed memory extraction subagent',
      ),
  },
  {
    id: 'memory-dream',
    matches: (s) =>
      s.startsWith('You are performing a managed memory dream'),
  },

  // — Session services —
  {
    id: 'session-recap',
    matches: (s) =>
      s.startsWith('You generate session recaps for a programming assistant CLI'),
  },
  {
    id: 'session-title',
    // sessionTitle.ts uses a system prompt that opens with the imperative
    // "Generate a concise, sentence-case title (3-7 words)" — no leading
    // "You are…" prefix, so we keyword-match the unique phrase instead.
    matches: (s) =>
      s.startsWith('Generate a concise, sentence-case title (3-7 words)'),
  },

  // — Context compression —
  {
    id: 'compression',
    matches: (s) =>
      s.startsWith(
        'You are the component that summarizes internal chat history',
      ),
  },

  // — User-invoked subagents (built-in registry) —
  {
    id: 'subagent-general',
    matches: (s) => s.startsWith('You are a general-purpose agent'),
  },
  {
    id: 'subagent-explore',
    matches: (s) => s.startsWith('You are a file search specialist agent'),
  },
  {
    id: 'subagent-statusline',
    matches: (s) =>
      s.startsWith('You are a status line setup agent for Qwen Code'),
  },
  {
    id: 'subagent-architect',
    matches: (s) => s.startsWith('You are an elite AI agent architect'),
  },
];

// ── Public API ──────────────────────────────────────────────

/**
 * Pull the system message text out of a request body.
 * Handles both string content and OpenAI multimodal-style content arrays.
 * Returns an empty string when no system message is present.
 */
export function extractSystemPrompt(trace: TraceEntry | null | undefined): string {
  const messages = trace?.requestBody?.messages;
  if (!Array.isArray(messages)) return '';
  const sys = messages.find((m) => m && m.role === 'system');
  if (!sys) return '';
  const c = sys.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    // Multimodal content — concatenate just the text parts.
    return c
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text?: unknown }).text ?? '')
          : '',
      )
      .join('\n');
  }
  return '';
}

/**
 * Classify a trace into one of the known Qwen Code agent roles.
 * Returns 'unknown' when no rule matches — never throws.
 */
export function detectAgentRole(trace: TraceEntry | null | undefined): AgentRoleId {
  if (!trace) return 'unknown';
  const sys = extractSystemPrompt(trace);
  if (!sys) return 'unknown';
  for (const rule of RULES) {
    if (rule.matches(sys)) return rule.id;
  }
  return 'unknown';
}

/** Convenience: classify and immediately resolve to the full metadata. */
export function getAgentRoleMeta(
  trace: TraceEntry | null | undefined,
): AgentRoleMeta {
  return AGENT_ROLE_META[detectAgentRole(trace)];
}
