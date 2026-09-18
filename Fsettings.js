// ==================================================================================================== //
// FUTUREPORN ARCHIVE PLUGIN
// ==================================================================================================== //
(function () {
  const API_URL = 'https://futureporn.net'
  const CDN_URL = 'https://futureporn-b2.b-cdn.net/'

  const STORAGE_KEYS = {
    loadOnStart:        'fp_load_on_start',
    includeUnavailable: 'fp_include_unavailable',
    cachedVtubers:      'fp_cached_vtubers',
    cachedVods:         'fp_cached_vods',
  }

  const ACCENTS = [
    'rosewater', 'flamingo', 'pink', 'mauve', 'red',       'maroon', 'peach',
    'yellow',    'green',    'teal', 'sky',    'sapphire', 'blue',   'lavender',
  ]

  const BATCH_SIZE = 60

  let loadedVtubers        = []
  let loadedVods           = []
  let filteredVods         = []
  let renderIndex          = 0
  let activeFolderFilter   = 'all'
  let currentSearchQuery   = ''
  let currentSort          = { key: 'name', direction: 'up' }
  let activeTabIndex       = 0
  let lastThumbnailRowSpan = 160

  function getLoadOnStart() {
    return localStorage.getItem(STORAGE_KEYS.loadOnStart) === 'true'
  }

  function getIncludeUnavailable() {
    return localStorage.getItem(STORAGE_KEYS.includeUnavailable) === 'true'
  }

  // ==================================================================================================== //
  // API CLIENT
  // ==================================================================================================== //
  async function fetchAllPages(collection, params = {}) {
    const items = []
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const url = new URL(`${API_URL}/api/collections/${collection}/records`)
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value))
        }
      }
      url.searchParams.set('page', String(page))
      url.searchParams.set('perPage', '50')

      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to fetch ${collection} (${res.status})`)

      const data = await res.json()
      totalPages = data.totalPages || 1
      items.push(...(data.items || []))
      page++
    }
    return items
  }

  function resolveVideoUrl(vod) {
    if (vod.videoSrcB2)  return CDN_URL + vod.videoSrcB2
    if (vod.sourceVideo) return CDN_URL + vod.sourceVideo
    return null
  }

  function resolveThumbnailUrl(vod) {
    if (!vod?.thumbnail) return null
    return `${API_URL}/api/files/vods/${vod.id}/${vod.thumbnail}`
  }

  // ==================================================================================================== //
  // MASONRY PACKER
  // ==================================================================================================== //
  function packCard(card, img) {
    const grid = document.querySelector('.gallery-masonry')
    if (!grid || !card) return

    const gridStyles = getComputedStyle(grid)
    const rowHeight  = parseFloat(gridStyles.getPropertyValue('grid-auto-rows')) || 1
    const rowGap     = parseFloat(gridStyles.getPropertyValue('gap')) || 20
    const cardWidth  = card.getBoundingClientRect().width || 250

    if (img && img.naturalWidth && img.naturalHeight) {
      const scaledHeight = cardWidth * (img.naturalHeight / img.naturalWidth)
      const rowSpan = Math.ceil((scaledHeight + rowGap) / (rowHeight + rowGap))
      card.style.gridRowEnd = `span ${rowSpan}`
      
      lastThumbnailRowSpan = rowSpan

      document.querySelectorAll('.gallery-masonry .gallery-card[data-has-thumb="false"]').forEach(c => {
        c.style.gridRowEnd = `span ${lastThumbnailRowSpan}`
      })
    }
  }

  function packAllVisibleCards() {
    const cards = document.querySelectorAll('.gallery-masonry .gallery-card:not([style*="display: none"])')
    cards.forEach(card => {
      const img = card.querySelector('img')
      if (img && img.complete && img.naturalWidth) {
        packCard(card, img)
      } else if (card.dataset.hasThumb === 'false') {
        card.style.gridRowEnd = `span ${lastThumbnailRowSpan}`
      }
    })
  }

  // ==================================================================================================== //
  // DOM POPULATION
  // ==================================================================================================== //
  function populateFolderCards() {
    const folderGrid = document.querySelector('.folder-grid')
    if (!folderGrid) return

    folderGrid.querySelectorAll('.folder-card[data-source="futureporn"]').forEach(el => el.remove())

    loadedVtubers.forEach((vtuber, idx) => {
      const vtuberVods = loadedVods.filter(v => v.vtubers && v.vtubers.includes(vtuber.id))
      const count      = vtuberVods.length
      const accent     = ACCENTS[idx % ACCENTS.length]
      const name       = vtuber.displayName || vtuber.slug || vtuber.id

      const previewVod = vtuberVods.find(v => resolveThumbnailUrl(v))
      const previewUrl = previewVod ? resolveThumbnailUrl(previewVod) : ''

      const card = document.createElement('div')
      card.className = 'folder-card'
      card.dataset.name = name.toLowerCase()
      card.dataset.folderId = vtuber.id
      card.dataset.source = 'futureporn'
      card.dataset.type = 'folder'
      card.dataset.date = Date.now()
      card.dataset.size = count
      card.style.setProperty('--accent', `var(--ctp-${accent}-rgb)`)

      card.innerHTML = `
        <info class="folder-tab">
          <span class="file-count">${count} Streams</span>
        </info>
        <div class="folder-body">
          <div class="folder-preview">
            ${previewUrl ? `<img loading="lazy" decoding="async" src="${previewUrl}" alt="${name} Preview">` : ''}
          </div>
          <info class="folder-info">
            <h3 class="folder-title">
              <span>${name}</span>
            </h3>
          </info>
        </div>
      `

      card.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        openVtuberInGallery(vtuber.id)
      })

      folderGrid.appendChild(card)
    })
  }

  function populateGalleryChips() {
    const chipContainer = document.querySelector('.chip-container')
    if (!chipContainer) return

    chipContainer.querySelectorAll('.chip[data-source="futureporn"]').forEach(el => el.remove())

    loadedVtubers.forEach(vtuber => {
      const name = vtuber.displayName || vtuber.slug || vtuber.id
      const chip = document.createElement('button')
      chip.className = 'chip'
      chip.dataset.folder = vtuber.id
      chip.dataset.source = 'futureporn'
      chip.innerHTML = `<span>${name}</span>`

      chipContainer.appendChild(chip)
    })
  }

  function renderNextBatch() {
    const gallery = document.querySelector('.gallery-masonry')
    if (!gallery || renderIndex >= filteredVods.length) return

    const vtuberMap = {}
    loadedVtubers.forEach(v => { vtuberMap[v.id] = v.displayName || v.slug || v.id })

    const fragment = document.createDocumentFragment()
    const end = Math.min(renderIndex + BATCH_SIZE, filteredVods.length)

    for (let i = renderIndex; i < end; i++) {
      const vod        = filteredVods[i]
      const videoUrl   = resolveVideoUrl(vod)
      const isApproved = Boolean(videoUrl)
      const thumbUrl   = resolveThumbnailUrl(vod)

      const vtuberIds      = vod.vtubers || []
      const vtuberNamesArr = vtuberIds.map(id => vtuberMap[id] || id)
      const vtuberNamesStr = vtuberNamesArr.join(', ') || 'Unknown'
      const dateStr        = vod.streamDate ? new Date(vod.streamDate).toLocaleDateString() : 'No Date'
      const timestamp      = vod.streamDate ? new Date(vod.streamDate).getTime() : 0
      const accent         = ACCENTS[i % ACCENTS.length]

      const card = document.createElement('div')
      card.className = 'gallery-card'
      card.dataset.source   = 'futureporn'
      card.dataset.vodId    = vod.id.toLowerCase()
      card.dataset.vtubers  = vtuberIds.join(',')
      card.dataset.name     = `${vtuberNamesStr} ${dateStr}`.toLowerCase()
      card.dataset.dateStr  = dateStr.toLowerCase()
      card.dataset.date     = timestamp
      card.dataset.size     = isApproved ? 1 : 0
      card.dataset.videoUrl = videoUrl || ''
      card.dataset.title    = `${vtuberNamesStr} — ${dateStr}`
      card.style.setProperty('--accent', `var(--ctp-${accent}-rgb)`)
      card.style.gridRowEnd = `span ${lastThumbnailRowSpan}`

      if (thumbUrl) {
        card.dataset.hasThumb = 'true'
        card.innerHTML = `<img decoding="async" src="${thumbUrl}" alt="${vtuberNamesStr}">`
        const img = card.querySelector('img')
        img.addEventListener('load', () => packCard(card, img))
      } else {
        card.dataset.hasThumb = 'false'
        const placeholderLabel = !isApproved ? 'Unavailable' : 'No Cover'
        const placeholderIcon  = !isApproved ? 'fa-video-slash' : 'fa-photo-film'

        card.innerHTML = `
          <div style="width: 100%; height: 100%; min-height: 140px; background-color: rgb(var(--ctp-surface1-rgb)); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: rgb(var(--accent));">
            <i class="fas ${placeholderIcon}" style="font-size: 2rem;"></i>
            <span style="font-size: 0.75rem; color: rgb(var(--ctp-subtext0-rgb)); font-weight: 800;">${placeholderLabel}</span>
          </div>
        `
      }

      fragment.appendChild(card)
    }

    gallery.appendChild(fragment)
    renderIndex = end
  }

  function initInfiniteScroll() {
    const contentPanel = document.querySelector('.content')
    if (!contentPanel) return

    contentPanel.addEventListener('scroll', () => {
      if (activeTabIndex !== 1) return
      const isNearBottom = contentPanel.scrollHeight - contentPanel.scrollTop - contentPanel.clientHeight < 800
      if (isNearBottom && renderIndex < filteredVods.length) {
        requestAnimationFrame(() => renderNextBatch())
      }
    }, { passive: true })
  }

  function updateImageCountLabel(count) {
    const label = document.querySelector('.image-count')
    if (!label) return
    label.textContent = `${count !== undefined ? count : filteredVods.length} Streams`
  }

  // ==================================================================================================== //
  // FILTERING & SEARCHING
  // ==================================================================================================== //
  function applyCurrentFilters() {
    const query = currentSearchQuery.trim().toLowerCase()

    if (activeTabIndex === 0) {
      const folderCards = document.querySelectorAll('.folder-grid .folder-card')
      folderCards.forEach(card => {
        const name  = card.dataset.name || ''
        const id    = (card.dataset.folderId || '').toLowerCase()
        const match = !query || name.includes(query) || id.includes(query)
        card.style.display = match ? '' : 'none'
      })
      return
    }

    const includeUnavailable = getIncludeUnavailable()
    const vtuberMap = {}
    loadedVtubers.forEach(v => { vtuberMap[v.id] = v.displayName || v.slug || v.id })

    filteredVods = loadedVods.filter(vod => {
      const isApproved = Boolean(resolveVideoUrl(vod))
      if (!includeUnavailable && !isApproved) return false

      if (activeFolderFilter !== 'all') {
        const vtubers = vod.vtubers || []
        if (!vtubers.includes(activeFolderFilter)) return false
      }

      if (query) {
        const vtuberNames = (vod.vtubers || []).map(id => vtuberMap[id] || id).join(' ').toLowerCase()
        const dateStr     = vod.streamDate ? new Date(vod.streamDate).toLocaleDateString().toLowerCase() : ''
        const vodId       = (vod.id || '').toLowerCase()

        const matches = vtuberNames.includes(query) || dateStr.includes(query) || vodId.includes(query)
        if (!matches) return false
      }

      return true
    })

    sortFilteredVods()

    const gallery = document.querySelector('.gallery-masonry')
    if (gallery) {
      gallery.querySelectorAll('.gallery-card[data-source="futureporn"]').forEach(el => el.remove())
    }
    renderIndex = 0
    renderNextBatch()
    updateImageCountLabel(filteredVods.length)
  }

  function sortFilteredVods() {
    const { key, direction } = currentSort
    const mult = direction === 'up' ? 1 : -1
    const vtuberMap = {}
    loadedVtubers.forEach(v => { vtuberMap[v.id] = v.displayName || v.slug || v.id })

    filteredVods.sort((a, b) => {
      if (key === 'type') return Math.random() - 0.5
      if (key === 'date') {
        const dateA = a.streamDate ? new Date(a.streamDate).getTime() : 0
        const dateB = b.streamDate ? new Date(b.streamDate).getTime() : 0
        return mult * (dateA - dateB)
      }
      if (key === 'size') {
        const sizeA = resolveVideoUrl(a) ? 1 : 0
        const sizeB = resolveVideoUrl(b) ? 1 : 0
        return mult * (sizeA - sizeB)
      }

      const nameA = (a.vtubers || []).map(id => vtuberMap[id] || id).join(', ')
      const nameB = (b.vtubers || []).map(id => vtuberMap[id] || id).join(', ')
      return mult * nameA.localeCompare(nameB)
    })
  }

  // ==================================================================================================== //
  // SORTING
  // ==================================================================================================== //
  function applySorting() {
    if (activeTabIndex === 0) {
      const { key, direction } = currentSort
      const mult = direction === 'up' ? 1 : -1
      const folderGrid = document.querySelector('.folder-grid')

      if (folderGrid) {
        const cards = Array.from(folderGrid.querySelectorAll('.folder-card'))
        cards.sort((a, b) => {
          if (key === 'type') return Math.random() - 0.5
          if (key === 'size' || key === 'date') {
            return mult * ((Number(a.dataset[key]) || 0) - (Number(b.dataset[key]) || 0))
          }
          return mult * String(a.dataset.name || '').localeCompare(String(b.dataset.name || ''))
        })
        cards.forEach(c => folderGrid.appendChild(c))
      }
    } else if (activeTabIndex === 1) {
      applyCurrentFilters()
    }
  }

  // ==================================================================================================== //
  // CAPTURE EVENT LISTENERS
  // ==================================================================================================== //
  function setupCaptureInterceptors() {
    const navPill = document.querySelector('.nav-pill')
    navPill?.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab')
      if (!tab) return

      e.preventDefault()
      e.stopImmediatePropagation()

      const tabs   = Array.from(navPill.querySelectorAll('.tab'))
      const panels = document.querySelectorAll('.content > div')
      const targetIndex = tabs.indexOf(tab)
      if (targetIndex === -1) return

      activeTabIndex = targetIndex
      tabs.forEach((t, i) => t.classList.toggle('active', i === targetIndex))
      panels.forEach((p, i) => p.classList.toggle('active', i === targetIndex))

      if (targetIndex === 1) {
        packAllVisibleCards()
      }
      applyCurrentFilters()
    }, true)

    const chipContainer = document.querySelector('.chip-container')
    chipContainer?.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip')
      if (!chip) return

      e.preventDefault()
      e.stopImmediatePropagation()

      chipContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
      activeFolderFilter = chip.dataset.folder || 'all'

      applyCurrentFilters()
    }, true)

    const sortPill = document.querySelector('.sort-pill')
    sortPill?.addEventListener('click', (e) => {
      const opt = e.target.closest('.sort-option')
      if (!opt) return

      e.preventDefault()
      e.stopImmediatePropagation()

      const sortKey = opt.dataset.sort
      const wasActive = opt.classList.contains('active')
      const dir = wasActive ? (currentSort.direction === 'up' ? 'down' : 'up') : 'up'

      sortPill.querySelectorAll('.sort-option').forEach(o => {
        o.classList.remove('active')
        const icon = o.querySelector('i')
        if (icon && o.dataset.sort !== 'type') {
          icon.className = 'fas fa-arrow-up'
        }
      })

      opt.classList.add('active')
      const activeIcon = opt.querySelector('i')
      if (activeIcon && sortKey !== 'type') {
        activeIcon.className = `fas fa-arrow-${dir}`
      }

      const slider = sortPill.querySelector('.sort-slider')
      if (slider) {
        slider.style.width = `${opt.offsetWidth}px`
        slider.style.transform = `translateX(${opt.offsetLeft}px)`
      }

      currentSort = { key: sortKey, direction: dir }
      applySorting()
    }, true)

    const searchInput  = document.querySelector('.search-input')
    const searchSubmit = document.querySelector('.search-submit')

    searchInput?.addEventListener('input', (e) => {
      e.stopImmediatePropagation()
      currentSearchQuery = searchInput.value
      applyCurrentFilters()
    }, true)

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        currentSearchQuery = searchInput.value
        applyCurrentFilters()
      }
    }, true)

    searchSubmit?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      currentSearchQuery = searchInput?.value || ''
      applyCurrentFilters()
    }, true)
  }

  function openVtuberInGallery(vtuberId) {
    const tabs   = document.querySelectorAll('.nav-pill .tab')
    const panels = document.querySelectorAll('.content > div')

    activeTabIndex = 1
    tabs.forEach((t, i) => t.classList.toggle('active', i === 1))
    panels.forEach((p, i) => p.classList.toggle('active', i === 1))

    const chipContainer = document.querySelector('.chip-container')
    if (chipContainer) {
      chipContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'))
      const matchingChip = chipContainer.querySelector(`.chip[data-folder="${vtuberId}"]`)
      if (matchingChip) {
        matchingChip.classList.add('active')
        matchingChip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }

    activeFolderFilter = vtuberId
    applyCurrentFilters()
  }

  // ==================================================================================================== //
  // VIDEO MODAL
  // ==================================================================================================== //
  function setupVideoModalIntegration() {
    const fullScreenModal = document.querySelector('.full-screen')
    if (!fullScreenModal) return

    let videoEl = fullScreenModal.querySelector('video.full-screen-video')
    if (!videoEl) {
      videoEl = document.createElement('video')
      videoEl.className          = 'full-screen-video'
      videoEl.controls           = true
      videoEl.autoplay           = true
      videoEl.playsInline        = true
      videoEl.style.borderRadius = '18px'
      videoEl.style.boxShadow    = '10px 10px 10px rgb(var(--ctp-crust-rgb))'
      videoEl.style.display      = 'none'
      videoEl.style.outline      = 'none'
      videoEl.style.cursor       = 'pointer'
      videoEl.style.transition   = 'transform 0.3s var(--cubic-bezier)'
      fullScreenModal.appendChild(videoEl)
    }

    const scaleModalVideo = () => {
      if (!videoEl.videoWidth || !videoEl.videoHeight) {
        videoEl.style.maxWidth  = 'calc(100vw - 20px)'
        videoEl.style.maxHeight = 'calc(100vh - 20px)'
        videoEl.style.width     = '100%'
        videoEl.style.height    = '100%'
        return
      }

      const videoRatio    = videoEl.videoWidth / videoEl.videoHeight
      const viewportRatio = (window.innerWidth - 20) / (window.innerHeight - 20)

      if (videoRatio > viewportRatio) {
        videoEl.style.width  = 'calc(100vw - 20px)'
        videoEl.style.height = 'auto'
      } else {
        videoEl.style.height = 'calc(100vh - 20px)'
        videoEl.style.width  = 'auto'
      }
      videoEl.style.maxWidth  = 'calc(100vw - 20px)'
      videoEl.style.maxHeight = 'calc(100vh - 20px)'
    }

    videoEl.addEventListener('loadedmetadata', scaleModalVideo)
    window.addEventListener('resize', () => {
      if (fullScreenModal.classList.contains('active') && videoEl.style.display !== 'none') {
        scaleModalVideo()
      }
    })

    const modalImg = fullScreenModal.querySelector('.full-screen-img')

    document.querySelector('.gallery-masonry')?.addEventListener('click', (e) => {
      const card = e.target.closest('.gallery-card[data-source="futureporn"]')
      if (!card) return

      const videoUrl = card.dataset.videoUrl
      if (videoUrl) {
        e.stopPropagation()
        if (modalImg) modalImg.style.display = 'none'
        videoEl.style.display = 'block'
        videoEl.src = videoUrl
        fullScreenModal.classList.add('active')
        scaleModalVideo()
        videoEl.play().catch(() => {})
      }
    }, true)

    const stopVideo = () => {
      if (videoEl.src) {
        videoEl.pause()
        videoEl.removeAttribute('src')
        videoEl.style.display = 'none'
        if (modalImg) modalImg.style.display = ''
      }
    }

    fullScreenModal.addEventListener('click', (e) => {
      if (e.target === fullScreenModal) stopVideo()
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') stopVideo()
    })
  }

  // ==================================================================================================== //
  // GLOBAL HOOKS
  // ==================================================================================================== //
  window.setFpLoadOnStart = function (value) {
    const enabled = Boolean(value)
    localStorage.setItem(STORAGE_KEYS.loadOnStart, enabled)

    if (enabled && loadedVtubers.length === 0) {
      renderFromCache()
    } else if (!enabled) {
      clearRenderedElements()
    }
  }

  window.syncFuturepornArchive = async function () {
    const syncBtn = document.getElementById('fpSyncBtn')
    if (syncBtn) syncBtn.textContent = 'Syncing...'

    try {
      const [vtubers, vods] = await Promise.all([
        fetchAllPages('vtubers', { sort: 'displayName' }),
        fetchAllPages('vods', { sort: '-streamDate' }),
      ])

      loadedVtubers = vtubers
      loadedVods    = vods

      const minimalVtubers = vtubers.map(v => ({
        id:          v.id,
        displayName: v.displayName,
        slug:        v.slug
      }))

      const minimalVods = vods.map(v => ({
        id:          v.id,
        streamDate:  v.streamDate,
        thumbnail:   v.thumbnail,
        videoSrcB2:  v.videoSrcB2,
        sourceVideo: v.sourceVideo,
        vtubers:     v.vtubers
      }))

      try {
        localStorage.setItem(STORAGE_KEYS.cachedVtubers, JSON.stringify(minimalVtubers))
        localStorage.setItem(STORAGE_KEYS.cachedVods,    JSON.stringify(minimalVods))
      } catch (storageErr) {
        console.warn('[FuturePorn] Storage quota exceeded; archive will remain active in memory.', storageErr)
      }

      populateFolderCards()
      populateGalleryChips()
      applyCurrentFilters()
      updateStatsButton()

      if (syncBtn) syncBtn.textContent = 'Sync Complete!'
      setTimeout(() => { if (syncBtn) syncBtn.textContent = 'Sync Archive' }, 2000)
    } catch (err) {
      console.error('[FuturePorn] Sync error:', err)
      alert(`Sync failed: ${err.message}`)
      if (syncBtn) syncBtn.textContent = 'Sync Archive'
    }
  }

  function clearRenderedElements() {
    document.querySelectorAll('.folder-card[data-source="futureporn"]').forEach(el =>  el.remove())
    document.querySelectorAll('.chip[data-source="futureporn"]').forEach(el =>         el.remove())
    document.querySelectorAll('.gallery-card[data-source="futureporn"]').forEach(el => el.remove())
    filteredVods = []
    renderIndex  = 0
    updateImageCountLabel(0)
  }

  window.clearFuturepornArchive = function () {
    loadedVtubers = []
    loadedVods    = []
    localStorage.removeItem(STORAGE_KEYS.cachedVtubers)
    localStorage.removeItem(STORAGE_KEYS.cachedVods)

    clearRenderedElements()
    updateStatsButton()
  }

  window.setFpIncludeUnavailable = function (value) {
    localStorage.setItem(STORAGE_KEYS.includeUnavailable, Boolean(value))
    if (loadedVods.length > 0) {
      applyCurrentFilters()
    }
    updateStatsButton()
  }

  function updateStatsButton() {
    if (!window.SettingsAPI?.updateSetting) return
    const ready   = loadedVods.filter(v => resolveVideoUrl(v)).length
    const unavailable = loadedVods.length - ready
    const label   = `VTubers: ${loadedVtubers.length} VODs: ${loadedVods.length} Unavailable: ${unavailable}`

    window.SettingsAPI.updateSetting('fpStatsBtn', { label })
  }

  function renderFromCache() {
    try {
      const cachedV = localStorage.getItem(STORAGE_KEYS.cachedVtubers)
      const cachedD = localStorage.getItem(STORAGE_KEYS.cachedVods)
      if (cachedV && cachedD) {
        loadedVtubers = JSON.parse(cachedV)
        loadedVods    = JSON.parse(cachedD)
        populateFolderCards()
        populateGalleryChips()
        applyCurrentFilters()
        return true
      }
    } catch (e) {}
    return false
  }

  // ==================================================================================================== //
  // INITIALIZATION
  // ==================================================================================================== //
  function initialize() {
    setupCaptureInterceptors()
    setupVideoModalIntegration()
    initInfiniteScroll()

    try {
      const cachedV = localStorage.getItem(STORAGE_KEYS.cachedVtubers)
      const cachedD = localStorage.getItem(STORAGE_KEYS.cachedVods)
      if (cachedV && cachedD) {
        loadedVtubers = JSON.parse(cachedV)
        loadedVods    = JSON.parse(cachedD)
      }
    } catch (e) {}

    if (getLoadOnStart()) {
      renderFromCache()
    }

    setTimeout(() => {
      if (window.SettingsAPI?.updateSetting) {
        window.SettingsAPI.updateSetting('fpLoadOnStartToggle', { default: getLoadOnStart() })
        window.SettingsAPI.updateSetting('fpUnavailableToggle',     { default: getIncludeUnavailable() })
      }
      updateStatsButton()
    }, 100)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize)
  } else {
    initialize()
  }
})()