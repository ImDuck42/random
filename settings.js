(async function autoLoadExtensions() {
  const EXTENSION_URLS = [
    'https://imduck42.github.io/random/Osettings.json',
    'https://imduck42.github.io/random/Psettings.json'
  ];

  console.log('[Autoloader] Silently loading extensions...');

  for (const url of EXTENSION_URLS) {
    if (!url) continue;
    try {
      await loadExternalSettingsFromUrl(url);
      console.log(`[Autoloader] Successfully loaded: ${url}`);
    } catch (error) {
      console.error(`[Autoloader] Failed to load: ${url}`, error);
    }
  }
})();