export async function compose(query: string, notes: string[]): Promise<{ text: string; model: string | null }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey || notes.length === 0) {
    return { text: "一次のURLは取れた。文章化はしない。", model: null };
  }
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: 420,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "渡された一次資料だけを根拠に、日本語で短く答える。資料に無いことは書かない。",
        },
        { role: "user", content: `質問: ${query}\n\n一次資料:\n${notes.join("\n\n")}` },
      ],
    }),
  });
  if (!res.ok) return { text: "一次のURLは取れた。文章化は失敗した。", model: null };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim();
  return { text: text || "一次のURLは取れた。文章は空だった。", model: text ? "grok-4.5" : null };
}
