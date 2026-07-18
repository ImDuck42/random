// ==================================================================================================== //
// GENERAL FUNCTIONS
// ==================================================================================================== //
function onToggleChange(enableToggle) {
  console.log(`[Core Service] Status changed: ${enableToggle ? 'ENABLED' : 'DISABLED'}`)
}

function printValue(textValue) {
  if (!textValue) {
    console.warn('[Ping] No service name provided.')
    return
  }
  console.log(`[Ping] Pinging service: "${textValue}"... Success!`)
}

function toggleNotifications(enabled) {
  console.log(`[Notifications] Email notifications are now ${enabled ? 'ON' : 'OFF'}.`)
}

// ==================================================================================================== //
// APPEARANCE FUNCTIONS
// ==================================================================================================== //
function applyTheme(isDarkMode) {
  console.log(`[Theme] Switched to ${isDarkMode ? 'Dark' : 'Light'} Mode.`)
  if (isDarkMode) {
    document.body.classList.add('theme-dark')
    document.body.classList.remove('theme-light')
  } else {
    document.body.classList.add('theme-light')
    document.body.classList.remove('theme-dark')
  }
}

function updateUIScale(scaleValue) {
  console.log(`[UI] Interface scale set to ${scaleValue}%`)
  document.documentElement.style.setProperty('--ui-scale', `${scaleValue / 100}`)
}

function resetScale() {
  const scaleInput = document.getElementById('scaleSlider')
  if (scaleInput) {
    scaleInput.value = 100
    // Dispatch input event so the parser registers the state change automatically
    scaleInput.dispatchEvent(new Event('input')) 
  }
}

function applyBrandColor(hexColor) {
  console.log(`[Brand] Applying custom color: ${hexColor}`)
  document.documentElement.style.setProperty('--brand-color', hexColor)
}

// ==================================================================================================== //
// AUDIO & VIDEO FUNCTIONS
// ==================================================================================================== //
function toggleMute(isMuted) {
  const volInput = document.getElementById('volumeSlider')
  if (isMuted) {
    console.log('[Audio] System Muted.')
    if (volInput) volInput.disabled = true
  } else {
    console.log('[Audio] System Unmuted.')
    if (volInput) volInput.disabled = false
  }
}

function changeVolume(volume) {
  console.log(`[Audio] Master volume adjusted to: ${volume}%`)
}

function saveQuietHours(start, end) {
  if (!start || !end) {
    console.warn('[Quiet Hours] Please provide both a start and end time.')
    return
  }
  console.log(`[Quiet Hours] Saved. Notifications will be paused from ${start} to ${end}.`)
}

// ==================================================================================================== //
// ACCOUNT & PRIVACY FUNCTIONS
// ==================================================================================================== //
function updatePassword(newPassword) {
  if (!newPassword || newPassword.length < 6) {
    alert('Password must be at least 6 characters long!')
    return
  }
  console.log(`[Security] Password updated successfully! (length: ${newPassword.length})`)
  
  // Clear the input after update
  const pwInput = document.getElementById('newPassword')
  if (pwInput) {
    pwInput.value = ''
    pwInput.dispatchEvent(new Event('input'))
  }
}

function exportUserData() {
  console.log('[Privacy] Compiling user data for export...')
  setTimeout(() => {
    console.log('[Privacy] User data exported successfully. Check your downloads folder.')
    alert('Data export complete!')
  }, 1000)
}

function deleteAccount() {
  console.error('[Danger Zone] Account deletion initiated...')
  alert('Your account has been flagged for deletion.')
}

// ==================================================================================================== //
// DEVELOPER FUNCTIONS
// ==================================================================================================== //
function pingApiEndpoint(url) {
  if (!url) {
    console.warn('[API] No URL provided to ping.');
    return
  }
  console.log(`[API] Sending test request to: ${url}`)
  
  // Simulated ping delay
  setTimeout(() => {
    console.log(`[API] 200 OK from ${url}`)
  }, 800)
}

function clearLocalCache() {
  console.log('[Dev] Clearing localStorage and sessionStorage...')
  localStorage.clear()
  sessionStorage.clear()
  console.log('[Dev] Cache cleared.')
  alert('Local cache successfully purged!')
}

async function loadExternalSettingsFromUrl(jsonUrl) {
  if (!jsonUrl) {
    console.warn('[API] No URL provided.');
    alert('Please enter a URL first!');
    return;
  }

  console.log(`[API] Fetching external settings from: ${jsonUrl}`);

  try {
    // 1. Fetch the remote settings JSON
    const response = await fetch(jsonUrl);
    if (!response.ok) {
      throw new Error(`HTTP Error! Status: ${response.status}`);
    }

    const data = await response.json();
    console.log('[API] Successfully loaded settings JSON:', data);

    // 2. Dynamically load the associated JS file if specified in "imports"
    if (data.imports) {
      // Resolve the import path relative to the JSON file's URL
      // For example, if jsonUrl is "https://example.com/config/settings.json"
      // and data.imports is "./settings.js", it resolves to "https://example.com/config/settings.js"
      const baseUrl = new URL(jsonUrl, window.location.href);
      const resolvedJsUrl = new URL(data.imports, baseUrl).href;
      
      console.log(`[API] Dynamically loading associated JS: ${resolvedJsUrl}`);
      await injectScript(resolvedJsUrl);
    }

    // 3. Render the newly imported sections at the bottom
    if (typeof appendAndRenderSettings === 'function') {
      appendAndRenderSettings(data.sections || []);
    } else {
      console.warn('[Dev] Settings loaded, but "appendAndRenderSettings" parser hook is missing.');
      alert('Settings loaded successfully! Connect "appendAndRenderSettings" to update your UI.');
    }

  } catch (error) {
    console.error('[API] Failed to fetch external config:', error);
    alert(`Error loading settings: ${error.message}`);
  }
}

// Helper utility to inject script tags into the document
function injectScript(src) {
  return new Promise((resolve, reject) => {
    // Avoid reloading the script if it's already present in the DOM
    if (document.querySelector(`script[src="${src}"]`)) {
      console.log(`[API] Script already loaded: ${src}`);
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.type = 'text/javascript'; // Use 'module' if your target script uses export statements
    script.onload = () => {
      console.log(`[API] Script successfully evaluated: ${src}`);
      resolve();
    };
    script.onerror = () => {
      reject(new Error(`Failed to load script resource: ${src}`));
    };
    
    document.head.appendChild(script);
  });
}