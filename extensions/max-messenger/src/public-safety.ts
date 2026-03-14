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
        | "life_situations"
        | "management_company_pending"
        | "forbidden_signs_pending"
        | "help"
        | "unknown_request"
        | "prompt_injection"
        | "internal_access_attempt";
      attachments?: unknown[];
    };

type PublicMenuNode = {
  id: string;
  label: string;
  reply?: string;
  children?: PublicMenuNode[];
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

const LIFE_SITUATIONS_TREE: PublicMenuNode = {
  id: "ls:root",
  label: "Жизненные ситуации",
  children: [
    {
      id: "ls:home",
      label: "🏘️ Дом, двор и участок",
      children: [
        {
          id: "ls:home-yard",
          label: "Придомовая территория МКД",
          children: [
            { id: "ls:home-yard-care", label: "Содержание территории" },
            { id: "ls:home-yard-fence", label: "Ограждения и шлагбаумы" },
            { id: "ls:home-yard-playgrounds", label: "Детские и спортивные площадки" },
            { id: "ls:home-yard-access", label: "Доступная среда у дома" },
            { id: "ls:home-yard-owner", label: "Кто отвечает" },
          ],
        },
        {
          id: "ls:home-plot",
          label: "Частный дом и участок",
          children: [
            { id: "ls:home-plot-care", label: "Содержание участка" },
            { id: "ls:home-plot-fence", label: "Ограждения участка" },
            { id: "ls:home-plot-green", label: "Зеленые насаждения на участке" },
            { id: "ls:home-plot-ban", label: "Что запрещено" },
          ],
        },
        {
          id: "ls:home-building",
          label: "Здания и фасады",
          children: [
            { id: "ls:home-building-facade", label: "Фасад и входная группа" },
            { id: "ls:home-building-light", label: "Освещение и внешний вид" },
            { id: "ls:home-building-signs", label: "Вывески на доме" },
          ],
        },
        {
          id: "ls:home-construction",
          label: "Строительная площадка",
          children: [
            { id: "ls:home-construction-safety", label: "Ограждение и безопасность" },
            { id: "ls:home-construction-clean", label: "Чистота и вывоз мусора" },
            { id: "ls:home-construction-restore", label: "Восстановление после работ" },
          ],
        },
      ],
    },
    {
      id: "ls:roads",
      label: "🚗 Улицы, дороги и парковки",
      children: [
        {
          id: "ls:roads-cleaning",
          label: "Уборка улиц и тротуаров",
          children: [
            { id: "ls:roads-cleaning-summer", label: "Летняя уборка" },
            { id: "ls:roads-cleaning-winter", label: "Зимняя уборка" },
            { id: "ls:roads-cleaning-ice", label: "Наледь и снег" },
          ],
        },
        {
          id: "ls:roads-surface",
          label: "Дороги и покрытия",
          children: [
            { id: "ls:roads-surface-pits", label: "Ямы и разрушение покрытия" },
            { id: "ls:roads-surface-yards", label: "Внутриквартальные проезды" },
            { id: "ls:roads-surface-bridges", label: "Искусственные сооружения" },
          ],
        },
        {
          id: "ls:roads-water",
          label: "Ливневая канализация",
          children: [
            { id: "ls:roads-water-clog", label: "Засор ливневки" },
            { id: "ls:roads-water-flood", label: "Подтопление" },
            { id: "ls:roads-water-owner", label: "Кто обслуживает" },
          ],
        },
        {
          id: "ls:roads-parking",
          label: "Стоянки и парковки",
          children: [
            { id: "ls:roads-parking-care", label: "Содержание стоянки" },
            { id: "ls:roads-parking-snow", label: "Снег и мусор" },
            { id: "ls:roads-parking-owner", label: "Кто отвечает" },
          ],
        },
        {
          id: "ls:roads-earthworks",
          label: "Земляные работы",
          children: [
            { id: "ls:roads-earthworks-permit", label: "Нужно ли разрешение" },
            { id: "ls:roads-earthworks-fence", label: "Ограждение раскопок" },
            { id: "ls:roads-earthworks-restore", label: "Восстановление благоустройства" },
          ],
        },
      ],
    },
    {
      id: "ls:comfort",
      label: "🌳 Озеленение и отдых",
      children: [
        {
          id: "ls:comfort-green",
          label: "Зеленые насаждения",
          children: [
            { id: "ls:comfort-green-care", label: "Уход и содержание" },
            { id: "ls:comfort-green-cut", label: "Обрезка и снос" },
            { id: "ls:comfort-green-damage", label: "Повреждение деревьев и газонов" },
          ],
        },
        {
          id: "ls:comfort-parks",
          label: "Парки, скверы и зоны отдыха",
          children: [
            { id: "ls:comfort-parks-care", label: "Содержание территории" },
            { id: "ls:comfort-parks-water", label: "Пляжи, вода и фонтаны" },
            { id: "ls:comfort-parks-objects", label: "Что должно быть на территории" },
          ],
        },
        {
          id: "ls:comfort-maf",
          label: "Малые архитектурные формы",
          children: [
            { id: "ls:comfort-maf-benches", label: "Скамейки, урны, навесы" },
            { id: "ls:comfort-maf-repair", label: "Состояние и ремонт" },
          ],
        },
        { id: "ls:comfort-toilets", label: "Общественные туалеты" },
        { id: "ls:comfort-holidays", label: "Праздничное оформление города" },
      ],
    },
    {
      id: "ls:visual",
      label: "🧹 Мусор и визуальная среда",
      children: [
        {
          id: "ls:visual-clean",
          label: "Чистота и санитарное состояние",
          children: [
            { id: "ls:visual-clean-general", label: "Общие требования к чистоте" },
            { id: "ls:visual-clean-snow", label: "Снег, лед и наледь" },
            { id: "ls:visual-clean-containers", label: "Контейнеры и площадки" },
          ],
        },
        {
          id: "ls:visual-waste",
          label: "Отходы и раздельный сбор",
          children: [
            { id: "ls:visual-waste-remove", label: "Сбор и вывоз отходов" },
            { id: "ls:visual-waste-oversized", label: "Крупногабаритный мусор" },
            { id: "ls:visual-waste-ban", label: "Что нельзя складировать" },
          ],
        },
        { id: "ls:visual-signposts", label: "Информационные указатели" },
        {
          id: "ls:visual-signs",
          label: "Вывески и реклама",
          children: [
            { id: "ls:visual-signs-place", label: "Где можно размещать" },
            { id: "ls:visual-signs-rules", label: "Требования к виду" },
            { id: "ls:visual-signs-heritage", label: "На объектах культурного наследия" },
          ],
        },
        { id: "ls:visual-graffiti", label: "Запрещенные надписи и граффити" },
        {
          id: "ls:visual-stalls",
          label: "Нестационарные объекты",
          children: [
            { id: "ls:visual-stalls-place", label: "Размещение объекта" },
            { id: "ls:visual-stalls-ban", label: "Что запрещено рядом" },
          ],
        },
      ],
    },
    {
      id: "ls:civic",
      label: "🤝 Участие, контроль и ответственность",
      children: [
        {
          id: "ls:civic-participation",
          label: "Участие жителей",
          children: [
            { id: "ls:civic-participation-volunteer", label: "Добровольные работы" },
            { id: "ls:civic-participation-forms", label: "Формы участия" },
            { id: "ls:civic-participation-control", label: "Общественный контроль" },
          ],
        },
        {
          id: "ls:civic-owner",
          label: "Кто отвечает за территорию",
          children: [
            { id: "ls:civic-owner-roads", label: "Дороги и тротуары" },
            { id: "ls:civic-owner-houses", label: "Дворы и дома" },
            { id: "ls:civic-owner-utilities", label: "Инженерные объекты" },
          ],
        },
        {
          id: "ls:civic-control",
          label: "Контроль и ответственность",
          children: [
            { id: "ls:civic-control-who", label: "Кто контролирует" },
            { id: "ls:civic-control-what", label: "Что делать при нарушении" },
          ],
        },
        {
          id: "ls:civic-special",
          label: "Особые территории",
          children: [
            { id: "ls:civic-special-cemetery", label: "Места погребения" },
            { id: "ls:civic-special-other", label: "Другие специальные объекты" },
          ],
        },
        {
          id: "ls:civic-reference",
          label: "Справочник по нормам",
          children: [
            { id: "ls:civic-reference-terms", label: "Основные понятия" },
            { id: "ls:civic-reference-apps", label: "Приложения к правилам" },
          ],
        },
      ],
    },
  ],
};

function makeMenuButton(text: string, payload: string) {
  return [{ type: "callback", text, payload }];
}

function findMenuNode(id: string, node: PublicMenuNode = LIFE_SITUATIONS_TREE, parent?: PublicMenuNode): { node: PublicMenuNode; parent?: PublicMenuNode } | null {
  if (node.id === id) {
    return { node, parent };
  }
  for (const child of node.children ?? []) {
    const found = findMenuNode(id, child, node);
    if (found) {
      return found;
    }
  }
  return null;
}

function buildMenuAttachments(node: PublicMenuNode, parent?: PublicMenuNode): unknown[] {
  const buttons = (node.children ?? []).map((child) => makeMenuButton(child.label, child.id));
  if (parent) {
    buttons.push(makeMenuButton("◀️ Назад", parent.id));
  }
  buttons.push(makeMenuButton("🏠 Главное меню", "Главное меню"));

  return [
    {
      type: "inline_keyboard",
      payload: {
        buttons,
      },
    },
  ];
}

function buildLeafReply(node: PublicMenuNode, parent?: PublicMenuNode): string {
  const topic = parent ? `Раздел «${parent.label} → ${node.label}».` : `Раздел «${node.label}».`;
  return (
    `${topic}\n\n` +
    "Здесь я буду показывать жителю короткое объяснение по правилам благоустройства, кто отвечает за эту тему, что считается нарушением и куда обращаться."
  );
}

function evaluateLifeSituationsMenu(text: string): PublicSafetyDecision | null {
  if (text === "жизненные ситуации") {
    return {
      kind: "menu",
      intent: "life_situations",
      eventType: "public_safe_reply",
      reasonCode: "life_situations",
      reply: "Выберите тему по благоустройству города.",
      attachments: buildMenuAttachments(LIFE_SITUATIONS_TREE),
    };
  }

  if (!text.startsWith("ls:")) {
    return null;
  }

  const found = findMenuNode(text);
  if (!found) {
    return null;
  }

  if (found.node.children?.length) {
    return {
      kind: "menu",
      intent: "life_situations",
      eventType: "public_safe_reply",
      reasonCode: "life_situations",
      reply: `Выберите раздел «${found.node.label}».`,
      attachments: buildMenuAttachments(found.node, found.parent),
    };
  }

  return {
    kind: "reply",
    intent: "life_situations",
    eventType: "public_safe_reply",
    reasonCode: "life_situations",
    reply: buildLeafReply(found.node, found.parent),
    attachments: buildMenuAttachments(found.node, found.parent),
  };
}

export function evaluatePublicSafety(text: string): PublicSafetyDecision {
  const normalized = normalize(text);

  const lifeSituationsDecision = evaluateLifeSituationsMenu(normalized);
  if (lifeSituationsDecision) {
    return lifeSituationsDecision;
  }

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
      kind: "menu",
      intent: "life_situations",
      eventType: "public_safe_reply",
      reasonCode: "life_situations",
      reply: "Выберите тему по благоустройству города.",
      attachments: buildMenuAttachments(LIFE_SITUATIONS_TREE),
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
