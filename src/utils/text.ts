/**
 * Tidy report text for display (mirrors public.normalize_report_text in the
 * database): drop trailing spaces / invisible direction marks at line ends,
 * collapse runs of blank lines to one, trim leading/trailing blank lines.
 */
export function cleanReportText(text: string): string {
  return text
    .replace(/[ \t\r ​‎‏‪-‮⁦-⁩]+(?=\n|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[\s\n]+|[\s\n]+$/g, '');
}

/** Short preview text: lines that are only a web address (e.g. map links) are dropped. */
export function previewText(text: string): string {
  return cleanReportText(text.replace(/^[ \t]*https?:\/\/\S+[ \t]*$/gm, ''));
}
