// ==================================================================================================== //
// PAWCHIVE GALLERY PLUGIN & INTEGRATED API
// ==================================================================================================== //
class Pawchive {
  constructor(configurationOptions = {}) {
    this.apiBaseUrl        = configurationOptions.apiBaseUrl        || 'https://pawchive.pw/api/v1'
    this.mainBaseUrl       = configurationOptions.mainBaseUrl       || 'https://pawchive.pw'
    this.mediaBaseUrl      = (configurationOptions.mediaBaseUrl     || 'https://file.pawchive.pw/data').replace(/\/$/, '')
    this.thumbnailBaseUrl  = (configurationOptions.thumbnailBaseUrl || 'https://img.pawchive.pw/thumbnail/data').replace(/\/$/, '')
    this.creatorGroups     = []
    this.isInitialized     = false
  }

  async initialize() {
    const fetchResponse = await fetch(`${this.apiBaseUrl}/creators`, {
      headers: { 'Accept': 'application/json' }
    })
    if (!fetchResponse.ok) {
      throw new Error(`Failed to load creators: ${fetchResponse.status}`)
    }
    const rawCreatorsData = await fetchResponse.json()

    const creatorDictionary = {}
    rawCreatorsData.forEach((creatorItem) => {
      const normalizedName = creatorItem.name.toLowerCase().trim()
      if (!creatorDictionary[normalizedName]) {
        creatorDictionary[normalizedName] = {
          name                : creatorItem.name,
          maximumFavoriteCount: 0,
          profiles            : []
        }
      }
      const favoriteCount = parseInt(creatorItem.favorited) || 0
      const profileObject = {
        name             : creatorItem.name,
        service          : creatorItem.service,
        identifier       : creatorItem.id,
        favoriteCount    : favoriteCount,
        profilePictureUrl: `${this.mainBaseUrl}/icons/${creatorItem.service}/${creatorItem.id}`,
        bannerUrl        : `${this.mainBaseUrl}/banners/${creatorItem.service}/${creatorItem.id}`
      }
      creatorDictionary[normalizedName].profiles.push(profileObject)
      if (favoriteCount > creatorDictionary[normalizedName].maximumFavoriteCount) {
        creatorDictionary[normalizedName].maximumFavoriteCount = favoriteCount
      }
    })

    this.creatorGroups = Object.values(creatorDictionary).map((groupItem) => {
      groupItem.profiles.sort((firstProfile, secondProfile) => {
        return secondProfile.favoriteCount - firstProfile.favoriteCount
      })
      return groupItem
    }).sort((firstGroup, secondGroup) => {
      return secondGroup.maximumFavoriteCount - firstGroup.maximumFavoriteCount
    })

    this.isInitialized = true
    return this.creatorGroups
  }

  searchCreators(searchQuery = '', searchLimit = 50, searchOffset = 0) {
    if (!this.isInitialized) {
      throw new Error('Client not initialized. Call initialize() first.')
    }
    const normalizedQuery = searchQuery.toLowerCase().trim()
    let matchingGroups    = this.creatorGroups

    if (normalizedQuery.length > 0) {
      matchingGroups = matchingGroups.filter((groupEntry) => {
        const matchesName    = groupEntry.name.toLowerCase().includes(normalizedQuery)
        const matchesService = groupEntry.profiles.some((profileEntry) => profileEntry.service.toLowerCase().includes(normalizedQuery))
        return matchesName || matchesService
      })
    }

    const flattenedEntries = []
    matchingGroups.forEach((groupEntry) => {
      groupEntry.profiles.forEach((profileEntry) => {
        flattenedEntries.push(profileEntry)
      })
    })

    const parsedOffset = parseInt(searchOffset) || 0
    const parsedLimit  = parseInt(searchLimit)  || 50

    return flattenedEntries.slice(parsedOffset, parsedOffset + parsedLimit)
  }

  async getGlobalPosts(searchQuery = '', searchOffset = 0) {
    let requestUrl       = `${this.apiBaseUrl}/posts`
    const parametersList = []
    const parsedOffset   = parseInt(searchOffset) || 0

    if (searchQuery)      parametersList.push(`q=${encodeURIComponent(searchQuery)}`)
    if (parsedOffset > 0) parametersList.push(`o=${parsedOffset}`)
    if (parametersList.length > 0) {
      requestUrl += `?${parametersList.join('&')}`
    }

    const fetchResponse = await fetch(requestUrl, {
      headers: { 'Accept': 'application/json' }
    })
    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch global posts: ${fetchResponse.status}`)
    }
    const retrievedPostsData = await fetchResponse.json()
    return retrievedPostsData.map((postItem) => this.transformPost(postItem))
  }

  async getArtistPosts(serviceName, creatorIdentifier, searchQuery = '', searchOffset = 0) {
    let requestUrl       = `${this.apiBaseUrl}/${serviceName}/user/${creatorIdentifier}`
    const parametersList = []
    const parsedOffset   = parseInt(searchOffset) || 0

    if (searchQuery)      parametersList.push(`q=${encodeURIComponent(searchQuery)}`)
    if (parsedOffset > 0) parametersList.push(`o=${parsedOffset}`)
    if (parametersList.length > 0) {
      requestUrl += `?${parametersList.join('&')}`
    }

    const fetchResponse = await fetch(requestUrl, {
      headers: { 'Accept': 'application/json' }
    })
    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch artist posts: ${fetchResponse.status}`)
    }
    const retrievedPostsData = await fetchResponse.json()
    return retrievedPostsData.map((postItem) => this.transformPost(postItem))
  }

  async searchHash(hashValue, searchOffset = 0) {
    let requestUrl     = `${this.apiBaseUrl}/search_hash/${hashValue}`
    const parsedOffset = parseInt(searchOffset) || 0

    if (parsedOffset > 0) {
      requestUrl += `?o=${parsedOffset}`
    }

    const fetchResponse = await fetch(requestUrl, {
      headers: { 'Accept': 'application/json' }
    })
    if (!fetchResponse.ok) {
      throw new Error(`Failed to lookup hash: ${fetchResponse.status}`)
    }
    const responseData = await fetchResponse.json()
    return {
      hashValue: responseData.hash,
      posts    : (responseData.posts || []).map((postItem) => this.transformPost(postItem))
    }
  }

  parseMedia(fileObject) {
    if (!fileObject || !fileObject.path) {
      return null
    }
    const cleanPath          = fileObject.path.split('?')[0]
    const fileExtension      = cleanPath.split('.').pop().toLowerCase()
    const imageExtensions    = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'apng', 'bmp', 'avif']
    const videoExtensions    = ['mp4', 'webm', 'ogg', 'mov', 'm4v']
    const animatedExtensions = ['gif', 'apng', 'webp']

    if (imageExtensions.includes(fileExtension)) {
      const isAnimated = animatedExtensions.includes(fileExtension)
      return {
        type        : 'image',
        name        : fileObject.name || '',
        cleanPath   : cleanPath,
        thumbnailUrl: isAnimated ? `${this.mediaBaseUrl}${cleanPath}` : `${this.thumbnailBaseUrl}${cleanPath}`,
        fullUrl     : `${this.mediaBaseUrl}${cleanPath}`
      }
    } else if (videoExtensions.includes(fileExtension)) {
      return {
        type        : 'video',
        name        : fileObject.name || '',
        cleanPath   : cleanPath,
        fullUrl     : `${this.mediaBaseUrl}${cleanPath}`,
        thumbnailUrl: `${this.mediaBaseUrl}${cleanPath}`
      }
    }
    return null
  }

  transformPost(postObject) {
    const mediaList = []
    const mainMedia = this.parseMedia(postObject.file)
    if (mainMedia) {
      mediaList.push(mainMedia)
    }

    if (postObject.attachments && Array.isArray(postObject.attachments)) {
      postObject.attachments.forEach((attachmentItem) => {
        const parsedAttachment = this.parseMedia(attachmentItem)
        if (parsedAttachment) {
          mediaList.push(parsedAttachment)
        }
      })
    }

    return {
      identifier: postObject.id,
      title     : postObject.title   || 'Untitled',
      creator   : postObject.user    || '',
      service   : postObject.service || '',
      media     : mediaList
    }
  }
}

// ---------------------------------------------------------------------------------------------------- //
// CONSTANTS AND GLOBAL PLUGIN STATE
// ---------------------------------------------------------------------------------------------------- //
const COLOR_ACCENT_NAMES     = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'sky', 'sapphire', 'blue', 'lavender']
const VIDEO_FILE_EXTENSIONS  = ['mp4', 'webm', 'ogg', 'mov', 'm4v']
const DEFAULT_SVG_BANNER_URL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="150" viewBox="0 0 400 150"><rect width="400" height="150" fill="%231e1e2e"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23cba6f7" font-family="sans-serif" font-size="20" font-weight="bold">Pawchive Creator</text></svg>'

let pawchiveClientInstance = null
let isPawchiveActive       = false

// Posts pagination state
let currentPostsSearchQuery  = ''
let currentPostsSearchOffset = 0
let isLoadingPostsState      = false
let hasMorePostsState        = true
let selectedCreatorProfile   = null
let postAccentColorIndex     = 0

// Creators pagination state
let currentCreatorsSearchQuery  = ''
let currentCreatorsSearchOffset = 0
let isLoadingCreatorsState      = false
let hasMoreCreatorsState        = true

// Saved default UI state
const originalUserInterfaceState = {
  tab1Label         : 'Folders',
  tab2Label         : 'Gallery',
  folderGridHTML    : '',
  galleryMasonryHTML: ''
}

// Intersection Observer for videos
let videoIntersectionObserver = null

function getVideoIntersectionObserver() {
  if (!videoIntersectionObserver && typeof IntersectionObserver !== 'undefined') {
    videoIntersectionObserver = new IntersectionObserver((observerEntries) => {
      observerEntries.forEach((observerEntry) => {
        const videoElement = observerEntry.target
        if (observerEntry.isIntersecting) {
          if (!videoElement.src && videoElement.dataset.src) {
            videoElement.src = videoElement.dataset.src
          }
          videoElement.play().catch(() => {})
        } else {
          videoElement.pause()
          if (videoElement.src) {
            videoElement.removeAttribute('src')
            videoElement.load()
          }
        }
      })
    }, { threshold: 0.05, rootMargin: '100px 0px' })
  }
  return videoIntersectionObserver
}

function cleanupGallery() {
  const masonryContainer = document.querySelector('.gallery-masonry')
  if (!masonryContainer) return

  const activeObserver = getVideoIntersectionObserver()
  masonryContainer.querySelectorAll('video').forEach((videoElement) => {
    if (activeObserver) activeObserver.unobserve(videoElement)
    videoElement.pause()
    videoElement.removeAttribute('src')
    videoElement.load()
  })
  masonryContainer.innerHTML = ''
}

function escapeHTML(inputString) {
  return String(inputString || '').replace(/[&<>"']/g, (matchedChar) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[matchedChar]
  })
}

// ---------------------------------------------------------------------------------------------------- //
// API CLIENT INITIALIZATION
// ---------------------------------------------------------------------------------------------------- //
async function getPawchiveClient() {
  if (!pawchiveClientInstance) {
    pawchiveClientInstance = new Pawchive()
    await pawchiveClientInstance.initialize()
  }
  return pawchiveClientInstance
}

// ---------------------------------------------------------------------------------------------------- //
// MASONRY GRID LAYOUT PACKING (IMAGES & VIDEOS)
// ---------------------------------------------------------------------------------------------------- //
function packGalleryCard(cardElement) {
  const gridContainer = document.querySelector('.gallery-masonry')
  if (!gridContainer) return

  if (gridContainer.offsetWidth === 0 && gridContainer.offsetHeight === 0) return

  const mediaElement = cardElement.querySelector('img, video')
  if (!mediaElement) return

  let mediaWidth  = 0
  let mediaHeight = 0

  const elementTagName = mediaElement.tagName.toLowerCase()
  if (elementTagName === 'img') {
    mediaWidth  = mediaElement.naturalWidth
    mediaHeight = mediaElement.naturalHeight
  } else if (elementTagName === 'video') {
    mediaWidth  = mediaElement.videoWidth  || 300
    mediaHeight = mediaElement.videoHeight || 400
  }

  if (!mediaWidth || !mediaHeight) return

  const computedGridStyles = getComputedStyle(gridContainer)
  const parsedRowHeight    = parseFloat(computedGridStyles.getPropertyValue('grid-auto-rows'))
  const parsedRowGap       = parseFloat(computedGridStyles.getPropertyValue('gap'))

  const calculatedRowHeight = (isNaN(parsedRowHeight) || parsedRowHeight <= 0) ? 10 : parsedRowHeight
  const calculatedRowGap    = isNaN(parsedRowGap) ? 15 : parsedRowGap

  const cardWidth = cardElement.getBoundingClientRect().width || 250
  if (cardWidth <= 0) return

  const scaledHeight      = cardWidth * (mediaHeight / mediaWidth)
  const calculatedRowSpan = Math.ceil((scaledHeight + calculatedRowGap) / (calculatedRowHeight + calculatedRowGap))

  if (isFinite(calculatedRowSpan) && calculatedRowSpan > 0) {
    cardElement.style.gridRowEnd = `span ${calculatedRowSpan}`
  }
}

function packAllGalleryCards() {
  document.querySelectorAll('.gallery-masonry .gallery-card').forEach(packGalleryCard)
}

// ---------------------------------------------------------------------------------------------------- //
// TAB HELPER & TAB SWITCHING WITH SEARCHBAR SYNC
// ---------------------------------------------------------------------------------------------------- //
function getActiveTab() {
  const contentPanels = document.querySelectorAll('.content > div')
  if (contentPanels[0] && contentPanels[0].classList.contains('active')) return 'creators'
  if (contentPanels[1] && contentPanels[1].classList.contains('active')) return 'posts'
  return 'other'
}

function switchToTab(tabIndex) {
  const navigationTabs = document.querySelectorAll('.nav-pill .tab')
  const contentPanels  = document.querySelectorAll('.content > div')

  if (navigationTabs[tabIndex]) {
    navigationTabs.forEach((tabElement) => tabElement.classList.remove('active'))
    navigationTabs[tabIndex].classList.add('active')
  }
  if (contentPanels[tabIndex]) {
    contentPanels.forEach((panelElement, panelIndex) => panelElement.classList.toggle('active', panelIndex === tabIndex))
  }

  const contentPanel = document.querySelector('.content')
  if (contentPanel) contentPanel.scrollTop = 0

  const searchInputField = document.querySelector('.search-input')
  if (searchInputField) {
    if (tabIndex === 0) {
      searchInputField.value = currentCreatorsSearchQuery
    } else if (tabIndex === 1) {
      searchInputField.value = currentPostsSearchQuery
    }
  }

  if (tabIndex === 1) {
    updateCreatorFilterChips()

    requestAnimationFrame(() => {
      packAllGalleryCards()
    })

    const masonryContainer = document.querySelector('.gallery-masonry')
    if (masonryContainer && masonryContainer.children.length === 0 && !isLoadingPostsState) {
      resetAndFetchPosts()
    }
  }
}

// ---------------------------------------------------------------------------------------------------- //
// CREATORS (FOLDERS TAB) & INFINITE SCROLL
// ---------------------------------------------------------------------------------------------------- //
function renderCreatorCardsBatch(creatorList, targetContainer) {
  const documentFragment = document.createDocumentFragment()

  creatorList.forEach((creatorEntry, creatorIndex) => {
    const folderCardElement = document.createElement('div')
    folderCardElement.className   = 'folder-card'
    folderCardElement.dataset.name = creatorEntry.name
    folderCardElement.dataset.size = 0
    folderCardElement.dataset.date = Date.now() - (currentCreatorsSearchOffset + creatorIndex) * 1000
    folderCardElement.dataset.type = 'folder'

    const selectedAccentColor = COLOR_ACCENT_NAMES[(currentCreatorsSearchOffset + creatorIndex) % COLOR_ACCENT_NAMES.length]
    folderCardElement.style.setProperty('--accent', `var(--ctp-${selectedAccentColor}-rgb)`)

    const bannerSourceUrl = creatorEntry.bannerUrl || creatorEntry.profilePictureUrl || DEFAULT_SVG_BANNER_URL
    const iconSourceUrl   = creatorEntry.profilePictureUrl || DEFAULT_SVG_BANNER_URL

    const folderTabElement = document.createElement('div')
    folderTabElement.className = 'folder-tab'
    folderTabElement.innerHTML = `<span class="file-count">${escapeHTML(creatorEntry.identifier)}</span>`

    const folderBodyElement = document.createElement('div')
    folderBodyElement.className = 'folder-body'

    const folderPreviewElement = document.createElement('div')
    folderPreviewElement.className = 'folder-preview'

    const bannerImageElement = document.createElement('img')
    bannerImageElement.loading        = 'lazy'
    bannerImageElement.decoding       = 'async'
    bannerImageElement.referrerPolicy = 'no-referrer'
    bannerImageElement.src            = bannerSourceUrl
    bannerImageElement.alt            = `${creatorEntry.name} Banner`

    bannerImageElement.addEventListener('error', function() {
      if (!this.dataset.step) {
        this.dataset.step = 'icon'
        if (iconSourceUrl && iconSourceUrl !== bannerSourceUrl) {
          this.src = iconSourceUrl
        } else {
          this.src = DEFAULT_SVG_BANNER_URL
        }
      } else if (this.dataset.step === 'icon') {
        this.dataset.step = 'none'
        this.src = DEFAULT_SVG_BANNER_URL
      }
    })

    folderPreviewElement.appendChild(bannerImageElement)

    const folderInfoElement = document.createElement('div')
    folderInfoElement.className = 'folder-info'
    folderInfoElement.innerHTML = `
      <h3 class="folder-title">
        <span>${escapeHTML(creatorEntry.name)}</span>
      </h3>
      <span class="folder-size">${escapeHTML((creatorEntry.service || 'CREATOR').toUpperCase())}</span>
    `

    folderBodyElement.appendChild(folderPreviewElement)
    folderBodyElement.appendChild(folderInfoElement)

    folderCardElement.appendChild(folderTabElement)
    folderCardElement.appendChild(folderBodyElement)

    folderCardElement.addEventListener('click', () => {
      selectedCreatorProfile  = creatorEntry
      currentPostsSearchQuery = ''
      switchToTab(1)
      resetAndFetchPosts()
    })

    documentFragment.appendChild(folderCardElement)
  })

  targetContainer.appendChild(documentFragment)
  if (typeof setupMarquee === 'function') setupMarquee(targetContainer)
}

async function fetchNextCreatorsBatch() {
  if (isLoadingCreatorsState || !hasMoreCreatorsState) return
  isLoadingCreatorsState = true

  try {
    const pawchiveClient    = await getPawchiveClient()
    const retrievedCreators = pawchiveClient.searchCreators(currentCreatorsSearchQuery, 50, currentCreatorsSearchOffset)

    if (!retrievedCreators || retrievedCreators.length === 0) {
      hasMoreCreatorsState   = false
      isLoadingCreatorsState = false
      return
    }

    if (retrievedCreators.length < 50) {
      hasMoreCreatorsState = false
    }

    const folderGridContainer = document.querySelector('.folder-grid')
    if (folderGridContainer) {
      renderCreatorCardsBatch(retrievedCreators, folderGridContainer)
    }

    currentCreatorsSearchOffset += retrievedCreators.length
  } catch (encounteredError) {
    console.error('Error fetching creators batch:', encounteredError)
  } finally {
    isLoadingCreatorsState = false
  }
}

async function renderPawchiveCreators(searchQuery = '') {
  const folderGridContainer = document.querySelector('.folder-grid')
  if (!folderGridContainer) return

  currentCreatorsSearchQuery  = searchQuery
  currentCreatorsSearchOffset = 0
  hasMoreCreatorsState        = true
  folderGridContainer.innerHTML = ''

  await fetchNextCreatorsBatch()
}

// ---------------------------------------------------------------------------------------------------- //
// POSTS (GALLERY TAB) & API SEARCH
// ---------------------------------------------------------------------------------------------------- //
function updateCreatorFilterChips() {
  const chipContainerElement = document.querySelector('.chip-container')
  if (!chipContainerElement) return

  const allFilterChip = chipContainerElement.querySelector('.chip[data-folder="all"]')
  
  chipContainerElement.querySelectorAll('.chip:not([data-folder="all"])').forEach((chipElement) => chipElement.remove())

  if (selectedCreatorProfile && (selectedCreatorProfile.name || selectedCreatorProfile.identifier)) {
    if (allFilterChip) allFilterChip.classList.remove('active')

    const creatorName    = selectedCreatorProfile.name || selectedCreatorProfile.identifier || 'Creator'
    const creatorService = selectedCreatorProfile.service ? ` (${selectedCreatorProfile.service})` : ''

    const creatorChipButton = document.createElement('button')
    creatorChipButton.className     = 'chip active'
    creatorChipButton.dataset.folder = creatorName

    const labelSpanElement = document.createElement('span')
    labelSpanElement.textContent = `${creatorName}${creatorService}`
    creatorChipButton.appendChild(labelSpanElement)

    creatorChipButton.addEventListener('click', () => {
      selectedCreatorProfile = null
      updateCreatorFilterChips()
      resetAndFetchPosts()
    })

    chipContainerElement.appendChild(creatorChipButton)
  } else {
    if (allFilterChip) allFilterChip.classList.add('active')
  }
}

async function resetAndFetchPosts() {
  isLoadingPostsState       = false
  currentPostsSearchOffset = 0
  hasMorePostsState         = true
  cleanupGallery()
  await fetchAndRenderPostsBatch(true)
}

async function fetchAndRenderPostsBatch(isNewSearchOperation = false) {
  if (isLoadingPostsState || (!hasMorePostsState && !isNewSearchOperation)) return
  isLoadingPostsState = true

  const masonryContainer = document.querySelector('.gallery-masonry')
  const imageCountLabel  = document.querySelector('.image-count')
  if (!masonryContainer) {
    isLoadingPostsState = false
    return
  }

  try {
    const pawchiveClient = await getPawchiveClient()
    let retrievedPosts   = []

    const trimmedQuery   = currentPostsSearchQuery.trim()

    if (selectedCreatorProfile) {
      retrievedPosts = await pawchiveClient.getArtistPosts(selectedCreatorProfile.service, selectedCreatorProfile.identifier, trimmedQuery, currentPostsSearchOffset)
    } else if (trimmedQuery.length > 0) {
      try {
        const hashSearchResult = await pawchiveClient.searchHash(trimmedQuery, currentPostsSearchOffset)
        if (hashSearchResult && hashSearchResult.posts && hashSearchResult.posts.length > 0) {
          retrievedPosts = hashSearchResult.posts
        }
      } catch (encounteredError) {}

      if (retrievedPosts.length === 0) {
        retrievedPosts = await pawchiveClient.getGlobalPosts(trimmedQuery, currentPostsSearchOffset)
      }
    } else {
      retrievedPosts = await pawchiveClient.getGlobalPosts('', currentPostsSearchOffset)
    }

    if (!retrievedPosts || retrievedPosts.length === 0) {
      hasMorePostsState   = false
      isLoadingPostsState = false
      if (imageCountLabel) imageCountLabel.textContent = `${masonryContainer.children.length} Images`
      return
    }

    const documentFragment = document.createDocumentFragment()
    const activeObserver   = getVideoIntersectionObserver()

    retrievedPosts.forEach((postEntry) => {
      const postAccentColor = COLOR_ACCENT_NAMES[postAccentColorIndex % COLOR_ACCENT_NAMES.length]
      postAccentColorIndex++

      (postEntry.media || []).forEach((mediaItem) => {
        const thumbnailSourceUrl      = mediaItem.thumbnailUrl || mediaItem.fullUrl
        const fullResolutionSourceUrl = mediaItem.fullUrl || mediaItem.thumbnailUrl
        if (!thumbnailSourceUrl) return

        const galleryCardElement = document.createElement('div')
        galleryCardElement.className          = 'gallery-card'
        galleryCardElement.dataset.folderName = postEntry.creator || 'Pawchive'
        galleryCardElement.dataset.name       = mediaItem.name || postEntry.title
        galleryCardElement.dataset.size       = 0
        galleryCardElement.dataset.date       = Date.now()

        const cleanPath     = (mediaItem.cleanPath || mediaItem.fullUrl || '').toLowerCase()
        const fileExtension = cleanPath.split('.').pop()
        const isVideoFormat = mediaItem.type === 'video' || VIDEO_FILE_EXTENSIONS.includes(fileExtension)

        galleryCardElement.dataset.type = isVideoFormat ? 'video' : (mediaItem.type || 'image')
        galleryCardElement.style.contentVisibility = 'auto'
        galleryCardElement.style.containIntrinsicSize = '200px 300px'
        galleryCardElement.style.setProperty('--accent', `var(--ctp-${postAccentColor}-rgb)`)

        if (isVideoFormat) {
          const videoElement = document.createElement('video')
          videoElement.loading        = 'lazy'
          videoElement.preload        = 'none'
          videoElement.referrerPolicy = 'no-referrer'
          videoElement.loop           = true
          videoElement.muted          = true
          videoElement.playsInline    = true
          if (thumbnailSourceUrl) videoElement.poster = thumbnailSourceUrl
          videoElement.dataset.src    = fullResolutionSourceUrl
          videoElement.style.cssText  = 'width:100%; height:100%; display:block; object-fit:cover; background-color:rgb(var(--ctp-mantle-rgb));'

          galleryCardElement.addEventListener('mouseenter', () => {
            if (!videoElement.src && videoElement.dataset.src) videoElement.src = videoElement.dataset.src
            videoElement.play().catch(() => {})
          })
          galleryCardElement.addEventListener('mouseleave', () => videoElement.pause())

          if (activeObserver) activeObserver.observe(videoElement)

          videoElement.addEventListener('error', function() {
            if (!this.dataset.failed) {
              this.dataset.failed = 'true'
              const fallbackImageElement = document.createElement('img')
              fallbackImageElement.loading        = 'lazy'
              fallbackImageElement.decoding       = 'async'
              fallbackImageElement.referrerPolicy = 'no-referrer'
              fallbackImageElement.src            = thumbnailSourceUrl
              fallbackImageElement.alt            = postEntry.title || mediaItem.name || 'Pawchive Media'
              fallbackImageElement.style.cssText  = 'width:100%; height:100%; display:block; object-fit:cover; background-color:rgb(var(--ctp-mantle-rgb));'
              fallbackImageElement.addEventListener('load', () => packGalleryCard(galleryCardElement))
              this.replaceWith(fallbackImageElement)
            }
          })

          if (videoElement.readyState >= 1) {
            packGalleryCard(galleryCardElement)
          } else {
            videoElement.addEventListener('loadedmetadata', () => packGalleryCard(galleryCardElement))
            setTimeout(() => packGalleryCard(galleryCardElement), 800)
          }

          galleryCardElement.appendChild(videoElement)
        } else {
          const imageElement = document.createElement('img')
          imageElement.loading          = 'lazy'
          imageElement.decoding         = 'async'
          imageElement.referrerPolicy   = 'no-referrer'
          imageElement.src              = thumbnailSourceUrl
          imageElement.alt              = postEntry.title || mediaItem.name || 'Pawchive Media'
          imageElement.dataset.fullUrl  = fullResolutionSourceUrl

          imageElement.addEventListener('error', function() {
            if (!this.dataset.failed) {
              this.dataset.failed = 'true'
              if (fullResolutionSourceUrl && fullResolutionSourceUrl !== thumbnailSourceUrl) {
                this.src = fullResolutionSourceUrl
              }
            }
          })

          if (imageElement.complete) {
            packGalleryCard(galleryCardElement)
          } else {
            imageElement.addEventListener('load', () => packGalleryCard(galleryCardElement))
          }

          galleryCardElement.appendChild(imageElement)
        }

        documentFragment.appendChild(galleryCardElement)
      })
    })

    masonryContainer.appendChild(documentFragment)
    currentPostsSearchOffset += retrievedPosts.length

    packAllGalleryCards()
    if (imageCountLabel) imageCountLabel.textContent = `${masonryContainer.children.length} Images`
  } catch (encounteredError) {
    console.error('Error fetching Pawchive posts:', encounteredError)
  } finally {
    isLoadingPostsState = false
  }
}

// ---------------------------------------------------------------------------------------------------- //
// FULLSCREEN MODAL MEDIA VIEWER SUPPORT (IMAGE & VIDEO)
// ---------------------------------------------------------------------------------------------------- //
function setupFullScreenMediaSupport() {
  const galleryContainer = document.querySelector('.gallery-masonry')
  const modalContainer   = document.querySelector('.full-screen')
  if (!galleryContainer || !modalContainer) return

  const modalImageElement = modalContainer.querySelector('.full-screen-img')

  galleryContainer.addEventListener('click', (clickEvent) => {
    if (!isPawchiveActive) return

    const galleryCardElement = clickEvent.target.closest('.gallery-card')
    if (!galleryCardElement) return

    const videoElement = galleryCardElement.querySelector('video')
    const imageElement = galleryCardElement.querySelector('img')

    if (videoElement) {
      clickEvent.stopPropagation()

      let modalVideoElement = modalContainer.querySelector('.full-screen-video')
      if (!modalVideoElement) {
        modalVideoElement           = document.createElement('video')
        modalVideoElement.className = 'full-screen-video'
        modalVideoElement.controls  = true
        modalVideoElement.autoplay  = true
        modalVideoElement.style.cssText = 'max-height: 90vh; max-width: 90vw; border-radius: 18px; box-shadow: 10px 10px 10px rgb(var(--ctp-crust-rgb)); display: none;'
        modalContainer.appendChild(modalVideoElement)
      }

      if (modalImageElement) modalImageElement.style.display = 'none'

      modalVideoElement.src           = videoElement.dataset.src || videoElement.src || videoElement.currentSrc
      modalVideoElement.style.display = 'block'
      modalVideoElement.play().catch(() => {})

      modalContainer.classList.add('active')
    } else if (imageElement) {
      if (modalImageElement && imageElement.dataset.fullUrl) {
        modalImageElement.src = imageElement.dataset.fullUrl
      }
    }
  }, true)

  const closeModalFunction = () => {
    const modalVideoElement = modalContainer.querySelector('.full-screen-video')
    if (modalVideoElement) {
      modalVideoElement.pause()
      modalVideoElement.removeAttribute('src')
      modalVideoElement.load()
      modalVideoElement.style.display = 'none'
    }
    if (modalImageElement) modalImageElement.style.display = ''
    modalContainer.classList.remove('active')
  }

  modalContainer.addEventListener('click', (clickEvent) => {
    if (clickEvent.target === modalContainer) closeModalFunction()
  })

  document.addEventListener('keydown', (keyboardEvent) => {
    if (keyboardEvent.key === 'Escape' && modalContainer.classList.contains('active')) closeModalFunction()
  })
}

// ---------------------------------------------------------------------------------------------------- //
// SEARCH & SCROLL EVENT INTERCEPTION
// ---------------------------------------------------------------------------------------------------- //
function executePawchiveSearch(searchQuery) {
  const activeTabName = getActiveTab()
  if (activeTabName === 'creators') {
    currentCreatorsSearchQuery = searchQuery
    renderPawchiveCreators(searchQuery)
  } else {
    currentPostsSearchQuery = searchQuery
    resetAndFetchPosts()
  }
}

function handleContentScroll() {
  if (!isPawchiveActive) return
  const activeTabName = getActiveTab()

  const contentPanel  = document.querySelector('.content')
  if (!contentPanel) return

  const isNearBottomPosition = contentPanel.scrollHeight - contentPanel.scrollTop - contentPanel.clientHeight < 800

  if (isNearBottomPosition) {
    if (activeTabName === 'posts' && !isLoadingPostsState && hasMorePostsState) {
      fetchAndRenderPostsBatch(false)
    } else if (activeTabName === 'creators' && !isLoadingCreatorsState && hasMoreCreatorsState) {
      fetchNextCreatorsBatch()
    }
  }
}

function setupEventInterception() {
  const searchInputField   = document.querySelector('.search-input')
  const searchSubmitButton = document.querySelector('.search-submit')
  const contentPanel       = document.querySelector('.content')

  const navigationTabs     = document.querySelectorAll('.nav-pill .tab')
  navigationTabs.forEach((tabElement, tabIndex) => {
    tabElement.addEventListener('click', () => {
      if (isPawchiveActive) {
        switchToTab(tabIndex)
      }
    })
  })

  if (searchInputField) {
    searchInputField.addEventListener('keydown', (keyboardEvent) => {
      if (isPawchiveActive && keyboardEvent.key === 'Enter') {
        keyboardEvent.preventDefault()
        keyboardEvent.stopImmediatePropagation()
        executePawchiveSearch(searchInputField.value.trim())
      }
    }, true)

    searchInputField.addEventListener('input', (inputEvent) => {
      if (isPawchiveActive) {
        const searchQuery   = searchInputField.value.trim()
        const activeTabName = getActiveTab()
        
        if (activeTabName === 'creators') {
          currentCreatorsSearchQuery = searchQuery
        } else {
          currentPostsSearchQuery = searchQuery
        }

        if (searchQuery === '') {
          inputEvent.stopImmediatePropagation()
          executePawchiveSearch('')
        }
      }
    }, true)
  }

  if (searchSubmitButton) {
    searchSubmitButton.addEventListener('click', (clickEvent) => {
      if (isPawchiveActive) {
        clickEvent.preventDefault()
        clickEvent.stopImmediatePropagation()
        const searchQuery = searchInputField ? searchInputField.value.trim() : ''
        executePawchiveSearch(searchQuery)
      }
    }, true)
  }

  if (contentPanel) {
    contentPanel.addEventListener('scroll', handleContentScroll, { passive: true })
  }

  const allFilterChip = document.querySelector('.chip[data-folder="all"]')
  if (allFilterChip) {
    allFilterChip.addEventListener('click', () => {
      if (isPawchiveActive) {
        selectedCreatorProfile = null
        updateCreatorFilterChips()
        resetAndFetchPosts()
      }
    })
  }

  setupFullScreenMediaSupport()

  window.addEventListener('resize', (resizeEvent) => {
    if (isPawchiveActive) packAllGalleryCards()
  })
}

// ---------------------------------------------------------------------------------------------------- //
// TOGGLE FUNCTION (ACTIVATION / DEACTIVATION)
// ---------------------------------------------------------------------------------------------------- //
async function togglePawchive(enableFlag) {
  isPawchiveActive = Boolean(enableFlag)
  localStorage.setItem('pawchive_enabled', isPawchiveActive ? 'true' : 'false')

  const tabLabelElements = document.querySelectorAll('.nav-pill .tab .label')

  if (isPawchiveActive) {
    const folderGridContainer = document.querySelector('.folder-grid')
    const masonryContainer    = document.querySelector('.gallery-masonry')
    if (folderGridContainer && !originalUserInterfaceState.folderGridHTML) originalUserInterfaceState.folderGridHTML = folderGridContainer.innerHTML
    if (masonryContainer && !originalUserInterfaceState.galleryMasonryHTML) originalUserInterfaceState.galleryMasonryHTML = masonryContainer.innerHTML

    if (tabLabelElements[0]) tabLabelElements[0].textContent = 'Creators'
    if (tabLabelElements[1]) tabLabelElements[1].textContent = 'Posts'

    selectedCreatorProfile     = null
    currentPostsSearchQuery    = ''
    currentCreatorsSearchQuery = ''

    const searchInputField = document.querySelector('.search-input')
    if (searchInputField) searchInputField.value = ''

    await renderPawchiveCreators()
    await resetAndFetchPosts()

  } else {
    if (tabLabelElements[0]) tabLabelElements[0].textContent = originalUserInterfaceState.tab1Label
    if (tabLabelElements[1]) tabLabelElements[1].textContent = originalUserInterfaceState.tab2Label

    const folderGridContainer = document.querySelector('.folder-grid')
    if (folderGridContainer) folderGridContainer.innerHTML = originalUserInterfaceState.folderGridHTML
    cleanupGallery()

    const masonryContainer = document.querySelector('.gallery-masonry')
    if (masonryContainer) masonryContainer.innerHTML = originalUserInterfaceState.galleryMasonryHTML

    selectedCreatorProfile = null
    updateCreatorFilterChips()

    if (typeof loadFoldersFromServer === 'function') {
      try { await loadFoldersFromServer() } catch (encounteredError) {}
    }
  }
}

if (typeof window !== 'undefined') {
  window.togglePawchive = togglePawchive
  window.Pawchive       = Pawchive
}
if (typeof globalThis !== 'undefined') {
  globalThis.togglePawchive = togglePawchive
  globalThis.Pawchive       = Pawchive
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupEventInterception)
} else {
  setupEventInterception()
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const storedEnabled = localStorage.getItem('pawchive_enabled') === 'true'
    const toggleInput   = document.getElementById('pawchiveToggle')

    if (toggleInput) {
      if (toggleInput.checked !== storedEnabled) {
        toggleInput.checked = storedEnabled
        toggleInput.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (storedEnabled) {
        togglePawchive(true)
      }
    } else if (storedEnabled) {
      setTimeout(() => togglePawchive(true), 200)
    }
  }, 300)
})