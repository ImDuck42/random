(async function autoLoadExtensions() {
  const EXTENSIONS_TO_INSTALL = [
    'https://imduck42.github.io/random/Dsettings.json',
    "https://imduck42.github.io/random/Osettings.json",
    "https://imduck42.github.io/random/Bsettings.json",
    "https://imduck42.github.io/random/Psettings.json"
  ];

  function getInstalledImports() {
    try {
      return JSON.parse(localStorage.getItem('imports') || '[]');
    } catch (error) {
      console.error('[Autoloader] Failed to parse local storage imports:', error);
      return [];
    }
  }

  const installed = getInstalledImports();

  for (const rawUrl of EXTENSIONS_TO_INSTALL) {
    const url = rawUrl.trim();
    if (!url) continue;

    if (!installed.includes(url)) {
      console.log(`[Autoloader] Extension not installed yet, installing: ${url}`);
      try {
        await loadExternalSettingsFromUrl(url);
      } catch (error) {
        console.error(`[Autoloader] Error installing ${url}:`, error);
      }
    } else {
      console.log(`[Autoloader] Extension already installed, skipping to prevent double-loading: ${url}`);
    }
  }
})();