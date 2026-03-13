import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { maxPlugin } from "./src/channel.js";
import { setMaxRuntime } from "./src/runtime.js";

const plugin = {
  id: "max-messenger",
  name: "MAX Messenger",
  description: "MAX messenger channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setMaxRuntime(api.runtime);
    api.registerChannel({ plugin: maxPlugin as ChannelPlugin });
  },
};

export default plugin;
