-- Paramètres avancés du super admin (02/11/2026) : règles métier réglables depuis l'admin (Paramètres → Avancés).
-- Une ligne par paramètre modifié ; paramètre absent = valeur d'origine (définie dans src/platform-settings/platform-settings.store.ts).
-- Aucune ligne de départ : rien ne change tant que le super admin ne modifie rien. Rejouable.
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  value VARCHAR(32) NOT NULL,
  updated_at DATETIME NULL,
  updated_by INT NULL
);
