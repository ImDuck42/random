// ==================================================================================================== //
// CONFIGURATION
// ==================================================================================================== //
const DISCORD_API_BASE   = 'https://discord.com/api/v10'
const DISCORD_EPOCH      = 1420070400000n
const ALLOWED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const ALLOWED_VIDEO_EXTS = ['mp4', 'webm', 'mov']

const DISCORD_SELECTORS = {
  contentPanel:    '.content',
  folderGrid:      '.folder-grid',
  galleryMasonry:  '.gallery-masonry',
  chipContainer:   '.chip-container',
  fullScreenModal: '.full-screen',
  fullScreenImage: '.full-screen-img',
  sortPill:        '.sort-pill',
  sortActive:      '.sort-pill .sort-option.active',
  navTabs:         '.nav-pill .tab',
  imageCountLabel: '.image-count',
}

const STORAGE_KEYS = {
  token:       'discord_token',
  servers:     'discord_servers',
  channels:    'discord_channels',
  isWhitelist: 'discord_is_whitelist',
}

const discordState = {
  currentChannel:     null,
  currentChannelName: '',
  lastMessageId:      null,
  isLoading:          false,
  hasMore:            true,
  mediaCards:         [],
  previewQueueToken:  0,
}

let modalOpenedTimestamp = 0

// ==================================================================================================== //
// STORAGE & UTILITY
// ==================================================================================================== //
function getStoredArray(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

function setStoredArray(key, array) {
  localStorage.setItem(key, JSON.stringify(array))
}

function snowflakeToTimestamp(id) {
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
  } catch {
    return Date.now()
  }
}

function getStoredAuthHeader() {
  const token = localStorage.getItem(STORAGE_KEYS.token)
  if (!token) throw new Error('No Discord token saved. Configure authentication in Settings.')
  return token
}

// ==================================================================================================== //
// SETTINGS INTEGRATION
// ==================================================================================================== //
window.discord_saveToken = function(type, token) {
  const trimmed = (token || '').trim()
  if (!trimmed) return alert('Please enter a valid token.')

  const authHeader = type === 'Bot' ? `Bot ${trimmed}` : trimmed
  localStorage.setItem(STORAGE_KEYS.token, authHeader)
  alert(`Token saved successfully as [${type}].`)
}

window.discord_toggleFilterMode = function(isWhitelist) {
  localStorage.setItem(STORAGE_KEYS.isWhitelist, isWhitelist ? 'true' : 'false')
  setTimeout(() => {
    const label = document.querySelector('.entry[data-entry-id="discordChannels"] .label')
    if (label) {
      label.textContent = isWhitelist ? 'Channel Filters (WHITELIST)' : 'Channel Filters (BLACKLIST)'
    }
  }, 0)
}

window.discord_addServer = function(serverId) {
  const id = (serverId || '').trim()
  if (!id) return

  const servers = getStoredArray(STORAGE_KEYS.servers)
  if (!servers.includes(id)) {
    servers.push(id)
    setStoredArray(STORAGE_KEYS.servers, servers)
    syncServerDropdown()
  }
}

window.discord_removeServer = function() {
  const wrapper  = document.getElementById('discordServerList')?.closest('.dropdown')
  const selected = wrapper?.querySelector('.options .selected')?.dataset.value
  if (!selected) return

  const servers = getStoredArray(STORAGE_KEYS.servers).filter((item) => item !== selected)
  setStoredArray(STORAGE_KEYS.servers, servers)
  syncServerDropdown()
}

window.discord_addChannel = function(channelId) {
  const id = (channelId || '').trim()
  if (!id) return

  const channels = getStoredArray(STORAGE_KEYS.channels)
  if (!channels.includes(id)) {
    channels.push(id)
    setStoredArray(STORAGE_KEYS.channels, channels)
    syncChannelDropdown()
  }
}

window.discord_removeChannel = function() {
  const wrapper  = document.getElementById('discordChannelList')?.closest('.dropdown')
  const selected = wrapper?.querySelector('.options .selected')?.dataset.value
  if (!selected) return

  const channels = getStoredArray(STORAGE_KEYS.channels).filter((item) => item !== selected)
  setStoredArray(STORAGE_KEYS.channels, channels)
  syncChannelDropdown()
}

function syncServerDropdown() {
  const servers = getStoredArray(STORAGE_KEYS.servers)
  const options = servers.length > 0
    ? servers.map((server) => ({ value: server, label: server }))
    : [{ value: '', label: 'No Servers Added' }]

  window.SettingsAPI?.updateSetting('discordServerList', { options, default: options[0].value })
}

function syncChannelDropdown() {
  const channels = getStoredArray(STORAGE_KEYS.channels)
  const options  = channels.length > 0
    ? channels.map((channel) => ({ value: channel, label: channel }))
    : [{ value: '', label: 'No Filtered Channels' }]

  window.SettingsAPI?.updateSetting('discordChannelList', { options, default: options[0].value })
}

// ==================================================================================================== //
// DISCORD API
// ==================================================================================================== //
window.discord_loadFolders = async function() {
  const servers     = getStoredArray(STORAGE_KEYS.servers)
  const filterList  = getStoredArray(STORAGE_KEYS.channels)
  const isWhitelist = localStorage.getItem(STORAGE_KEYS.isWhitelist) === 'true'
  const grid        = document.querySelector(DISCORD_SELECTORS.folderGrid)

  if (servers.length === 0) return alert('Please add at least one Discord Server ID in Settings.')

  document.querySelectorAll(DISCORD_SELECTORS.navTabs)[0]?.click()

  try {
    const authHeader = getStoredAuthHeader()

    for (const serverId of servers) {
      const response = await fetch(`${DISCORD_API_BASE}/guilds/${serverId}/channels`, {
        headers: { Authorization: authHeader },
      })

      if (!response.ok) {
        console.warn(`[Discord Plugin] Failed to fetch server ${serverId} (HTTP ${response.status})`)
        continue
      }

      const channels = await response.json()
      channels.sort((channelA, channelB) => channelA.position - channelB.position)

      channels.forEach((channel) => {
        if (![0, 2, 5, 15].includes(channel.type)) return

        if (isWhitelist && !filterList.includes(channel.id)) return
        if (!isWhitelist && filterList.includes(channel.id)) return

        createDiscordFolderCard(channel, grid)
      })

      queueChannelFolderPreviews(channels, filterList, isWhitelist, authHeader)
    }
  } catch (error) {
    alert(`Discord Connection Error: ${error.message}`)
  }
}

async function queueChannelFolderPreviews(channels, filterList, isWhitelist, authHeader) {
  const currentToken = ++discordState.previewQueueToken

  for (const channel of channels) {
    if (currentToken !== discordState.previewQueueToken) break
    if (![0, 2, 5, 15].includes(channel.type)) continue
    if (isWhitelist && !filterList.includes(channel.id)) continue
    if (!isWhitelist && filterList.includes(channel.id)) continue

    try {
      const response = await fetch(`${DISCORD_API_BASE}/channels/${channel.id}/messages?limit=15`, {
        headers: { Authorization: authHeader },
      })

      if (response.ok) {
        const messages = await response.json()
        for (const message of messages) {
          if (!message.attachments || message.attachments.length === 0) continue

          const mediaAttachment = message.attachments.find((attachment) => {
            const extension = (attachment.filename.split('.').pop() || '').toLowerCase()
            return ALLOWED_IMAGE_EXTS.includes(extension)
          })

          if (mediaAttachment) {
            const previewContainer = document.getElementById(`discord-preview-${channel.id}`)
            if (previewContainer) {
              previewContainer.innerHTML = `<img loading="lazy" decoding="async" src="${mediaAttachment.url}" alt="${channel.name} Preview">`
            }
            break
          }
        }
      }
    } catch (error) {
      console.warn(`[Discord Plugin] Preview fetch error for channel ${channel.id}:`, error)
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function openDiscordChannelInGallery(channelId, channelName) {
  discordState.currentChannel     = channelId
  discordState.currentChannelName = channelName
  discordState.lastMessageId      = null
  discordState.isLoading          = false
  discordState.hasMore            = true
  discordState.mediaCards         = []

  document.querySelectorAll(DISCORD_SELECTORS.navTabs)[1]?.click()

  document.querySelectorAll(`${DISCORD_SELECTORS.galleryMasonry} .gallery-card`).forEach((card) => {
    card.style.display = 'none'
  })

  const chipContainer = document.querySelector(DISCORD_SELECTORS.chipContainer)
  if (chipContainer) {
    chipContainer.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('active'))

    let discordChip = document.getElementById('discord-temp-chip')
    if (!discordChip) {
      discordChip           = document.createElement('button')
      discordChip.id        = 'discord-temp-chip'
      discordChip.className = 'chip active'
      discordChip.dataset.folder = `discord-${channelId}`
      chipContainer.appendChild(discordChip)
    }

    discordChip.innerHTML = `<span># ${channelName}</span>`
    discordChip.classList.add('active')
  }

  document.querySelectorAll(`${DISCORD_SELECTORS.galleryMasonry} .gallery-card.discord-media`).forEach((card) => card.remove())

  fetchDiscordMediaBatch()
}

async function fetchDiscordMediaBatch() {
  if (discordState.isLoading || !discordState.hasMore) return
  discordState.isLoading = true

  const grid = document.querySelector(DISCORD_SELECTORS.galleryMasonry)
  if (!grid) return

  try {
    let mediaResolvedCount = 0
    let skippedBatches     = 0

    while (mediaResolvedCount === 0 && discordState.hasMore && skippedBatches < 5) {
      skippedBatches += 1

      let endpointUrl = `${DISCORD_API_BASE}/channels/${discordState.currentChannel}/messages?limit=100`
      if (discordState.lastMessageId) endpointUrl += `&before=${discordState.lastMessageId}`

      const response = await fetch(endpointUrl, {
        headers: { Authorization: getStoredAuthHeader() },
      })

      if (!response.ok) {
        if (response.status === 401) throw new Error('401 Unauthorized: Invalid Token.')
        if (response.status === 403) throw new Error('403 Forbidden: Missing permissions to read history.')
        throw new Error(`HTTP Error ${response.status}`)
      }

      const messages = await response.json()
      if (messages.length < 100) discordState.hasMore = false
      if (messages.length === 0) break

      discordState.lastMessageId = messages[messages.length - 1].id

      messages.forEach((message) => {
        if (!message.attachments) return

        message.attachments.forEach((attachment) => {
          const extension = (attachment.filename.split('.').pop() || '').toLowerCase()
          const isImage   = ALLOWED_IMAGE_EXTS.includes(extension)
          const isVideo   = ALLOWED_VIDEO_EXTS.includes(extension)

          if (isImage || isVideo) {
            mediaResolvedCount += 1
            createDiscordMediaCard(attachment, extension, grid)
          }
        })
      })
    }

    const countLabel = document.querySelector(DISCORD_SELECTORS.imageCountLabel)
    if (countLabel) countLabel.textContent = `${discordState.mediaCards.length} Media`
  } catch (error) {
    console.error('[Discord Plugin] Fetch error:', error)
    alert(`Discord Error: ${error.message}`)
  } finally {
    discordState.isLoading = false
  }
}

// ==================================================================================================== //
// DOM CARD & MASONRY
// ==================================================================================================== //
function createDiscordFolderCard(channel, gridContainer) {
  const card = document.createElement('div')
  card.className = 'folder-card discord-folder'
  card.style.setProperty('--accent', 'var(--ctp-mauve-rgb)')

  card.dataset.name = channel.name.toLowerCase()
  card.dataset.size = '0'
  card.dataset.date = String(snowflakeToTimestamp(channel.id))
  card.dataset.type = 'folder'

  card.innerHTML = `
    <div class="folder-tab">
      <span class="file-count">Discord</span>
    </div>
    <div class="folder-body">
      <div class="folder-preview" id="discord-preview-${channel.id}">
        <i class="brands fa-discord"></i>
      </div>
      <div class="folder-info">
        <h3 class="folder-title">
          <span># ${channel.name}</span>
        </h3>
        <span class="folder-size">Cloud</span>
      </div>
    </div>
  `

  card.addEventListener('click', () => {
    openDiscordChannelInGallery(channel.id, channel.name)
  })

  gridContainer.appendChild(card)
}

function createDiscordMediaCard(attachment, extension, gridContainer) {
  const card = document.createElement('div')
  card.className = 'gallery-card discord-media'
  card.style.setProperty('--accent', 'var(--ctp-mauve-rgb)')

  card.dataset.name       = (attachment.filename || '').toLowerCase()
  card.dataset.size       = String(attachment.size || 0)
  card.dataset.date       = String(snowflakeToTimestamp(attachment.id))
  card.dataset.type       = extension
  card.dataset.folderName = discordState.currentChannelName

  if (ALLOWED_IMAGE_EXTS.includes(extension)) {
    const image = document.createElement('img')
    image.loading  = 'lazy'
    image.decoding = 'async'
    image.src      = attachment.url
    image.alt      = attachment.filename
    image.addEventListener('load', () => packDiscordCard(card, image.naturalWidth, image.naturalHeight))

    card.addEventListener('click', () => {
      openDiscordFullscreenMedia(attachment.url, 'image')
    })

    card.appendChild(image)
  } else if (ALLOWED_VIDEO_EXTS.includes(extension)) {
    const container = document.createElement('div')
    container.className = 'discord-video-container'

    const video = document.createElement('video')
    video.src      = attachment.url
    video.controls = true
    video.preload  = 'metadata'
    video.addEventListener('loadedmetadata', () => packDiscordCard(card, video.videoWidth, video.videoHeight))

    const shiftOverlay = document.createElement('div')
    shiftOverlay.className = 'discord-shift-overlay'
    shiftOverlay.title     = 'Shift + Click to View Fullscreen'
    shiftOverlay.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      video.pause()
      openDiscordFullscreenMedia(attachment.url, 'video')
    })

    const expandButton = document.createElement('button')
    expandButton.type      = 'button'
    expandButton.className = 'discord-fs-btn'
    expandButton.title     = 'Open Fullscreen'
    expandButton.innerHTML = '<i class="fas fa-expand"></i>'
    expandButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      video.pause()
      openDiscordFullscreenMedia(attachment.url, 'video')
    })

    container.append(video, shiftOverlay, expandButton)
    card.appendChild(container)
  }

  discordState.mediaCards.push(card)
  gridContainer.appendChild(card)
}

function packDiscordCard(card, naturalWidth, naturalHeight) {
  const grid = document.querySelector(DISCORD_SELECTORS.galleryMasonry)
  if (!grid || !naturalWidth) return

  const gridStyles   = getComputedStyle(grid)
  const rowHeight    = parseFloat(gridStyles.getPropertyValue('grid-auto-rows'))
  const rowGap       = parseFloat(gridStyles.getPropertyValue('gap'))
  const cardWidth    = card.getBoundingClientRect().width
  const scaledHeight = cardWidth * (naturalHeight / naturalWidth)

  const rowSpan         = Math.ceil((scaledHeight + rowGap) / (rowHeight + rowGap))
  card.style.gridRowEnd = `span ${rowSpan}`
}

// ==================================================================================================== //
// FULLSCREEN MODAL
// ==================================================================================================== //
function scaleFullscreenVideo(videoElement) {
  if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) return

  const videoRatio    = videoElement.videoWidth / videoElement.videoHeight
  const containerPad  = 20
  const maxAvailableW = window.innerWidth  - containerPad
  const maxAvailableH = window.innerHeight - containerPad
  const viewportRatio = maxAvailableW / maxAvailableH

  if (videoRatio > viewportRatio) {
    videoElement.style.width  = `${maxAvailableW}px`
    videoElement.style.height = `${Math.round(maxAvailableW / videoRatio)}px`
  } else {
    videoElement.style.height = `${maxAvailableH}px`
    videoElement.style.width  = `${Math.round(maxAvailableH * videoRatio)}px`
  }
}

function openDiscordFullscreenMedia(mediaUrl, mediaType) {
  const modal = document.querySelector(DISCORD_SELECTORS.fullScreenModal)
  if (!modal) return

  const modalImage     = modal.querySelector(DISCORD_SELECTORS.fullScreenImage)
  modalOpenedTimestamp = Date.now()

  modal.querySelector('.full-screen-video')?.remove()

  if (mediaType === 'image') {
    if (modalImage) {
      modalImage.style.display = ''
      modalImage.src = mediaUrl
      modalImage.onload = () => {
        const imageRatio    = modalImage.naturalWidth / modalImage.naturalHeight
        const viewportRatio = window.innerWidth       / window.innerHeight
        if (imageRatio > viewportRatio) {
          modalImage.style.width  = '100%'
          modalImage.style.height = 'auto'
        } else {
          modalImage.style.height = '100%'
          modalImage.style.width  = 'auto'
        }
      }
    }
    modal.classList.add('active')
  } else if (mediaType === 'video') {
    if (modalImage) modalImage.style.display = 'none'

    const video = document.createElement('video')
    video.className = 'full-screen-img full-screen-video'
    video.src       = mediaUrl
    video.controls  = true
    video.autoplay  = true

    const triggerScaling = () => scaleFullscreenVideo(video)
    video.addEventListener('loadedmetadata', triggerScaling)
    video.addEventListener('loadeddata',     triggerScaling)
    video.addEventListener('canplay',        triggerScaling)
    video.addEventListener('playing',        triggerScaling)

    if (video.readyState >= 1) triggerScaling()

    let pollCount = 0
    const pollTimer = setInterval(() => {
      pollCount += 1
      if (video.videoWidth > 0) {
        triggerScaling()
        clearInterval(pollTimer)
      } else if (pollCount > 20) {
        clearInterval(pollTimer)
      }
    }, 50)

    video.addEventListener('pointerdown', (event) => event.stopPropagation())
    video.addEventListener('click',       (event) => event.stopPropagation())

    modal.appendChild(video)
    modal.classList.add('active')
  }
}

// ==================================================================================================== //
// SORT PILL
// ==================================================================================================== //
function sortDiscordGalleryMedia() {
  const grid = document.querySelector(DISCORD_SELECTORS.galleryMasonry)
  if (!grid || !discordState.currentChannel || discordState.mediaCards.length === 0) return

  grid.querySelectorAll('.gallery-card:not(.discord-media)').forEach((card) => {
    card.style.display = 'none'
  })

  const activeOption  = document.querySelector(DISCORD_SELECTORS.sortActive)
  const sortKey       = activeOption?.dataset.sort      || 'name'
  const sortDirection = activeOption?.dataset.direction || 'up'

  discordState.mediaCards.sort((cardA, cardB) => {
    if (sortKey === 'type') {
      return (Math.random() > 0.5 ? 1 : -1) * (sortDirection === 'up' ? 1 : -1)
    }

    const valueA = cardA.dataset[sortKey] ?? ''
    const valueB = cardB.dataset[sortKey] ?? ''

    const comparison = (sortKey === 'size' || sortKey === 'date')
      ? (Number(valueA) || 0) - (Number(valueB) || 0)
      : String(valueA).localeCompare(String(valueB), undefined, { numeric: true, sensitivity: 'base' })

    return sortDirection === 'up' ? comparison : -comparison
  })

  discordState.mediaCards.forEach((card) => grid.appendChild(card))

  discordState.mediaCards.forEach((card) => {
    const image = card.querySelector('img')
    const video = card.querySelector('video')
    if (image && image.naturalWidth) packDiscordCard(card, image.naturalWidth, image.naturalHeight)
    if (video && video.videoWidth)   packDiscordCard(card, video.videoWidth,   video.videoHeight)
  })
}

// ==================================================================================================== //
// CSS STYLES
// ==================================================================================================== //
function injectDiscordPluginStyles() {
  if (document.getElementById('discord-plugin-styles')) return

  const style = document.createElement('style')
  style.id = 'discord-plugin-styles'
  style.textContent = `
    /* Folder preview Discord fallback icon */
    .folder-card.discord-folder .folder-preview {
      display:         flex;
      justify-content: center;
      align-items:     center;
      font-size:       3.5rem;
      color:           rgb(var(--ctp-mauve-rgb));
    }

    /* Video card and container layout */
    .gallery-card.discord-media {
      position: relative;
    }

    .gallery-card.discord-media video {
      width:            100%;
      height:           100%;
      display:          block;
      object-fit:       cover;
      background-color: rgb(var(--ctp-mantle-rgb));
    }

    .gallery-card.discord-media audio {
      width:  calc(100% - 20px);
      margin: 10px;
    }

    .discord-video-container {
      position: relative;
      width:    100%;
      height:   100%;
    }

    /* Shift-click interceptor overlay */
    .discord-shift-overlay {
      position:       absolute;
      inset:          0;
      z-index:        5;
      pointer-events: none;
    }

    body.shift-down .discord-shift-overlay {
      pointer-events: auto !important;
      cursor:         zoom-in;
    }

    /* Corner fullscreen expansion button */
    .discord-fs-btn {
      position:         absolute;
      top:              8px;
      right:            8px;
      z-index:          6;
      width:            32px;
      height:           32px;
      display:          flex;
      align-items:      center;
      justify-content:  center;
      background-color: rgba(var(--ctp-crust-rgb), 0.8);
      color:            rgb(var(--ctp-text-rgb));
      border:           2px solid rgb(var(--ctp-surface1-rgb));
      border-radius:    8px;
      cursor:           pointer;
      opacity:          0;
      transition:       opacity 0.2s ease, transform 0.15s ease, border-color 0.2s ease;

      &:hover {
        border-color: rgb(var(--accent));
        transform:    scale(1.1);
      }
    }

    .gallery-card:hover .discord-fs-btn {
      opacity: 1;
    }

    /* Fullscreen video sizing */
    .full-screen-video {
      outline:    none;
      box-sizing: border-box;
    }
  `
  document.head.appendChild(style)
}

// ==================================================================================================== //
// INITIALIZATION
// ==================================================================================================== //
function initDiscordPlugin() {
  injectDiscordPluginStyles()
  syncServerDropdown()
  syncChannelDropdown()

  const isWhitelist = localStorage.getItem(STORAGE_KEYS.isWhitelist) === 'true'
  window.SettingsAPI?.updateSetting('discordFilterToggle', { default: isWhitelist })

  setTimeout(() => {
    const label = document.querySelector('.entry[data-entry-id="discordChannels"] .label')
    if (label) {
      label.textContent = isWhitelist ? 'Channel Filters (WHITELIST)' : 'Channel Filters (BLACKLIST)'
    }
  }, 100)

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') document.body.classList.add('shift-down')
  })

  window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') document.body.classList.remove('shift-down')
  })

  window.addEventListener('blur', () => {
    document.body.classList.remove('shift-down')
  })

  const sortPill = document.querySelector(DISCORD_SELECTORS.sortPill)
  if (sortPill && !sortPill.dataset.discordHooked) {
    sortPill.dataset.discordHooked = 'true'
    sortPill.addEventListener('click', () => {
      if (!discordState.currentChannel) return
      setTimeout(sortDiscordGalleryMedia, 35)
    })
  }

  const contentPanel = document.querySelector(DISCORD_SELECTORS.contentPanel)
  if (contentPanel && !contentPanel.dataset.discordScrollHooked) {
    contentPanel.dataset.discordScrollHooked = 'true'
    contentPanel.addEventListener('scroll', () => {
      if (!discordState.currentChannel || discordState.isLoading || !discordState.hasMore) return
      const isNearBottom = contentPanel.scrollHeight - contentPanel.scrollTop - contentPanel.clientHeight < 800
      if (isNearBottom) {
        requestAnimationFrame(fetchDiscordMediaBatch)
      }
    }, { passive: true })
  }

  const modal = document.querySelector(DISCORD_SELECTORS.fullScreenModal)
  if (modal && !modal.dataset.discordHooked) {
    modal.dataset.discordHooked = 'true'

    modal.addEventListener('click', (event) => {
      if (Date.now() - modalOpenedTimestamp < 350) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }, true)

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class' && !modal.classList.contains('active')) {
          const video = modal.querySelector('.full-screen-video')
          if (video) {
            video.pause()
            video.remove()
          }
          const image = modal.querySelector(DISCORD_SELECTORS.fullScreenImage)
          if (image) image.style.display = ''
        }
      })
    })

    observer.observe(modal, { attributes: true })
  }

  window.addEventListener('resize', () => {
    const activeVideo = document.querySelector('.full-screen-video')
    if (activeVideo) scaleFullscreenVideo(activeVideo)
  })
}

setTimeout(initDiscordPlugin, 100)