// ==================================================================================================== //
// BINDINGS INITIALIZATION
// ==================================================================================================== //
if (typeof settingsState !== 'undefined') {
  settingsState.proxyUrl = settingsState.proxyUrl || 'http://localhost:4269';
  settingsState.albumLimit = settingsState.albumLimit || 12;
} else {
  window.settingsState = {
    proxyUrl: 'http://localhost:4269',
    albumLimit: 12
  };
}

// =================================================================================//
// DYNAMIC SETTINGS SYNC & CONNECTION TESTING
// =================================================================================//
async function updateScraperSettings(limit) {
  const activeState = typeof settingsState !== 'undefined' ? settingsState : window.settingsState;
  const proxyBase = (activeState.proxyUrl || 'http://localhost:4269').replace(/\/$/, '');
  
  try {
    const res = await fetch(`${proxyBase}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumLimit: limit })
    });
    if (res.ok) {
      alert(`Album limit updated to ${limit}!\n\nRefresh the page to let the scraper build the new feed layout.`);
    }
  } catch (err) {
    console.error('[Settings] Failed to save settings to backend:', err);
    alert('Failed to send configuration updates to your proxy.js backend.');
  }
}

async function testProxyConnection(proxyUrl) {
  if (!proxyUrl) {
    alert('Please enter a proxy URL first.');
    return;
  }
  const cleanUrl = proxyUrl.replace(/\/$/, '');
  const testTarget = 'https://ososedki.com/';
  const fullUrl = `${cleanUrl}/proxy?url=${encodeURIComponent(testTarget)}`;
  
  console.log(`[Proxy Test] Pinging: ${fullUrl}`);
  try {
    const res = await fetch(fullUrl, { method: 'HEAD' });
    if (res.ok) {
      alert('Proxy connection successful!\n\nYour proxy.js server is online, running on port 4269, and successfully routing traffic to ososedki.com.');
    } else {
      alert(`Proxy responded, but returned an error status: ${res.status}`);
    }
  } catch (err) {
    console.error('[Proxy Test] Connection failed:', err);
    alert(`CORS Proxy Connection Test Failed!\n\nError: ${err.message}\n\nTroubleshooting steps:\n1. Confirm "node proxy.js" is running in your terminal.\n2. Verify the port in your input matches your terminal's run port.`);
  }
}

window.updateScraperSettings = updateScraperSettings;
window.testProxyConnection = testProxyConnection;