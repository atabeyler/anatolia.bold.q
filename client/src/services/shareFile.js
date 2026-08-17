// Shares a Blob via the native OS share sheet (AirDrop, Messages, Mail,
// WhatsApp, Print, etc. on iOS/Android) when the platform supports file
// sharing; falls back to a normal browser download everywhere else
// (desktop browsers largely don't support navigator.share with files).
export async function shareOrDownloadBlob(blob, filename, mimeType, shareTitle) {
  const file = new File([blob], filename, { type: mimeType });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: shareTitle });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user dismissed the share sheet
      // Fall through to a plain download for any other failure.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function canShareFiles() {
  return !!(navigator.canShare && navigator.share);
}

export function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
