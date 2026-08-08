// ==================================================================================================== //
// OSOSEDKI SCRAPER GALLERY PLUGIN
// ==================================================================================================== //
/** Stuff to maybe add:
 *    Marquee for liked folders
 *    Fullscreen for liked images
 */

const OSOSEDKI_ORIGIN_ADDRESS = 'https://ososedki.com';

const GITHUB_DATABASE_CONFIGURATION = {
  owner:        'ImDuck42',
  repo:         'Node-Test',
  publicTokens: ['ghdb_enc_ICEwKjIqGzImPBtzdgoFcBQOcAN3HRYYAwYjJQAsJisgFyoJCTwIASQQChc+ACwsKCIDdgoLLRAhAwMIMwE3Kn4HdgQ1IRUlCwIMFD0echEVGnEGFyI+GwQCDjQf'],
  basePath:     'data',
  useRaw:       true,
  rawBranches:  ['main', 'master', 'HEAD', 'refs/heads/main'],
};

const ICON_SVG_HEART_EMPTY  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
const ICON_SVG_HEART_FILLED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"   stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

let globalDatabaseInstance = null;

// ==================================================================================================== //
// PLUGIN STATE MANAGER
// ==================================================================================================== //
const pluginApplicationState = {
  currentPageNumber:      1,
  isCurrentlyLoading:     false,
  hasMoreAlbumsAvailable: true,
  currentSearchQuery:     '',
  proxyServerAddress:     '',
  loadedAlbumObjects:     [],
  cachedAlbumImagesMap:   {},
  activeAlbumIdentifiers: [],
  isGallerySortApplied:   false,
  
  currentUserAccount:   null,
  likedGalleryMap:      new Map(),
  likedImagesMap:       new Map(),
  activeProfileTabName: 'albums',
  activeProfileSortKey: 'liked-new'
};

function resetApplicationState(serverProxyAddress, searchQuery = '') {
  pluginApplicationState.currentPageNumber      = 1;
  pluginApplicationState.isCurrentlyLoading     = false;
  pluginApplicationState.hasMoreAlbumsAvailable = true;
  pluginApplicationState.currentSearchQuery     = searchQuery;
  pluginApplicationState.proxyServerAddress     = serverProxyAddress;
  pluginApplicationState.loadedAlbumObjects     = [];
  pluginApplicationState.cachedAlbumImagesMap   = {};
  pluginApplicationState.activeAlbumIdentifiers = [];
  pluginApplicationState.isGallerySortApplied   = false;
}

// ==================================================================================================== //
// UTILITY HELPERS & USER INTERFACE
// ==================================================================================================== //
function generateStringHash(inputString) {
  let hashValue = 0;
  for (let index = 0; index < inputString.length; index++) {
    hashValue  = ((hashValue << 5) - hashValue) + inputString.charCodeAt(index);
    hashValue |= 0;
  }
  return Math.abs(hashValue).toString(36);
}

function displayToastMessage(messageText, messageSeverity = 'info') {
  let toastContainerElement = document.getElementById('ososedki-toast-container');
  
  if (!toastContainerElement) {
    toastContainerElement    = document.createElement('div');
    toastContainerElement.id = 'ososedki-toast-container';
    document.body.appendChild(toastContainerElement);
  }
  
  const toastMessageElement       = document.createElement('div');
  toastMessageElement.className   = `ososedki-toast ${messageSeverity}`;
  toastMessageElement.textContent = messageText;
  
  toastContainerElement.appendChild(toastMessageElement);
  
  setTimeout(() => {
    toastMessageElement.classList.add('toast-out');
    toastMessageElement.addEventListener('animationend', () => toastMessageElement.remove());
  }, 3000);
}

function pauseExecution(delayMilliseconds) {
  return new Promise(resolveCallback => setTimeout(resolveCallback, delayMilliseconds));
}

async function executeNetworkTaskWithRetry(taskFunction, maximumRetries = 2, baseDelayMilliseconds = 500) {
  let lastEncounteredError;
  for (let attemptCount = 0; attemptCount <= maximumRetries; attemptCount++) {
    try {
      return await taskFunction();
    } catch (requestError) {
      lastEncounteredError = requestError;
      if (attemptCount === maximumRetries) {
        throw requestError;
      }
      await pauseExecution(baseDelayMilliseconds * (2 ** attemptCount));
    }
  }
  throw lastEncounteredError;
}

function extractIntegerFromString(textString) {
  if (textString == null) {
    return 0;
  }
  const matchResult = String(textString).match(/(\d[\d,]*)/);
  return matchResult ? parseInt(matchResult[1].replace(/,/g, ''), 10) : 0;
}

function generateProxyAddress(targetResourceAddress, proxyServerHost) {
  if (!targetResourceAddress) {
    return '';
  }
  const normalizedTarget = targetResourceAddress.startsWith('/') 
    ? OSOSEDKI_ORIGIN_ADDRESS + targetResourceAddress 
    : targetResourceAddress;
    
  const cleanProxyHost = proxyServerHost.replace(/\/$/, '');
  return `${cleanProxyHost}/proxy?url=${encodeURIComponent(normalizedTarget)}`;
}

function sortArrayItems(arrayItems, sortKeyConstraint) {
  const sortedArray = [...arrayItems];
  switch (sortKeyConstraint) {
    case 'liked-new':  
      sortedArray.sort((firstItem, secondItem) => new Date(secondItem.likedAt || 0) - new Date(firstItem.likedAt || 0)); 
      break;
    case 'liked-old':  
      sortedArray.sort((firstItem, secondItem) => new Date(firstItem.likedAt || 0) - new Date(secondItem.likedAt || 0)); 
      break;
    case 'alpha-asc':  
      sortedArray.sort((firstItem, secondItem) => (firstItem.title || firstItem.imageUrl || '').localeCompare(secondItem.title || secondItem.imageUrl || '')); 
      break;
    case 'alpha-desc': 
      sortedArray.sort((firstItem, secondItem) => (secondItem.title || secondItem.imageUrl || '').localeCompare(firstItem.title || firstItem.imageUrl || '')); 
      break;
    case 'random':     
      sortedArray.sort(() => Math.random() - 0.5); 
      break;
  }
  return sortedArray;
}

// ==================================================================================================== //
// API COMMUNICATION CLIENT
// ==================================================================================================== //
class OsosedkiNetworkClient {
  constructor(proxyServerAddress) {
    this.proxyServerAddress = proxyServerAddress.replace(/\/$/, '');
  }

  buildProxyTargetAddress(requestPath, requestParameters = {}) {
    const targetAddressObject = new URL(requestPath, OSOSEDKI_ORIGIN_ADDRESS);
    for (const [parameterKey, parameterValue] of Object.entries(requestParameters)) {
      if (parameterValue != null) {
        targetAddressObject.searchParams.set(parameterKey, String(parameterValue));
      }
    }
    const encodedTargetAddress = encodeURIComponent(targetAddressObject.toString());
    return `${this.proxyServerAddress}/proxy?url=${encodedTargetAddress}`;
  }

  async executeGetRequest(requestPath, requestParameters = {}) {
    const finalTargetAddress = this.buildProxyTargetAddress(requestPath, requestParameters);
    return executeNetworkTaskWithRetry(async () => {
      const serverResponse    = await fetch(finalTargetAddress);
      const requestSuccessful = serverResponse.ok;
      if (!requestSuccessful) {
        throw new Error(`HTTP Error Status ${serverResponse.status}`);
      }
      return serverResponse.text();
    });
  }

  parseMarkupToDocument(markupString) {
    const documentParser = new DOMParser();
    return documentParser.parseFromString(markupString, 'text/html');
  }

  parseAlbumElementsFromDocument(htmlDocument) {
    const processedAlbumIdentifiers = new Set();
    const extractedAlbumObjects     = [];
    const linkElementsCollection    = htmlDocument.querySelectorAll('a[href^="/photos/"]');

    for (const linkElement of linkElementsCollection) {
      const hyperlinkReference = linkElement.getAttribute('href');
      const albumIdentifier    = hyperlinkReference ? hyperlinkReference.replace('/photos/', '') : null;
      
      if (!albumIdentifier || processedAlbumIdentifiers.has(albumIdentifier)) {
        continue;
      }

      const figureContainer = linkElement.querySelector('figure');
      if (!figureContainer) {
        continue;
      }
      processedAlbumIdentifiers.add(albumIdentifier);

      const imageElement   = figureContainer.querySelector('img');
      let thumbnailAddress = imageElement?.getAttribute('data-src') ?? imageElement?.getAttribute('src') ?? '';
      
      if (thumbnailAddress.startsWith('/')) {
        thumbnailAddress = OSOSEDKI_ORIGIN_ADDRESS + thumbnailAddress;
      }

      const childDivElements = linkElement.querySelectorAll(':scope > div');
      const titleCellElement = childDivElements[0];
      const modelCellElement = childDivElements[1];
      const countCellElement = childDivElements[2];

      let albumTitleString = titleCellElement?.textContent.trim() ?? '';
      let modelNameString  = modelCellElement?.textContent.trim() ?? '';
      let totalImageCount  = countCellElement ? extractIntegerFromString(countCellElement.textContent) : 0;

      if (!albumTitleString) {
        const cleanedTextLines = linkElement.textContent.replace(/NEW/g, '').split('\n').map(line => line.trim()).filter(Boolean);
        albumTitleString       = cleanedTextLines[0] ?? '';
        modelNameString        = cleanedTextLines[1] ?? '';
        totalImageCount        = cleanedTextLines[2] ? extractIntegerFromString(cleanedTextLines[2]) : 0;
      }
      
      if (!modelNameString && albumTitleString.includes(' - ')) {
        const splitTitleParts = albumTitleString.split(' - ');
        modelNameString = splitTitleParts[0];
      }

      extractedAlbumObjects.push({ 
        identifier: albumIdentifier, 
        title:      albumTitleString, 
        modelName:  modelNameString, 
        imageCount: totalImageCount, 
        thumbnail:  thumbnailAddress 
      });
    }

    return extractedAlbumObjects;
  }

  async fetchAlbumListingData(requestPath, requestParameters) {
    const rawMarkupString = await this.executeGetRequest(requestPath, requestParameters);
    const parsedDocument  = this.parseMarkupToDocument(rawMarkupString);
    const hasNextPageLink = !!parsedDocument.querySelector('a.next-page');
    
    return {
      albums:  this.parseAlbumElementsFromDocument(parsedDocument),
      hasMore: hasNextPageLink
    };
  }

  fetchHomeAlbumsListing(pageNumber = 1) {
    return this.fetchAlbumListingData('/', { page: pageNumber });
  }

  searchAlbumsListing(searchQuery, pageNumber = 1) {
    return this.fetchAlbumListingData('/search', { q: searchQuery, page: pageNumber });
  }

  async fetchGalleryImageCollection(albumIdentifier) {
    const rawMarkupString = await this.executeGetRequest(`/photos/${albumIdentifier}`);
    const parsedDocument  = this.parseMarkupToDocument(rawMarkupString);
    const extractedImages = [];
    
    for (const figureElement of parsedDocument.querySelectorAll('figure.photo-item')) {
      const linkElement = figureElement.querySelector('a[href^="/images/a/"]');
      if (!linkElement) {
        continue;
      }
      const hyperlinkReference = linkElement.getAttribute('href') ?? '';
      extractedImages.push({ 
        address: `${OSOSEDKI_ORIGIN_ADDRESS}${hyperlinkReference}` 
      });
    }
    return extractedImages;
  }
}

// ==================================================================================================== //
// DATABASE INITIALIZATION & FAVORITES LOGIC
// ==================================================================================================== //
async function initializeDatabaseConnection() {
  if (globalDatabaseInstance) {
    return globalDatabaseInstance;
  }
  
  try {
    let DatabaseClassConstructor = window.GitHubDB;
    
    if (!DatabaseClassConstructor) {
      const importedLibraryModule = await import('https://imduck42.github.io/Node-Test/api/github-db.js').catch(() => null);
      if (importedLibraryModule) {
        DatabaseClassConstructor = importedLibraryModule.GitHubDB || importedLibraryModule.default;
      }
    }
    
    if (!DatabaseClassConstructor) {
      await new Promise((resolvePromise, rejectPromise) => {
        const scriptElement   = document.createElement('script');
        scriptElement.src     = 'https://imduck42.github.io/Node-Test/api/github-db.js';
        scriptElement.onload  = resolvePromise; 
        scriptElement.onerror = rejectPromise;
        document.head.appendChild(scriptElement);
      });
      DatabaseClassConstructor = window.GitHubDB;
    }
    
    globalDatabaseInstance = await DatabaseClassConstructor.public(GITHUB_DATABASE_CONFIGURATION);
    
    globalDatabaseInstance.permissions({
      imageLikes: { read: 'public', write: 'users' },
      likes:      { read: 'public', write: 'users' }
    });

    const activeSessionString = sessionStorage.getItem('__githubdb_session__');
    if (activeSessionString) {
      const parsedSessionObject = JSON.parse(activeSessionString);
      const sessionIsValid      = parsedSessionObject && parsedSessionObject.user && parsedSessionObject.expiresAt > Date.now();
      
      if (sessionIsValid) {
        pluginApplicationState.currentUserAccount = parsedSessionObject.user;
        await loadUserFavoriteRecords();
      }
    }
  } catch (initializationError) {
    console.error('Ososedki Database Initialization Failed:', initializationError);
  }
  
  return globalDatabaseInstance;
}

async function loadUserFavoriteRecords() {
  if (!globalDatabaseInstance || !pluginApplicationState.currentUserAccount) {
    return;
  }
  try {
    const userIdentifier         = pluginApplicationState.currentUserAccount.id;
    const likedGalleriesResponse = await globalDatabaseInstance.collection('likes').query(record => record.userId === userIdentifier);
    const likedImagesResponse    = await globalDatabaseInstance.collection('imageLikes').query(record => record.userId === userIdentifier);
    
    pluginApplicationState.likedGalleryMap = new Map(likedGalleriesResponse.map(record => [record.galleryId, record]));
    pluginApplicationState.likedImagesMap  = new Map(likedImagesResponse.map(record => [record.imageUrl, record]));

    const profileModalElement = document.getElementById('ososedki-profile-modal-container');
    const isProfileModalOpen  = profileModalElement?.style.display === 'flex';
    
    if (isProfileModalOpen) {
      window.renderOsosedkiProfileModalData();
    }
  } catch (fetchingError) {
    console.error('Failed to load favorites:', fetchingError);
  }
}

async function toggleAlbumFavoriteStatus(albumObject, actionButtonElement) {
  if (!pluginApplicationState.currentUserAccount) {
    displayToastMessage('Please log in via settings', 'warning');
    return;
  }
  
  const userIdentifier     = pluginApplicationState.currentUserAccount.id;
  const albumIdentifier    = albumObject.identifier;
  const uniqueRecordId     = `like_${userIdentifier}_${albumIdentifier}`;
  const existingLikeRecord = pluginApplicationState.likedGalleryMap.get(albumIdentifier);
  const isCurrentlyLiked   = !!existingLikeRecord;

  if (actionButtonElement) {
    actionButtonElement.classList.toggle('liked', !isCurrentlyLiked);
    actionButtonElement.innerHTML = !isCurrentlyLiked ? ICON_SVG_HEART_FILLED : ICON_SVG_HEART_EMPTY;
  }

  try {
    if (isCurrentlyLiked) {
      await globalDatabaseInstance.collection('likes').remove(existingLikeRecord.id);
      pluginApplicationState.likedGalleryMap.delete(albumIdentifier);
      displayToastMessage('Removed from liked galleries', 'info');
    } else {
      const cachedImagesForAlbum = pluginApplicationState.cachedAlbumImagesMap[albumIdentifier] || [];
      const cachedImageAddresses = cachedImagesForAlbum.map(imageObj => imageObj.address);
      
      const newFavoriteRecord = {
        id:         uniqueRecordId, 
        userId:     userIdentifier, 
        galleryId:  albumIdentifier,
        title:      albumObject.title, 
        thumbnail:  albumObject.thumbnail,
        modelName:  albumObject.modelName || 'Album',
        imageCount: albumObject.imageCount || 0,
        images:     cachedImageAddresses,
        likedAt:    new Date().toISOString()
      };
      
      await globalDatabaseInstance.collection('likes').upsert(uniqueRecordId, newFavoriteRecord);
      pluginApplicationState.likedGalleryMap.set(albumIdentifier, newFavoriteRecord);
      displayToastMessage('Added to liked galleries', 'success');
    }
  } catch (databaseError) {
    if (actionButtonElement) {
      actionButtonElement.classList.toggle('liked', isCurrentlyLiked);
      actionButtonElement.innerHTML = isCurrentlyLiked ? ICON_SVG_HEART_FILLED : ICON_SVG_HEART_EMPTY;
    }
    displayToastMessage('Failed to update gallery favorite', 'error');
  }
}

async function toggleImageFavoriteStatus(imageAddress, imageTitle, actionButtonElement) {
  if (!pluginApplicationState.currentUserAccount) {
    displayToastMessage('Please log in via settings', 'warning');
    return;
  }
  
  const userIdentifier      = pluginApplicationState.currentUserAccount.id;
  const hashedAddressString = generateStringHash(imageAddress);
  const uniqueRecordId      = `imglike_${userIdentifier}_${hashedAddressString}`;
  const existingLikeRecord  = pluginApplicationState.likedImagesMap.get(imageAddress);
  const isCurrentlyLiked    = !!existingLikeRecord;

  if (actionButtonElement) {
    actionButtonElement.classList.toggle('liked', !isCurrentlyLiked);
    actionButtonElement.innerHTML = !isCurrentlyLiked ? ICON_SVG_HEART_FILLED : ICON_SVG_HEART_EMPTY;
  }

  try {
    if (isCurrentlyLiked) {
      await globalDatabaseInstance.collection('imageLikes').remove(existingLikeRecord.id);
      pluginApplicationState.likedImagesMap.delete(imageAddress);
      displayToastMessage('Unliked image successfully', 'info');
    } else {
      const activeGalleryContext = pluginApplicationState.activeAlbumIdentifiers[0] || null;
      
      const newFavoriteRecord = {
        id:        uniqueRecordId, 
        userId:    userIdentifier, 
        imageUrl:  imageAddress,
        title:     imageTitle || 'Image',
        galleryId: activeGalleryContext,
        likedAt:   new Date().toISOString()
      };
      
      await globalDatabaseInstance.collection('imageLikes').upsert(uniqueRecordId, newFavoriteRecord);
      pluginApplicationState.likedImagesMap.set(imageAddress, newFavoriteRecord);
      displayToastMessage('Liked image successfully', 'success');
    }
  } catch (databaseError) {
    if (actionButtonElement) {
      actionButtonElement.classList.toggle('liked', isCurrentlyLiked);
      actionButtonElement.innerHTML = isCurrentlyLiked ? ICON_SVG_HEART_FILLED : ICON_SVG_HEART_EMPTY;
    }
    displayToastMessage('Failed to update image favorite', 'error');
  }
}

// ==================================================================================================== //
// PROFILE MODAL CREATION
// ==================================================================================================== //
function clearElementChildren(parentElement) {
  while (parentElement.firstChild) {
    parentElement.removeChild(parentElement.firstChild);
  }
}

window.openOsosedkiProfileWindow = async function () {
  let modalContainerElement = document.getElementById('ososedki-profile-modal-container');
  
  if (!modalContainerElement) {
    modalContainerElement           = document.createElement('div');
    modalContainerElement.id        = 'ososedki-profile-modal-container';
    modalContainerElement.className = 'ososedki-modal-backdrop-layer';
    document.body.appendChild(modalContainerElement);
    
    modalContainerElement.addEventListener('click', (eventObject) => {
      if (eventObject.target === modalContainerElement) {
        modalContainerElement.style.display = 'none';
      }
    });
  }
  
  modalContainerElement.style.display = 'flex';
  
  const interfaceOverlays = document.querySelectorAll('.settings-overlay, .modal-backdrop, dialog');
  interfaceOverlays.forEach((overlayElement) => {
    if (overlayElement.tagName === 'DIALOG') {
      overlayElement.close();
    } else {
      overlayElement.style.display = 'none';
    }
  });

  window.renderOsosedkiProfileModalData();

  if (!globalDatabaseInstance) {
    await initializeDatabaseConnection();
    window.renderOsosedkiProfileModalData();
  }
}

window.renderOsosedkiProfileModalData = function() {
  const modalContainerElement = document.getElementById('ososedki-profile-modal-container');
  if (!modalContainerElement) {
    return;
  }
  
  clearElementChildren(modalContainerElement);

  const innerWrapperElement     = document.createElement('div');
  innerWrapperElement.className = 'ososedki-modal-inner-wrapper';
  
  const headerContainerElement = buildModalHeaderContainer();
  innerWrapperElement.appendChild(headerContainerElement);

  const isDatabaseLoading = !globalDatabaseInstance && !pluginApplicationState.currentUserAccount;
  if (isDatabaseLoading) {
    innerWrapperElement.appendChild(buildModalLoadingMessage());
    modalContainerElement.appendChild(innerWrapperElement);
    return;
  }

  const isUserUnauthenticated = !pluginApplicationState.currentUserAccount;
  if (isUserUnauthenticated) {
    innerWrapperElement.appendChild(buildModalUnauthenticatedMessage());
    modalContainerElement.appendChild(innerWrapperElement);
    return;
  }

  const controlsContainerElement = buildModalControlsContainer();
  innerWrapperElement.appendChild(controlsContainerElement);

  const contentContainerElement = buildModalContentContainer();
  innerWrapperElement.appendChild(contentContainerElement);
  modalContainerElement.appendChild(innerWrapperElement);
}

function buildModalHeaderContainer() {
  const headerContainerElement = document.createElement('div');
  headerContainerElement.className = 'ososedki-modal-header-section';
  
  const headerTitleElement = document.createElement('h2');
  const accountUsername    = pluginApplicationState.currentUserAccount?.username || 'Profile';
  headerTitleElement.textContent = `${accountUsername}'s Favorites`;
  
  const closeButtonElement       = document.createElement('button');
  closeButtonElement.className   = 'ososedki-modal-close-button';
  closeButtonElement.textContent = '✕';
  closeButtonElement.addEventListener('click', () => {
    const modalContainerElement = document.getElementById('ososedki-profile-modal-container');
    if (modalContainerElement) {
      modalContainerElement.style.display = 'none';
    }
  });
  
  headerContainerElement.appendChild(headerTitleElement);
  headerContainerElement.appendChild(closeButtonElement);
  return headerContainerElement;
}

function buildModalLoadingMessage() {
  const messageContainer     = document.createElement('div');
  messageContainer.className = 'ososedki-modal-message-container';
  
  const loadingTextElement       = document.createElement('p');
  loadingTextElement.className   = 'ososedki-modal-message-text';
  loadingTextElement.textContent = 'Loading database & favorites...';
  
  messageContainer.appendChild(loadingTextElement);
  return messageContainer;
}

function buildModalUnauthenticatedMessage() {
  const messageContainer     = document.createElement('div');
  messageContainer.className = 'ososedki-modal-message-container';
  
  const unauthenticatedTextElement       = document.createElement('p');
  unauthenticatedTextElement.className   = 'ososedki-modal-message-text';
  unauthenticatedTextElement.textContent = 'Please log in via the Settings menu to view your saved favorites.';
  
  messageContainer.appendChild(unauthenticatedTextElement);
  return messageContainer;
}

function buildModalControlsContainer() {
  const controlsContainerElement     = document.createElement('div');
  controlsContainerElement.className = 'ososedki-modal-controls-section';
  
  const tabsContainerElement = document.createElement('div');
  tabsContainerElement.className = 'ososedki-modal-tabs-group';
  
  const totalAlbumsCount = pluginApplicationState.likedGalleryMap.size;
  const totalImagesCount = pluginApplicationState.likedImagesMap.size;
  const activeTabName    = pluginApplicationState.activeProfileTabName;

  const albumsTabButton       = document.createElement('button');
  albumsTabButton.textContent = `Liked Galleries (${totalAlbumsCount})`;
  albumsTabButton.className   = activeTabName === 'albums' ? 'active-tab' : '';
  albumsTabButton.addEventListener('click', () => {
    pluginApplicationState.activeProfileTabName = 'albums';
    window.renderOsosedkiProfileModalData();
  });

  const imagesTabButton       = document.createElement('button');
  imagesTabButton.textContent = `Liked Images (${totalImagesCount})`;
  imagesTabButton.className   = activeTabName === 'images' ? 'active-tab' : '';
  imagesTabButton.addEventListener('click', () => {
    pluginApplicationState.activeProfileTabName = 'images';
    window.renderOsosedkiProfileModalData();
  });
  
  tabsContainerElement.appendChild(albumsTabButton);
  tabsContainerElement.appendChild(imagesTabButton);
  
  const sortContainerElement           = document.createElement('div');
  sortContainerElement.className       = 'ososedki-modal-sort-group';
  sortContainerElement.style.display   = 'flex';
  sortContainerElement.style.gap       = '12px';
  sortContainerElement.style.alignItems = 'center';

  const openAllButtonElement       = document.createElement('button');
  openAllButtonElement.className   = 'ososedki-open-all-button';
  openAllButtonElement.textContent = 'Open All';
  openAllButtonElement.addEventListener('click', () => {
    window.loadAllFavoritesIntoGallery();
  });
  
  const sortSelectElement = document.createElement('select');
  const activeSortKey     = pluginApplicationState.activeProfileSortKey;
  
  const sortOptionsArray = [
    { value: 'liked-new',  label: 'Date Liked (Newest)' },
    { value: 'liked-old',  label: 'Date Liked (Oldest)' },
    { value: 'alpha-asc',  label: 'Title (A-Z)' },
    { value: 'alpha-desc', label: 'Title (Z-A)' },
    { value: 'random',     label: 'Random' }
  ];
  
  sortOptionsArray.forEach((optionData) => {
    const optionElement = document.createElement('option');
    optionElement.value = optionData.value;
    optionElement.textContent = optionData.label;
    if (activeSortKey === optionData.value) {
      optionElement.selected = true;
    }
    sortSelectElement.appendChild(optionElement);
  });
  
  sortSelectElement.addEventListener('change', (eventObject) => {
    pluginApplicationState.activeProfileSortKey = eventObject.target.value;
    window.renderOsosedkiProfileModalData();
  });
  
  sortContainerElement.appendChild(openAllButtonElement);
  sortContainerElement.appendChild(sortSelectElement);
  
  controlsContainerElement.appendChild(tabsContainerElement);
  controlsContainerElement.appendChild(sortContainerElement);
  
  return controlsContainerElement;
}

function buildModalContentContainer() {
  const contentContainerElement     = document.createElement('div');
  contentContainerElement.className = 'ososedki-modal-content-section';
  
  const activeTabName = pluginApplicationState.activeProfileTabName;
  const activeSortKey = pluginApplicationState.activeProfileSortKey;
  
  const proxyInputElement  = document.getElementById('proxyServerAddress');
  const proxyServerAddress = pluginApplicationState.proxyServerAddress || proxyInputElement?.value || 'http://localhost:3000';

  if (activeTabName === 'albums') {
    const rawLikedAlbumsArray = Array.from(pluginApplicationState.likedGalleryMap.values());
    const sortedAlbumsArray   = sortArrayItems(rawLikedAlbumsArray, activeSortKey);
    
    if (sortedAlbumsArray.length === 0) {
      contentContainerElement.appendChild(buildEmptyStateMessage('No liked galleries yet.'));
    } else {
      const gridContainerElement     = document.createElement('div');
      gridContainerElement.className = 'folder-grid active';
      
      sortedAlbumsArray.forEach((albumRecord, itemIndex) => {
        const imageCountTotal = albumRecord.imageCount || (albumRecord.images && albumRecord.images.length) || 0;
        const normalizedAlbum = { 
          identifier: albumRecord.galleryId, 
          title:      albumRecord.title, 
          thumbnail:  albumRecord.thumbnail, 
          imageCount: imageCountTotal, 
          modelName:  albumRecord.modelName || 'Album' 
        };
        const albumCardElement = createAlbumCardElement(normalizedAlbum, itemIndex, proxyServerAddress);
        
        albumCardElement.addEventListener('click', () => {
          const modalContainerElement = document.getElementById('ososedki-profile-modal-container');
          if (modalContainerElement) {
            modalContainerElement.style.display = 'none';
          }
          window.loadOsosedkiGalleryData(proxyServerAddress, normalizedAlbum.identifier, normalizedAlbum.title);
        });
        
        gridContainerElement.appendChild(albumCardElement);
      });
      contentContainerElement.appendChild(gridContainerElement);
    }
  } else {
    const rawLikedImagesArray = Array.from(pluginApplicationState.likedImagesMap.values());
    const sortedImagesArray   = sortArrayItems(rawLikedImagesArray, activeSortKey);
    
    if (sortedImagesArray.length === 0) {
      contentContainerElement.appendChild(buildEmptyStateMessage('No liked images yet.'));
    } else {
      const gridWrapperElement     = document.createElement('div');
      gridWrapperElement.className = 'gallery-grid active';

      const masonryContainerElement     = document.createElement('div');
      masonryContainerElement.className = 'gallery-masonry active';

      sortedImagesArray.forEach((imageRecord) => {
        const normalizedImageObject = { 
          address: imageRecord.imageUrl, 
          title:   imageRecord.title || 'Liked Image' 
        };
        const imageCardElement = createImageCardElement(normalizedImageObject, proxyServerAddress);
        masonryContainerElement.appendChild(imageCardElement);
      });

      gridWrapperElement.appendChild(masonryContainerElement);
      contentContainerElement.appendChild(gridWrapperElement);

      requestAnimationFrame(() => {
        masonryContainerElement.querySelectorAll('.gallery-card').forEach(adjustCardGridSpanProperty);
      });
    }
  }
  
  return contentContainerElement;
}

function buildEmptyStateMessage(messageText) {
  const messageElement       = document.createElement('p');
  messageElement.className   = 'ososedki-empty-state-message';
  messageElement.textContent = messageText;
  return messageElement;
}

// ==================================================================================================== //
// GLOBAL SETTINGS HOOKS
// ==================================================================================================== //
window.executeOsosedkiLogin = async function (usernameInputNode, passwordInputNode) {
  const extractedUsername = (typeof usernameInputNode === 'string' ? usernameInputNode : (usernameInputNode?.value || '')).trim();
  const extractedPassword = (typeof passwordInputNode === 'string' ? passwordInputNode : (passwordInputNode?.value || '')).trim();

  if (!extractedUsername || !extractedPassword) {
    displayToastMessage('Please enter both username and password', 'warning');
    return;
  }

  try {
    displayToastMessage('Logging in...', 'info');
    const databaseInstance = await initializeDatabaseConnection();
    
    if (!databaseInstance || !databaseInstance.auth) {
      throw new Error('Database failed to initialize properly');
    }
    
    const userAccountObject = await databaseInstance.auth.login(extractedUsername, extractedPassword);
    pluginApplicationState.currentUserAccount = userAccountObject;
    await loadUserFavoriteRecords();
    
    displayToastMessage(`Logged in as ${userAccountObject.username}!`, 'success');
    
    const profileModalElement = document.getElementById('ososedki-profile-modal-container');
    if (profileModalElement?.style.display === 'flex') {
      window.renderOsosedkiProfileModalData();
    }
  } catch (authenticationError) {
    displayToastMessage(`Login failed: ${authenticationError.message}`, 'error');
  }
}

window.executeOsosedkiLogout = async function () {
  const databaseInstance = await initializeDatabaseConnection();
  if (databaseInstance && databaseInstance.auth) {
    databaseInstance.auth.logout();
  }
  
  pluginApplicationState.currentUserAccount = null;
  pluginApplicationState.likedGalleryMap.clear();
  pluginApplicationState.likedImagesMap.clear();
  
  displayToastMessage('Logged out successfully', 'info');
  
  const profileModalElement = document.getElementById('ososedki-profile-modal-container');
  if (profileModalElement?.style.display === 'flex') {
    window.renderOsosedkiProfileModalData();
  }
}

// ==================================================================================================== //
// STYLES & DOM OVERRIDES
// ==================================================================================================== //
function injectOsosedkiStylesheets() {
  if (document.getElementById('ososedki-injected-styles')) {
    return;
  }
  const stylesheetElement = document.createElement('style');
  stylesheetElement.id    = 'ososedki-injected-styles';
  stylesheetElement.innerHTML = `
    .ososedki-active-mode .folder-card:not(.ososedki-animated-item) { display: none !important; }
    .ososedki-active-mode .gallery-card:not(.ososedki-animated-item) { display: none !important; }
    .ososedki-active-mode .chip-container .chip:not(.ososedki-animated-item) { display: none !important; }
    
    .ososedki-animated-item { animation: fadeElementIn 0.3s ease; }
    @keyframes fadeElementIn { from { opacity: 0; } to { opacity: 1; } }
    
    .gallery-card {
      background-color: rgb(var(--ctp-surface0-rgb, 49, 50, 68)) !important;
      border: 3px solid rgb(var(--ctp-surface1-rgb, 69, 71, 90)) !important;
      border-radius: 18px !important;
      overflow: hidden !important;
      cursor: pointer !important;
      transition: all 0.2s ease, transform 0.2s cubic-bezier(0.35, 1.55, 0.65, 1) !important;
      box-shadow: 3px 3px 0 rgb(var(--ctp-crust-rgb, 17, 17, 27)) !important;
      position: relative !important;
    }
    .gallery-card img {
      width: 100% !important; height: 100% !important; display: block !important;
      object-fit: cover !important; background-color: rgb(var(--ctp-mantle-rgb, 24, 24, 37)) !important;
    }
    .gallery-card:hover {
      transform: translateY(-2px) !important; border-color: rgb(var(--ctp-mauve-rgb, 203, 166, 247)) !important;
      box-shadow: 1px 1px 0 rgb(var(--ctp-mauve-rgb, 203, 166, 247)), 2px 2px 0 rgb(var(--ctp-mauve-rgb, 203, 166, 247)) !important;
    }
    .gallery-card:active {
      transform: translateY(1px) !important;
      box-shadow: 1px 1px 0 rgb(var(--ctp-mauve-rgb, 203, 166, 247)) !important;
    }

    #ososedki-toast-container {
      position: fixed !important; bottom: 24px !important; left: 50% !important;
      transform: translateX(-50%) !important; z-index: 999999 !important;
      display: flex !important; flex-direction: column !important; gap: 8px !important;
      pointer-events: none !important; align-items: center !important;
    }
    .ososedki-toast {
      background: rgba(30, 30, 46, 0.95) !important; border: 1px solid #45475a !important;
      color: #cdd6f4 !important; padding: 12px 24px !important; border-radius: 12px !important;
      font-family: 'Inter', sans-serif !important; font-size: 14px !important; font-weight: 600 !important;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important; pointer-events: auto !important;
      animation: slideToastIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
      backdrop-filter: blur(12px) !important;
    }
    .ososedki-toast.success { border-left: 4px solid #a6e3a1 !important; }
    .ososedki-toast.error   { border-left: 4px solid #f38ba8 !important; }
    .ososedki-toast.info    { border-left: 4px solid #89b4fa !important; }
    .ososedki-toast.warning { border-left: 4px solid #f9e2af !important; }
    .ososedki-toast.toast-out { opacity: 0 !important; transform: translateY(10px) scale(0.95) !important; transition: all 0.25s ease !important; }
    @keyframes slideToastIn { from { opacity: 0; transform: translateY(16px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .ososedki-modal-backdrop-layer {
      position: fixed !important; inset: 0 !important; background: rgba(17, 17, 27, 0.85) !important;
      backdrop-filter: blur(8px) !important; z-index: 999999 !important;
      display: none; align-items: center !important; justify-content: center !important;
      font-family: 'Inter', -apple-system, sans-serif !important; padding: 20px !important; box-sizing: border-box !important;
    }
    .ososedki-modal-inner-wrapper {
      background: #1e1e2e !important; width: 100% !important; max-width: 1400px !important;
      height: 100% !important; max-height: 90vh !important; border-radius: 16px !important;
      border: 1px solid #45475a !important; display: flex !important; flex-direction: column !important;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important; overflow: hidden !important;
    }
    .ososedki-modal-header-section {
      padding: 20px 24px !important; border-bottom: 1px solid #313244 !important;
      display: flex !important; justify-content: space-between !important; align-items: center !important;
      background: #181825 !important; flex-shrink: 0 !important;
    }
    .ososedki-modal-header-section h2 { margin: 0 !important; color: #cdd6f4 !important; font-size: 1.5rem !important; font-weight: 800 !important; }
    .ososedki-modal-close-button {
      background: transparent !important; border: none !important; color: #a6adc8 !important;
      font-size: 1.5rem !important; cursor: pointer !important; transition: 0.2s !important;
    }
    .ososedki-modal-close-button:hover { color: #f38ba8 !important; transform: scale(1.1) !important; }
    .ososedki-modal-controls-section {
      padding: 16px 24px !important; border-bottom: 1px solid #313244 !important; display: flex !important;
      justify-content: space-between !important; align-items: center !important; flex-wrap: wrap !important;
      gap: 16px !important; background: #1e1e2e !important; flex-shrink: 0 !important;
    }
    .ososedki-modal-tabs-group { display: flex !important; gap: 8px !important; }
    .ososedki-modal-tabs-group button {
      background: transparent !important; border: none !important; color: #a6adc8 !important;
      padding: 8px 16px !important; font-size: 0.95rem !important; font-weight: 700 !important;
      cursor: pointer !important; border-radius: 8px !important; transition: 0.2s !important;
    }
    .ososedki-modal-tabs-group button:hover { background: #313244 !important; color: #cdd6f4 !important; }
    .ososedki-modal-tabs-group button.active-tab { background: #cba6f7 !important; color: #11111b !important; }
    .ososedki-modal-sort-group select {
      background: #313244 !important; border: 1px solid #45475a !important; color: #cdd6f4 !important;
      padding: 8px 12px !important; border-radius: 8px !important; font-family: inherit !important;
      font-weight: 600 !important; font-size: 0.9rem !important; cursor: pointer !important; outline: none !important;
    }
    .ososedki-modal-content-section {
      flex: 1 !important; overflow-y: auto !important; padding: 24px !important; background: #1e1e2e !important;
    }
    .ososedki-modal-message-container {
      display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; gap: 12px;
    }
    .ososedki-modal-message-text {
      color: var(--txt-2, #a6adc8); font-weight: 700; font-size: 1.1rem; text-align: center;
    }
    .ososedki-empty-state-message {
      text-align: center; margin-top: 3rem; color: var(--txt-2, #a6adc8);
    }
    .ososedki-card-like-button {
      position: absolute; top: 8px; left: 8px; z-index: 10; border-radius: 50%; width: 32px; height: 32px;
      border: 1px solid var(--border, #45475a); background: rgba(30, 30, 46, 0.7); 
      color: var(--txt-2, #a6adc8); display: flex; align-items: center; justify-content: center; 
      cursor: pointer; transition: 0.2s;
    }
    .ososedki-card-like-button.liked { color: var(--red, #f38ba8); }
    .ososedki-image-like-button {
      position: absolute; bottom: 8px; left: 8px; z-index: 10; border-radius: 50%; width: 32px; height: 32px;
      border: 1px solid var(--border, #45475a); background: rgba(30, 30, 46, 0.7); 
      color: var(--txt-2, #a6adc8); display: flex; align-items: center; justify-content: center; 
      cursor: pointer; transition: 0.2s;
    }
    .ososedki-image-like-button.liked { color: var(--red, #f38ba8); }
    .ososedki-loader-text {
      padding: 2rem; color: var(--text); grid-column: 1 / -1; text-align: center;
    }
    
    .ososedki-open-all-button {
      background: #89b4fa !important; border: none !important; color: #11111b !important;
      padding: 8px 16px !important; font-size: 0.95rem !important; font-weight: 700 !important;
      cursor: pointer !important; border-radius: 8px !important; transition: 0.2s !important;
    }
    .ososedki-open-all-button:hover {
      background: #b4befe !important; transform: translateY(-2px) !important;
    }
  `;
  document.head.appendChild(stylesheetElement);
}

function clearContainerItems(gridSelectorQuery) {
  const containerElement = document.querySelector(gridSelectorQuery);
  if (!containerElement) {
    return;
  }
  const childElementsArray = containerElement.querySelectorAll(':scope > .ososedki-animated-item');
  childElementsArray.forEach(childNode => childNode.remove());
}

function switchNativeGalleryTab(tabIndexNumber) {
  const targetTabElement = document.querySelectorAll('.nav-pill .tab')[tabIndexNumber];
  if (targetTabElement) {
    targetTabElement.click();
  }
}

function adjustCardGridSpanProperty(cardElementNode) {
  const parentGridContainer = cardElementNode.closest('.gallery-masonry') || document.querySelector('.gallery-masonry');
  const internalImageNode   = cardElementNode.querySelector('img');
  
  if (!parentGridContainer || !internalImageNode?.naturalWidth) {
    return;
  }

  const computedGridStyles   = getComputedStyle(parentGridContainer);
  const parsedRowHeightValue = parseFloat(computedGridStyles.getPropertyValue('grid-auto-rows')) || 1;
  const parsedRowGapValue    = parseFloat(computedGridStyles.getPropertyValue('gap')) || 20;
  const cardBoundingWidth    = cardElementNode.getBoundingClientRect().width || 250;
  
  const widthToHeightRatio     = internalImageNode.naturalHeight / internalImageNode.naturalWidth;
  const scaledImageHeightValue = cardBoundingWidth * widthToHeightRatio;

  const calculatedRowSpanCount = Math.ceil((scaledImageHeightValue + parsedRowGapValue) / (parsedRowHeightValue + parsedRowGapValue));
  cardElementNode.style.gridRowEnd = `span ${calculatedRowSpanCount}`;
}

function sortFolderElementsInDom(sortAttributeKey = 'name', sortDirection = 'up') {
  const gridContainerElement = document.querySelector('.folder-grid');
  if (!gridContainerElement) {
    return;
  }

  const cardElementsArray = [...gridContainerElement.querySelectorAll('.ososedki-folder-card')];
  
  cardElementsArray.sort((firstCardElement, secondCardElement) => {
    let firstCardAttribute  = firstCardElement.dataset[sortAttributeKey] || '';
    let secondCardAttribute = secondCardElement.dataset[sortAttributeKey] || '';

    if (sortAttributeKey === 'size' || sortAttributeKey === 'date') {
      const firstNumericalValue  = parseFloat(firstCardAttribute) || 0;
      const secondNumericalValue = parseFloat(secondCardAttribute) || 0;
      return sortDirection === 'up' 
        ? firstNumericalValue  - secondNumericalValue 
        : secondNumericalValue - firstNumericalValue;
    }

    const textualComparisonResult = String(firstCardAttribute).localeCompare(String(secondCardAttribute), undefined, { numeric: true, sensitivity: 'base' });
    return sortDirection === 'up' ? textualComparisonResult : -textualComparisonResult;
  });

  const documentFragmentNode = document.createDocumentFragment();
  cardElementsArray.forEach(cardNode => documentFragmentNode.appendChild(cardNode));
  gridContainerElement.appendChild(documentFragmentNode);
}

function resetSortPillElementState() {
  const sortOptionElementsArray = document.querySelectorAll('.sort-option');
  
  sortOptionElementsArray.forEach(optionElement => {
    const sortIconElement  = optionElement.querySelector('i');
    const isNameSortOption = optionElement.dataset.sort === 'name';

    optionElement.classList.toggle('active', isNameSortOption);
    if (isNameSortOption) {
      optionElement.dataset.direction = 'up';
    }

    if (sortIconElement) {
      sortIconElement.className = !isNameSortOption && optionElement.dataset.sort === 'type' 
        ? 'fa-solid fa-shuffle' 
        : 'fas fa-arrow-up';
    }
  });

  const currentlyActiveOption = document.querySelector('.sort-option.active');
  const sortSliderElement     = document.querySelector('.sort-slider');
  
  if (currentlyActiveOption && sortSliderElement) {
    sortSliderElement.style.width     = `${currentlyActiveOption.offsetWidth}px`;
    sortSliderElement.style.transform = `translateX(${currentlyActiveOption.offsetLeft}px)`;
  }
}

function setupTextMarqueeEffect(rootContainerElement = document) {
  const folderTitleElementsArray = rootContainerElement.querySelectorAll('.folder-title');
  
  folderTitleElementsArray.forEach((titleElementNode) => {
    const textLabelElement = titleElementNode.querySelector('span');
    if (!textLabelElement) {
      return;
    }

    const titleContainerWidth = titleElementNode.clientWidth || 0;
    const requiresMarqueeEffect = textLabelElement.scrollWidth > titleContainerWidth;

    titleElementNode.classList.toggle('marquee', requiresMarqueeEffect);
    if (requiresMarqueeEffect) {
      titleElementNode.style.setProperty('--marquee-room', `${titleContainerWidth}px`);
    } else {
      titleElementNode.style.removeProperty('--marquee-room');
    }
  });
}

// ==================================================================================================== //
// ALBUM PAGE CHIPS MANAGEMENT
// ==================================================================================================== //
function updateFilterChipElements(newAlbumObjectsArray) {
  const chipContainerElement = document.querySelector('.chip-container');
  if (!chipContainerElement) {
    return;
  }

  for (const albumObjectItem of newAlbumObjectsArray) {
    const albumAlreadyLoaded = pluginApplicationState.loadedAlbumObjects.some(existingAlbum => existingAlbum.identifier === albumObjectItem.identifier);
    if (!albumAlreadyLoaded) {
      pluginApplicationState.loadedAlbumObjects.push(albumObjectItem);
    }
  }

  const allImagesChipHtmlString = `<button class="chip ososedki-animated-item" data-ososedki-folder="all"><span>All Images</span></button>`;
  
  const albumChipsHtmlString = pluginApplicationState.loadedAlbumObjects.map(albumObject => {
    const isAlbumCurrentlyActive = pluginApplicationState.activeAlbumIdentifiers.includes(albumObject.identifier);
    const activeClassString      = isAlbumCurrentlyActive ? 'active' : '';
    return `<button class="chip ${activeClassString} ososedki-animated-item" data-ososedki-folder="${albumObject.identifier}"><span>${albumObject.title}</span></button>`;
  }).join('');

  chipContainerElement.innerHTML = allImagesChipHtmlString + albumChipsHtmlString;
}

function initializeChipsEventListener() {
  const chipContainerElement = document.querySelector('.chip-container');
  if (!chipContainerElement) {
    return;
  }

  chipContainerElement.addEventListener('click', async (eventObject) => {
    const isOsosedkiModeActive = document.body.classList.contains('ososedki-active-mode');
    if (!isOsosedkiModeActive) {
      return;
    }
    
    const clickedChipElement = eventObject.target.closest('[data-ososedki-folder]');
    if (!clickedChipElement) {
      return;
    }

    const targetFolderIdentifier = clickedChipElement.dataset.ososedkiFolder;

    if (targetFolderIdentifier === 'all') {
      const wasCurrentlyActive   = clickedChipElement.classList.contains('active');
      const allChipElementsArray = document.querySelectorAll('.chip-container [data-ososedki-folder]');
      
      allChipElementsArray.forEach(chipNode => chipNode.classList.remove('active'));
      
      if (!wasCurrentlyActive) {
        clickedChipElement.classList.add('active');
      }
      pluginApplicationState.activeAlbumIdentifiers = [];
    } else {
      const allImagesChipElement = document.querySelector('.chip-container [data-ososedki-folder="all"]');
      allImagesChipElement?.classList.remove('active');

      clickedChipElement.classList.toggle('active');

      const activeAlbumChipElements = document.querySelectorAll('.chip-container .chip.active:not([data-ososedki-folder="all"])');
      pluginApplicationState.activeAlbumIdentifiers = [...activeAlbumChipElements].map(chipNode => chipNode.dataset.ososedkiFolder);

      if (pluginApplicationState.activeAlbumIdentifiers.length === 0) {
        allImagesChipElement?.classList.add('active');
      }
    }

    await fetchAndRenderImagesForSelectedAlbums();
  });
}

// ==================================================================================================== //
// LOAD IMAGES FOR SELECTED ALBUMS & OPEN ALL FAVORITES
// ==================================================================================================== //
function shuffleImageObjectsArray(imageObjectsArray) {
  for (let currentIndex = imageObjectsArray.length - 1; currentIndex > 0; currentIndex--) {
    const randomSwapIndex     = Math.floor(Math.random() * (currentIndex + 1));
    const temporaryStoredItem = imageObjectsArray[currentIndex];
    imageObjectsArray[currentIndex]    = imageObjectsArray[randomSwapIndex];
    imageObjectsArray[randomSwapIndex] = temporaryStoredItem;
  }
}

function sortImageObjectsArray(imageObjectsArray) {
  if (!pluginApplicationState.isGallerySortApplied) {
    imageObjectsArray.sort((firstImage, secondImage) => firstImage.originalIndex - secondImage.originalIndex);
    return;
  }

  const activeSortOptionElement = document.querySelector('.sort-option.active');
  const sortAttributeKey        = activeSortOptionElement?.dataset.sort ?? 'name';
  const sortDirectionValue      = activeSortOptionElement?.dataset.direction ?? 'up';

  if (sortAttributeKey === 'type') {
    shuffleImageObjectsArray(imageObjectsArray);
    return;
  }

  imageObjectsArray.sort((firstImage, secondImage) => {
    let firstComparisonValue;
    let secondComparisonValue;
    
    if (sortAttributeKey === 'name') {
      const firstFileNameString  = firstImage.address.split('/').pop().split('?')[0];
      const secondFileNameString = secondImage.address.split('/').pop().split('?')[0];
      firstComparisonValue  = `${firstImage.title}_${firstFileNameString}`;
      secondComparisonValue = `${secondImage.title}_${secondFileNameString}`;
    } else if (sortAttributeKey === 'size') {
      firstComparisonValue  = firstImage.address.split('/').pop().split('?')[0];
      secondComparisonValue = secondImage.address.split('/').pop().split('?')[0];
    } else {
      firstComparisonValue  = firstImage.originalIndex;
      secondComparisonValue = secondImage.originalIndex;
    }

    const areBothNumbers            = typeof firstComparisonValue === 'number' && typeof secondComparisonValue === 'number';
    const numericalComparisonResult = areBothNumbers
      ? firstComparisonValue - secondComparisonValue
      : String(firstComparisonValue).localeCompare(String(secondComparisonValue), undefined, { numeric: true, sensitivity: 'base' });

    return sortDirectionValue === 'up' ? numericalComparisonResult : -numericalComparisonResult;
  });
}

function createImageCardElement(imageObjectData, overrideProxyServerAddress = null) {
  const imageCardContainerElement     = document.createElement('div');
  imageCardContainerElement.className = 'gallery-card ososedki-animated-item';
  imageCardContainerElement.style.setProperty('--accent', 'var(--ctp-mauve-rgb)');
  imageCardContainerElement.style.contentVisibility    = 'auto';
  imageCardContainerElement.style.containIntrinsicSize = '200px 300px';
  imageCardContainerElement.style.position             = 'relative';

  imageCardContainerElement.setAttribute('data-name',        imageObjectData.address);
  imageCardContainerElement.setAttribute('data-folder-name', imageObjectData.title);

  const isImageCurrentlyLiked = pluginApplicationState.likedImagesMap.has(imageObjectData.address);
  const likeActionElement     = document.createElement('button');
  
  const baseButtonClasses = `ososedki-image-like-button ${isImageCurrentlyLiked ? 'liked' : ''}`;
  likeActionElement.className = baseButtonClasses;
  likeActionElement.innerHTML = isImageCurrentlyLiked ? ICON_SVG_HEART_FILLED : ICON_SVG_HEART_EMPTY;
  likeActionElement.title     = 'Like image';

  likeActionElement.addEventListener('click', (eventObject) => {
    eventObject.stopPropagation();
    toggleImageFavoriteStatus(imageObjectData.address, imageObjectData.title, likeActionElement);
  });

  const actualImageElement    = document.createElement('img');
  actualImageElement.loading  = 'lazy';
  actualImageElement.decoding = 'async';
  actualImageElement.alt      = imageObjectData.title;
  
  const finalProxyAddress = overrideProxyServerAddress || pluginApplicationState.proxyServerAddress;
  actualImageElement.src  = generateProxyAddress(imageObjectData.address, finalProxyAddress);
  
  actualImageElement.onload = () => {
    adjustCardGridSpanProperty(imageCardContainerElement);
  };

  if (actualImageElement.complete && actualImageElement.naturalWidth) {
    setTimeout(() => adjustCardGridSpanProperty(imageCardContainerElement), 10);
  }

  imageCardContainerElement.appendChild(actualImageElement);
  imageCardContainerElement.appendChild(likeActionElement);
  
  return imageCardContainerElement;
}

window.loadAllFavoritesIntoGallery = async function() {
  const modalContainerElement = document.getElementById('ososedki-profile-modal-container');
  if (modalContainerElement) {
    modalContainerElement.style.display = 'none';
  }

  document.body.classList.add('ososedki-active-mode');
  switchNativeGalleryTab(1);

  const proxyInputElement  = document.getElementById('proxyServerAddress');
  const proxyServerAddress = pluginApplicationState.proxyServerAddress || proxyInputElement?.value || 'http://localhost:3000';

  pluginApplicationState.activeAlbumIdentifiers = ['favorites_all_virtual_album'];
  pluginApplicationState.proxyServerAddress     = proxyServerAddress;
  pluginApplicationState.isGallerySortApplied   = false;
  
  const favoritesPseudoAlbum = { 
    identifier: 'favorites_all_virtual_album', 
    title:      'All Favorites' 
  };
  
  const isAlreadyLoaded = pluginApplicationState.loadedAlbumObjects.some(albumObject => albumObject.identifier === 'favorites_all_virtual_album');
  if (!isAlreadyLoaded) {
    pluginApplicationState.loadedAlbumObjects.push(favoritesPseudoAlbum);
  }

  updateFilterChipElements([]);

  const masonryGridContainerElement = document.querySelector('.gallery-masonry');
  if (masonryGridContainerElement) {
    clearContainerItems('.gallery-masonry');
    const loadingIndicatorElement       = document.createElement('p');
    loadingIndicatorElement.className   = 'ososedki-animated-item ososedki-loader-text';
    loadingIndicatorElement.textContent = 'Fetching and compiling all favorite images...';
    masonryGridContainerElement.appendChild(loadingIndicatorElement);
  }

  const networkClientInstance = new OsosedkiNetworkClient(proxyServerAddress);

  const galleryPromisesArray = Array.from(pluginApplicationState.likedGalleryMap.values()).map(async (galleryRecord) => {
    let galleryImagesArray = pluginApplicationState.cachedAlbumImagesMap[galleryRecord.galleryId];
    if (!galleryImagesArray) {
      try {
         galleryImagesArray = await networkClientInstance.fetchGalleryImageCollection(galleryRecord.galleryId);
         pluginApplicationState.cachedAlbumImagesMap[galleryRecord.galleryId] = galleryImagesArray;
      } catch (networkError) {
         console.error(`Failed to fetch images for ${galleryRecord.galleryId}`, networkError);
         galleryImagesArray = [];
      }
    }
    return galleryImagesArray.map(imageObject => ({ 
      address: imageObject.address, 
      title:   galleryRecord.title 
    }));
  });

  const resolvedGalleriesDataArray = await Promise.all(galleryPromisesArray);
  const combinedImagesArray        = resolvedGalleriesDataArray.flat();

  const individualLikedImagesArray = Array.from(pluginApplicationState.likedImagesMap.values()).map(imageRecord => ({
    address: imageRecord.imageUrl,
    title:   imageRecord.title || 'Liked Image'
  }));

  combinedImagesArray.push(...individualLikedImagesArray);

  const uniqueImagesMap = new Map();
  combinedImagesArray.forEach(imageObjectData => {
    if (!uniqueImagesMap.has(imageObjectData.address)) {
      uniqueImagesMap.set(imageObjectData.address, imageObjectData);
    }
  });
  
  pluginApplicationState.cachedAlbumImagesMap['favorites_all_virtual_album'] = Array.from(uniqueImagesMap.values());
  
  await fetchAndRenderImagesForSelectedAlbums();
};

async function fetchAndRenderImagesForSelectedAlbums() {
  const masonryGridContainerElement = document.querySelector('.gallery-masonry');
  if (!masonryGridContainerElement) {
    return;
  }

  clearContainerItems('.gallery-masonry');

  const allImagesChipElement = document.querySelector('.chip-container [data-ososedki-folder="all"]');
  const isAllAlbumsActive    = allImagesChipElement?.classList.contains('active') ?? false;

  const targetAlbumsToLoadArray = isAllAlbumsActive
    ? [...pluginApplicationState.loadedAlbumObjects]
    : pluginApplicationState.loadedAlbumObjects.filter(albumObject => pluginApplicationState.activeAlbumIdentifiers.includes(albumObject.identifier));

  const imageCountLabelElement = document.querySelector('.image-count');
  if (imageCountLabelElement) {
    imageCountLabelElement.innerText = 'Loading images...';
  }

  if (targetAlbumsToLoadArray.length === 0) {
    if (imageCountLabelElement) {
      imageCountLabelElement.innerText = '0 Images';
    }
    return;
  }

  const loadingIndicatorElement       = document.createElement('p');
  loadingIndicatorElement.className   = 'ososedki-animated-item ososedki-loader-text';
  loadingIndicatorElement.textContent = 'Loading photos for selected galleries...';
  masonryGridContainerElement.appendChild(loadingIndicatorElement);

  const networkClientInstance = new OsosedkiNetworkClient(pluginApplicationState.proxyServerAddress);

  const fetchImagesForSingleAlbum = async (albumObjectContext) => {
    if (albumObjectContext.identifier === 'favorites_all_virtual_album') {
      return pluginApplicationState.cachedAlbumImagesMap['favorites_all_virtual_album'] || [];
    }

    const cachedImagesArray = pluginApplicationState.cachedAlbumImagesMap[albumObjectContext.identifier];
    if (cachedImagesArray) {
      return cachedImagesArray;
    }
    try {
      const fetchedImagesArray = await networkClientInstance.fetchGalleryImageCollection(albumObjectContext.identifier);
      pluginApplicationState.cachedAlbumImagesMap[albumObjectContext.identifier] = fetchedImagesArray;
      return fetchedImagesArray;
    } catch (networkError) {
      console.error(`Error fetching images for ${albumObjectContext.identifier}:`, networkError);
      return [];
    }
  };

  await Promise.all(targetAlbumsToLoadArray.map(fetchImagesForSingleAlbum));
  clearContainerItems('.gallery-masonry');

  const compiledImagesArray = targetAlbumsToLoadArray.flatMap(albumObjectContext => {
    const albumImagesArray = pluginApplicationState.cachedAlbumImagesMap[albumObjectContext.identifier] ?? [];
    return albumImagesArray.map(imageObjectData => ({ 
      address: imageObjectData.address, 
      title:   imageObjectData.title || albumObjectContext.title 
    }));
  });
  
  compiledImagesArray.forEach((imageObjectData, elementIndex) => { 
    imageObjectData.originalIndex = elementIndex;
  });

  sortImageObjectsArray(compiledImagesArray);

  if (imageCountLabelElement) {
    imageCountLabelElement.innerText = `${compiledImagesArray.length} Images`;
  }

  const imagesDocumentFragment = document.createDocumentFragment();
  for (const imageObjectData of compiledImagesArray) {
    const imageCardElement = createImageCardElement(imageObjectData);
    imagesDocumentFragment.appendChild(imageCardElement);
  }
  masonryGridContainerElement.appendChild(imagesDocumentFragment);
}

// ==================================================================================================== //
// SCRAPER CORE EXECUTIONS
// ==================================================================================================== //
window.executeOsosedkiTestScraper = async function (proxyServerAddress) {
  if (!proxyServerAddress) {
    alert('Please enter a Proxy URL.');
    return;
  }
  try {
    const networkClientInstance = new OsosedkiNetworkClient(proxyServerAddress);
    await networkClientInstance.fetchHomeAlbumsListing(1);
    alert('Scraper Test Successful!\nSuccessfully connected to Ososedki via the proxy.');
  } catch (networkError) {
    alert('Scraper Test Failed:\n' + networkError.message);
  }
}

window.revertToLocalGalleryEnvironment = function () {
  window.location.reload();
}

function createAlbumCardElement(albumObjectData, cardIndexNumber, proxyServerAddress) {
  const albumCardContainerElement        = document.createElement('div');
  albumCardContainerElement.className    = 'folder-card ososedki-folder-card ososedki-animated-item';
  albumCardContainerElement.dataset.name = albumObjectData.title;
  albumCardContainerElement.dataset.size = albumObjectData.imageCount;
  albumCardContainerElement.dataset.date = Date.now() - (pluginApplicationState.loadedAlbumObjects.length + cardIndexNumber) * 1000;
  albumCardContainerElement.style.setProperty('--accent', 'var(--ctp-mauve-rgb)');
  
  const isAlbumCurrentlyLiked = pluginApplicationState.likedGalleryMap.has(albumObjectData.identifier);

  const folderTabElement           = document.createElement('div');
  folderTabElement.className       = 'folder-tab';
  const fileCountSpanElement       = document.createElement('span');
  fileCountSpanElement.className   = 'file-count';
  fileCountSpanElement.textContent = `${albumObjectData.imageCount} Photos`;
  folderTabElement.appendChild(fileCountSpanElement);

  const folderBodyElement     = document.createElement('div');
  folderBodyElement.className = 'folder-body';

  const folderPreviewElement          = document.createElement('div');
  folderPreviewElement.className      = 'folder-preview';
  folderPreviewElement.style.position = 'relative';

  const likeActionElement     = document.createElement('button');
  const baseButtonClasses     = `ososedki-card-like-button ${isAlbumCurrentlyLiked ? 'liked' : ''}`;
  likeActionElement.className = baseButtonClasses;
  likeActionElement.innerHTML = isAlbumCurrentlyLiked ? ICON_SVG_HEART_FILLED : ICON_SVG_HEART_EMPTY;
  
  likeActionElement.addEventListener('click', (eventObject) => {
    eventObject.stopPropagation();
    toggleAlbumFavoriteStatus(albumObjectData, likeActionElement);
  });

  const previewImageElement           = document.createElement('img');
  previewImageElement.src             = generateProxyAddress(albumObjectData.thumbnail, proxyServerAddress);
  previewImageElement.loading         = 'lazy';
  previewImageElement.style.objectFit = 'cover';
  previewImageElement.style.width     = '100%';
  previewImageElement.style.height    = '100%';

  folderPreviewElement.appendChild(likeActionElement);
  folderPreviewElement.appendChild(previewImageElement);

  const folderInfoElement     = document.createElement('div');
  folderInfoElement.className = 'folder-info';

  const folderTitleElement     = document.createElement('h3');
  folderTitleElement.className = 'folder-title';
  const titleSpanElement       = document.createElement('span');
  titleSpanElement.textContent = albumObjectData.title;
  folderTitleElement.appendChild(titleSpanElement);

  const folderSizeElement       = document.createElement('span');
  folderSizeElement.className   = 'folder-size';
  folderSizeElement.textContent = albumObjectData.modelName || 'Album';

  folderInfoElement.appendChild(folderTitleElement);
  folderInfoElement.appendChild(folderSizeElement);

  folderBodyElement.appendChild(folderPreviewElement);
  folderBodyElement.appendChild(folderInfoElement);

  albumCardContainerElement.appendChild(folderTabElement);
  albumCardContainerElement.appendChild(folderBodyElement);

  albumCardContainerElement.addEventListener('click', () => {
    window.loadOsosedkiGalleryData(proxyServerAddress, albumObjectData.identifier, albumObjectData.title);
  });
  
  return albumCardContainerElement;
}

function renderAlbumCards(albumObjectsArray, proxyServerAddress) {
  const gridContainerElement = document.querySelector('.folder-grid');
  if (!gridContainerElement) {
    return;
  }

  if (albumObjectsArray.length === 0 && pluginApplicationState.currentPageNumber === 1) {
    const emptyStateElement       = document.createElement('p');
    emptyStateElement.className   = 'ososedki-animated-item ososedki-loader-text';
    emptyStateElement.textContent = 'No albums found.';
    gridContainerElement.appendChild(emptyStateElement);
    return;
  }

  const documentFragmentNode = document.createDocumentFragment();
  albumObjectsArray.forEach((albumObjectData, cardIndexNumber) => {
    const cardElementNode = createAlbumCardElement(albumObjectData, cardIndexNumber, proxyServerAddress);
    documentFragmentNode.appendChild(cardElementNode);
  });
  
  gridContainerElement.appendChild(documentFragmentNode);
  requestAnimationFrame(() => setupTextMarqueeEffect(gridContainerElement));
}

async function executeAlbumQueryRequest(proxyServerAddress, searchQueryString = '') {
  if (!proxyServerAddress) {
    alert('Proxy URL required.');
    return;
  }

  document.body.classList.add('ososedki-active-mode');
  switchNativeGalleryTab(0);
  clearContainerItems('.folder-grid');
  resetApplicationState(proxyServerAddress, searchQueryString);

  const gridContainerElement       = document.querySelector('.folder-grid');
  const loaderMessageElement       = document.createElement('p');
  loaderMessageElement.className   = 'ososedki-animated-item ososedki-loader-text';
  loaderMessageElement.textContent = searchQueryString ? `Searching for "${searchQueryString}"...` : 'Loading Web Folders...';
  gridContainerElement.appendChild(loaderMessageElement);

  try {
    const networkClientInstance = new OsosedkiNetworkClient(proxyServerAddress);
    const serverResponseData    = searchQueryString 
      ? await networkClientInstance.searchAlbumsListing(searchQueryString, 1) 
      : await networkClientInstance.fetchHomeAlbumsListing(1);
      
    clearContainerItems('.folder-grid');
    renderAlbumCards(serverResponseData.albums, proxyServerAddress);
    
    pluginApplicationState.hasMoreAlbumsAvailable = serverResponseData.hasMore;
    updateFilterChipElements(serverResponseData.albums);
  } catch (networkError) {
    clearContainerItems('.folder-grid');
    const errorMessageElement       = document.createElement('p');
    errorMessageElement.className   = 'ososedki-animated-item ososedki-loader-text';
    errorMessageElement.style.color = 'var(--red)';
    errorMessageElement.textContent = `Error: ${networkError.message}`;
    gridContainerElement.appendChild(errorMessageElement);
  }
}

window.loadOsosedkiHomeAlbums = function (proxyServerAddressArgument) {
  const proxyInputElement  = document.getElementById('proxyServerAddress');
  const proxyServerAddress = typeof proxyServerAddressArgument === 'string' 
    ? proxyServerAddressArgument 
    : (proxyServerAddressArgument?.value || proxyInputElement?.value || 'http://localhost:3000');
    
  executeAlbumQueryRequest(proxyServerAddress);
}

window.loadOsosedkiSearchListing = function (proxyServerAddressArgument, searchQueryString) {
  const proxyInputElement  = document.getElementById('proxyServerAddress');
  const proxyServerAddress = typeof proxyServerAddressArgument === 'string' 
    ? proxyServerAddressArgument 
    : (proxyServerAddressArgument?.value || proxyInputElement?.value || 'http://localhost:3000');
    
  if (!searchQueryString) {
    return window.loadOsosedkiHomeAlbums(proxyServerAddress);
  }
  return executeAlbumQueryRequest(proxyServerAddress, searchQueryString);
}

window.loadOsosedkiGalleryData = async function (proxyServerAddress, albumIdentifierString, albumTitleString) {
  document.body.classList.add('ososedki-active-mode');
  switchNativeGalleryTab(1);

  pluginApplicationState.activeAlbumIdentifiers = [albumIdentifierString];
  pluginApplicationState.proxyServerAddress     = proxyServerAddress;
  pluginApplicationState.isGallerySortApplied   = false;

  const isAlbumAlreadyLoaded = pluginApplicationState.loadedAlbumObjects.some(albumObject => albumObject.identifier === albumIdentifierString);
  if (!isAlbumAlreadyLoaded) {
    pluginApplicationState.loadedAlbumObjects.push({ 
      identifier: albumIdentifierString, 
      title:      albumTitleString 
    });
  }

  updateFilterChipElements([]);
  await fetchAndRenderImagesForSelectedAlbums();
}

// ==================================================================================================== //
// INFINITE SCROLL, SORT, SEARCH, & FILTERING
// ==================================================================================================== //
async function fetchNextPageOfAlbums() {
  pluginApplicationState.isCurrentlyLoading = true;
  const targetNextPageNumber = pluginApplicationState.currentPageNumber + 1;

  const gridContainerElement       = document.querySelector('.folder-grid');
  const loadingIndicatorNode       = document.createElement('p');
  loadingIndicatorNode.className   = 'ososedki-animated-item ososedki-loader-text';
  loadingIndicatorNode.textContent = 'Loading more web folders...';
  gridContainerElement.appendChild(loadingIndicatorNode);

  try {
    const networkClientInstance = new OsosedkiNetworkClient(pluginApplicationState.proxyServerAddress);
    const currentSearchQuery    = pluginApplicationState.currentSearchQuery;
    
    const serverResponseData = currentSearchQuery
      ? await networkClientInstance.searchAlbumsListing(currentSearchQuery, targetNextPageNumber)
      : await networkClientInstance.fetchHomeAlbumsListing(targetNextPageNumber);

    loadingIndicatorNode.remove();

    if (serverResponseData.albums?.length > 0) {
      renderAlbumCards(serverResponseData.albums, pluginApplicationState.proxyServerAddress);
      pluginApplicationState.currentPageNumber = targetNextPageNumber;
      updateFilterChipElements(serverResponseData.albums);
    }
    pluginApplicationState.hasMoreAlbumsAvailable = serverResponseData.hasMore;
  } catch (networkError) {
    loadingIndicatorNode.textContent = `Error loading more: ${networkError.message}`;
    setTimeout(() => loadingIndicatorNode.remove(), 3000);
  } finally {
    pluginApplicationState.isCurrentlyLoading = false;
  }
}

function executeLocalGallerySearchFilter(searchQueryString) {
  const masonryGridContainerElement = document.querySelector('.gallery-masonry');
  if (!masonryGridContainerElement) {
    return;
  }

  const normalizedSearchQuery = searchQueryString.trim().toLowerCase();
  const galleryCardElementsArray = masonryGridContainerElement.querySelectorAll('.gallery-card.ososedki-animated-item');
  
  galleryCardElementsArray.forEach(cardElementNode => {
    const imageNameString   = cardElementNode.getAttribute('data-name')?.toLowerCase()        ?? '';
    const folderNameString  = cardElementNode.getAttribute('data-folder-name')?.toLowerCase() ?? '';
    const cardMatchesQuery  = !normalizedSearchQuery || imageNameString.includes(normalizedSearchQuery) || folderNameString.includes(normalizedSearchQuery);
    cardElementNode.style.display = cardMatchesQuery ? '' : 'none';
  });

  const specificChipElementsArray = document.querySelectorAll('.chip-container .chip.ososedki-animated-item:not([data-ososedki-folder="all"])');
  specificChipElementsArray.forEach(chipElementNode => {
    const folderIdentifierString = chipElementNode.dataset.ososedkiFolder;
    const associatedAlbumObject  = pluginApplicationState.loadedAlbumObjects.find(album => album.identifier === folderIdentifierString);
    const albumTitleString       = associatedAlbumObject ? associatedAlbumObject.title.toLowerCase() : '';

    const associatedImagesArray  = pluginApplicationState.cachedAlbumImagesMap[folderIdentifierString] || [];
    const hasMatchingImagesCheck = !normalizedSearchQuery || albumTitleString.includes(normalizedSearchQuery) ||
      associatedImagesArray.some(imageObj => imageObj.address.toLowerCase().includes(normalizedSearchQuery));

    chipElementNode.style.display = hasMatchingImagesCheck ? '' : 'none';
  });

  const allImagesChipElement = document.querySelector('.chip-container .chip[data-ososedki-folder="all"]');
  if (allImagesChipElement) {
    allImagesChipElement.style.display = '';
  }

  const visibleCardCount       = [...galleryCardElementsArray].filter(cardNode => cardNode.style.display !== 'none').length;
  const imageCountLabelElement = document.querySelector('.image-count');
  
  if (imageCountLabelElement) {
    imageCountLabelElement.innerText = `${visibleCardCount} Images`;
  }

  galleryCardElementsArray.forEach(cardElementNode => {
    if (cardElementNode.style.display !== 'none') {
      adjustCardGridSpanProperty(cardElementNode);
    }
  });
}

function checkIfGalleryTabIsCurrentlyActive() {
  const galleryGridElement = document.querySelector('.gallery-grid');
  return galleryGridElement?.classList.contains('active') ?? false;
}

function initializeScrollEventListener() {
  const mainContentPanelElement = document.querySelector('.content');
  if (!mainContentPanelElement) {
    return;
  }

  mainContentPanelElement.addEventListener('scroll', () => {
    const isOsosedkiModeActive = document.body.classList.contains('ososedki-active-mode');
    if (!isOsosedkiModeActive) {
      return;
    }

    const foldersGridPanelElement = document.querySelector('.folder-grid');
    if (!foldersGridPanelElement?.classList.contains('active')) {
      return;
    }

    const scrollThresholdReached = mainContentPanelElement.scrollHeight - mainContentPanelElement.scrollTop - mainContentPanelElement.clientHeight < 800;
    const isReadyToLoadMore      = scrollThresholdReached && !pluginApplicationState.isCurrentlyLoading && pluginApplicationState.hasMoreAlbumsAvailable;
    
    if (isReadyToLoadMore) {
      fetchNextPageOfAlbums();
    }
  }, { passive: true });
}

function initializeSortPillEventListener() {
  const sortPillContainerElement = document.querySelector('.sort-pill');
  if (!sortPillContainerElement) {
    return;
  }

  sortPillContainerElement.addEventListener('click', (eventObject) => {
    const isOsosedkiModeActive = document.body.classList.contains('ososedki-active-mode');
    if (!isOsosedkiModeActive) {
      return;
    }
    
    const clickedSortOptionElement = eventObject.target.closest('.sort-option');
    if (!clickedSortOptionElement) {
      return;
    }

    const isGalleryTabActive = checkIfGalleryTabIsCurrentlyActive();
    if (isGalleryTabActive) {
      pluginApplicationState.isGallerySortApplied = true;
    }

    setTimeout(async () => {
      if (isGalleryTabActive) {
        await fetchAndRenderImagesForSelectedAlbums();
      }
    }, 50);
  });
}

function initializeTabSwitchEventListener() {
  const navigationTabElementsArray = document.querySelectorAll('.nav-pill .tab');
  
  navigationTabElementsArray.forEach((tabElementNode, tabIndexNumber) => {
    tabElementNode.addEventListener('click', () => {
      const isOsosedkiModeActive = document.body.classList.contains('ososedki-active-mode');
      if (!isOsosedkiModeActive) {
        return;
      }

      const isFoldersTabSelected = tabIndexNumber === 0;

      const folderCardElementsArray = document.querySelectorAll('.ososedki-folder-card');
      folderCardElementsArray.forEach(cardElementNode => {
        cardElementNode.classList.toggle('folder-card', isFoldersTabSelected);
      });

      const searchInputElement = document.querySelector('.search-input');
      if (searchInputElement) {
        searchInputElement.value = '';
      }

      resetSortPillElementState();
      pluginApplicationState.isGallerySortApplied = false;

      if (isFoldersTabSelected) {
        sortFolderElementsInDom('date', 'down');
      }

      if (tabIndexNumber === 1) {
        setTimeout(async () => {
          const masonryGridElement = document.querySelector('.gallery-masonry');
          const hasNoLoadedImages  = masonryGridElement && !masonryGridElement.querySelector('.ososedki-animated-item');
          const isReadyToFetchData = hasNoLoadedImages  && !pluginApplicationState.isCurrentlyLoading;
          
          if (isReadyToFetchData) {
            await fetchAndRenderImagesForSelectedAlbums();
          }
        }, 150);
      }
    });
  });
}

function initializeSearchInputEventListener() {
  const searchInputElement  = document.querySelector('.search-input');
  const searchSubmitElement = document.querySelector('.search-submit');
  if (!searchInputElement) {
    return;
  }

  const checkIfSearchIsHijacked = () => document.body.classList.contains('ososedki-active-mode');

  const executePluginSearchFunction = () => {
    const sanitizedSearchQuery = searchInputElement.value.trim().toLowerCase();

    if (checkIfGalleryTabIsCurrentlyActive()) {
      executeLocalGallerySearchFilter(sanitizedSearchQuery);
      return;
    }

    const proxyInputElement  = document.getElementById('proxyServerAddress');
    const proxyServerAddress = proxyInputElement?.value || 'http://localhost:3000';

    if (sanitizedSearchQuery) {
      if (sanitizedSearchQuery.length < 2) {
        return;
      }
      window.loadOsosedkiSearchListing(proxyServerAddress, sanitizedSearchQuery);
    } else {
      window.loadOsosedkiHomeAlbums(proxyServerAddress);
    }
  };

  searchInputElement.addEventListener('input', () => {
    if (!checkIfSearchIsHijacked()) {
      return;
    }

    const sanitizedSearchQuery = searchInputElement.value.trim().toLowerCase();

    if (checkIfGalleryTabIsCurrentlyActive()) {
      const galleryMasonryElement = document.querySelector('.gallery-masonry');
      const hasNoLoadedImages     = !galleryMasonryElement?.querySelector('.ososedki-animated-item');

      if (sanitizedSearchQuery === '' && hasNoLoadedImages && !pluginApplicationState.isCurrentlyLoading) {
        fetchAndRenderImagesForSelectedAlbums();
      } else {
        executeLocalGallerySearchFilter(sanitizedSearchQuery);
      }
    } else if (sanitizedSearchQuery === '') {
      executePluginSearchFunction();
    }
  });

  searchInputElement.addEventListener('keydown', (eventObject) => {
    if (!checkIfSearchIsHijacked() || eventObject.key !== 'Enter') {
      return;
    }
    eventObject.stopImmediatePropagation();
    eventObject.preventDefault();
    executePluginSearchFunction();
  }, true);

  if (searchSubmitElement) {
    searchSubmitElement.addEventListener('click', (eventObject) => {
      if (!checkIfSearchIsHijacked()) {
        return;
      }
      eventObject.stopImmediatePropagation();
      eventObject.preventDefault();
      executePluginSearchFunction();
    }, true);
  }
}

// ==================================================================================================== //
// PLUGIN INITIALIZATION
// ==================================================================================================== //
function initializeOsosedkiPluginHooks() {
  injectOsosedkiStylesheets();
  initializeChipsEventListener();
  initializeScrollEventListener();
  initializeSortPillEventListener();
  initializeTabSwitchEventListener();
  initializeSearchInputEventListener();
  
  initializeDatabaseConnection();

  window.addEventListener('resize', () => {
    setupTextMarqueeEffect(document);
  });
}

initializeOsosedkiPluginHooks();
