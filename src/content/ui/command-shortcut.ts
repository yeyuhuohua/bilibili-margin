/** Visible palette shortcut; slash is available even with Ctrl/⌘ K switched off. */
export const commandKeys = (enabled: boolean, platform = navigator.platform): string[] =>
  enabled ? [/Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘' : 'Ctrl', 'K'] : ['/'];