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

const LIFE_SITUATION_REPLIES: Record<string, string> = {
  "ls:home-yard-care":
    "Придомовая территория должна содержаться в чистоте и безопасном состоянии. Обычно сюда входят уборка мусора, содержание покрытий, уход за элементами благоустройства и поддержание порядка на территории дома.",
  "ls:home-yard-fence":
    "Ограждения и шлагбаумы на придомовой территории допускаются не произвольно, а по установленному порядку. Важны решение собственников, соответствие границам участка и соблюдение требований к виду и размещению.",
  "ls:home-yard-playgrounds":
    "Детские и спортивные площадки на придомовой территории должны быть исправными, безопасными и ухоженными. Ограждения, покрытие и оборудование не должны создавать риск для жителей.",
  "ls:home-yard-access":
    "У дома рекомендуется обеспечивать доступную среду: проходы, съезды, элементы для маломобильных жителей и отсутствие препятствий на путях движения.",
  "ls:home-yard-owner":
    "За придомовую территорию обычно отвечают собственники помещений, управляющая организация или иное лицо, которое обязано содержать дом и связанный с ним участок.",
  "ls:home-plot-care":
    "Собственник участка обязан поддерживать его в надлежащем состоянии: убирать мусор, не допускать захламления и следить за элементами благоустройства на своей территории.",
  "ls:home-plot-fence":
    "К ограждениям участка предъявляются требования по высоте, внешнему виду и допустимым параметрам. Особенно это важно со стороны улиц и проездов.",
  "ls:home-plot-green":
    "Элементы озеленения на участке должны содержаться и не превращаться в источник беспорядка или опасности. Повреждение и запущенное состояние могут считаться нарушением.",
  "ls:home-plot-ban":
    "На участке нельзя допускать захламление, разрушение элементов благоустройства и иные действия, которые ухудшают состояние территории или мешают соседям и городу.",
  "ls:home-building-facade":
    "Фасад, входная группа и внешние элементы здания должны содержаться аккуратно и безопасно. Повреждения, разрушение, грязь и ненадлежащий вид могут рассматриваться как нарушение правил содержания.",
  "ls:home-building-light":
    "Внешний вид здания включает не только фасад, но и исправное освещение, читаемость входов и общее состояние наружных элементов.",
  "ls:home-building-signs":
    "Вывески на здании нельзя размещать как угодно. Для них действуют требования к месту, внешнему виду и, в ряде случаев, отдельные правила для фасадов и исторической среды.",
  "ls:home-construction-safety":
    "Строительная площадка должна быть ограждена и организована так, чтобы не создавать угрозу пешеходам, транспорту и соседним территориям.",
  "ls:home-construction-clean":
    "На стройплощадке обязаны поддерживать порядок, вовремя вывозить мусор и не допускать загрязнения прилегающих территорий.",
  "ls:home-construction-restore":
    "После земляных и строительных работ нарушенное благоустройство должно быть восстановлено. Это касается покрытий, газонов и других поврежденных элементов.",
  "ls:roads-cleaning-summer":
    "Летняя уборка улиц и тротуаров включает поддержание чистоты, удаление мусора и смета, а также регулярное содержание городской территории в опрятном состоянии.",
  "ls:roads-cleaning-winter":
    "Зимой дороги и тротуары должны очищаться от снега и содержаться так, чтобы движение транспорта и пешеходов оставалось безопасным.",
  "ls:roads-cleaning-ice":
    "Наледь и снег должны убираться своевременно. Дополнительно применяются противогололедные меры, если это необходимо для безопасности.",
  "ls:roads-surface-pits":
    "Дорожное покрытие должно содержаться исправно. Ямы, разрушение покрытия и опасные дефекты относятся к проблемам содержания дорог и требуют устранения ответственным лицом.",
  "ls:roads-surface-yards":
    "Внутриквартальные проезды и территории также подлежат содержанию. Для них важны уборка, состояние покрытия и безопасность передвижения.",
  "ls:roads-surface-bridges":
    "Искусственные сооружения и связанные элементы дорожной инфраструктуры должны содержаться и эксплуатироваться без угрозы для пользователей.",
  "ls:roads-water-clog":
    "Ливневая канализация, решетки и колодцы должны быть в рабочем состоянии и не быть засорены. Засор ливневки — это нарушение содержания системы отвода воды.",
  "ls:roads-water-flood":
    "Подтопление улиц и территорий часто связано с ненадлежащим состоянием ливневой системы или нарушением отвода поверхностных и талых вод.",
  "ls:roads-water-owner":
    "За содержание ливневых сооружений отвечают организации, которые эксплуатируют соответствующие сети и объекты водоотведения.",
  "ls:roads-parking-care":
    "Стоянки и парковочные территории должны содержаться правообладателем участка с соблюдением санитарных, противопожарных и эксплуатационных требований.",
  "ls:roads-parking-snow":
    "На стоянках обязаны регулярно убирать снег, мусор и поддерживать территорию в чистом состоянии.",
  "ls:roads-parking-owner":
    "Как правило, за содержание стоянки отвечает правообладатель земельного участка или лицо, эксплуатирующее объект.",
  "ls:roads-earthworks-permit":
    "Для земляных работ обычно требуется установленное разрешение. Проводить плановые работы без надлежащего порядка нельзя.",
  "ls:roads-earthworks-fence":
    "Место раскопок должно быть ограждено и организовано так, чтобы не создавать опасность для жителей и движения.",
  "ls:roads-earthworks-restore":
    "После завершения работ нарушенное благоустройство должно быть восстановлено: покрытие, газоны, тротуары и другие элементы.",
  "ls:comfort-green-care":
    "Зеленые насаждения должны содержаться с соблюдением требований по их охране и уходу. Это касается деревьев, кустарников, газонов и других озелененных территорий.",
  "ls:comfort-green-cut":
    "Обрезка, снос и иные работы с зелеными насаждениями нельзя проводить произвольно. Для таких действий действует отдельный порядок и требования охраны зеленого фонда.",
  "ls:comfort-green-damage":
    "Повреждение деревьев, кустарников, газонов и иных озелененных территорий рассматривается как нарушение правил содержания и благоустройства.",
  "ls:comfort-parks-care":
    "Парки, скверы и иные зоны отдыха должны содержаться безопасно, чисто и в состоянии, пригодном для использования жителями.",
  "ls:comfort-parks-water":
    "В зонах отдыха правила касаются и водных объектов: берегов, акваторий, фонтанов и иных элементов, связанных с водой.",
  "ls:comfort-parks-objects":
    "На территориях отдыха должны быть исправные элементы благоустройства, а при необходимости — урны, туалеты и иные объекты обслуживания.",
  "ls:comfort-maf-benches":
    "Скамейки, урны, навесы и другие малые архитектурные формы должны быть исправными, аккуратными и безопасными для использования.",
  "ls:comfort-maf-repair":
    "Малые архитектурные формы подлежат ремонту, окраске и своевременному восстановлению при повреждениях.",
  "ls:comfort-toilets":
    "Общественные туалеты и туалетные кабины должны устанавливаться и содержаться по правилам, обеспечивая санитарное состояние и доступность использования.",
  "ls:comfort-holidays":
    "Праздничное оформление города выполняется по утвержденной концепции и должно соответствовать требованиям к символике, размещению и общему внешнему виду.",
  "ls:visual-clean-general":
    "Территории города должны содержаться в чистоте. Это базовое правило благоустройства, которое распространяется на общественные пространства, прилегающие территории и иные объекты.",
  "ls:visual-clean-snow":
    "Снег, лед и наледь необходимо убирать в установленном порядке, не создавая опасности для жителей и не нарушая правила складирования снега.",
  "ls:visual-clean-containers":
    "Контейнерные площадки и контейнеры должны содержаться в порядке. Переполнение, мусор вокруг и антисанитария указывают на проблему содержания.",
  "ls:visual-waste-remove":
    "Сбор и вывоз отходов должны организовываться по установленным правилам. Это касается как обычных отходов, так и содержания мест накопления.",
  "ls:visual-waste-oversized":
    "Крупногабаритные отходы нельзя размещать произвольно. Для них действует отдельный порядок накопления и вывоза.",
  "ls:visual-waste-ban":
    "Нельзя складировать отходы и материалы где угодно, если это портит городскую среду, мешает уборке или нарушает санитарные требования.",
  "ls:visual-signposts":
    "Информационные указатели должны размещаться и содержаться так, чтобы быть читаемыми, исправными и не портить облик территории.",
  "ls:visual-signs-place":
    "Вывески и средства информации можно размещать только с соблюдением правил по месту установки и соответствию фасаду или объекту.",
  "ls:visual-signs-rules":
    "Для вывесок важны параметры внешнего вида, читаемость, аккуратность размещения и соблюдение требований к эксплуатации.",
  "ls:visual-signs-heritage":
    "На объектах культурного наследия действуют дополнительные требования к размещению и оформлению информационных конструкций.",
  "ls:visual-graffiti":
    "Запрещенные надписи, несанкционированные изображения и визуальный мусор — это нарушение содержания городской среды. По таким случаям можно направлять сообщение о проблеме.",
  "ls:visual-stalls-place":
    "Нестационарные объекты размещаются по установленной схеме и в порядке, определенном муниципальными актами. Самовольное размещение не допускается.",
  "ls:visual-stalls-ban":
    "Рядом с нестационарными объектами нельзя складировать тару, товары, оборудование и иные предметы с нарушением правил благоустройства.",
  "ls:civic-participation-volunteer":
    "Жители могут участвовать в благоустройстве на добровольной основе. Такие работы организуются в установленном порядке и не должны быть произвольными.",
  "ls:civic-participation-forms":
    "Формы участия жителей включают обсуждения, предложения и иные открытые способы участия в решениях по городской среде.",
  "ls:civic-participation-control":
    "Общественный контроль допускает фиксацию нарушений, в том числе с помощью фото и видео, и направление этой информации в уполномоченные органы.",
  "ls:civic-owner-roads":
    "За дороги, тротуары, газоны и элементы дорожного обустройства отвечают организации, на обслуживании которых находятся эти объекты.",
  "ls:civic-owner-houses":
    "За дворы и дома отвечают собственники, управляющие организации или иные лица, на которых возложено содержание конкретной территории.",
  "ls:civic-owner-utilities":
    "За инженерные сооружения и связанные территории отвечают организации, в собственности или эксплуатации которых находятся такие объекты.",
  "ls:civic-control-who":
    "Контроль за соблюдением правил благоустройства осуществляют уполномоченные подразделения администрации и муниципальные учреждения в пределах своих полномочий.",
  "ls:civic-control-what":
    "Если вы видите нарушение, важно описать проблему, место и характер нарушения. Дальше такое сообщение должно быть направлено в уполномоченный орган или по городскому сценарию обращения.",
  "ls:civic-special-cemetery":
    "Места погребения относятся к специальным территориям и подлежат отдельным требованиям по содержанию и порядку благоустройства.",
  "ls:civic-special-other":
    "К специальным объектам могут относиться отдельные территории и сооружения, для которых действуют особые правила содержания и эксплуатации.",
  "ls:civic-reference-terms":
    "В правилах есть базовые понятия: элементы благоустройства, прилегающая территория, малые архитектурные формы, нестационарные объекты и другие. Через этот раздел удобно объяснять термины простыми словами.",
  "ls:civic-reference-apps":
    "Приложения к правилам содержат дополнительные параметры и варианты размещения. Они нужны там, где важны конкретные схемы, приемы благоустройства и требования к оформлению.",
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
  const body =
    LIFE_SITUATION_REPLIES[node.id] ??
    "Здесь я покажу короткое объяснение по правилам благоустройства, кто отвечает за эту тему, что считается нарушением и куда обращаться.";
  return `${topic}\n\n${body}`;
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
