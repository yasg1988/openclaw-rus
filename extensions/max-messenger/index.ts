/**
 * Канал MAX Messenger для OpenClaw
 * Статус: В разработке (заглушка)
 */

const plugin = {
  id: "max-messenger",
  name: "MAX Messenger",
  description: "Канал MAX Messenger — в разработке",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {}
  },
  register() {
    console.log("💬 Канал MAX Messenger — в разработке");
    console.log("   https://github.com/yasg1988/openclaw-rus");
  },
};

export default plugin;
