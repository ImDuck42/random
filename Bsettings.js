// ==================================================================================================== //
// CONFIGURATION
// ==================================================================================================== //
const DANBOORU_ENDPOINT    = 'https://danbooru.donmai.us'
const DANBOORU_FOLDER_NAME = 'Danbooru Feed'
const DANBOORU_ACCENT      = 'peach'

const DANBOORU_SELECTORS = {
  galleryMasonry:   '.gallery-masonry',
  galleryGrid:      '.gallery-grid',
  folderGrid:       '.folder-grid',
  chipContainer:    '.chip-container',
  imageCountLabel:  '.image-count',
  searchInput:      '.search-input',
  searchSubmit:     '.search-submit',
  searchPill:       '.search-pill',
  navPill:          '.nav-pill',
  navTab:           '.tab',
  contentContainer: '.content',
  contentSections:  '.content > div',
}

const DANBOORU_CONFIG = {
  enabled:  localStorage.getItem('dbooru_enabled') === 'true',
  tags:     localStorage.getItem('dbooru_tags')           || 'order:rank rating:g',
  limit:    parseInt(localStorage.getItem('dbooru_limit') || '50', 10),
  username: localStorage.getItem('dbooru_user')           || '',
  apiKey:   localStorage.getItem('dbooru_key')            || '',
}

let danbooruFolderCache    = {}
let danbooruFolderQueryMap = new Map()

let danbooruPagination = {
  activeFolder: DANBOORU_FOLDER_NAME,
  query:        DANBOORU_CONFIG.tags,
  page:         1,
  isLoading:    false,
  hasMore:      true,
}

// ==================================================================================================== //
// METATAG DICTIONARY
// ==================================================================================================== //
const DANBOORU_METATAGS = [
  // Ratings
  { value: 'rating:general',      label: 'rating:general (Safe)',       type: 'meta' },
  { value: 'rating:sensitive',    label: 'rating:sensitive (SFW/Mild)', type: 'meta' },
  { value: 'rating:questionable', label: 'rating:questionable (Ecchi)', type: 'meta' },
  { value: 'rating:explicit',     label: 'rating:explicit (NSFW)',      type: 'meta' },

  // Sort Orders
  { value: 'order:rank',          label: 'order:rank (Top Trending)',   type: 'sort' },
  { value: 'order:score',         label: 'order:score (Highest Score)', type: 'sort' },
  { value: 'order:favcount',      label: 'order:favcount (Most Liked)', type: 'sort' },
  { value: 'order:id',            label: 'order:id (Newest First)',     type: 'sort' },
  { value: 'order:id_asc',        label: 'order:id_asc (Oldest First)', type: 'sort' },
  { value: 'order:mpixels',       label: 'order:mpixels (Resolution)',  type: 'sort' },
  { value: 'order:portrait',      label: 'order:portrait (Tallest)',    type: 'sort' },
  { value: 'order:landscape',     label: 'order:landscape (Widest)',    type: 'sort' },
  { value: 'order:filesize',      label: 'order:filesize (Largest MB)', type: 'sort' },

  // Score & Favorites
  { value: 'score:>100',          label: 'score:>100',                  type: 'meta' },
  { value: 'score:>500',          label: 'score:>500',                  type: 'meta' },
  { value: 'score:>1000',         label: 'score:>1000',                 type: 'meta' },
  { value: 'favcount:>50',        label: 'favcount:>50',                type: 'meta' },
  { value: 'favcount:>200',       label: 'favcount:>200',               type: 'meta' },

  // Aspect Ratios & Dimensions
  { value: 'ratio:portrait',      label: 'ratio:portrait',              type: 'meta' },
  { value: 'ratio:landscape',     label: 'ratio:landscape',             type: 'meta' },
  { value: 'ratio:square',        label: 'ratio:square',                type: 'meta' },
  { value: 'width:>1920',         label: 'width:>1920 (HD Width)',      type: 'meta' },
  { value: 'height:>1080',        label: 'height:>1080 (HD Height)',    type: 'meta' },
  { value: 'mpixels:>2',          label: 'mpixels:>2 (2MP+ High Res)',  type: 'meta' },

  // Media Types & Status
  { value: 'is:animated',         label: 'is:animated (GIF / Video)',   type: 'meta' },
  { value: 'is:parent',           label: 'is:parent (Has Variants)',    type: 'meta' },
  { value: 'status:active',       label: 'status:active',               type: 'meta' },
  { value: 'age:<1d',             label: 'age:<1d (Past 24 Hours)',     type: 'meta' },
  { value: 'age:<1w',             label: 'age:<1w (Past Week)',         type: 'meta' },
  { value: 'age:<1mo',            label: 'age:<1mo (Past Month)',       type: 'meta' },
]

// ==================================================================================================== //
// API FETCHER & AUTOCOMPLETE
// ==================================================================================================== //
async function fetchDanbooruApi(tagQuery, limit = 50, page = 1) {
  const queryTags = (tagQuery || 'order:rank').trim()

  const url = new URL(`${DANBOORU_ENDPOINT}/posts.json`)
  url.searchParams.set('tags',  queryTags)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('page',  String(page))

  if (DANBOORU_CONFIG.username && DANBOORU_CONFIG.apiKey) {
    url.searchParams.set('login',   DANBOORU_CONFIG.username)
    url.searchParams.set('api_key', DANBOORU_CONFIG.apiKey)
  }

  console.log(`[Danbooru] Fetching Page ${page}: ${url.toString()}`)
  const response = await fetch(url.toString())

  if (!response.ok) {
    // 401 / 403: Invalid Auth Credentials
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid Danbooru Username or API Key.')
    }
    // 410: Pagination Limit Reached
    if (response.status === 410) {
      console.log('[Danbooru] Pagination limit reached (410 Gone).')
      danbooruPagination.hasMore = false
      return []
    }
    // 429: Rate Limit Exceeded
    if (response.status === 429) {
      throw new Error('Rate limit reached (429 User Throttled). Please wait a moment.')
    }
    // 500: Statement / Query Timeout
    if (response.status === 500) {
      throw new Error('Danbooru query timed out. Avoid "score:>X" alone; use "order:rank" or "order:score".')
    }
    // 502 / 503: Maintenance / Downbooru
    if (response.status === 502 || response.status === 503) {
      throw new Error('Danbooru is temporarily unavailable / in maintenance (Downbooru).')
    }

    throw new Error(`Danbooru API error (${response.status})`)
  }

  const posts = await response.json()
  return posts.filter((post) => post.file_url || post.large_file_url || post.preview_file_url)
}

async function getHybridAutocomplete(rawToken) {
  if (!rawToken || rawToken.trim().length < 1) return []

  const cleanQuery = rawToken.trim()
  const matches    = []

  DANBOORU_METATAGS.forEach((meta) => {
    if (meta.value.toLowerCase().includes(cleanQuery.toLowerCase())) {
      matches.push({
        value: meta.value,
        label: meta.label,
        type:  meta.type,
        badge: meta.type.toUpperCase(),
      })
    }
  })

  if (cleanQuery.length >= 2) {
    try {
      const url = new URL(`${DANBOORU_ENDPOINT}/autocomplete.json`)
      url.searchParams.set('search[query]', cleanQuery)
      url.searchParams.set('search[type]',  'tag_query')
      url.searchParams.set('version',       '1')
      url.searchParams.set('limit',         '8')

      const response = await fetch(url.toString())
      if (response.ok) {
        const data = await response.json()
        data.forEach((item) => {
          const val   = item.value || item.label
          const count = item.post_count > 1000
            ? `${(item.post_count / 1000).toFixed(1)}k`
            : (item.post_count || '')

          matches.push({
            value: val,
            label: val,
            type:  'tag',
            badge: count ? `${count}` : 'TAG',
          })
        })
      }
    } catch {}
  }

  return matches.slice(0, 10)
}

// ==================================================================================================== //
// MASONRY PACKER & TAB NAVIGATION
// ==================================================================================================== //
function packDanbooruCard(card) {
  const grid  = document.querySelector(DANBOORU_SELECTORS.galleryMasonry)
  const image = card.querySelector('img')
  if (!grid || !image) return

  const applySpan = () => {
    if (!image.naturalWidth) return
    const gridStyles      = getComputedStyle(grid)
    const rowHeight       = parseFloat(gridStyles.getPropertyValue('grid-auto-rows')) || 1
    const rowGap          = parseFloat(gridStyles.getPropertyValue('gap')) || 20
    const cardWidth       = card.getBoundingClientRect().width || 250
    const scaledHeight    = cardWidth * (image.naturalHeight / image.naturalWidth)
    const rowSpan         = Math.ceil((scaledHeight + rowGap) / (rowHeight + rowGap))
    card.style.gridRowEnd = `span ${rowSpan}`
  }

  if (image.complete && image.naturalWidth) {
    applySpan()
  } else {
    image.addEventListener('load', applySpan)
  }
}

function switchToGalleryTab() {
  const tabs   = document.querySelectorAll(`${DANBOORU_SELECTORS.navPill} ${DANBOORU_SELECTORS.navTab}`)
  const panels = document.querySelectorAll(DANBOORU_SELECTORS.contentSections)

  tabs.forEach((tab, index)     => tab.classList.toggle('active', index   === 1))
  panels.forEach((panel, index) => panel.classList.toggle('active', index === 1))
}

function toggleFolderFilter(folderName) {
  const chip = document.querySelector(`${DANBOORU_SELECTORS.chipContainer} .chip[data-folder="${folderName}"]`)
  if (!chip) return

  const isCurrentlyActive = chip.classList.contains('active') && folderName !== 'all'

  if (isCurrentlyActive) {
    let prev = chip.previousElementSibling
    while (prev && (prev.style.display === 'none' || !prev.classList.contains('chip'))) {
      prev = prev.previousElementSibling
    }

    const targetFolder = prev?.dataset?.folder || 'all'

    if (folderName.startsWith('Booru:')) {
      chip.remove()
      document.querySelector(`${DANBOORU_SELECTORS.folderGrid} .folder-card[data-name="${folderName}"]`)?.remove()
      document.querySelectorAll(`.gallery-card[data-folder-name="${folderName}"]`).forEach((element) => element.remove())
      delete danbooruFolderCache[folderName]
    }

    filterByFolder(targetFolder)
  } else {
    filterByFolder(folderName)
  }
}

function rememberFolderQuery(folderName) {
  return Boolean(folderName) && folderName !== 'all' && folderName !== DANBOORU_FOLDER_NAME
}

function syncSearchInput(folderName) {
  const searchInput = document.querySelector(DANBOORU_SELECTORS.searchInput)
  const nextQuery   = rememberFolderQuery(folderName)
    ? (danbooruFolderQueryMap.get(folderName) || '')
    : ''

  if (searchInput) searchInput.value = nextQuery
}

function filterByFolder(folderName) {
  const previousFolder = danbooruPagination.activeFolder || 'all'
  const searchInput    = document.querySelector(DANBOORU_SELECTORS.searchInput)

  if (rememberFolderQuery(previousFolder) && searchInput) {
    const savedQuery = (searchInput.value || '').trim()
    danbooruFolderQueryMap.set(previousFolder, savedQuery)
  }

  const chips = document.querySelectorAll(`${DANBOORU_SELECTORS.chipContainer} .chip`)
  chips.forEach((chip) => chip.classList.toggle('active', chip.dataset.folder === folderName))

  danbooruPagination.activeFolder = folderName
  syncSearchInput(folderName)

  if (danbooruFolderCache[folderName]) {
    renderDanbooruCards(danbooruFolderCache[folderName], folderName, false)
  }

  let visibleCount = 0
  document.querySelectorAll(`${DANBOORU_SELECTORS.galleryMasonry} .gallery-card`).forEach((card) => {
    const matches      = folderName === 'all' || card.dataset.folderName === folderName
    card.style.display = matches ? '' : 'none'
    if (matches) {
      visibleCount += 1
      packDanbooruCard(card)
    }
  })

  const countLabel = document.querySelector(DANBOORU_SELECTORS.imageCountLabel)
  if (countLabel) countLabel.textContent = `${visibleCount} Images`
}

function renderDanbooruCards(posts, folderLabel, isAppend = false) {
  const gridContainer = document.querySelector(DANBOORU_SELECTORS.galleryMasonry)
  if (!gridContainer) return

  if (!isAppend) {
    document.querySelectorAll(`.gallery-card[data-folder-name="${folderLabel}"]`).forEach((element) => element.remove())
  }

  const fragment = document.createDocumentFragment()

  posts.forEach((post) => {
    if (isAppend && document.querySelector(`.gallery-card[data-id="${post.id}"]`)) return

    const size       = post.file_size             || (post.image_width * post.image_height) || 500000
    const cleanTitle = (post.tag_string_character || post.tag_string_artist                 || post.tag_string_general || 'Danbooru')
      .split(' ').slice(0, 3).join(' ')

    const imgUrl = post.large_file_url || post.file_url || post.preview_file_url

    const card              = document.createElement('div')
    card.className          = 'gallery-card'
    card.dataset.id         = post.id
    card.dataset.folderName = folderLabel
    card.dataset.name       = `#${post.id} ${cleanTitle}`
    card.dataset.size       = size
    card.dataset.date       = post.created_at ? new Date(post.created_at).getTime() : Date.now()
    card.dataset.type       = (post.file_ext || 'jpg').toLowerCase()

    card.style.setProperty('--accent', `var(--ctp-${DANBOORU_ACCENT}-rgb)`)
    card.innerHTML = `<img loading="lazy" decoding="async" src="${imgUrl}" alt="${cleanTitle}">`

    packDanbooruCard(card)
    fragment.appendChild(card)
  })

  gridContainer.appendChild(fragment)
}

function injectDanbooruPostsIntoGallery(posts, folderLabel = DANBOORU_FOLDER_NAME, isAppend = false) {
  if (!DANBOORU_CONFIG.enabled) return

  if (!posts || posts.length === 0) {
    console.warn(`[Danbooru] No posts returned for: "${folderLabel}"`)
    return
  }

  if (!danbooruFolderCache[folderLabel] || !isAppend) {
    danbooruFolderCache[folderLabel] = posts
  } else {
    danbooruFolderCache[folderLabel].push(...posts)
  }

  const allPosts      = danbooruFolderCache[folderLabel]
  const folderGrid    = document.querySelector(DANBOORU_SELECTORS.folderGrid)
  const chipContainer = document.querySelector(DANBOORU_SELECTORS.chipContainer)

  renderDanbooruCards(posts, folderLabel, isAppend)

  if (folderGrid) {
    let   folderCard = folderGrid.querySelector(`.folder-card[data-name="${folderLabel}"]`)
    const totalBytes = allPosts.reduce((acc, post) => acc + (post.file_size || 500000), 0)
    const sizeMB     = (totalBytes / (1024 * 1024)).toFixed(1)
    const previewUrl = allPosts[0].preview_file_url || allPosts[0].large_file_url || allPosts[0].file_url

    if (!folderCard) {
      folderCard              = document.createElement('div')
      folderCard.className    = 'folder-card'
      folderCard.dataset.name = folderLabel
      folderCard.dataset.size = sizeMB
      folderCard.dataset.date = Date.now()
      folderCard.dataset.type = 'folder'
      folderCard.style.setProperty('--accent', `var(--ctp-${DANBOORU_ACCENT}-rgb)`)

      folderCard.innerHTML = `
        <div class="folder-tab"><span class="file-count">${allPosts.length} Files</span></div>
        <div class="folder-body">
          <div class="folder-preview"><img decoding="async" src="${previewUrl}" alt="${folderLabel}"></div>
          <div class="folder-info">
            <h3   class="folder-title"><span>${folderLabel}</span></h3>
            <span class="folder-size">${sizeMB} MB</span>
          </div>
        </div>
      `
      folderCard.addEventListener('click', () => {
        switchToGalleryTab()
        filterByFolder(folderLabel)
      })
      folderGrid.appendChild(folderCard)
    } else {
      folderCard.querySelector('.file-count').textContent  = `${allPosts.length} Files`
      folderCard.querySelector('.folder-size').textContent = `${sizeMB} MB`

      const previewContainer = folderCard.querySelector('.folder-preview')
      if (previewContainer) {
        previewContainer.innerHTML = `<img decoding="async" src="${previewUrl}" alt="${folderLabel}">`
      }
    }
  }

  if (chipContainer) {
    let chip = chipContainer.querySelector(`.chip[data-folder="${folderLabel}"]`)
    if (!chip) {
      chip                = document.createElement('button')
      chip.className      = 'chip'
      chip.dataset.folder = folderLabel
      chip.innerHTML      = `<span>${folderLabel}</span>`
      chip.addEventListener('click', () => toggleFolderFilter(folderLabel))
      chipContainer.appendChild(chip)
    }
  }

  if (!isAppend) {
    filterByFolder(folderLabel)
  } else {
    const totalVisible = document.querySelectorAll(`${DANBOORU_SELECTORS.galleryMasonry} .gallery-card:not([style*="display: none"])`).length
    const countLabel   = document.querySelector(DANBOORU_SELECTORS.imageCountLabel)
    if (countLabel) countLabel.textContent = `${totalVisible} Images`
  }
}

// ==================================================================================================== //
// INFINITE SCROLL
// ==================================================================================================== //
async function loadMoreDanbooruPosts() {
  if (danbooruPagination.isLoading || !danbooruPagination.hasMore || !DANBOORU_CONFIG.enabled) return

  const isGalleryActive  = document.querySelector(DANBOORU_SELECTORS.galleryGrid)?.classList.contains('active')
  const isDanbooruActive = danbooruPagination.activeFolder.startsWith('Danbooru') || danbooruPagination.activeFolder.startsWith('Booru:')

  if (!isGalleryActive || !isDanbooruActive) return

  danbooruPagination.isLoading = true
  const nextPage               = danbooruPagination.page + 1

  console.log(`[Danbooru] Loading page ${nextPage} for "${danbooruPagination.query}"...`)

  try {
    const posts = await fetchDanbooruApi(danbooruPagination.query, DANBOORU_CONFIG.limit, nextPage)
    if (!posts || posts.length === 0) {
      danbooruPagination.hasMore = false
      console.log('[Danbooru] Reached end of results.')
      return
    }

    danbooruPagination.page = nextPage
    injectDanbooruPostsIntoGallery(posts, danbooruPagination.activeFolder, true)
  } catch (error) {
    console.warn('[Danbooru] Infinite scroll fetch error:', error.message)
  } finally {
    danbooruPagination.isLoading = false
  }
}

function initDanbooruInfiniteScroll() {
  const contentPanel = document.querySelector(DANBOORU_SELECTORS.contentContainer)
  if (!contentPanel) return

  contentPanel.addEventListener('scroll', () => {
    if (!DANBOORU_CONFIG.enabled) return
    const isNearBottom = contentPanel.scrollHeight - contentPanel.scrollTop - contentPanel.clientHeight < 800
    if (isNearBottom) {
      loadMoreDanbooruPosts()
    }
  }, { passive: true })
}

// ==================================================================================================== //
// SEARCH BAR & AUTOCOMPLETE
// ==================================================================================================== //
function getCurrentWordToken(inputElement) {
  const fullText     = inputElement.value
  const cursorPos    = inputElement.selectionStart || fullText.length
  const leftOfCursor = fullText.slice(0, cursorPos)
  const words        = leftOfCursor.split(/\s+/)
  const currentWord  = words[words.length - 1] || ''

  return {
    word:           currentWord,
    wordStartIndex: cursorPos - currentWord.length,
    wordEndIndex:   cursorPos,
  }
}

function replaceCurrentWordToken(inputElement, replacement) {
  const fullText  = inputElement.value
  const cursorPos = inputElement.selectionStart ?? fullText.length
  const leftText  = fullText.slice(0, cursorPos)
  const rightText = fullText.slice(cursorPos)
  const selected  = String(replacement || '').trim()

  const leftMatch  = leftText.match(/[^\s]+$/)
  const rightMatch = rightText.match(/^[^\s]+/)
  const tokenStart = leftMatch  ? cursorPos - leftMatch[0].length  : cursorPos
  const tokenEnd   = rightMatch ? cursorPos + rightMatch[0].length : cursorPos

  const before   = fullText.slice(0, tokenStart)
  const after    = fullText.slice(tokenEnd)
  const inserted = `${selected} `
  const newText  = `${before}${inserted}${after}`

  inputElement.value = newText
  inputElement.focus()
  const newCursor = before.length + inserted.length
  inputElement.setSelectionRange(newCursor, newCursor)
}

function setupAutocompleteDropdown() {
  const searchPill  = document.querySelector(DANBOORU_SELECTORS.searchPill)
  const searchInput = document.querySelector(DANBOORU_SELECTORS.searchInput)
  if (!searchPill || !searchInput) return

  if (!document.getElementById('booru-autocomplete-styles')) {
    const style       = document.createElement('style')
    style.id          = 'booru-autocomplete-styles'
    style.textContent = `
      .search-pill { position: relative; }
      .booru-autocomplete-list {
        position:         absolute;
        top:              calc(100% + 8px);
        left:             0;
        right:            0;
        background-color: rgb(var(--ctp-surface0-rgb));
        border:           3px solid rgb(var(--ctp-surface2-rgb));
        border-radius:    16px;
        box-shadow:       0 8px 24px rgb(var(--ctp-crust-rgb));
        z-index:          1000;
        max-height:       280px;
        overflow-y:       auto;
        display:          none;
        flex-direction:   column;
        padding:          6px;
        gap:              4px;
      }
      .booru-autocomplete-list.open { display: flex; }
      .booru-item {
        display:          flex;
        align-items:      center;
        justify-content:  space-between;
        padding:          8px 14px;
        border-radius:    8px;
        cursor:           pointer;
        font:             750 0.85rem sans-serif;
        color:            rgb(var(--ctp-text-rgb));
        transition:       all 0.15s ease;
      }
      .booru-item:hover, .booru-item.selected {
        background-color: rgb(var(--ctp-surface1-rgb));
        color:            rgb(var(--ctp-peach-rgb));
      }
      .booru-badge {
        font-size:        0.72rem;
        font-weight:      800;
        padding:          2px 8px;
        border-radius:    6px;
        background:       rgb(var(--ctp-mantle-rgb));
        color:            rgb(var(--ctp-subtext0-rgb));
      }
      .booru-badge.sort {
        background:       rgba(var(--ctp-sapphire-rgb), 0.2);
        color:            rgb(var(--ctp-sapphire-rgb));
      }
      .booru-badge.meta {
        background:       rgba(var(--ctp-mauve-rgb), 0.2);
        color:            rgb(var(--ctp-mauve-rgb));
      }
    `
    document.head.appendChild(style)
  }

  let dropdown = searchPill.querySelector('.booru-autocomplete-list')
  if (!dropdown) {
    dropdown           = document.createElement('div')
    dropdown.className = 'booru-autocomplete-list'
    searchPill.appendChild(dropdown)
  }

  let debounceTimer = null

  const closeDropdown = () => {
    dropdown.classList.remove('open')
    dropdown.innerHTML = ''
  }

  searchInput.addEventListener('input', (event) => {
    if (!DANBOORU_CONFIG.enabled) return
    event.stopImmediatePropagation()

    const rawVal = searchInput.value.trim().toLowerCase()

    if (rawVal === '') {
      closeDropdown()
      let visibleCount = 0
      document.querySelectorAll(`${DANBOORU_SELECTORS.galleryMasonry} .gallery-card`).forEach((card) => {
        const belongsToActive = danbooruPagination.activeFolder === 'all' || card.dataset.folderName === danbooruPagination.activeFolder
        card.style.display    = belongsToActive ? '' : 'none'
        if (belongsToActive) {
          visibleCount += 1
          packDanbooruCard(card)
        }
      })

      const countLabel = document.querySelector(DANBOORU_SELECTORS.imageCountLabel)
      if (countLabel) countLabel.textContent = `${visibleCount} Images`
      return
    }

    let visibleCount = 0
    document.querySelectorAll(`${DANBOORU_SELECTORS.galleryMasonry} .gallery-card`).forEach((card) => {
      const belongsToActive = danbooruPagination.activeFolder === 'all' || card.dataset.folderName === danbooruPagination.activeFolder
      const matchesQuery    = (card.dataset.name                        || '').toLowerCase().includes(rawVal)
      const show            = belongsToActive && matchesQuery

      card.style.display = show ? '' : 'none'
      if (show) {
        visibleCount += 1
        packDanbooruCard(card)
      }
    })

    const countLabel = document.querySelector(DANBOORU_SELECTORS.imageCountLabel)
    if (countLabel) countLabel.textContent = `${visibleCount} Images`

    const tokenInfo = getCurrentWordToken(searchInput)
    const token     = tokenInfo.word

    if (!token || token.length < 1) {
      closeDropdown()
      return
    }

    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      const results = await getHybridAutocomplete(token)
      if (!results || results.length === 0) {
        closeDropdown()
        return
      }

      dropdown.innerHTML = ''
      results.forEach((item) => {
        const row     = document.createElement('div')
        row.className = 'booru-item'
        row.innerHTML = `
          <span>${item.label}</span>
          <span class="booru-badge ${item.type}">${item.badge}</span>
        `

        row.addEventListener('click', (ev) => {
          ev.stopPropagation()
          replaceCurrentWordToken(searchInput, item.value)
          closeDropdown()
        })

        dropdown.appendChild(row)
      })

      dropdown.classList.add('open')
    }, 150)
  }, { capture: true })

  document.addEventListener('click', (event) => {
    if (!searchPill.contains(event.target)) closeDropdown()
  })
}

async function triggerDanbooruSearch(tagQuery) {
  if (!DANBOORU_CONFIG.enabled) return

  const searchInput = document.querySelector(DANBOORU_SELECTORS.searchInput)
  const query       = (tagQuery || searchInput?.value || '').trim()

  if (!query) {
    filterByFolder(danbooruPagination.activeFolder)
    return
  }

  const searchFolderName = `Booru: ${query}`
  danbooruFolderQueryMap.set(searchFolderName, query)
  console.log(`[Danbooru] Searching tags: "${query}"`)
  if (searchInput) searchInput.disabled = true

  danbooruPagination.activeFolder = searchFolderName
  danbooruPagination.query        = query
  danbooruPagination.page         = 1
  danbooruPagination.hasMore      = true

  try {
    const posts = await fetchDanbooruApi(query, DANBOORU_CONFIG.limit, 1)
    injectDanbooruPostsIntoGallery(posts, searchFolderName, false)
    switchToGalleryTab()
  } catch (error) {
    console.warn('[Danbooru] Search failed:', error.message)
  } finally {
    if (searchInput) {
      searchInput.disabled = false
      searchInput.focus()
    }
  }
}

function initSearchbarDanbooruHook() {
  const searchInput  = document.querySelector(DANBOORU_SELECTORS.searchInput)
  const searchSubmit = document.querySelector(DANBOORU_SELECTORS.searchSubmit)
  if (!searchInput || searchInput.dataset.danbooruHooked) return

  searchInput.dataset.danbooruHooked = 'true'
  setupAutocompleteDropdown()

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      if (!DANBOORU_CONFIG.enabled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      document.querySelector('.booru-autocomplete-list')?.classList.remove('open')
      triggerDanbooruSearch(searchInput.value)
    }
  }, { capture: true })

  if (searchSubmit) {
    searchSubmit.addEventListener('click', (event) => {
      if (!DANBOORU_CONFIG.enabled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      document.querySelector('.booru-autocomplete-list')?.classList.remove('open')
      triggerDanbooruSearch(searchInput.value)
    }, { capture: true })
  }
}

// ==================================================================================================== //
// SETTINGS ACTIONS
// ==================================================================================================== //
function saveDanbooruAuth(username, apiKey) {
  DANBOORU_CONFIG.username = (username || '').trim()
  DANBOORU_CONFIG.apiKey   = (apiKey   || '').trim()

  localStorage.setItem('dbooru_user', DANBOORU_CONFIG.username)
  localStorage.setItem('dbooru_key',  DANBOORU_CONFIG.apiKey)

  console.log('[Danbooru] Credentials saved.')
}

async function fetchDanbooruFeed(tags, limit, isManual = false) {
  if (!DANBOORU_CONFIG.enabled) return

  const queryTags  = tags  !== undefined ? tags  : DANBOORU_CONFIG.tags
  const queryLimit = limit !== undefined ? limit : DANBOORU_CONFIG.limit

  DANBOORU_CONFIG.tags  = queryTags
  DANBOORU_CONFIG.limit = queryLimit
  localStorage.setItem('dbooru_tags',  queryTags)
  localStorage.setItem('dbooru_limit', String(queryLimit))

  danbooruPagination.activeFolder = DANBOORU_FOLDER_NAME
  danbooruPagination.query        = queryTags
  danbooruPagination.page         = 1
  danbooruPagination.hasMore      = true

  try {
    const posts = await fetchDanbooruApi(queryTags, queryLimit, 1)
    injectDanbooruPostsIntoGallery(posts, DANBOORU_FOLDER_NAME, false)
    console.log(`[Danbooru] Synced ${posts.length} posts.`)
  } catch (error) {
    console.warn(`[Danbooru] Sync failed: ${error.message}`)
  }
}

function clearDanbooruImages() {
  document.querySelectorAll('.gallery-card[data-folder-name^="Danbooru"], .gallery-card[data-folder-name^="Booru:"]').forEach((card) => card.remove())
  document.querySelectorAll('.folder-card[data-name^="Danbooru"],         .folder-card[data-name^="Booru:"]').forEach((card)         => card.remove())
  document.querySelectorAll('.chip[data-folder^="Danbooru"],              .chip[data-folder^="Booru:"]').forEach((chip)              => chip.remove())

  document.querySelector('.booru-autocomplete-list')?.remove()
  document.getElementById('booru-autocomplete-styles')?.remove()

  danbooruFolderCache     = {}
  danbooruPagination.page = 1

  const allChip = document.querySelector(`${DANBOORU_SELECTORS.chipContainer} .chip[data-folder="all"]`)
  if (allChip) allChip.classList.add('active')

  const countLabel = document.querySelector(DANBOORU_SELECTORS.imageCountLabel)
  if (countLabel) {
    const totalVisible     = document.querySelectorAll(`${DANBOORU_SELECTORS.galleryMasonry} .gallery-card`).length
    countLabel.textContent = `${totalVisible} Images`
  }
}

function toggleDanbooruIntegration(enabled) {
  DANBOORU_CONFIG.enabled = Boolean(enabled) && String(enabled) !== 'false'
  localStorage.setItem('dbooru_enabled', String(DANBOORU_CONFIG.enabled))

  if (!enabled) {
    clearDanbooruImages()
  } else {
    setupAutocompleteDropdown()
    fetchDanbooruFeed(undefined, undefined, false)
  }
}

function populateDanbooruSettings() {
  const update = window.SettingsAPI?.updateSetting
  if (typeof update === 'function') {
    if (DANBOORU_CONFIG.username) update('danbooruUsername',    { default: DANBOORU_CONFIG.username })
    if (DANBOORU_CONFIG.enabled)  update('danbooruToggle',      { default: DANBOORU_CONFIG.enabled})
    if (DANBOORU_CONFIG.apiKey)   update('danbooruApiKey',      { default: DANBOORU_CONFIG.apiKey })
    if (DANBOORU_CONFIG.limit)    update('danbooruFetchLimit',  { default: DANBOORU_CONFIG.limit })
    if (DANBOORU_CONFIG.tags)     update('danbooruDefaultTags', { default: DANBOORU_CONFIG.tags })
  }
}

// ==================================================================================================== //
// INITIALIZATION
// ==================================================================================================== //
function initDanbooruExtension() {
  initSearchbarDanbooruHook()
  initDanbooruInfiniteScroll()
  setTimeout(populateDanbooruSettings, 100)

  if (DANBOORU_CONFIG.enabled) {
    fetchDanbooruFeed(undefined, undefined, false)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDanbooruExtension)
} else {
  initDanbooruExtension()
}