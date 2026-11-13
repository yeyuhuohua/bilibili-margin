import { UPDATE_PENDING, UPDATE_SEEN } from '../shared/updates';

export async function recordVersionInstall(reason: string, previousVersion?: string): Promise<void> {
  const version = chrome.runtime.getManifest().version;
  if (reason === 'install') await chrome.storage.local.set({ [UPDATE_SEEN]: version });
  else if (reason === 'update' && previousVersion && previousVersion !== version) await chrome.storage.local.set({ [UPDATE_PENDING]: version });
}
