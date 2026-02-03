/**
 * Провайдер GigaChat для OpenClaw
 * Статус: В разработке (заглушка)
 */

const plugin = {
  id: "gigachat-provider",
  name: "GigaChat",
  description: "Провайдер GigaChat — в разработке",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {}
  },
  register() {
    console.log("🟢 Провайдер GigaChat — в разработке");
    console.log("   https://github.com/yasg1988/openclaw-rus");
  },
};

export default plugin;
