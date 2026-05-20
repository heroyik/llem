// ---------------------------------------------------------------------------
// Slider value display setup — extracted from main.ts
// ---------------------------------------------------------------------------

export interface SliderSetupDeps {
  settingsTemp: HTMLInputElement | null;
  settingsTempVal: HTMLElement | null;
  settingsTopP: HTMLInputElement | null;
  settingsTopPVal: HTMLElement | null;
  settingsTopK: HTMLInputElement | null;
  settingsTopKVal: HTMLElement | null;
  settingsRepeatPenalty: HTMLInputElement | null;
  settingsRepeatPenaltyVal: HTMLElement | null;
  settingsMaxTokens: HTMLInputElement | null;
  settingsMaxTokensVal: HTMLElement | null;
}

export interface SliderSettingsModule {
  onSliderChange(input: HTMLInputElement | null, display: HTMLElement | null, decimals?: number): void;
  postSliderValue(input: HTMLInputElement | null, key: string): void;
}

export function setupSliderDisplays(
  els: SliderSetupDeps,
  settings: SliderSettingsModule
): void {
  settings.onSliderChange(els.settingsTemp, els.settingsTempVal, 2);
  settings.onSliderChange(els.settingsTopP, els.settingsTopPVal, 2);
  settings.onSliderChange(els.settingsTopK, els.settingsTopKVal, 0);
  settings.onSliderChange(els.settingsRepeatPenalty, els.settingsRepeatPenaltyVal, 2);
  settings.onSliderChange(els.settingsMaxTokens, els.settingsMaxTokensVal, 0);
  settings.postSliderValue(els.settingsTemp, 'temperature');
  settings.postSliderValue(els.settingsTopP, 'topP');
  settings.postSliderValue(els.settingsTopK, 'topK');
  settings.postSliderValue(els.settingsRepeatPenalty, 'repeatPenalty');
  settings.postSliderValue(els.settingsMaxTokens, 'maxTokens');
}
