// Giving bots a voice with Workers AI. Every call is bounded in time and
// falls back to evidence-based lines, so a slow model or a spent daily
// allowance never stalls a meeting.

import { buildPrompt, fallbackLine, parseReply, type MindContext } from "./minds";

export const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const TIMEOUT_MS = 7000;

const SCHEMA = {
  type: "object",
  properties: { say: { type: "string" }, suspect: { type: "string" } },
  required: ["say", "suspect"],
};

export interface Voice {
  say: string;
  suspect: string | null;
  source: "ai" | "fallback";
}

interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

/** After a failure, give the model a rest before trying again (per room). */
export class AiGate {
  private pausedUntil = 0;
  ok(now: number) { return now >= this.pausedUntil; }
  fail(now: number) { this.pausedUntil = now + 60_000; }
}

/** Ask the model for free text (the end-of-game tale). Null if it can't. */
export async function write(ai: AiBinding | undefined, model: string, system: string, user: string, clean: (raw: unknown) => string | null, timeoutMs = 12_000): Promise<string | null> {
  if (!ai) return null;
  try {
    const run = ai.run(model, {
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 260,
      temperature: 0.8,
    });
    const out = await Promise.race([run, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]);
    return clean(out);
  } catch (err) {
    console.log("ai tale failed; using fallback:", String(err).slice(0, 200));
    return null;
  }
}

export async function speak(ai: AiBinding | undefined, model: string, ctx: MindContext, gate: AiGate): Promise<Voice> {
  const now = Date.now();
  if (ai && gate.ok(now)) {
    try {
      const { system, user } = buildPrompt(ctx);
      const run = ai.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 90,
        temperature: 0.85,
        response_format: { type: "json_schema", json_schema: SCHEMA },
      });
      const out = await Promise.race([run, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);
      const raw = (out as any)?.response ?? out;
      const parsed = parseReply(raw, ctx);
      if (parsed) return { ...parsed, source: "ai" };
    } catch (err) {
      console.log("ai voice failed; using fallback:", String(err).slice(0, 200));
      gate.fail(now);
    }
  }
  return { ...fallbackLine(ctx), source: "fallback" };
}
