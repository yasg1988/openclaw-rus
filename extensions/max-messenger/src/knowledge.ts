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

const SECTION_CODES = {
  terms: "I.",
  generalClean: "II.",
  cleaning: "III.",
  roads: "IV.",
  stormwater: "V.",
  parking: "VI.",
  fences: "VII.",
  smallForms: "VIII.",
  recreation: "IX.",
  greenery: "X.",
  buildings: "XI.",
  landPlots: "XII.",
  apartmentYards: "XIII.",
  construction: "XIV.",
  signposts: "XV.",
  waste: "XVI.",
  cemetery: "XVII.",
  toilets: "XVIII.",
  visual: "XIX.",
  owners: "XX.",
  earthworks: "XXI.",
  ads: "XXII.",
  holiday: "XXIII.",
  civicParticipation: "XXIV.",
  accessibility: "XXV.",
  civicForms: "XXVI.",
  stalls: "XXVII.",
  control: "XXVIII.",
} as const;

const LIFE_SITUATION_SOURCES: Record<string, string[]> = {
  "ls:home-yard-care": [SECTION_CODES.apartmentYards],
  "ls:home-yard-fence": [SECTION_CODES.fences],
  "ls:home-yard-playgrounds": [SECTION_CODES.smallForms, SECTION_CODES.apartmentYards],
  "ls:home-yard-access": [SECTION_CODES.accessibility],
  "ls:home-yard-owner": [SECTION_CODES.owners],
  "ls:home-plot-care": [SECTION_CODES.landPlots],
  "ls:home-plot-fence": [SECTION_CODES.fences, SECTION_CODES.landPlots],
  "ls:home-plot-green": [SECTION_CODES.greenery, SECTION_CODES.landPlots],
  "ls:home-plot-ban": [SECTION_CODES.landPlots],
  "ls:home-building-facade": [SECTION_CODES.buildings],
  "ls:home-building-light": [SECTION_CODES.buildings],
  "ls:home-building-signs": [SECTION_CODES.ads, SECTION_CODES.visual],
  "ls:home-construction-safety": [SECTION_CODES.construction],
  "ls:home-construction-clean": [SECTION_CODES.construction],
  "ls:home-construction-restore": [SECTION_CODES.construction, SECTION_CODES.earthworks],
  "ls:roads-cleaning-summer": [SECTION_CODES.cleaning],
  "ls:roads-cleaning-winter": [SECTION_CODES.cleaning],
  "ls:roads-cleaning-ice": [SECTION_CODES.cleaning],
  "ls:roads-surface-pits": [SECTION_CODES.roads],
  "ls:roads-surface-yards": [SECTION_CODES.roads],
  "ls:roads-surface-bridges": [SECTION_CODES.roads],
  "ls:roads-water-clog": [SECTION_CODES.stormwater],
  "ls:roads-water-flood": [SECTION_CODES.stormwater],
  "ls:roads-water-owner": [SECTION_CODES.stormwater, SECTION_CODES.owners],
  "ls:roads-parking-care": [SECTION_CODES.parking],
  "ls:roads-parking-snow": [SECTION_CODES.parking, SECTION_CODES.cleaning],
  "ls:roads-parking-owner": [SECTION_CODES.parking, SECTION_CODES.owners],
  "ls:roads-earthworks-permit": [SECTION_CODES.earthworks],
  "ls:roads-earthworks-fence": [SECTION_CODES.earthworks],
  "ls:roads-earthworks-restore": [SECTION_CODES.earthworks],
  "ls:comfort-green-care": [SECTION_CODES.greenery],
  "ls:comfort-green-cut": [SECTION_CODES.greenery],
  "ls:comfort-green-damage": [SECTION_CODES.greenery],
  "ls:comfort-parks-care": [SECTION_CODES.recreation],
  "ls:comfort-parks-water": [SECTION_CODES.recreation],
  "ls:comfort-parks-objects": [SECTION_CODES.recreation, SECTION_CODES.smallForms],
  "ls:comfort-maf-benches": [SECTION_CODES.smallForms],
  "ls:comfort-maf-repair": [SECTION_CODES.smallForms],
  "ls:comfort-toilets": [SECTION_CODES.toilets],
  "ls:comfort-holidays": [SECTION_CODES.holiday],
  "ls:visual-clean-general": [SECTION_CODES.generalClean],
  "ls:visual-clean-snow": [SECTION_CODES.cleaning],
  "ls:visual-clean-containers": [SECTION_CODES.waste],
  "ls:visual-waste-remove": [SECTION_CODES.waste],
  "ls:visual-waste-oversized": [SECTION_CODES.waste],
  "ls:visual-waste-ban": [SECTION_CODES.waste, SECTION_CODES.generalClean],
  "ls:visual-signposts": [SECTION_CODES.signposts],
  "ls:visual-signs-place": [SECTION_CODES.ads],
  "ls:visual-signs-rules": [SECTION_CODES.visual, SECTION_CODES.ads],
  "ls:visual-signs-heritage": [SECTION_CODES.visual, SECTION_CODES.ads],
  "ls:visual-graffiti": [SECTION_CODES.visual],
  "ls:visual-stalls-place": [SECTION_CODES.stalls],
  "ls:visual-stalls-ban": [SECTION_CODES.stalls],
  "ls:civic-participation-volunteer": [SECTION_CODES.civicParticipation, SECTION_CODES.civicForms],
  "ls:civic-participation-forms": [SECTION_CODES.civicParticipation, SECTION_CODES.civicForms],
  "ls:civic-participation-control": [SECTION_CODES.civicParticipation, SECTION_CODES.control],
  "ls:civic-owner-roads": [SECTION_CODES.owners, SECTION_CODES.roads],
  "ls:civic-owner-houses": [SECTION_CODES.owners, SECTION_CODES.apartmentYards],
  "ls:civic-owner-utilities": [SECTION_CODES.owners],
  "ls:civic-control-who": [SECTION_CODES.control],
  "ls:civic-control-what": [SECTION_CODES.control],
  "ls:civic-special-cemetery": [SECTION_CODES.cemetery],
  "ls:civic-special-other": [SECTION_CODES.cemetery],
  "ls:civic-reference-terms": [SECTION_CODES.terms],
  "ls:civic-reference-apps": [SECTION_CODES.terms, SECTION_CODES.ads],
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

function collectSectionBulletPoints(blocks: RuleBlock[], sectionCodes: string[]): string[] {
  const result: string[] = [];
  for (const block of blocks) {
    const chapter = Array.isArray(block.section_path) ? trimString(block.section_path[0]) : null;
    if (!chapter || !sectionCodes.some((code) => chapter.startsWith(code))) {
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
  const sectionCodes = LIFE_SITUATION_SOURCES[nodeId];
  if (!sectionCodes?.length) {
    return fallbackReply;
  }

  try {
    const blocks = await loadRulesBlocks();
    if (!blocks.length) {
      return fallbackReply;
    }

    const bullets = collectSectionBulletPoints(blocks, sectionCodes);
    if (!bullets.length) {
      return fallbackReply;
    }

    const chapterLabels = sectionCodes
      .slice(0, 2)
      .join(", ");

    return `${fallbackReply}\n\nПо Правилам благоустройства:\n- ${bullets.join("\n- ")}\n\nОснование: ${chapterLabels}.`;
  } catch (error) {
    console.error("[max] life situation knowledge error:", error);
    return fallbackReply;
  }
}
