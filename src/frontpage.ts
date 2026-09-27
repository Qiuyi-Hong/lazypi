import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { plain } from "./ui.ts";

// Five-cell letters share edges: the bottom stroke of L touches the A.
const letters = [
  ["██   ", "██   ", "██   ", "██   ", "██   ", "█████"],
  [" ███ ", "██ ██", "█████", "██ ██", "██ ██", "██ ██"],
  ["█████", "   ██", "  ██ ", " ██  ", "██   ", "█████"],
  ["██ ██", "██ ██", " ███ ", "  ██ ", "  ██ ", "  ██ "],
  ["████ ", "██ ██", "████ ", "██   ", "██   ", "██   "],
  ["█████", "  ██ ", "  ██ ", "  ██ ", "  ██ ", "█████"],
];

function wordmark(theme: Theme, zShift: number): string[] {
  const pixels = Array.from(
    { length: 7 },
    () => Array(79).fill(" ") as string[],
  );
  for (let y = 0; y < 6; y++) {
    const row = letters.map((letter) => letter[y]).join("");
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== "█") continue;
      pixels[y]![x * 2] = "█";
      pixels[y]![x * 2 + 1] = "█";
    }
  }
  // A one-cell offset traces the outside of the solid letters.
  for (let y = 5; y >= 0; y--)
    for (let x = 59; x >= 0; x--)
      if (pixels[y]![x] === "█" && pixels[y + 1]![x + 1] === " ")
        pixels[y + 1]![x + 1] = "░";
  for (const [x, y] of [
    [62, 4],
    [65, 3],
    [70, 2],
    [77, 1],
  ])
    pixels[y]![x + zShift] = "z";
  return pixels.map((row) =>
    (
      row
        .join("")
        .trimEnd()
        .match(/█+|░+|z+| +/g) ?? []
    )
      .map((part) =>
        part[0] === "█"
          ? theme.fg("accent", part)
          : part[0] === "░"
            ? theme.fg("border", part)
            : part[0] === "z"
              ? theme.fg("accent", part)
              : part,
      )
      .join(""),
  );
}

function path(label: string, value: string, width: number): string {
  const prefix = `${label} · `;
  const clean = plain(value);
  const room = width - visibleWidth(prefix);
  if (room <= 1) return truncateToWidth(prefix, width, "…");
  return (
    prefix +
    (visibleWidth(clean) > room
      ? `…${sliceByColumn(clean, visibleWidth(clean) - room + 1, room - 1, true)}`
      : clean)
  );
}

const commands = [
  ["/lazypi", "Pi-configured packages"],
  ["/lazypi extras", "optional capabilities"],
  ["/lazypi community", "npm discovery"],
  ["/lazypi updates", "newer npm versions"],
] as const;

function wideFrontpage(
  ctx: ExtensionContext,
  theme: Theme,
  width: number,
  thinkingEffort: string,
): string[] {
  const panelWidth = Math.min(width, 112);
  const leftWidth = Math.floor((panelWidth - 7) / 2);
  const rightWidth = panelWidth - 7 - leftWidth;
  const sessionDir = ctx.sessionManager.getSessionDir();
  const info = [
    "SESSION",
    "",
    `Model · ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "No model selected"}`,
    `Thinking effort · ${thinkingEffort}`,
    path("Working directory", ctx.cwd, leftWidth),
    ...(sessionDir ? [path("Session directory", sessionDir, leftWidth)] : []),
  ];
  const links = [
    "LAZYPI",
    "",
    ...commands.map(([name, hint]) => `${name} · ${hint}`),
  ];
  const border = (text: string) => theme.fg("border", text);
  const cell = (text: string, size: number, heading: boolean) =>
    theme.fg(
      heading ? "accent" : "text",
      truncateToWidth(plain(text), size, "…", true),
    );
  const rows = Array.from(
    { length: Math.max(info.length, links.length) },
    (_, i) =>
      `${border("│")} ${cell(info[i] ?? "", leftWidth, i === 0)} ${border("│")} ${cell(links[i] ?? "", rightWidth, i === 0)} ${border("│")}`,
  );
  const pad = " ".repeat(Math.floor((width - panelWidth) / 2));
  const logoStart = Math.floor((width - 60) / 2);
  const logoPad = " ".repeat(logoStart);
  // Keep the trailing z marks on screen at the narrow end of the wide layout.
  const zShift = Math.min(0, width - logoStart - 78);
  return [
    ...wordmark(theme, zShift).map((line) => logoPad + line),
    "",
    pad + border("╭" + "─".repeat(panelWidth - 2) + "╮"),
    ...rows.map((row) => pad + row),
    pad + border("╰" + "─".repeat(panelWidth - 2) + "╯"),
  ];
}

export function frontpage(
  ctx: ExtensionContext,
  theme: Theme,
  width: number,
  thinkingEffort: string,
): string[] {
  // Reserve room for both columns and the ascending z marks.
  if (width >= 88) return wideFrontpage(ctx, theme, width, thinkingEffort);
  const sessionDir = ctx.sessionManager.getSessionDir();
  const grouped = width >= 32;
  const rows = [
    "LazyPi",
    ...(grouped ? ["", "SESSION"] : []),
    `Model · ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "No model selected"}`,
    `Thinking effort · ${thinkingEffort}`,
    path("Cwd", ctx.cwd, width),
    ...(sessionDir ? [path("Session", sessionDir, width)] : []),
    ...(grouped ? ["", "LAZYPI"] : []),
    ...commands.map(([name, hint]) =>
      width >= 40 ? `${name} · ${hint}` : name,
    ),
  ];
  return rows.map((row, index) => {
    const line = theme.fg(
      index === 0 || row === "SESSION" || row === "LAZYPI" ? "accent" : "text",
      truncateToWidth(plain(row), width, "…"),
    );
    return " ".repeat(Math.floor((width - visibleWidth(line)) / 2)) + line;
  });
}
