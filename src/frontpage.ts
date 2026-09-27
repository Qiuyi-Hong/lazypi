import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { plain } from "./ui.ts";

export function frontpage(
  ctx: ExtensionContext,
  theme: Theme,
  width: number,
): string[] {
  const model = ctx.model;
  const sessionDir = ctx.sessionManager.getSessionDir();
  const commands = [
    "/lazypi",
    "/lazypi extras",
    "/lazypi community",
    "/lazypi updates",
  ];
  const links = commands.join("  ·  ");
  const rows = [
    "LazyPi · Pi packages",
    `Model · ${model ? `${model.provider}/${model.id}` : "No model selected"}`,
    `Working directory · ${ctx.cwd}`,
    ...(sessionDir ? [`Session directory · ${sessionDir}`] : []),
    ...(visibleWidth(links) <= width ? [links] : commands),
  ];
  return rows.flatMap((row, index) =>
    wrapTextWithAnsi(plain(row), Math.max(1, width)).map((line) =>
      theme.fg(
        index === 0 ? "accent" : "text",
        truncateToWidth(line, Math.max(0, width)),
      ),
    ),
  );
}
