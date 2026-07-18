// ==================================================================================================== //
// OSOSEDKI SCRAPER API Plugin
// ==================================================================================================== //
const OSO_ORIGIN = 'https://ososedki.com'

function sleep(delayMilliseconds) {
  return new Promise(resolve => setTimeout(resolve, delayMilliseconds))
}

async function withRetry(task, retries = 2, baseDelayMilliseconds = 500) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt === retries) throw error
      await sleep(baseDelayMilliseconds * 2 ** attempt)
    }
  }
  throw lastError
}

function extractInteger(text) {
  if (text == null) return 0
  const match = String(text).match(/(\d[\d,]*)/)
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0
}

class OsosedkiAPI {
  constructor(proxyUrl) {
    this.proxyUrl = proxyUrl.replace(/\/$/, '')
  }

  buildProxyTarget(path, params = {}) {
    const url = new URL(path, OSO_ORIGIN)
    for (const [key, val] of Object.entries(params)) {
      if (val != null) url.searchParams.set(key, String(val))
    }
    return `${this.proxyUrl}/proxy?url=${encodeURIComponent(url.toString())}`
  }

  async request(path, params = {}) {
    const target = this.buildProxyTarget(path, params)
    return withRetry(async () => {
      const response = await fetch(target)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })
  }

  parse(html) {
    return new DOMParser().parseFromString(html, 'text/html')
  }

  parseAlbums(doc) {
    const seen = new Set()
    const albums = []

    for (const link of doc.querySelectorAll('a[href^="/photos/"]')) {
      const albumId = link.getAttribute('href')?.replace('/photos/', '') || null
      if (!albumId || seen.has(albumId)) continue

      const figure = link.querySelector('figure')
      if (!figure) continue
      seen.add(albumId)

      const img = figure.querySelector('img')
      let thumbnail = img?.getAttribute('data-src') ?? img?.getAttribute('src') ?? ''
      if (thumbnail.startsWith('/')) thumbnail = OSO_ORIGIN + thumbnail

      const [titleCell, modelCell, countCell] = link.querySelectorAll(':scope > div')
      let title     = titleCell?.textContent.trim() ?? ''
      let modelName = modelCell?.textContent.trim() ?? ''
      let imageCount = countCell ? extractInteger(countCell.textContent) : 0

      if (!title) {
        const lines = link.textContent.replace(/NEW/g, '').split('\n').map(line => line.trim()).filter(Boolean)
        title     = lines[0] ?? ''
        modelName = lines[1] ?? ''
        imageCount = lines[2] ? extractInteger(lines[2]) : 0
      }
      if (!modelName && title.includes(' - ')) [modelName] = title.split(' - ')

      albums.push({ id: albumId, title, modelName, imageCount, thumbnail })
    }

    return albums
  }

  async getListing(path, params) {
    const doc = this.parse(await this.request(path, params))
    return {
      albums: this.parseAlbums(doc),
      hasMore: !!doc.querySelector('a.next-page')
    }
  }

  getHome(page = 1) {
    return this.getListing('/', { page })
  }

  search(query, page = 1) {
    return this.getListing('/search', { q: query, page })
  }

  async getGalleryImages(albumId) {
    const doc = this.parse(await this.request(`/photos/${albumId}`))
    const images = []
    for (const figure of doc.querySelectorAll('figure.photo-item')) {
      const link = figure.querySelector('a[href^="/images/a/"]')
      if (!link) continue
      images.push({ url: `${OSO_ORIGIN}${link.getAttribute('href') ?? ''}` })
    }
    return images
  }
}

function proxifyOso(url, proxyHost) {
  if (!url) return ''
  const target = url.startsWith('/') ? OSO_ORIGIN + url : url
  return `${proxyHost.replace(/\/$/, '')}/proxy?url=${encodeURIComponent(target)}`
}

// ==================================================================================================== //
// PLUGIN STATE
// ==================================================================================================== //
const osoState = {
  currentPage: 1,
  isLoading: false,
  hasMore: true,
  currentQuery: '',
  proxyUrl: '',
  loadedAlbums: [],
  cachedAlbumImages: {},
  activeAlbums: [],
  gallerySortApplied: false
}

function resetOsoState(proxyUrl, query = '') {
  osoState.currentPage         = 1
  osoState.isLoading           = false
  osoState.hasMore             = true
  osoState.currentQuery        = query
  osoState.proxyUrl            = proxyUrl
  osoState.loadedAlbums        = []
  osoState.cachedAlbumImages   = {}
  osoState.activeAlbums        = []
  osoState.gallerySortApplied  = false
}

// ==================================================================================================== //
// DOM INJECTION & NATIVE OVERRIDES
// ==================================================================================================== //
function injectOsoStyles() {
  if (document.getElementById('oso-styles')) return
  const style = document.createElement('style')
  style.id = 'oso-styles'
  style.innerHTML = `
    .oso-mode-active .folder-card:not(.oso-item)   { display: none !important; }
    .oso-mode-active .gallery-card:not(.oso-item)  { display: none !important; }
    .oso-mode-active .chip-container .chip:not(.oso-item) { display: none !important; }
    .oso-item { animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  `
  document.head.appendChild(style)
}

function clearOsoItems(gridSelector) {
  document.querySelector(gridSelector)
    ?.querySelectorAll(':scope > .oso-item')
    .forEach(child => child.remove())
}

function switchNativeTab(index) {
  document.querySelectorAll('.nav-pill .tab')[index]?.click()
}

function packOsoCard(card) {
  const grid = document.querySelector('.gallery-masonry')
  const img  = card.querySelector('img')
  if (!grid || !img?.naturalWidth) return

  const gridStyles   = getComputedStyle(grid)
  const rowHeight    = parseFloat(gridStyles.getPropertyValue('grid-auto-rows')) || 10
  const rowGap       = parseFloat(gridStyles.getPropertyValue('gap')) || 16
  const cardWidth    = card.getBoundingClientRect().width
  const scaledHeight = cardWidth * (img.naturalHeight / img.naturalWidth)

  const rowSpan = Math.ceil((scaledHeight + rowGap) / (rowHeight + rowGap))
  card.style.gridRowEnd = `span ${rowSpan}`
}

function sortFoldersOsoDOM(sortKey = 'name', direction = 'up') {
  const grid = document.querySelector('.folder-grid')
  if (!grid) return

  const cards = [...grid.querySelectorAll('.oso-folder-card')]
  cards.sort((cardA, cardB) => {
    let valueA = cardA.dataset[sortKey] || ''
    let valueB = cardB.dataset[sortKey] || ''

    if (sortKey === 'size' || sortKey === 'date') {
      valueA = parseFloat(valueA) || 0
      valueB = parseFloat(valueB) || 0
      return direction === 'up' ? valueA - valueB : valueB - valueA
    }

    const comparison = String(valueA).localeCompare(String(valueB), undefined, { numeric: true, sensitivity: 'base' })
    return direction === 'up' ? comparison : -comparison
  })

  const fragment = document.createDocumentFragment()
  cards.forEach(card => fragment.appendChild(card))
  grid.appendChild(fragment)
}

function resetSortPill() {
  document.querySelectorAll('.sort-option').forEach(option => {
    const icon         = option.querySelector('i')
    const isNameOption = option.dataset.sort === 'name'

    option.classList.toggle('active', isNameOption)
    if (isNameOption) option.dataset.direction = 'up'

    if (icon) {
      icon.className = !isNameOption && option.dataset.sort === 'type' ? 'fa-solid fa-shuffle' : 'fas fa-arrow-up'
    }
  })

  const activeOption = document.querySelector('.sort-option.active')
  const slider       = document.querySelector('.sort-slider')
  if (activeOption && slider) {
    slider.style.width      = `${activeOption.offsetWidth}px`
    slider.style.transform  = `translateX(${activeOption.offsetLeft}px)`
  }
}

function setupMarquee(root = document) {
  root.querySelectorAll('.folder-title').forEach((title) => {
    const label = title.querySelector('span')
    if (!label) return

    const titleWidth   = title.clientWidth || 0
    const needsMarquee = label.scrollWidth > titleWidth

    title.classList.toggle('marquee', needsMarquee)
    if (needsMarquee) {
      title.style.setProperty('--marquee-room', `${titleWidth}px`)
    } else {
      title.style.removeProperty('--marquee-room')
    }
  })
}

// ==================================================================================================== //
// ALBUM PAGE CHIPS IMPLEMENTATION
// ==================================================================================================== //
function updateOsoChips(newAlbums) {
  const chipContainer = document.querySelector('.chip-container')
  if (!chipContainer) return

  for (const album of newAlbums) {
    if (!osoState.loadedAlbums.some(existing => existing.id === album.id)) {
      osoState.loadedAlbums.push(album)
    }
  }

  const allChipHtml    = `<button class="chip ${osoState.activeAlbums.length === 0 ? 'active' : ''} oso-item" data-oso-folder="all"><span>All Images</span></button>`
  const albumChipsHtml = osoState.loadedAlbums.map(album => {
    const isActive = osoState.activeAlbums.includes(album.id)
    return `<button class="chip ${isActive ? 'active' : ''} oso-item" data-oso-folder="${album.id}"><span>${album.title}</span></button>`
  }).join('')

  chipContainer.innerHTML = allChipHtml + albumChipsHtml
}

function initChipsHook() {
  const chipContainer = document.querySelector('.chip-container')
  if (!chipContainer) return

  chipContainer.addEventListener('click', async event => {
    if (!document.body.classList.contains('oso-mode-active')) return
    const chip = event.target.closest('[data-oso-folder]')
    if (!chip) return

    const folderId = chip.dataset.osoFolder

    if (folderId === 'all') {
      const isCurrentlyActive = chip.classList.contains('active')
      document.querySelectorAll('.chip-container [data-oso-folder]').forEach(chipElement => chipElement.classList.remove('active'))
      if (!isCurrentlyActive) chip.classList.add('active')
      osoState.activeAlbums = []
    } else {
      const allChip = document.querySelector('.chip-container [data-oso-folder="all"]')
      allChip?.classList.remove('active')

      chip.classList.toggle('active')

      osoState.activeAlbums = [...document.querySelectorAll('.chip-container .chip.active:not([data-oso-folder="all"])')]
        .map(chipElement => chipElement.dataset.osoFolder)

      if (osoState.activeAlbums.length === 0) allChip?.classList.add('active')
    }

    await loadImagesForActiveAlbums()
  })
}

// ==================================================================================================== //
// LOAD IMAGES FOR SELECTED CHIPS
// ==================================================================================================== //
function shuffleOsoImages(images) {
  for (let index = images.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[images[index], images[swapIndex]] = [images[swapIndex], images[index]]
  }
}

function sortOsoImages(images) {
  if (!osoState.gallerySortApplied) {
    images.sort((imageA, imageB) => imageA.originalIndex - imageB.originalIndex)
    return
  }

  const activeOption = document.querySelector('.sort-option.active')
  const sortKey      = activeOption?.dataset.sort ?? 'name'
  const direction    = activeOption?.dataset.direction ?? 'up'

  if (sortKey === 'type') {
    shuffleOsoImages(images)
    return
  }

  images.sort((imageA, imageB) => {
    let valueA
    let valueB
    if (sortKey === 'name') {
      valueA = `${imageA.title}_${imageA.url.split('/').pop().split('?')[0]}`
      valueB = `${imageB.title}_${imageB.url.split('/').pop().split('?')[0]}`
    } else if (sortKey === 'size') {
      valueA = imageA.url.split('/').pop().split('?')[0]
      valueB = imageB.url.split('/').pop().split('?')[0]
    } else {
      valueA = imageA.originalIndex
      valueB = imageB.originalIndex
    }

    const comparison = typeof valueA === 'number' && typeof valueB === 'number'
      ? valueA - valueB
      : String(valueA).localeCompare(String(valueB), undefined, { numeric: true, sensitivity: 'base' })

    return direction === 'up' ? comparison : -comparison
  })
}

function createOsoImageCard(imageData) {
  const card = document.createElement('div')
  card.className = 'gallery-card oso-item'
  card.style.setProperty('--accent', 'var(--ctp-mauve-rgb)')
  card.style.contentVisibility = 'auto'
  card.style.containIntrinsicSize = '200px 300px'

  card.setAttribute('data-name',        imageData.url)   // Raw non-proxy URL
  card.setAttribute('data-folder-name', imageData.title) // Album title

  const img = document.createElement('img')
  img.loading    = 'lazy'
  img.decoding   = 'async'
  img.src        = proxifyOso(imageData.url, osoState.proxyUrl)
  img.alt        = imageData.title
  img.onload     = () => packOsoCard(card)

  card.appendChild(img)
  return card
}

async function loadImagesForActiveAlbums() {
  const masonry = document.querySelector('.gallery-masonry')
  if (!masonry) return

  clearOsoItems('.gallery-masonry')

  const allChip     = document.querySelector('.chip-container [data-oso-folder="all"]')
  const isAllActive = allChip?.classList.contains('active') ?? false

  const albumsToLoad = isAllActive
    ? [...osoState.loadedAlbums]
    : osoState.loadedAlbums.filter(album => osoState.activeAlbums.includes(album.id))

  const imageCountLabel = document.querySelector('.image-count')
  if (imageCountLabel) imageCountLabel.innerText = 'Loading images...'

  if (albumsToLoad.length === 0) {
    if (imageCountLabel) imageCountLabel.innerText = '0 Images'
    return
  }

  masonry.insertAdjacentHTML('beforeend', '<p class="oso-item" style="padding:2rem;color:var(--text); text-align: center; width: 100%;">Loading photos for selected galleries...</p>')

  const api = new OsosedkiAPI(osoState.proxyUrl)

  const fetchAlbumImages = async album => {
    if (osoState.cachedAlbumImages[album.id]) return osoState.cachedAlbumImages[album.id]
    try {
      const images = await api.getGalleryImages(album.id)
      osoState.cachedAlbumImages[album.id] = images
      return images
    } catch (error) {
      console.error(`Error fetching images for ${album.id}:`, error)
      return []
    }
  }

  await Promise.all(albumsToLoad.map(fetchAlbumImages))
  clearOsoItems('.gallery-masonry')

  const allImages = albumsToLoad.flatMap(album =>
    (osoState.cachedAlbumImages[album.id] ?? []).map(img => ({ url: img.url, title: album.title }))
  )
  allImages.forEach((image, index) => { image.originalIndex = index })

  sortOsoImages(allImages)

  if (imageCountLabel) imageCountLabel.innerText = `${allImages.length} Images`

  const fragment = document.createDocumentFragment()
  for (const imageData of allImages) {
    fragment.appendChild(createOsoImageCard(imageData))
  }
  masonry.appendChild(fragment)
}

// ==================================================================================================== //
// SCRAPER CORE EXECUTIONS
// ==================================================================================================== //
window.osoTestScraper = async function (proxyUrl) {
  if (!proxyUrl) return alert('Please enter a Proxy URL.')
  try {
    const api = new OsosedkiAPI(proxyUrl)
    await api.getHome(1)
    alert('Scraper Test Successful!\nSuccessfully connected to Ososedki via the proxy.')
  } catch (error) {
    alert('Scraper Test Failed:\n' + error.message)
  }
}

window.osoRevert = function () {
  window.location.reload()
}

function createOsoAlbumCard(album, index, proxyUrl) {
  const card = document.createElement('div')
  card.className = 'folder-card oso-folder-card oso-item'
  card.dataset.name = album.title
  card.dataset.size = album.imageCount
  card.dataset.date = Date.now() - (osoState.loadedAlbums.length + index) * 1000
  card.style.setProperty('--accent', 'var(--ctp-mauve-rgb)')
  card.innerHTML = `
    <div class="folder-tab"><span class="file-count">${album.imageCount} Photos</span></div>
    <div class="folder-body">
      <div class="folder-preview"><img src="${proxifyOso(album.thumbnail, proxyUrl)}" loading="lazy" style="object-fit:cover;width:100%;height:100%;"></div>
      <div class="folder-info">
        <h3 class="folder-title"><span>${album.title}</span></h3>
        <span class="folder-size">${album.modelName || 'Album'}</span>
      </div>
    </div>
  `
  card.onclick = () => window.osoLoadGallery(proxyUrl, album.id, album.title)
  return card
}

function renderOsoAlbums(albums, proxyUrl) {
  const grid = document.querySelector('.folder-grid')
  if (!grid) return

  if (albums.length === 0 && osoState.currentPage === 1) {
    grid.insertAdjacentHTML('beforeend', '<p class="oso-item" style="padding:2rem;color:var(--text); grid-column: 1 / -1; text-align: center;">No albums found.</p>')
    return
  }

  const fragment = document.createDocumentFragment()
  albums.forEach((album, index) => fragment.appendChild(createOsoAlbumCard(album, index, proxyUrl)))
  grid.appendChild(fragment)

  requestAnimationFrame(() => setupMarquee(grid))
}

async function runOsoAlbumQuery(proxyUrl, query = '') {
  if (!proxyUrl) return alert('Proxy URL required.')

  document.body.classList.add('oso-mode-active')
  switchNativeTab(0) // Go to Folders Tab
  clearOsoItems('.folder-grid')
  resetOsoState(proxyUrl, query)

  const grid          = document.querySelector('.folder-grid')
  const loadingLabel  = query ? `Searching for "${query}"...` : 'Loading Web Folders...'
  grid.insertAdjacentHTML('beforeend', `<p class="oso-item" style="padding:2rem;color:var(--text); grid-column: 1 / -1; text-align: center;">${loadingLabel}</p>`)

  try {
    const api    = new OsosedkiAPI(proxyUrl)
    const result = query ? await api.search(query, 1) : await api.getHome(1)
    clearOsoItems('.folder-grid')

    renderOsoAlbums(result.albums, proxyUrl)
    osoState.hasMore = result.hasMore

    updateOsoChips(result.albums)
  } catch (error) {
    clearOsoItems('.folder-grid')
    grid.insertAdjacentHTML('beforeend', `<p class="oso-item" style="padding:2rem;color:var(--red); grid-column: 1 / -1; text-align: center;">Error: ${error.message}</p>`)
  }
}

window.osoLoadHome = proxyUrl => runOsoAlbumQuery(proxyUrl)

window.osoLoadSearch = (proxyUrl, query) => {
  if (!query) return window.osoLoadHome(proxyUrl)
  return runOsoAlbumQuery(proxyUrl, query)
}

window.osoLoadGallery = async function (proxyUrl, albumId, title) {
  document.body.classList.add('oso-mode-active')
  switchNativeTab(1)

  osoState.activeAlbums       = [albumId]
  osoState.proxyUrl           = proxyUrl
  osoState.gallerySortApplied = false

  if (!osoState.loadedAlbums.some(album => album.id === albumId)) {
    osoState.loadedAlbums.push({ id: albumId, title })
  }

  updateOsoChips([])
  await loadImagesForActiveAlbums()
}

// ==================================================================================================== //
// INFINITE SCROLL, SORT PILL, SEARCH HOOKS, & LOCAL FILTERING
// ==================================================================================================== //
async function loadNextPageOfAlbums() {
  osoState.isLoading = true
  const nextPage     = osoState.currentPage + 1

  const grid   = document.querySelector('.folder-grid')
  const loader = document.createElement('p')
  loader.className     = 'oso-item oso-scroll-loader'
  loader.style.cssText = 'padding:2rem;color:var(--text); grid-column: 1 / -1; text-align: center;'
  loader.innerText     = 'Loading more web folders...'
  grid.appendChild(loader)

  try {
    const api    = new OsosedkiAPI(osoState.proxyUrl)
    const result = osoState.currentQuery
      ? await api.search(osoState.currentQuery, nextPage)
      : await api.getHome(nextPage)

    loader.remove()

    if (result.albums?.length > 0) {
      renderOsoAlbums(result.albums, osoState.proxyUrl)
      osoState.currentPage = nextPage
      updateOsoChips(result.albums)
    }
    osoState.hasMore = result.hasMore
  } catch (error) {
    loader.innerText = `Error loading more: ${error.message}`
    setTimeout(() => loader.remove(), 3000)
  } finally {
    osoState.isLoading = false
  }
}

function localGallerySearch(query) {
  const masonry = document.querySelector('.gallery-masonry')
  if (!masonry) return

  const normalizedQuery = query.trim().toLowerCase()

  const cards = masonry.querySelectorAll('.gallery-card.oso-item')
  cards.forEach(card => {
    const name   = card.getAttribute('data-name')?.toLowerCase() ?? ''
    const folder = card.getAttribute('data-folder-name')?.toLowerCase() ?? ''
    const matchesQuery = !normalizedQuery || name.includes(normalizedQuery) || folder.includes(normalizedQuery)
    card.style.display = matchesQuery ? '' : 'none'
  })

  document.querySelectorAll('.chip-container .chip.oso-item:not([data-oso-folder="all"])').forEach(chip => {
    const folderId    = chip.dataset.osoFolder
    const album       = osoState.loadedAlbums.find(album => album.id === folderId)
    const albumTitle  = album ? album.title.toLowerCase() : ''

    const images           = osoState.cachedAlbumImages[folderId] || []
    const hasMatchingImages = !normalizedQuery || albumTitle.includes(normalizedQuery) ||
      images.some(img => img.url.toLowerCase().includes(normalizedQuery))

    chip.style.display = hasMatchingImages ? '' : 'none'
  })

  const allChip = document.querySelector('.chip-container .chip[data-oso-folder="all"]')
  if (allChip) allChip.style.display = ''

  const visibleCount    = [...cards].filter(card => card.style.display !== 'none').length
  const imageCountLabel = document.querySelector('.image-count')
  if (imageCountLabel) imageCountLabel.innerText = `${visibleCount} Images`

  cards.forEach(card => {
    if (card.style.display !== 'none') packOsoCard(card)
  })
}

function isGalleryTabActive() {
  return document.querySelector('.gallery-grid')?.classList.contains('active') ?? false
}

function initScrollHook() {
  const contentPanel = document.querySelector('.content')
  if (!contentPanel) return

  contentPanel.addEventListener('scroll', () => {
    if (!document.body.classList.contains('oso-mode-active')) return

    const foldersPanel = document.querySelector('.folder-grid')
    if (!foldersPanel?.classList.contains('active')) return

    const isNearBottom = contentPanel.scrollHeight - contentPanel.scrollTop - contentPanel.clientHeight < 800
    if (isNearBottom && !osoState.isLoading && osoState.hasMore) {
      loadNextPageOfAlbums()
    }
  }, { passive: true })
}

function initSortPillHook() {
  const sortPill = document.querySelector('.sort-pill')
  if (!sortPill) return

  sortPill.addEventListener('click', event => {
    if (!document.body.classList.contains('oso-mode-active')) return
    const option = event.target.closest('.sort-option')
    if (!option) return

    const galleryActive = isGalleryTabActive()
    if (galleryActive) osoState.gallerySortApplied = true

    setTimeout(async () => {
      if (galleryActive) await loadImagesForActiveAlbums()
    }, 50)
  })
}

function initTabHook() {
  document.querySelectorAll('.nav-pill .tab').forEach((tab, index) => {
    tab.addEventListener('click', () => {
      if (!document.body.classList.contains('oso-mode-active')) return

      const isFoldersTab = index === 0

      document.querySelectorAll('.oso-folder-card').forEach(card => {
        card.classList.toggle('folder-card', isFoldersTab)
      })

      const searchInput = document.querySelector('.search-input')
      if (searchInput) searchInput.value = ''

      resetSortPill()
      osoState.gallerySortApplied = false

      if (isFoldersTab) {
        sortFoldersOsoDOM('date', 'down')
      }

      if (index === 1) {
        setTimeout(async () => {
          const masonry = document.querySelector('.gallery-masonry')
          if (masonry && !masonry.querySelector('.oso-item') && !osoState.isLoading) {
            await loadImagesForActiveAlbums()
          }
        }, 150)
      }
    })
  })
}

function initSearchHook() {
  const searchInput   = document.querySelector('.search-input')
  const searchSubmit  = document.querySelector('.search-submit')
  if (!searchInput) return

  const performOsoSearch = () => {
    const query = searchInput.value.trim().toLowerCase()

    if (isGalleryTabActive() && document.body.classList.contains('oso-mode-active')) {
      localGallerySearch(query)
      return
    }

    const proxyUrl = document.getElementById('osoProxy')?.value || 'http://localhost:3000'

    if (query) {
      if (query.length < 2) return
      window.osoLoadSearch(proxyUrl, query)
    } else {
      window.osoLoadHome(proxyUrl)
    }
  }

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase()

    if (isGalleryTabActive() && document.body.classList.contains('oso-mode-active')) {
      const hasNoLoadedImages = !document.querySelector('.gallery-masonry .oso-item')

      if (query === '' && hasNoLoadedImages && !osoState.isLoading) {
        loadImagesForActiveAlbums()
      } else {
        localGallerySearch(query)
      }
    } else if (query === '') {
      performOsoSearch()
    }
  })

  searchInput.addEventListener('keydown', event => {
    if (!document.body.classList.contains('oso-mode-active')) return
    if (event.key !== 'Enter') return
    event.stopImmediatePropagation()
    event.preventDefault()
    performOsoSearch()
  }, true)

  searchSubmit?.addEventListener('click', event => {
    if (!document.body.classList.contains('oso-mode-active')) return
    event.stopImmediatePropagation()
    event.preventDefault()
    performOsoSearch()
  }, true)
}

function initOso() {
  injectOsoStyles()
  initChipsHook()
  initScrollHook()
  initSortPillHook()
  initTabHook()
  initSearchHook()

  window.addEventListener('resize', () => {
    setupMarquee(document)
  })
}

initOso()