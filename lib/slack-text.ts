const PATH_TOKEN_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const URL_RE = /^https?:\/\/\S+$/;

export type ParsedSlackText = {
  customPath?: string;
  payload: string;
  asFileUrl: string | null;
};

export function parseSlackText(text: string): ParsedSlackText {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { payload: "", asFileUrl: null };

  const firstSpace = trimmed.indexOf(" ");
  let customPath: string | undefined;
  let payload: string;

  if (firstSpace === -1) {
    if (PATH_TOKEN_RE.test(trimmed)) {
      customPath = trimmed;
      payload = "";
    } else {
      payload = trimmed;
    }
  } else {
    const head = trimmed.slice(0, firstSpace);
    const rest = trimmed.slice(firstSpace + 1).trim();
    if (PATH_TOKEN_RE.test(head)) {
      customPath = head;
      payload = rest;
    } else {
      payload = trimmed;
    }
  }

  const asFileUrl = payload && URL_RE.test(payload) ? payload : null;
  return { customPath, payload, asFileUrl };
}
