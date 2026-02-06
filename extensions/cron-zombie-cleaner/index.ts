/**
 * Cron Zombie Cleaner Plugin для OpenClaw
 *
 * Периодически находит и убивает зависшие процессы openclaw-cron,
 * которые не завершились после выполнения крон-задачи.
 *
 * Безопасен: если разработчики пофиксят утечку — плагин ничего не найдёт (no-op).
 */

import { execSync } from "node:child_process";

const PLUGIN_ID = "cron-zombie-cleaner";
const DEFAULT_MAX_AGE_MINUTES = 15;
const DEFAULT_CHECK_INTERVAL_MINUTES = 15;
const SIGKILL_DELAY_MS = 5000;

interface PluginConfig {
  maxAgeMinutes?: number;
  checkIntervalMinutes?: number;
}

let cleanupInterval: NodeJS.Timeout | null = null;
let maxAgeSec = DEFAULT_MAX_AGE_MINUTES * 60;

/**
 * Находит процессы openclaw-cron старше порога
 */
function findZombies(): Array<{ pid: number; ageSec: number; rssKb: number }> {
  try {
    const output = execSync("ps -eo pid,comm,etimes,rss --no-headers", {
      encoding: "utf-8",
      timeout: 5000,
    });

    const zombies: Array<{ pid: number; ageSec: number; rssKb: number }> = [];

    for (const line of output.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      const pid = parseInt(parts[0], 10);
      const comm = parts[1];
      const etimes = parseInt(parts[2], 10);
      const rss = parseInt(parts[3], 10);

      if (comm === "openclaw-cron" && etimes > maxAgeSec) {
        zombies.push({ pid, ageSec: etimes, rssKb: rss });
      }
    }

    return zombies;
  } catch {
    return [];
  }
}

/**
 * Проверяет, жив ли процесс
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Убивает процесс: SIGTERM → ждём → SIGKILL
 */
function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");

    // Синхронная пауза 5 сек
    const deadline = Date.now() + SIGKILL_DELAY_MS;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return true;
      execSync("sleep 0.5", { timeout: 2000 });
    }

    // Если ещё жив — SIGKILL
    if (isAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Основная функция очистки
 */
function cleanup(): void {
  const zombies = findZombies();
  if (zombies.length === 0) return;

  let killed = 0;
  let freedKb = 0;

  for (const z of zombies) {
    const ageMin = Math.round(z.ageSec / 60);
    const rssMb = Math.round(z.rssKb / 1024);

    if (killProcess(z.pid)) {
      killed++;
      freedKb += z.rssKb;
      console.log(`[${PLUGIN_ID}] Killed PID ${z.pid} (age: ${ageMin}m, RSS: ${rssMb} MB)`);
    } else {
      console.error(`[${PLUGIN_ID}] Failed to kill PID ${z.pid}`);
    }
  }

  const freedMb = Math.round(freedKb / 1024);
  console.log(`[${PLUGIN_ID}] Cleaned ${killed} zombie process(es), freed ~${freedMb} MB`);
}

const plugin = {
  id: PLUGIN_ID,
  name: "Cron Zombie Cleaner",
  description: "Убивает зависшие процессы openclaw-cron старше заданного порога",

  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      maxAgeMinutes: {
        type: "number" as const,
        description: "Порог возраста процесса в минутах (по умолчанию 15)",
      },
      checkIntervalMinutes: {
        type: "number" as const,
        description: "Интервал проверки в минутах (по умолчанию 15)",
      },
    },
  },

  register(api: { getConfig?: () => PluginConfig }) {
    const config = api.getConfig?.() || {};

    const maxAgeMin = Number(process.env.ZOMBIE_MAX_AGE_MIN)
      || config.maxAgeMinutes
      || DEFAULT_MAX_AGE_MINUTES;

    const checkIntervalMin = config.checkIntervalMinutes || DEFAULT_CHECK_INTERVAL_MINUTES;

    maxAgeSec = maxAgeMin * 60;

    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }

    cleanupInterval = setInterval(cleanup, checkIntervalMin * 60 * 1000);

    console.log(
      `[${PLUGIN_ID}] Plugin loaded, checking every ${checkIntervalMin} min (threshold: ${maxAgeMin} min)`
    );
  },

  unload() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    console.log(`[${PLUGIN_ID}] Plugin unloaded`);
  },
};

export default plugin;
