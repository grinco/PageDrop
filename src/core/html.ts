function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function wrapHtmlDocument(inner: string, title: string): string {
  if (/<!doctype html|<html[\s>]/i.test(inner)) {
    return inner;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  img { max-width: 100%; }
  pre { overflow-x: auto; background: #f6f8fa; padding: 1rem; border-radius: 6px; }
</style>
</head>
<body>
${inner}
</body>
</html>`;
}
