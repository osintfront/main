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
