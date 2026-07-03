export interface GoogleConfig {
  folderName: string;
  rendererBaseUrl: string;
}

export function buildViewUrl(base: string, fileId: string): string {
  const trimmed = base.replace(/[?&]$/, "");
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}id=${encodeURIComponent(fileId)}`;
}
