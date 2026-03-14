type AudioAttachment = {
  type?: string;
  payload?: {
    url?: string;
    file_name?: string;
    mime_type?: string;
  };
};

type TranscriptionConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  language?: string;
  prompt?: string;
};

function trimString(value?: string | null): string | undefined {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
}

function inferFilename(url: string, fallbackExt = "ogg"): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.split("/").filter(Boolean).pop() || "";
    if (pathname.includes(".")) {
      return pathname;
    }
  } catch {}
  return `max-voice.${fallbackExt}`;
}

export function resolveTranscriptionConfig(accountConfig: Record<string, unknown> | undefined): TranscriptionConfig {
  const enabledOverride = accountConfig?.transcriptionEnabled;
  const apiKey =
    trimString(String(accountConfig?.openaiApiKey || "")) ||
    trimString(process.env.MAX_TRANSCRIBE_OPENAI_API_KEY) ||
    trimString(process.env.OPENAI_API_KEY) ||
    "";
  const model =
    trimString(String(accountConfig?.transcriptionModel || "")) ||
    trimString(process.env.MAX_TRANSCRIBE_MODEL) ||
    "gpt-4o-mini-transcribe";
  const language =
    trimString(String(accountConfig?.transcriptionLanguage || "")) ||
    trimString(process.env.MAX_TRANSCRIBE_LANGUAGE);
  const prompt =
    trimString(String(accountConfig?.transcriptionPrompt || "")) ||
    trimString(process.env.MAX_TRANSCRIBE_PROMPT);

  return {
    enabled: enabledOverride === false ? false : Boolean(apiKey),
    apiKey,
    model,
    language,
    prompt,
  };
}

export async function transcribeMaxAudioAttachment(
  attachments: unknown[] | undefined,
  config: TranscriptionConfig
): Promise<string | null> {
  if (!config.enabled || !attachments?.length) {
    return null;
  }

  const audioAttachment = (attachments as AudioAttachment[]).find((attachment) => attachment?.type === "audio");
  const audioUrl = trimString(audioAttachment?.payload?.url);
  if (!audioUrl) {
    return null;
  }

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`MAX audio download failed: ${audioResponse.status} ${audioResponse.statusText}`);
  }

  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
  const filename = inferFilename(audioUrl);
  const mimeType = trimString(audioAttachment?.payload?.mime_type) || "audio/ogg";

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);
  form.append("model", config.model);
  if (config.language) {
    form.append("language", config.language);
  }
  if (config.prompt) {
    form.append("prompt", config.prompt);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI transcription failed: ${response.status} ${response.statusText} ${errorText}`);
  }

  const payload = (await response.json()) as { text?: string };
  const transcript = trimString(payload.text);
  return transcript || null;
}
