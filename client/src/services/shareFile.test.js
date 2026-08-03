import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shareOrDownloadBlob, canShareFiles, base64ToBlob } from './shareFile.js';

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() });
});

describe('base64ToBlob', () => {
  it('decodes a base64 string into a Blob of the given mime type', () => {
    const blob = base64ToBlob(btoa('hello'), 'text/plain');
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe(5);
  });
});

describe('canShareFiles', () => {
  it('is true when both canShare and share exist on navigator', () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: vi.fn() });
    expect(canShareFiles()).toBe(true);
  });

  it('is false when the platform has no file-share support', () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });
    expect(canShareFiles()).toBe(false);
  });
});

describe('shareOrDownloadBlob', () => {
  it('calls navigator.share with the file when the platform supports it', async () => {
    const shareMock = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: shareMock });

    await shareOrDownloadBlob(new Blob(['x']), 'report.pdf', 'application/pdf', 'ANATOLIA-Q Raporu');

    expect(shareMock).toHaveBeenCalledTimes(1);
    const arg = shareMock.mock.calls[0][0];
    expect(arg.title).toBe('ANATOLIA-Q Raporu');
    expect(arg.files[0].name).toBe('report.pdf');
  });

  it('falls back to a download when the platform has no file-share support', async () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });
    const clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    await shareOrDownloadBlob(new Blob(['x']), 'report.pdf', 'application/pdf', 'title');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalled();
    document.createElement.mockRestore();
  });

  it('silently does nothing when the user dismisses the share sheet (AbortError)', async () => {
    const shareMock = vi.fn(async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: shareMock });
    const clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    await shareOrDownloadBlob(new Blob(['x']), 'report.pdf', 'application/pdf', 'title');

    expect(shareMock).toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled(); // no fallback download on a user cancel
    document.createElement.mockRestore();
  });

  it('falls back to a download when navigator.share rejects for a reason other than AbortError', async () => {
    const shareMock = vi.fn(async () => { throw new Error('some other failure'); });
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: shareMock });
    const clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    await shareOrDownloadBlob(new Blob(['x']), 'report.pdf', 'application/pdf', 'title');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    document.createElement.mockRestore();
  });
});
