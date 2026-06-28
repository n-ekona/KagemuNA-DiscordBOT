import { config } from '../config.js';

export function isAiConfigured() {
  return !!config.geminiApiKey;
}

/**
 * Summarize text with the Google Gemini API (free tier friendly). Throws on
 * failure (HTTP error, invalid JSON, empty/blocked output, timeout) with a
 * helpful message. The key is sent via header (not URL) to keep it out of logs.
 */
export async function summarize(text, { instruction = '次の内容を日本語で簡潔に要約してください。', maxOutputTokens = 1024 } = {}) {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY が未設定です。');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: `${instruction}\n\n----\n${text}` }] }],
    // thinkingBudget:0 disables "thinking" tokens on 2.5/3.x flash models, which
    // would otherwise consume the output budget and truncate the summary.
    generationConfig: { maxOutputTokens, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    // The timeout stays armed through the body read below, so a slow/stalled
    // response stream also aborts at 30s (not just the initial headers).
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).split('\n')[0].slice(0, 150);
      throw new Error(`Gemini API ${res.status}（モデル設定 GEMINI_MODEL を確認）: ${detail}`);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Gemini API の応答をJSONとして解析できませんでした。');
    }

    const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    if (!out) {
      const cand = data?.candidates?.[0];
      let reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'unknown';
      const blocked = cand?.safetyRatings?.filter((r) => r.blocked || r.probability === 'HIGH');
      if (blocked?.length) reason += ` [${blocked.map((r) => r.category).join(', ')}]`;
      throw new Error(`要約結果が空でした (reason: ${reason})`);
    }
    return out;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('AIへの接続がタイムアウトしました。');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
