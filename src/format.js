/**
 * Join channel IDs into a mention string, capped to stay within Discord's embed
 * limits (field value <= 1024, description <= 4096). Shows "…ほかN件" when over.
 */
export function joinChannelMentions(ids, { limit = 30, joiner = ' ' } = {}) {
  if (!ids || !ids.length) return '';
  const shown = ids.slice(0, limit).map((id) => `<#${id}>`).join(joiner);
  return ids.length > limit ? `${shown}${joiner}…ほか${ids.length - limit}件` : shown;
}

/**
 * Discord only renders heading levels #, ##, ### (no #### / H4+). Convert any
 * deeper heading line to bold so it doesn't show up as a literal "####".
 */
export function clampMarkdownHeadings(text) {
  return String(text).replace(/^[ \t]*#{4,}[ \t]+(.+?)\s*$/gm, '**$1**');
}
