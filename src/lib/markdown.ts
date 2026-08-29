import { marked } from "marked";

export function mdToHtml(markdown: string): string {
  const body = marked.parse(markdown) as string;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
${body}</body>
</html>
`;
}
