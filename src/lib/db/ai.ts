import { getActiveCompanyDb } from "./active";
import type { AiSettings } from "../ai/types";

const META_KEY = "ai_settings";

export function emptyAiSettings(): AiSettings {
  return { provider: "", apiKey: "", model: "" };
}

export async function getAiSettings(): Promise<AiSettings> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = $1",
    [META_KEY],
  );
  if (!rows[0]?.value) return emptyAiSettings();
  try {
    return { ...emptyAiSettings(), ...JSON.parse(rows[0].value) };
  } catch {
    return emptyAiSettings();
  }
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [META_KEY, JSON.stringify(settings)],
  );
}

export function aiConfigured(settings: AiSettings): boolean {
  return settings.provider !== "" && settings.apiKey.trim() !== "";
}
