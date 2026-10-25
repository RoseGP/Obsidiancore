/**
 * Safe clipboard helper for iframe sandboxed and browser environments.
 * Prevents "Failed to execute 'writeText' on 'Clipboard': Document is not focused" errors.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. First attempt modern navigator.clipboard with try/catch
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      // Check if document has focus or request focus if in iframe
      if (typeof window !== 'undefined' && typeof window.focus === 'function') {
        try {
          window.focus();
        } catch {
          // ignore focus error
        }
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('[Clipboard] Modern writeText failed, using fallback:', err);
    }
  }

  // 2. Fallback: execCommand('copy') with temporary textarea
  try {
    if (typeof document !== 'undefined') {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      
      // Ensure element is off-screen but part of layout
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      textArea.setAttribute('readonly', '');
      textArea.style.opacity = '0';
      textArea.style.pointerEvents = 'none';

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, 99999); // Mobile compatibility

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        return true;
      }
    }
  } catch (fallbackErr) {
    console.warn('[Clipboard] ExecCommand fallback failed:', fallbackErr);
  }

  return false;
}
