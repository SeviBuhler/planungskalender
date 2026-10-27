// Mail clients cannot run a copy button, so the app offers "paste" instead:
// it reads the clipboard and picks the code out of whatever was copied (e.g. "Code: 5503 4420").
export function extractCode(text: string): string | null {
  const match = text.replace(/[\s-]/g, '').match(/\d{6,10}/);
  return match ? match[0] : null;
}

// Clipboard access needs a user gesture and may be refused (or missing in older browsers)
export async function readCodeFromClipboard(): Promise<string | null> {
  try {
    return extractCode(await navigator.clipboard.readText());
  } catch {
    return null;
  }
}
