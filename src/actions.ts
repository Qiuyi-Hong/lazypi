import { togglePackage, type Manager, type PackageEntry } from "./packages.ts";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";

export async function execute(
  action: "install" | "remove" | "update" | "enable" | "disable",
  entry: Pick<PackageEntry, "source" | "scope" | "state" | "name">,
  settings: Pick<
    SettingsManager,
    | "getGlobalSettings"
    | "getProjectSettings"
    | "setPackages"
    | "setProjectPackages"
    | "flush"
    | "drainErrors"
  >,
  manager: Pick<Manager, "installAndPersist" | "removeAndPersist" | "update">,
): Promise<void> {
  if (action === "install") {
    await manager.installAndPersist(entry.source, {
      local: entry.scope === "project",
    });
  } else if (action === "remove") {
    if (entry.name === "lazypi")
      throw new Error("Remove LazyPi using vanilla Pi outside this popup.");
    if (
      !(await manager.removeAndPersist(entry.source, {
        local: entry.scope === "project",
      }))
    )
      throw new Error("Pi could not find the package declaration to remove.");
  } else if (action === "update") {
    await manager.update(entry.source);
  } else {
    await togglePackage(settings, entry, action === "enable");
  }
  await settings.flush();
  const errors = settings.drainErrors();
  if (errors.length) throw errors[0]!.error;
}
