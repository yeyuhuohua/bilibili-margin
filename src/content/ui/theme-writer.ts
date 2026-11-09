import { loadSettings, saveSettings, type Settings } from '../../shared/settings';

/** 合并连续点击的主题写入，在最后一次保存确认前保留用户当前选择。 */
export class ThemeWriter {
  private pending: Settings['theme'] | undefined;
  private observed: Settings['theme'] | undefined;
  private writing = false;

  sync(settings: Settings): Settings {
    this.observed = settings.theme;
    if (!this.writing && this.pending === settings.theme) this.pending = undefined;
    return this.pending === undefined ? settings : { ...settings, theme: this.pending };
  }

  async save(theme: Settings['theme']): Promise<void> {
    this.pending = theme;
    if (this.writing) return;
    this.writing = true;
    try {
      let value: Settings['theme'];
      do {
        value = this.pending;
        const current = await loadSettings();
        if (current.theme === value) this.observed = value;
        else {
          this.observed = undefined;
          await saveSettings({ theme: value });
        }
      } while (this.pending !== value);
    } catch (error) {
      this.pending = undefined;
      throw error;
    } finally {
      this.writing = false;
      if (this.observed === this.pending) this.pending = undefined;
    }
  }
}
