import { SETTING_DEFS, loadSettings, parseSettingValue, setting, settingDef, settingOn } from './platform-settings.store';

describe('Paramètres avancés (02/11/2026)', () => {
  afterEach(() => {
    loadSettings([]);
    delete process.env.CAMPAIGN_GUARD_IP;
    delete process.env.SELLER_SIGNUP_OPEN;
  });

  it('sans réglage : valeurs d’origine (rien ne change avant une modification)', () => {
    loadSettings([]);
    expect(setting('tc.booking_window_days')).toBe(30);
    expect(setting('tc.min_lead_hours')).toBe(5);
    expect(setting('tc.max_upcoming_per_patient')).toBe(2);
    expect(setting('campaign.otp_ttl_hours')).toBe(48);
    expect(setting('order.pickup_otp_ttl_hours')).toBe(48);
    expect(setting('signup.min_age')).toBe(10);
    expect(setting('signup.max_age')).toBe(100);
    expect(setting('ai.log_retention_days')).toBe(90);
    expect(setting('files.photo_max_mb')).toBe(3);
    expect(settingOn('tc.reminders_enabled')).toBe(true);
    expect(settingOn('campaign.guard_ip')).toBe(true);
    expect(settingOn('signup.seller_open')).toBe(false);
  });

  it('variables Render gardées comme valeur par défaut', () => {
    process.env.CAMPAIGN_GUARD_IP = 'off';
    process.env.SELLER_SIGNUP_OPEN = 'true';
    expect(settingOn('campaign.guard_ip')).toBe(false);
    expect(settingOn('signup.seller_open')).toBe(true);
    loadSettings([{ setting_key: 'campaign.guard_ip', value: 'true' }]);
    expect(settingOn('campaign.guard_ip')).toBe(true);
  });

  it('valeur enregistrée appliquée ; ligne inconnue ou hors bornes ignorée', () => {
    loadSettings([
      { setting_key: 'tc.booking_window_days', value: '14' },
      { setting_key: 'ai.log_retention_days', value: '365' },
      { setting_key: 'inconnu', value: '1' },
    ]);
    expect(setting('tc.booking_window_days')).toBe(14);
    expect(setting('ai.log_retention_days')).toBe(90);
  });

  it('contrôle des valeurs envoyées par l’admin', () => {
    const d = settingDef('tc.booking_window_days');
    expect(parseSettingValue(d, '45')).toBe(45);
    expect(parseSettingValue(d, 45)).toBe(45);
    expect(() => parseSettingValue(d, '6')).toThrow('entre 7 et 90');
    expect(() => parseSettingValue(d, '91')).toThrow();
    expect(() => parseSettingValue(d, '1.5')).toThrow('nombre entier');
    expect(() => parseSettingValue(d, '')).toThrow();
    const b = settingDef('tc.reminders_enabled');
    expect(parseSettingValue(b, false)).toBe(false);
    expect(parseSettingValue(b, 'true')).toBe(true);
    expect(() => parseSettingValue(b, 'peut-être')).toThrow();
    expect(() => settingDef('inconnu')).toThrow('Paramètre inconnu');
  });

  it('chaque valeur d’origine respecte ses propres bornes', () => {
    for (const d of SETTING_DEFS) {
      if (d.type !== 'int') continue;
      const v = Number(d.fallback());
      expect(v).toBeGreaterThanOrEqual(d.min as number);
      expect(v).toBeLessThanOrEqual(d.max as number);
    }
  });
});
