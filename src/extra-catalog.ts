import type { Extra } from "./extras.ts";

// Curated Pi packages, not npm dependencies of LazyPi. See docs/extras-curation.md.
// Package identity and display name come from the npm source, not hand-written labels.
type PackageExtra = Omit<Extra, "id" | "name" | "source"> & {
  source: `npm:${string}`;
};
const catalog: readonly (PackageExtra | Extra)[] = [
  // AI & Agents
  {
    source: "npm:pi-subagents",
    description: "Delegate work to parallel agents",
    category: "ai-agents",
    resourceTypes: ["extension", "skill", "prompt"],
    tags: ["subagents", "delegation", "workflow"],
  },
  {
    source: "npm:@quintinshaw/pi-dynamic-workflows",
    description:
      "Orchestrate parallel subagents in resumable workflows with model routing and cross-checking.",
    category: "ai-agents",
    resourceTypes: ["extension", "skill"],
    tags: [
      "subagents",
      "orchestration",
      "workflow",
      "model-routing",
      "deep-research",
    ],
  },
  {
    source: "npm:@tintinweb/pi-subagents",
    description: "Run parallel subagents with custom roles and live steering.",
    category: "ai-agents",
    resourceTypes: ["extension"],
    tags: ["subagents", "orchestration", "roles"],
  },
  {
    source: "npm:@henryqw/pi-subagent",
    description:
      "Delegate bounded tasks to isolated Pi agents and track their results.",
    category: "ai-agents",
    resourceTypes: ["extension", "skill"],
    tags: ["subagents", "delegation", "isolation"],
  },
  {
    source: "npm:@gotgenes/pi-subagents",
    description:
      "Add in-process subagents with a typed API for agent delegation.",
    category: "ai-agents",
    resourceTypes: ["extension"],
    tags: ["subagents", "delegation", "api"],
  },

  // Coding
  {
    source: "npm:@dietrichgebert/ponytail",
    description:
      "Encourages simpler, maintainable code through YAGNI, smaller diffs, reuse of existing functionality, and reduced over-engineering.",
    category: "coding",
    resourceTypes: ["extension", "skill"],
    tags: [
      "code-quality",
      "code-review",
      "simplification",
      "yagni",
      "refactoring",
      "maintainability",
    ],
  },
  {
    source: "npm:pi-lens",
    description:
      "Get live LSP, lint, formatter, and type-checking feedback while coding.",
    category: "coding",
    resourceTypes: ["extension", "skill"],
    tags: ["lsp", "lint", "typescript", "code-quality"],
  },
  {
    source: "npm:pi-simplify",
    description:
      "Review changed code for clarity, consistency, and maintainability.",
    category: "coding",
    resourceTypes: ["extension"],
    tags: ["code-review", "simplification", "refactoring"],
  },
  {
    source: "npm:@ff-labs/pi-fff",
    description:
      "Find files and code quickly with fuzzy file and content search.",
    category: "coding",
    resourceTypes: ["extension"],
    tags: ["code-search", "fuzzy-search", "files"],
  },
  {
    source: "npm:pi-hashline-edit-pro",
    description: "Edit code using stable line anchors and stale-edit checks.",
    category: "coding",
    resourceTypes: ["extension"],
    tags: ["editing", "refactoring", "code-quality"],
  },

  // Planning & Workflow
  {
    source: "npm:@juicesharp/rpiv-todo",
    description: "Track the agent's tasks in a persistent live todo overlay.",
    category: "planning-workflow",
    resourceTypes: ["extension"],
    tags: ["todo", "task-management", "workflow"],
  },
  {
    source: "npm:pi-goal-x",
    description:
      "Plan goals, persist progress, and audit completion independently.",
    category: "planning-workflow",
    resourceTypes: ["extension"],
    tags: ["goals", "planning", "task-management"],
  },
  {
    source: "npm:@plannotator/pi-extension",
    description: "Review and annotate agent plans before implementation.",
    category: "planning-workflow",
    resourceTypes: ["extension", "skill"],
    tags: ["plan-review", "annotations", "workflow"],
  },
  {
    source: "npm:@narumitw/pi-plan-mode",
    description:
      "Explore a task in a read-only planning mode before making changes.",
    category: "planning-workflow",
    resourceTypes: ["extension"],
    tags: ["planning", "read-only", "workflow"],
  },
  {
    source: "npm:@mjasnikovs/pi-task",
    description:
      "Run resumable, verifiable task plans through a structured pipeline.",
    category: "planning-workflow",
    resourceTypes: ["extension"],
    tags: ["tasks", "planning", "verification"],
  },

  // Web & Research
  {
    source: "npm:pi-web-access",
    description: "Search and fetch web sources",
    category: "web-research",
    resourceTypes: ["extension"],
    tags: ["web-search", "fetch", "research"],
  },
  {
    id: "research-workflow",
    name: "research-workflow",
    description: "Combine subagents with web access",
    category: "web-research",
    resourceTypes: [],
    tags: ["research", "subagents", "web-search"],
    requires: ["pi-subagents", "pi-web-access"],
  },
  {
    source: "npm:pi-web-search",
    description:
      "Search the web using supported model providers' native search tools.",
    category: "web-research",
    resourceTypes: ["extension"],
    tags: ["web-search", "research", "providers"],
  },
  {
    source: "npm:pi-agent-browser-native",
    description: "Automate a browser through agent-browser tools in Pi.",
    category: "web-research",
    resourceTypes: ["extension"],
    tags: ["browser", "automation", "web"],
  },
  {
    source: "npm:@ollama/pi-web-search",
    description: "Search and fetch the web through Ollama's web APIs.",
    category: "web-research",
    resourceTypes: ["extension"],
    tags: ["web-search", "fetch", "ollama"],
  },
  {
    source: "npm:@narumitw/pi-firecrawl",
    description: "Scrape and crawl websites using Firecrawl tools.",
    category: "web-research",
    resourceTypes: ["extension"],
    tags: ["web-scraping", "crawl", "firecrawl"],
  },

  // Context & Memory
  {
    source: "npm:billion-context-pi",
    description:
      "Manage long-running Pi conversations with model-driven context compression.",
    category: "context-memory",
    resourceTypes: ["extension"],
    tags: ["context", "compaction", "long-running"],
  },
  {
    source: "npm:pi-memory",
    description:
      "Search daily logs, long-term memory, and scratchpad notes semantically.",
    category: "context-memory",
    resourceTypes: ["extension"],
    tags: ["memory", "semantic-search", "context"],
  },
  {
    source: "npm:@amaster.ai/pi-memory-mem0",
    description: "Capture and recall long-term memories with Mem0.",
    category: "context-memory",
    resourceTypes: ["extension"],
    tags: ["memory", "semantic-search", "mem0"],
  },
  {
    source: "npm:pi-hermes-memory",
    description: "Keep persistent memories and search previous Pi sessions.",
    category: "context-memory",
    resourceTypes: ["extension"],
    tags: ["memory", "session-search", "context"],
  },
  {
    source: "npm:gentle-engram",
    description:
      "Share persistent memory across sessions, compactions, and MCP agents.",
    category: "context-memory",
    resourceTypes: ["extension"],
    tags: ["memory", "context", "mcp"],
  },

  // Models & Providers
  {
    source: "npm:pi-claude-bridge",
    description:
      "Use Claude Code through its Agent SDK as a Pi model provider.",
    category: "models-providers",
    resourceTypes: ["extension"],
    tags: ["claude", "models", "providers"],
  },
  {
    source: "npm:pi-provider-litellm",
    description: "Connect Pi models through a LiteLLM proxy.",
    category: "models-providers",
    resourceTypes: ["extension"],
    tags: ["litellm", "models", "providers"],
  },
  {
    source: "npm:pi-prompt-template-model",
    description: "Choose a model when using Pi prompt templates.",
    category: "models-providers",
    resourceTypes: ["extension", "skill"],
    tags: ["model-selection", "prompts", "routing"],
  },
  {
    source: "npm:pi-ollama-cloud-link",
    description: "Discover Ollama Cloud models and connect your account to Pi.",
    category: "models-providers",
    resourceTypes: ["extension"],
    tags: ["ollama", "models", "providers"],
  },
  {
    source: "npm:pi-nvidia-nim",
    description: "Use NVIDIA NIM API models as Pi providers.",
    category: "models-providers",
    resourceTypes: ["extension"],
    tags: ["nvidia", "models", "providers"],
  },

  // Integrations
  {
    source: "npm:pi-mcp-adapter",
    description: "Connect Pi to external tools and services through MCP.",
    category: "integrations",
    resourceTypes: ["extension"],
    tags: ["mcp", "tools", "integrations"],
  },
  {
    source: "npm:pi-mcp-extension",
    description: "Use MCP servers and their tools inside Pi.",
    category: "integrations",
    resourceTypes: ["extension"],
    tags: ["mcp", "tools", "integrations"],
  },
  {
    source: "npm:@agentskit/doc-bridge",
    description:
      "Connect human and agent documentation through shareable doc-site links.",
    category: "integrations",
    resourceTypes: ["skill"],
    tags: ["documentation", "handoff", "integration"],
  },
  {
    source: "npm:@alasano/pi-linear",
    description: "Manage Linear projects and issues from Pi.",
    category: "integrations",
    resourceTypes: ["extension"],
    tags: ["linear", "issues", "integration"],
  },
  {
    source: "npm:@henryqw/pi-pr",
    description: "Create and manage GitHub pull requests from Pi.",
    category: "integrations",
    resourceTypes: ["extension", "skill"],
    tags: ["github", "pull-requests", "integration"],
  },

  // Safety & Permissions
  {
    source: "npm:@gotgenes/pi-permission-system",
    description: "Enforce access policies for Pi tools and actions.",
    category: "safety-permissions",
    resourceTypes: ["extension"],
    tags: ["permissions", "policy", "security"],
  },
  {
    source: "npm:cc-safety-net",
    description: "Block destructive commands and secret-file access.",
    category: "safety-permissions",
    resourceTypes: ["extension"],
    tags: ["guardrails", "secrets", "commands"],
  },
  {
    source: "npm:pi-landstrip",
    description: "Run shell commands and subprocess agents in a sandbox.",
    category: "safety-permissions",
    resourceTypes: ["extension"],
    tags: ["sandbox", "shell", "isolation"],
  },
  {
    source: "npm:@aliou/pi-guardrails",
    description: "Apply safety checks to Pi tool execution.",
    category: "safety-permissions",
    resourceTypes: ["extension"],
    tags: ["guardrails", "permissions", "security"],
  },
  {
    source: "npm:pi-sandbox",
    description:
      "Isolate Pi processes at the OS level with permission prompts.",
    category: "safety-permissions",
    resourceTypes: ["extension"],
    tags: ["sandbox", "permissions", "isolation"],
  },

  // UI & Experience
  {
    source: "npm:pi-powerline-footer",
    description: "Show a powerline-style Pi status bar.",
    category: "ui-experience",
    resourceTypes: ["extension"],
    tags: ["statusline", "footer", "tui"],
  },
  {
    source: "npm:pi-cc-extensions",
    description: "Give Pi a Claude Code-inspired terminal interface.",
    category: "ui-experience",
    resourceTypes: ["extension", "theme"],
    tags: ["tui", "theme", "rendering"],
  },
  {
    source: "npm:pi-open-tui",
    description: "Polish Pi's header, footer, editor, and message layout.",
    category: "ui-experience",
    resourceTypes: ["extension"],
    tags: ["tui", "footer", "layout"],
  },
  {
    source: "npm:pi-zentui",
    description: "Add a statusline and alternate terminal UI styling.",
    category: "ui-experience",
    resourceTypes: ["extension"],
    tags: ["tui", "statusline", "theme"],
  },
  {
    source: "npm:awesome-pi-themes",
    description: "Choose from a collection of dark terminal themes.",
    category: "ui-experience",
    resourceTypes: ["extension", "theme"],
    tags: ["themes", "color", "tui"],
  },

  // Observability & Usage
  {
    source: "npm:@langfuse/pi-observability-plugin",
    description:
      "Trace Pi prompts, model generations, and tool calls in Langfuse.",
    category: "observability-usage",
    resourceTypes: ["extension"],
    tags: ["tracing", "langfuse", "observability"],
  },
  {
    source: "npm:@narumitw/pi-usage",
    description: "View supported provider usage and account balances.",
    category: "observability-usage",
    resourceTypes: ["extension"],
    tags: ["usage", "quotas", "cost"],
  },
  {
    source: "npm:@langchain/langsmith-pi-extension",
    description: "Trace Pi agent activity in LangSmith.",
    category: "observability-usage",
    resourceTypes: ["extension"],
    tags: ["tracing", "langsmith", "observability"],
  },
  {
    source: "npm:@raindrop-ai/pi-agent",
    description: "Trace Pi agent sessions and activity with Raindrop.",
    category: "observability-usage",
    resourceTypes: ["extension"],
    tags: ["tracing", "raindrop", "observability"],
  },
  {
    source: "npm:@braintrust/pi-extension",
    description:
      "Trace sessions, turns, model calls, and tool execution in Braintrust.",
    category: "observability-usage",
    resourceTypes: ["extension"],
    tags: ["tracing", "braintrust", "observability"],
  },

  // Tools & Utilities
  {
    source: "npm:@juicesharp/rpiv-ask-user-question",
    description:
      "Ask structured multiple-choice questions instead of guessing.",
    category: "tools-utilities",
    resourceTypes: ["extension"],
    tags: ["questions", "input", "utilities"],
  },
  {
    source: "npm:pi-background-tasks",
    description:
      "Run durable background shell tasks and inspect their progress.",
    category: "tools-utilities",
    resourceTypes: ["extension"],
    tags: ["background-tasks", "shell", "utilities"],
  },
  {
    source: "npm:pi-interview",
    description:
      "Collect structured answers through an interactive terminal form.",
    category: "tools-utilities",
    resourceTypes: ["extension"],
    tags: ["questions", "forms", "input"],
  },
  {
    source: "npm:@juanibiapina/pi-extension-settings",
    description:
      "Manage configuration for multiple Pi extensions in one place.",
    category: "tools-utilities",
    resourceTypes: ["extension"],
    tags: ["configuration", "extensions", "utilities"],
  },
  {
    source: "npm:@nklisch/pi-plugins",
    description:
      "Browse and manage Pi plugins with a filesystem-first marketplace.",
    category: "tools-utilities",
    resourceTypes: ["extension"],
    tags: ["package-management", "plugins", "utilities"],
  },
];

export const extras: readonly Extra[] = catalog.map((entry) =>
  entry.source
    ? { ...entry, id: entry.source.slice(4), name: entry.source.slice(4) }
    : (entry as Extra),
);
