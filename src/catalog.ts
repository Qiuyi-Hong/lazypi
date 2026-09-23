// Package specs describe suggestions; Pi's installed manifest remains the authority for resources.
export type ResourceType = "extension" | "skill" | "prompt" | "theme";
export interface PackageSpec {
  source: string;
  name: string;
  description: string;
  category: string;
  resources?: readonly ResourceType[]; // A package may provide several kinds.
}

// Core packages remain independent Pi installations, not npm dependencies of LazyPi.
export const core = [
  {
    source: "npm:pi-mcp-adapter",
    name: "MCP Adapter",
    description: "Connect Pi to MCP tools and services",
    category: "Integrations",
  },
  {
    source: "npm:pi-subagents",
    name: "Subagents",
    description: "Delegation and parallel agent workflows",
    category: "AI",
  },
  {
    source: "npm:pi-web-access",
    name: "Web Access",
    description: "Web search and URL fetching",
    category: "Research",
  },
] as const satisfies readonly PackageSpec[];
