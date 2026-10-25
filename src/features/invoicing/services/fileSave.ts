/**
 * Saves a generated file. Inside a claude.ai artifact the page can't trigger
 * downloads itself, so it asks the viewer through the `downloads` capability;
 * everywhere else (e.g. the CRM) it uses a normal browser download.
 */
export type SaveOutcome = 'saved' | 'declined';

export async function saveFile(filename: string, data: Blob): Promise<SaveOutcome> {
  const host = (window as any).claude;
  if (host && typeof host.use === 'function') {
    const downloads = await host.use('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return 'saved';
      } catch (err: any) {
        if (err?.code === 'declined') return 'declined';
        throw err;
      }
    }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
