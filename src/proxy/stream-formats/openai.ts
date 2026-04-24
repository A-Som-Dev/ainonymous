export function buildOpenaiChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function buildOpenaiSyntheticContent(
  text: string,
  id: string | null,
  model: string | null,
): string {
  const payload: Record<string, unknown> = {
    id: id ?? 'chatcmpl-ainonymous-flush',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
  if (model) payload['model'] = model;
  return `data: ${JSON.stringify(payload)}\n\n`;
}
