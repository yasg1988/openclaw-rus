type KnowledgeConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

type DokumentRecord = {
  document_id: number;
};

type RuleBlock = {
  block_order: number;
  section_path?: string[] | null;
  heading?: string | null;
  summary?: string | null;
  body_text?: string | null;
};

type CacheEntry = {
  expiresAt: number;
  blocks: RuleBlock[];
};

const DOKUMENT_CACHE_TTL_MS = 5 * 60_000;
const dokumentCache = new Map<string, CacheEntry>();

const SECTION_HEADINGS = {
  terms: "I. Сфера правового регулирования и организация выполнения",
  generalClean: "II. Общие требования к состоянию территорий общего",
  cleaning: "III. Порядок уборки городских территорий, включая перечень",
  roads: "IV. Содержание дорог и тротуаров, внутриквартальных",
  stormwater: "V. Отведение ливневых и талых вод",
  parking: "VI. Содержание стоянок длительного и краткосрочного хранения",
  fences: "VII. Установка ограждений на придомовых территориях",
  smallForms: "VIII. Содержание малых архитектурных форм,",
  recreation: "IX. Содержание зон отдыха",
  greenery: "X. Содержание зеленых насаждений",
  buildings: "XI. Содержание зданий, строений и сооружений",
  landPlots: "XII. Содержание земельных участков",
  apartmentYards: "XIII. Содержание придомовой территории многоквартирных домов",
  construction: "XIV. Содержание строительных площадок",
  signposts: "XV. Установка и содержание информационных указателей",
  waste: "XVI. Организация деятельности по сбору (в том числе",
  cemetery: "XVII. Содержание мест погребения",
  toilets: "XVIII. Содержание общественных туалетов.",
  visual: "XIX. Требования к состоянию, содержанию объектов (средств)",
  owners: "XX. Ответственные лица за содержание и уборку территорий",
  earthworks: "XXI. Производство земляных работ по прокладке",
  ads: "XXII. Средства размещения наружной рекламы и информации",
  holiday: "XXIII. Праздничное оформление территории города",
  civicParticipation: "XIV. Порядок участия граждан в благоустройстве",
  accessibility: "XXV. Особые требования к доступной среде",
  civicForms: "XXVI. Формы участия субъектов городской среды",
  stalls: "XXVII. Нестационарные объекты",
  control: "XXVIII. Контроль за соблюдением Правил",
} as const;

const LIFE_SITUATION_SOURCES: Record<string, string[]> = {
  "ls:home-yard-care": [SECTION_HEADINGS.apartmentYards],
  "ls:home-yard-fence": [SECTION_HEADINGS.fences],
  "ls:home-yard-playgrounds": [SECTION_HEADINGS.smallForms, SECTION_HEADINGS.apartmentYards],
  "ls:home-yard-access": [SECTION_HEADINGS.accessibility],
  "ls:home-yard-owner": [SECTION_HEADINGS.owners],
  "ls:home-plot-care": [SECTION_HEADINGS.landPlots],
  "ls:home-plot-fence": [SECTION_HEADINGS.fences, SECTION_HEADINGS.landPlots],
  "ls:home-plot-green": [SECTION_HEADINGS.greenery, SECTION_HEADINGS.landPlots],
  "ls:home-plot-ban": [SECTION_HEADINGS.landPlots],
  "ls:home-building-facade": [SECTION_HEADINGS.buildings],
  "ls:home-building-light": [SECTION_HEADINGS.buildings],
  "ls:home-building-signs": [SECTION_HEADINGS.ads, SECTION_HEADINGS.visual],
  "ls:home-construction-safety": [SECTION_HEADINGS.construction],
  "ls:home-construction-clean": [SECTION_HEADINGS.construction],
  "ls:home-construction-restore": [SECTION_HEADINGS.construction, SECTION_HEADINGS.earthworks],
  "ls:roads-cleaning-summer": [SECTION_HEADINGS.cleaning],
  "ls:roads-cleaning-winter": [SECTION_HEADINGS.cleaning],
  "ls:roads-cleaning-ice": [SECTION_HEADINGS.cleaning],
  "ls:roads-surface-pits": [SECTION_HEADINGS.roads],
  "ls:roads-surface-yards": [SECTION_HEADINGS.roads],
  "ls:roads-surface-bridges": [SECTION_HEADINGS.roads],
  "ls:roads-water-clog": [SECTION_HEADINGS.stormwater],
  "ls:roads-water-flood": [SECTION_HEADINGS.stormwater],
  "ls:roads-water-owner": [SECTION_HEADINGS.stormwater, SECTION_HEADINGS.owners],
  "ls:roads-parking-care": [SECTION_HEADINGS.parking],
  "ls:roads-parking-snow": [SECTION_HEADINGS.parking, SECTION_HEADINGS.cleaning],
  "ls:roads-parking-owner": [SECTION_HEADINGS.parking, SECTION_HEADINGS.owners],
  "ls:roads-earthworks-permit": [SECTION_HEADINGS.earthworks],
  "ls:roads-earthworks-fence": [SECTION_HEADINGS.earthworks],
  "ls:roads-earthworks-restore": [SECTION_HEADINGS.earthworks],
  "ls:comfort-green-care": [SECTION_HEADINGS.greenery],
  "ls:comfort-green-cut": [SECTION_HEADINGS.greenery],
  "ls:comfort-green-damage": [SECTION_HEADINGS.greenery],
  "ls:comfort-parks-care": [SECTION_HEADINGS.recreation],
  "ls:comfort-parks-water": [SECTION_HEADINGS.recreation],
  "ls:comfort-parks-objects": [SECTION_HEADINGS.recreation, SECTION_HEADINGS.smallForms],
  "ls:comfort-maf-benches": [SECTION_HEADINGS.smallForms],
  "ls:comfort-maf-repair": [SECTION_HEADINGS.smallForms],
  "ls:comfort-toilets": [SECTION_HEADINGS.toilets],
  "ls:comfort-holidays": [SECTION_HEADINGS.holiday],
  "ls:visual-clean-general": [SECTION_HEADINGS.generalClean],
  "ls:visual-clean-snow": [SECTION_HEADINGS.cleaning],
  "ls:visual-clean-containers": [SECTION_HEADINGS.waste],
  "ls:visual-waste-remove": [SECTION_HEADINGS.waste],
  "ls:visual-waste-oversized": [SECTION_HEADINGS.waste],
  "ls:visual-waste-ban": [SECTION_HEADINGS.waste, SECTION_HEADINGS.generalClean],
  "ls:visual-signposts": [SECTION_HEADINGS.signposts],
  "ls:visual-signs-place": [SECTION_HEADINGS.ads],
  "ls:visual-signs-rules": [SECTION_HEADINGS.visual, SECTION_HEADINGS.ads],
  "ls:visual-signs-heritage": [SECTION_HEADINGS.visual, SECTION_HEADINGS.ads],
  "ls:visual-graffiti": [SECTION_HEADINGS.visual],
  "ls:visual-stalls-place": [SECTION_HEADINGS.stalls],
  "ls:visual-stalls-ban": [SECTION_HEADINGS.stalls],
  "ls:civic-participation-volunteer": [SECTION_HEADINGS.civicParticipation, SECTION_HEADINGS.civicForms],
  "ls:civic-participation-forms": [SECTION_HEADINGS.civicParticipation, SECTION_HEADINGS.civicForms],
  "ls:civic-participation-control": [SECTION_HEADINGS.civicParticipation, SECTION_HEADINGS.control],
  "ls:civic-owner-roads": [SECTION_HEADINGS.owners, SECTION_HEADINGS.roads],
  "ls:civic-owner-houses": [SECTION_HEADINGS.owners, SECTION_HEADINGS.apartmentYards],
  "ls:civic-owner-utilities": [SECTION_HEADINGS.owners],
  "ls:civic-control-who": [SECTION_HEADINGS.control],
  "ls:civic-control-what": [SECTION_HEADINGS.control],
  "ls:civic-special-cemetery": [SECTION_HEADINGS.cemetery],
  "ls:civic-special-other": [SECTION_HEADINGS.cemetery],
  "ls:civic-reference-terms": [SECTION_HEADINGS.terms],
  "ls:civic-reference-apps": [SECTION_HEADINGS.terms, SECTION_HEADINGS.ads],
};

function trimString(value?: string | null): string | null {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function resolveKnowledgeConfig(): KnowledgeConfig | null {
  const supabaseUrl = trimString(process.env.MAX_SUPABASE_URL);
  const serviceRoleKey = trimString(process.env.MAX_SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
    serviceRoleKey,
  };
}

async function dokumentRead<T>(config: KnowledgeConfig, tableQuery: string): Promise<T> {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${tableQuery}`, {
    method: "GET",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Accept-Profile": "dokument",
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Dokument read failed (${tableQuery}): ${res.status} ${res.statusText} ${errorText}`);
  }

  return (await res.json()) as T;
}

async function loadRulesBlocks(slug = "pravila-blagoustroystva"): Promise<RuleBlock[]> {
  const cached = dokumentCache.get(slug);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.blocks;
  }

  const config = resolveKnowledgeConfig();
  if (!config) {
    return [];
  }

  const docs = await dokumentRead<DokumentRecord[]>(
    config,
    `documents?select=document_id&slug=eq.${encodeURIComponent(slug)}&limit=1`
  );
  const documentId = Number(docs[0]?.document_id);
  if (!Number.isFinite(documentId)) {
    return [];
  }

  const blocks = await dokumentRead<RuleBlock[]>(
    config,
    `rules_blagoustroystvo_blocks?select=block_order,section_path,heading,summary,body_text&document_id=eq.${documentId}&order=block_order.asc&limit=1200`
  );
  dokumentCache.set(slug, {
    expiresAt: now + DOKUMENT_CACHE_TTL_MS,
    blocks,
  });
  return blocks;
}

function collectSectionBulletPoints(blocks: RuleBlock[], sectionHeadings: string[]): string[] {
  const wanted = new Set(sectionHeadings);
  const result: string[] = [];
  for (const block of blocks) {
    const chapter = Array.isArray(block.section_path) ? trimString(block.section_path[0]) : null;
    if (!chapter || !wanted.has(chapter)) {
      continue;
    }

    const body = trimString(block.body_text);
    if (!body) {
      continue;
    }

    const normalized = body
      .replace(/\s+/g, " ")
      .replace(/\s*;\s*/g, "; ")
      .trim();
    if (normalized.length < 80) {
      continue;
    }

    result.push(normalized.length > 260 ? `${normalized.slice(0, 257).trimEnd()}...` : normalized);
    if (result.length >= 3) {
      break;
    }
  }
  return result;
}

export async function buildLifeSituationKnowledgeReply(
  nodeId: string,
  fallbackReply: string
): Promise<string> {
  const sectionHeadings = LIFE_SITUATION_SOURCES[nodeId];
  if (!sectionHeadings?.length) {
    return fallbackReply;
  }

  try {
    const blocks = await loadRulesBlocks();
    if (!blocks.length) {
      return fallbackReply;
    }

    const bullets = collectSectionBulletPoints(blocks, sectionHeadings);
    if (!bullets.length) {
      return fallbackReply;
    }

    const chapterLabels = sectionHeadings
      .map((heading) => trimString(heading)?.split(/\s{2,}/)[0] || heading)
      .slice(0, 2)
      .join(", ");

    return `${fallbackReply}\n\nПо Правилам благоустройства:\n- ${bullets.join("\n- ")}\n\nОснование: ${chapterLabels}.`;
  } catch (error) {
    console.error("[max] life situation knowledge error:", error);
    return fallbackReply;
  }
}
