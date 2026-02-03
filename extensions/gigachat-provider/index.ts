/**
 * Провайдер GigaChat для OpenClaw
 *
 * Позволяет использовать GigaChat от Сбера как LLM провайдер.
 *
 * Поддерживаемые модели:
 * - GigaChat (базовая модель)
 * - GigaChat-Plus (расширенная модель)
 * - GigaChat-Pro (профессиональная модель)
 *
 * Статус: В разработке
 */

import { Type, Static } from '@sinclair/typebox';

// Схема конфигурации провайдера
export const ConfigSchema = Type.Object({
  // Client ID и Client Secret для OAuth
  clientId: Type.Optional(Type.String({
    description: 'Client ID из личного кабинета Sber'
  })),
  clientSecret: Type.Optional(Type.String({
    description: 'Client Secret из личного кабинета Sber'
  })),
  // Или готовый access token
  accessToken: Type.Optional(Type.String({
    description: 'Access Token (альтернатива clientId/clientSecret)'
  })),
  // Scope (для физлиц или юрлиц)
  scope: Type.Optional(Type.String({
    description: 'Scope: GIGACHAT_API_PERS (физлица) или GIGACHAT_API_CORP (юрлица)',
    default: 'GIGACHAT_API_PERS'
  })),
  // Модель по умолчанию
  defaultModel: Type.Optional(Type.String({
    description: 'Модель по умолчанию',
    default: 'GigaChat'
  }))
});

export type Config = Static<typeof ConfigSchema>;

// Определение плагина
export const plugin = {
  name: 'gigachat-provider',
  slot: 'provider' as const,
  version: '0.1.0',

  configSchema: ConfigSchema,

  // Список доступных моделей
  models: [
    { id: 'GigaChat', name: 'GigaChat', contextWindow: 8192 },
    { id: 'GigaChat-Plus', name: 'GigaChat Plus', contextWindow: 32768 },
    { id: 'GigaChat-Pro', name: 'GigaChat Pro', contextWindow: 32768 }
  ],

  // Инициализация провайдера
  async init(config: Config) {
    console.log('🟢 Провайдер GigaChat — в разработке');
    console.log('   Следите за обновлениями: https://github.com/yasg1988/openclaw-rus');

    // Проверка конфигурации
    if (!config.accessToken && (!config.clientId || !config.clientSecret)) {
      console.warn('[GigaChat] Не указаны credentials (accessToken или clientId/clientSecret)');
    }

    // TODO: Реализовать OAuth авторизацию
    // TODO: Реализовать вызов GigaChat API
    // TODO: Реализовать streaming ответов
    // TODO: Реализовать автообновление токена

    return {
      // Заглушка для интерфейса провайдера
      complete: async (messages: any[], options?: any) => {
        console.log('[GigaChat] Запрос completion');
        throw new Error('Провайдер GigaChat ещё не реализован');
      },

      stream: async function* (messages: any[], options?: any) {
        console.log('[GigaChat] Запрос streaming');
        throw new Error('Провайдер GigaChat ещё не реализован');
      }
    };
  }
};

export default plugin;
