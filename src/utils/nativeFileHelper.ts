import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface DeviceSaveResult {
  savedToDevice: boolean;
  location: string;
  uri?: string;
  viaShareSheet?: boolean;
}

export interface WhatsAppShareResult {
  shared: boolean;
  method: 'native-share' | 'web-share' | 'whatsapp-link' | 'cancelled';
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

export function triggerWebBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
}

export function openWhatsAppLink(messageText: string): void {
  const url = `https://wa.me/?text=${encodeURIComponent(messageText)}`;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function saveFileToDevice(options: {
  filename: string;
  blob: Blob;
  base64Data: string;
}): Promise<DeviceSaveResult> {
  const { filename, blob, base64Data } = options;

  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await Filesystem.checkPermissions();
      if (perm.publicStorage !== 'granted') {
        await Filesystem.requestPermissions().catch(() => undefined);
      }
    } catch {
      // Android 11+ scoped storage does not require legacy storage permission for app-created Documents files
    }

    try {
      const relPath = `Payroll/${filename}`;
      const res = await Filesystem.writeFile({
        path: relPath,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      });
      return {
        savedToDevice: true,
        location: `Documents/${relPath}`,
        uri: res.uri,
      };
    } catch {
      // Fallback: write to Cache and open native Android Save/Share sheet
      const cacheRes = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      await Share.share({
        title: filename,
        files: [cacheRes.uri],
        dialogTitle: 'Save Salary Slip',
      });
      return {
        savedToDevice: true,
        location: filename,
        uri: cacheRes.uri,
        viaShareSheet: true,
      };
    }
  }

  triggerWebBlobDownload(blob, filename);
  return {
    savedToDevice: false,
    location: filename,
  };
}

export async function shareSlipToWhatsApp(options: {
  filename: string;
  blob: Blob;
  base64Data: string;
  mimeType: string;
  title: string;
  text: string;
}): Promise<WhatsAppShareResult> {
  const { filename, blob, base64Data, mimeType, title, text } = options;

  if (Capacitor.isNativePlatform()) {
    const cacheRes = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });

    try {
      await Share.share({
        title,
        text,
        files: [cacheRes.uri],
        dialogTitle: 'Share Salary Slip to WhatsApp',
      });
      return { shared: true, method: 'native-share' };
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('cancel') || msg.includes('abort')) {
        return { shared: false, method: 'cancelled' };
      }
      openWhatsAppLink(text);
      return { shared: true, method: 'whatsapp-link' };
    }
  }

  const file = new File([blob], filename, { type: mimeType });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };

  if (
    typeof nav.share === 'function' &&
    (!nav.canShare || nav.canShare({ files: [file] }))
  ) {
    try {
      await nav.share({
        title,
        text,
        files: [file],
      });
      return { shared: true, method: 'web-share' };
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError') {
        return { shared: false, method: 'cancelled' };
      }
      // Fall through to direct WhatsApp link + download when Web Share is blocked (e.g. iframe)
    }
  }

  triggerWebBlobDownload(blob, filename);
  openWhatsAppLink(text);
  return { shared: true, method: 'whatsapp-link' };
}
