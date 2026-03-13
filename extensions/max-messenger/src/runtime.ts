import { createPluginRuntimeStore } from "openclaw/plugin-sdk/compat";
import type { PluginRuntime } from "openclaw/plugin-sdk";

const { setRuntime: setMaxRuntime, getRuntime: getMaxRuntime } =
  createPluginRuntimeStore<PluginRuntime>("MAX runtime not initialized");

export { getMaxRuntime, setMaxRuntime };
