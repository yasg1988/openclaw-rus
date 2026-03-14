import { basename } from "node:path";
import { readFile } from "node:fs/promises";

export interface MaxBotInfo {
  user_id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
  name?: string;
  description?: string;
  avatar_url?: string;
  last_activity_time?: number;
}

export interface MaxUpdate {
  update_type: string;
  timestamp?: number;
  message?: MaxMessage;
  chat_id?: number;
  user?: MaxUser;
  payload?: string;
  callback?: MaxCallback;
  marker?: number;
}

export interface MaxMessage {
  sender?: MaxUser;
  recipient?: { chat_id?: number; chat_type?: string };
  body?: { mid?: string; text?: string; attachments?: unknown[] };
  timestamp?: number;
}

export interface MaxUser {
  user_id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  name?: string;
  is_bot?: boolean;
}

export interface MaxCallback {
  timestamp?: number;
  callback_id?: string;
  payload?: string;
  user?: MaxUser;
  message?: MaxMessage;
}

export interface MaxUpdatesResponse {
  updates?: MaxUpdate[];
  marker?: number | null;
}

export interface MaxSendResult {
  message?: {
    body?: { mid?: string; text?: string };
    recipient?: { chat_id?: number };
    sender?: MaxUser;
    timestamp?: number;
  };
}

export interface MaxAnswerCallbackResult {
  success?: boolean;
  message?: string;
}

interface MaxUploadUrlResponse {
  url: string;
  token?: string;
}

export class MaxBotApi {
  token: string;
  apiBaseUrl: string;
  timeoutMs: number;

  constructor(opts: { token: string; apiBaseUrl?: string; timeoutMs?: number }) {
    this.token = opts.token;
    this.apiBaseUrl = (opts.apiBaseUrl || "https://platform-api.max.ru").replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs || 10000;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: this.token, ...extra };
  }

  private async get<T = unknown>(
    path: string,
    params: Record<string, string | number | null | undefined> = {},
    opts?: { timeoutMs?: number }
  ): Promise<T> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs || this.timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`MAX API GET ${path} failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async post<T = unknown>(
    path: string,
    params: Record<string, string | number | null | undefined> = {},
    body: unknown = {}
  ): Promise<T> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`MAX API POST ${path} failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async put<T = unknown>(
    path: string,
    params: Record<string, string | number | null | undefined> = {},
    body: unknown = {}
  ): Promise<T> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`MAX API PUT ${path} failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async getMe(): Promise<MaxBotInfo> {
    return this.get<MaxBotInfo>("/me");
  }

  async getUpdates(opts: {
    marker?: number | null;
    timeout?: number;
    limit?: number;
    types?: string[];
  } = {}): Promise<MaxUpdatesResponse> {
    const params: Record<string, string | number | null | undefined> = {};
    if (opts.marker != null) params.marker = opts.marker;
    if (opts.timeout != null) params.timeout = opts.timeout;
    if (opts.limit != null) params.limit = opts.limit;
    if (opts.types?.length) params.types = opts.types.join(",");

    return this.get<MaxUpdatesResponse>("/updates", params, {
      timeoutMs: ((opts.timeout || 30) + 10) * 1000,
    });
  }

  async sendMessage(opts: {
    userId?: number;
    chatId?: number;
    text?: string;
    attachments?: unknown[];
    link?: unknown;
    notify?: boolean;
    format?: string;
    disableLinkPreview?: boolean;
  }): Promise<MaxSendResult> {
    const params: Record<string, string | number | null | undefined> = {};
    if (opts.userId != null) params.user_id = opts.userId;
    if (opts.chatId != null) params.chat_id = opts.chatId;
    if (opts.disableLinkPreview != null) {
      params.disable_link_preview = opts.disableLinkPreview ? "true" : "false";
    }

    const body: Record<string, unknown> = {};
    if (opts.text != null) body.text = opts.text;
    if (opts.attachments?.length) body.attachments = opts.attachments;
    if (opts.link) body.link = opts.link;
    if (opts.notify != null) body.notify = opts.notify;
    if (opts.format) body.format = opts.format;

    return this.post<MaxSendResult>("/messages", params, body);
  }

  async editMessage(opts: {
    messageId: string;
    text?: string;
    attachments?: unknown[] | null;
    link?: unknown;
    notify?: boolean;
    format?: string;
  }): Promise<{ success: boolean; message?: string }> {
    const params: Record<string, string | number | null | undefined> = {
      message_id: opts.messageId,
    };

    const body: Record<string, unknown> = {};
    if (opts.text != null) body.text = opts.text;
    if (opts.attachments !== undefined) body.attachments = opts.attachments;
    if (opts.link) body.link = opts.link;
    if (opts.notify != null) body.notify = opts.notify;
    if (opts.format) body.format = opts.format;

    return this.put<{ success: boolean; message?: string }>("/messages", params, body);
  }

  async answerOnCallback(opts: {
    callbackId: string;
    message?: {
      text?: string;
      attachments?: unknown[] | null;
      link?: unknown;
      notify?: boolean;
      format?: string;
    } | null;
    notification?: string | null;
  }): Promise<MaxAnswerCallbackResult> {
    const params: Record<string, string | number | null | undefined> = {
      callback_id: opts.callbackId,
    };
    const body: Record<string, unknown> = {};
    if (opts.message !== undefined) body.message = opts.message;
    if (opts.notification !== undefined) body.notification = opts.notification;
    return this.post<MaxAnswerCallbackResult>("/answers", params, body);
  }

  async sendAction(chatId: number, action = "typing_on"): Promise<unknown> {
    return this.post(`/chats/${chatId}/actions`, {}, { action });
  }

  async createUpload(type: "image" | "video" | "audio" | "file"): Promise<MaxUploadUrlResponse> {
    return this.post<MaxUploadUrlResponse>("/uploads", { type }, {});
  }

  async uploadImageFromFile(filePath: string): Promise<Record<string, unknown>> {
    const upload = await this.createUpload("image");
    if (!upload?.url) {
      throw new Error("MAX upload URL for image was not returned");
    }

    const bytes = await readFile(filePath);
    const form = new FormData();
    form.append("data", new Blob([bytes]), basename(filePath));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(upload.url, {
        method: "POST",
        headers: this.headers(),
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`MAX upload image failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }
}
