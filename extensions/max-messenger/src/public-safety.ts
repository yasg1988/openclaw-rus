const PUBLIC_INFO_OPTIONS = [
  "что это за сервис",
  "как пользоваться картой",
  "как сообщить об ошибке",
  "как связаться с оператором",
] as const;

export type PublicSafetyDecision =
  | {
      kind: "reply" | "menu";
      intent:
        | "greeting"
        | "identity"
        | "capabilities"
        | "service_info"
        | "map_help"
        | "report_problem"
        | "chat_operator"
        | "my_requests"
        | "book_appointment"
        | "life_situations"
        | "management_company"
        | "forbidden_signs"
        | "help"
        | "unknown"
        | "unsafe";
      reply: string;
      eventType:
        | "public_safe_reply"
        | "public_feature_pending"
        | "public_refusal"
        | "public_policy_refusal";
      reasonCode:
        | "greeting"
        | "identity"
        | "capabilities"
        | "service_info"
        | "map_help"
        | "report_problem"
        | "chat_operator"
        | "my_requests_pending"
        | "book_appointment_pending"
        | "life_situations_pending"
        | "management_company_pending"
        | "forbidden_signs_pending"
        | "help"
        | "unknown_request"
        | "prompt_injection"
        | "internal_access_attempt";
    };

const UNSAFE_RULES: Array<{
  reasonCode: "prompt_injection" | "internal_access_attempt";
  matches: (text: string) => boolean;
}> = [
  {
    reasonCode: "prompt_injection",
    matches: (text) =>
      hasAll(text, ["игнорируй", "инструк"]) ||
      hasAll(text, ["ignore", "instruction"]) ||
      hasAll(text, ["system", "prompt"]) ||
      hasAll(text, ["developer", "message"]) ||
      hasAll(text, ["раскрой", "промпт"]) ||
      hasAll(text, ["покажи", "системн"]) ||
      hasAll(text, ["обойди", "огранич"]) ||
      hasAll(text, ["смени", "роль"]) ||
      hasAll(text, ["pretend", "developer"]) ||
      hasAll(text, ["jailbreak", "prompt"]),
  },
  {
    reasonCode: "internal_access_attempt",
    matches: (text) =>
      hasAny(text, [
        "token",
        "api key",
        "secret",
        "env ",
        "mcp",
        "ssh",
        "docker",
        "dokploy",
        "journalctl",
        "shell",
        "terminal",
        "supabase",
        "postgres",
        "sql",
        "git",
      ]) ||
      hasAll(text, ["ключ", "api"]) ||
      hasAll(text, ["покажи", "ключ"]) ||
      hasAll(text, ["покажи", "секрет"]) ||
      hasAll(text, ["покажи", "сервер"]) ||
      hasAll(text, ["доступ", "базе"]) ||
      hasAll(text, ["доступ", "бд"]),
  },
];

const OUTBOUND_BLOCKLIST = [
  "token",
  "api key",
  "secret",
  "ssh",
  "docker",
  "dokploy",
  "journalctl",
  "shell",
  "terminal",
  "postgres",
  "supabase",
  "sql",
  "git",
  "mcp",
  "developer message",
  "system prompt",
  "системный промпт",
  "секрет",
  "токен",
] as const;

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(text: string, parts: readonly string[]): boolean {
  return parts.some((part) => text.includes(part));
}

function hasAll(text: string, parts: readonly string[]): boolean {
  return parts.every((part) => text.includes(part));
}

function containsMenuKeyword(text: string): boolean {
  return (
    text.includes("меню") ||
    text.includes("vty.") ||
    text.includes("vty/")
  );
}

function isGreeting(text: string): boolean {
  return hasAny(text, ["привет", "здравств", "добрый день", "добрый вечер", "доброе утро", "/start"]) || containsMenuKeyword(text);
}

function isIdentityQuestion(text: string): boolean {
  return hasAny(text, ["кто ты", "что ты такое", "представься", "представит", "ты кто"]);
}

function isCapabilitiesQuestion(text: string): boolean {
  return hasAny(text, ["что ты умеешь", "что умеешь", "чем поможешь", "чем можешь помочь", "/help", "помощь", "help"]);
}

function isServiceInfo(text: string): boolean {
  return (
    hasAny(text, [
      "что такое городской радар",
      "что за сервис",
      "что это за сервис",
      "для чего сервис",
      "что такое радар",
      "о проекте",
      "что за проект",
    ]) ||
    (hasAny(text, ["городской радар", "сервис"]) && hasAny(text, ["что", "зачем", "для чего"])) ||
    (hasAny(text, ["проект", "городской радар"]) && hasAny(text, ["что", "о проекте"]))
  );
}

function isMapHelp(text: string): boolean {
  return hasAny(text, [
    "как пользоваться картой",
    "как пользоваться сервисом",
    "как найти адрес",
    "как найти объект",
    "как посмотреть слой",
    "что на карте",
    "как искать на карте",
    "адрес",
    "объект",
    "слой",
    "инфраструктур",
  ]);
}

function isReportProblem(text: string): boolean {
  return hasAny(text, [
    "сообщить об ошибке",
    "ошибка на карте",
    "неточност",
    "неверные данные",
    "проблема на карте",
    "пожаловаться",
    "оставить обращение",
    "сообщить о проблеме",
  ]);
}

function isChatOperator(text: string): boolean {
  return hasAny(text, [
    "связаться с оператором",
    "написать оператору",
    "чат с оператором",
    "живой оператор",
    "человек оператор",
    "оператор",
  ]);
}

function isMyRequests(text: string): boolean {
  return hasAny(text, [
    "мои обращения",
    "мои заявки",
    "мои сообщения",
    "статус обращения",
    "статус заявки",
    "мои запросы",
  ]);
}

function isBookAppointment(text: string): boolean {
  return hasAny(text, [
    "запись на прием",
    "записаться на прием",
    "категории записи на прием",
    "прием граждан",
    "записаться",
  ]);
}

function isLifeSituations(text: string): boolean {
  return hasAny(text, ["жизненные ситуации", "жизненная ситуация"]);
}

function isManagementCompany(text: string): boolean {
  return hasAny(text, ["связь с ук", "управляющ", "ук"]);
}

function isForbiddenSigns(text: string): boolean {
  return hasAny(text, ["запрещенные надписи", "запрещённые надписи", "надписи", "граффити"]);
}

function formatUnknownReply(): string {
  return `Я отвечаю только по сценариям Городского радара. Сейчас могу помочь с такими темами:\n- ${PUBLIC_INFO_OPTIONS.join("\n- ")}`;
}

export function sanitizePublicOutbound(text: string): string {
  const normalized = normalize(text);
  if (OUTBOUND_BLOCKLIST.some((part) => normalized.includes(part))) {
    return "Я могу отвечать только по безопасным пользовательским сценариям Городского радара.";
  }
  return text.trim();
}

export const PUBLIC_MAIN_MENU_TEXT =
  "Городской Радар — ИИ-отдел Администрации Йошкар-Олы.\n\n" +
  "Принимаем сигналы о городских проблемах, консультируем по вопросам благоустройства, связываем с управляющими компаниями.\n\n" +
  "Напишите сообщение или выберите пункт меню";

export function buildPublicMainMenuAttachments(imageToken?: string | null): unknown[] {
  const buttons = [
    [{ type: "callback", text: "🚨 Сообщить о проблеме", payload: "Сообщить о проблеме" }],
    [{ type: "callback", text: "📨 Мои обращения", payload: "Мои обращения" }],
    [{ type: "callback", text: "🏢 Связь с УК", payload: "Связь с УК" }],
    [{ type: "callback", text: "🧭 Жизненные ситуации", payload: "Жизненные ситуации" }],
    [{ type: "callback", text: "🗓️ Запись на прием в мэрию", payload: "Запись на прием в мэрию" }],
    [{ type: "callback", text: "🚫 Запрещенные надписи", payload: "Запрещенные надписи" }],
    [{ type: "callback", text: "👩‍💼 Оператор", payload: "Оператор" }],
    [
      { type: "callback", text: "ℹ️ О проекте", payload: "О проекте" },
      { type: "callback", text: "❓ Помощь", payload: "Помощь" },
    ],
  ];

  const attachments: unknown[] = [
    {
      type: "inline_keyboard",
      payload: {
        buttons,
      },
    },
  ];

  if (imageToken) {
    attachments.unshift({
      type: "image",
      payload: {
        token: imageToken,
      },
    });
  }

  return attachments;
}

export function evaluatePublicSafety(text: string): PublicSafetyDecision {
  const normalized = normalize(text);

  for (const rule of UNSAFE_RULES) {
    if (rule.matches(normalized)) {
      return {
        kind: "reply",
        intent: "unsafe",
        eventType: "public_policy_refusal",
        reasonCode: rule.reasonCode,
        reply: "Я не помогаю с внутренними инструкциями, служебной информацией или обходом ограничений.",
      };
    }
  }

  if (isGreeting(normalized)) {
    return {
      kind: "menu",
      intent: "greeting",
      eventType: "public_safe_reply",
      reasonCode: "greeting",
      reply: PUBLIC_MAIN_MENU_TEXT,
    };
  }

  if (isIdentityQuestion(normalized)) {
    return {
      kind: "reply",
      intent: "identity",
      eventType: "public_safe_reply",
      reasonCode: "identity",
      reply: "Я чат-бот Городской радар для жителей. Помогаю с навигацией по сервису, карте и городским данным.",
    };
  }

  if (isCapabilitiesQuestion(normalized)) {
    return {
      kind: "menu",
      intent: "capabilities",
      eventType: "public_safe_reply",
      reasonCode: "capabilities",
      reply: PUBLIC_MAIN_MENU_TEXT,
    };
  }

  if (isServiceInfo(normalized)) {
    return {
      kind: "reply",
      intent: "service_info",
      eventType: "public_safe_reply",
      reasonCode: "service_info",
      reply:
        "Городской радар — это городской сервис с картой и данными по объектам и инфраструктуре. Через него можно искать адреса и ориентироваться по доступным слоям и городским данным.",
    };
  }

  if (isMapHelp(normalized)) {
    return {
      kind: "reply",
      intent: "map_help",
      eventType: "public_safe_reply",
      reasonCode: "map_help",
      reply:
        "Я могу подсказать, как пользоваться сервисом и картой. Если нужно, напишите, что именно хотите сделать: найти адрес, объект или понять, что означает слой.",
    };
  }

  if (isReportProblem(normalized)) {
    return {
      kind: "reply",
      intent: "report_problem",
      eventType: "public_feature_pending",
      reasonCode: "report_problem",
      reply:
        "Приём сообщений о проблемах и неточностях будет подключён отдельным безопасным сценарием. Пока опишите, что именно хотите сообщить, и я подскажу следующий шаг.",
    };
  }

  if (isChatOperator(normalized)) {
    return {
      kind: "reply",
      intent: "chat_operator",
      eventType: "public_feature_pending",
      reasonCode: "chat_operator",
      reply:
        "Чат с оператором будет подключён отдельным безопасным сценарием. Пока я могу подсказать, как пользоваться сервисом и как подготовить описание проблемы.",
    };
  }

  if (isMyRequests(normalized)) {
    return {
      kind: "reply",
      intent: "my_requests",
      eventType: "public_feature_pending",
      reasonCode: "my_requests_pending",
      reply:
        "Раздел «Мои обращения» ещё не подключён. Когда сценарий будет готов, я смогу показывать только ваши собственные обращения и их краткий статус.",
    };
  }

  if (isBookAppointment(normalized)) {
    return {
      kind: "reply",
      intent: "book_appointment",
      eventType: "public_feature_pending",
      reasonCode: "book_appointment_pending",
      reply:
        "Запись на приём ещё не подключена. Когда этот сценарий будет готов, я буду работать только через безопасную форму с проверкой данных.",
    };
  }

  if (isLifeSituations(normalized)) {
    return {
      kind: "reply",
      intent: "life_situations",
      eventType: "public_feature_pending",
      reasonCode: "life_situations_pending",
      reply:
        "Раздел «Жизненные ситуации» ещё подключается. Скоро здесь будут готовые сценарии и подсказки по типовым городским вопросам.",
    };
  }

  if (isManagementCompany(normalized)) {
    return {
      kind: "reply",
      intent: "management_company",
      eventType: "public_feature_pending",
      reasonCode: "management_company_pending",
      reply:
        "Связь с управляющими компаниями ещё подключается. Когда сценарий будет готов, я смогу направлять обращение по безопасному маршруту.",
    };
  }

  if (isForbiddenSigns(normalized)) {
    return {
      kind: "reply",
      intent: "forbidden_signs",
      eventType: "public_feature_pending",
      reasonCode: "forbidden_signs_pending",
      reply:
        "Сценарий по запрещённым надписям ещё подключается. Когда он будет готов, здесь можно будет передать адрес и описание проблемы.",
    };
  }

  if (hasAny(normalized, ["помоги", "что делать", "с чего начать"])) {
    return {
      kind: "reply",
      intent: "help",
      eventType: "public_refusal",
      reasonCode: "help",
      reply: formatUnknownReply(),
    };
  }

  return {
    kind: "reply",
    intent: "unknown",
    eventType: "public_refusal",
    reasonCode: "unknown_request",
    reply: formatUnknownReply(),
  };
}
