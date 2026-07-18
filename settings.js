// ==================================================================================================== //
// SCRAPER INTERCEPTOR & BRIDGE SYSTEM
// ==================================================================================================== //
let scraperApi = null;
const imageCacheMap = new Map();

function getRealImageUrl(folder, file) {
  return imageCacheMap.get(`${folder}|${file}`);
}

function setRealImageUrl(folder, file, realUrl) {
  imageCacheMap.set(`${folder}|${file}`, realUrl);
}

// Intercept window.fetch requests targetting your mock port 4269
const originalFetch = window.fetch;
window.fetch = async function(input, init) {
  const urlStr = typeof input === 'string' ? input : input?.url || '';

  // 1. Intercept the database manifest call
  if (urlStr.startsWith('http://localhost:4269/folders')) {
    console.log('[Bridge] Intercepted folders fetch. Scraping live data...');
    try {
      const liveData = await fetchLiveOsosedkiData();
      return new Response(JSON.stringify(liveData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('[Bridge] Live scrape fell back to error:', err);
      return new Response(JSON.stringify([]), { status: 500 });
    }
  }

  // 2. Intercept scraper calls bound to the source site and force local CORS proxy routing
  if (urlStr.startsWith('https://ososedki.com')) {
    const proxyBase = (settingsState.proxyUrl || 'http://localhost:3000').replace(/\/$/, '');
    const proxiedUrl = `${proxyBase}/proxy?url=${encodeURIComponent(urlStr)}`;
    return originalFetch(proxiedUrl, init);
  }

  return originalFetch(input, init);
};

// 3. Hijack HTML Image element src attributes
// Standard <img> tags do not trigger window.fetch. We override the prototype setter
// to capture local asset requests and map them to direct CDN targets.
const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src') || {
  set: function(val) { this.setAttribute('src', val); },
  get: function() { return this.getAttribute('src'); }
};

Object.defineProperty(HTMLImageElement.prototype, 'src', {
  set: function(value) {
    if (typeof value === 'string' && value.includes('http://localhost:4269/image')) {
      try {
        const url = new URL(value);
        const folder = url.searchParams.get('folder');
        const file = url.searchParams.get('file');
        const realUrl = getRealImageUrl(folder, file);

        if (realUrl) {
          const proxyBase = (settingsState.proxyUrl || 'http://localhost:3000').replace(/\/$/, '');
          const proxiedUrl = `${proxyBase}/proxy?url=${encodeURIComponent(realUrl)}`;
          return originalSrcDescriptor.set.call(this, proxiedUrl);
        }
      } catch (err) {
        console.error('[Bridge] Image URL processing failed:', err);
      }
    }
    return originalSrcDescriptor.set.call(this, value);
  },
  get: function() {
    return originalSrcDescriptor.get.call(this);
  },
  configurable: true,
  enumerable: true
});

// ==================================================================================================== //
// MAPPING SCRAPED PORTAL DATA TO FOLDER STRUCTURE
// ==================================================================================================== //
async function fetchLiveOsosedkiData() {
  // Dynamically load your modular scraper client
  if (!scraperApi) {
    const module = await import('./api/api.mjs');
    scraperApi = module.createClient({ baseUrl: 'https://ososedki.com' });
  }

  const limit = parseInt(settingsState.albumLimit, 10) || 12;

  // Retrieve default homepage galleries feed
  const feed = await scraperApi.getHome(1);
  const targetAlbums = feed.albums.slice(0, limit);

  const mockFolders = [];

  // Concurrently resolve the interior contents of each gallery block
  const resolutionTasks = targetAlbums.map(async (album) => {
    try {
      const details = await scraperApi.getGallery(album.id);
      const imagesList = details.allImageUrls.length ? details.allImageUrls : details.images.map(i => i.url);

      // Structure title matching Folder properties
      const folderName = `${album.modelName || 'Model'} - ${album.title}`;
      const randomAccent = ACCENT_NAMES[Math.floor(Math.random() * ACCENT_NAMES.length)];
      const byteCalculation = Math.floor(imagesList.length * 1.5 + 5);

      const folderObject = {
        name: folderName,
        accent: randomAccent,
        sizeMB: byteCalculation,
        fileCount: imagesList.length,
        images: imagesList.map((url, index) => {
          const fileName = `${index + 1}.webp`;
          setRealImageUrl(folderName, fileName, url);
          return {
            name: fileName,
            size: 1.5
          };
        })
      };

      mockFolders.push(folderObject);
    } catch (err) {
      console.warn(`[Bridge] Skipped loading details for album: ${album.id}`, err);
    }
  });

  await Promise.all(resolutionTasks);
  return mockFolders;
}

// ==================================================================================================== //
// WORKSPACE THEME HOOK
// ==================================================================================================== //
function applyGlobalAccent(accentName) {
  if (ACCENT_NAMES.includes(accentName)) {
    document.documentElement.style.setProperty('--accent', `var(--ctp-${accentName}-rgb)`);
    console.log(`[Theme] Accent set to: ${accentName}`);
  }
}