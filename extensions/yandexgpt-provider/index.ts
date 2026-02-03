/**
 * Провайдер YandexGPT для OpenClaw
 * Статус: В разработке (заглушка)
 */

const plugin = {
  id: "yandexgpt-provider",
  name: "YandexGPT",
  description: "Провайдер YandexGPT — в разработке",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {}
  },
  register() {
    console.log("🟡 Провайдер YandexGPT — в разработке");
    console.log("   https://github.com/yasg1988/openclaw-rus");
  },
};

export default plugin;
