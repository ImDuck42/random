// ==================================================================================================== //
// DISCORD GALLERY INTEGRATION PLUGIN
// ==================================================================================================== //
(() => {
  // ================================================================================================== //
  // CONFIGURATION
  // ================================================================================================== //
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
    loadedChannels:     new Set(),
    channelCursors:     {},
  }

  let modalOpenedTimestamp = 0

  // ================================================================================================== //
  // STORAGE & UTILITY
  // ================================================================================================== //
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

  // ================================================================================================== //
  // SETTINGS INTEGRATION
  // ================================================================================================== //
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

  function ensureSettingsSynced(retries = 25) {
    if (window.SettingsElements?.['discordServerList']) {
      syncServerDropdown()
      syncChannelDropdown()
      const isWhitelist = localStorage.getItem(STORAGE_KEYS.isWhitelist) === 'true'
      window.SettingsAPI?.updateSetting('discordFilterToggle', { default: isWhitelist })
    } else if (retries > 0) {
      setTimeout(() => ensureSettingsSynced(retries - 1), 100)
    }
  }

  // ================================================================================================== //
  // DISCORD API & PERMISSIONS
  // ================================================================================================== //
  window.discord_loadFolders = async function() {
    const servers     = getStoredArray(STORAGE_KEYS.servers)
    const filterList  = getStoredArray(STORAGE_KEYS.channels)
    const isWhitelist = localStorage.getItem(STORAGE_KEYS.isWhitelist) === 'true'
    const grid        = document.querySelector(DISCORD_SELECTORS.folderGrid)

    if (servers.length === 0) return alert('Please add at least one Discord Server ID in Settings.')

    document.querySelectorAll(DISCORD_SELECTORS.navTabs)[0]?.click()

    grid?.querySelectorAll('.folder-card.discord-folder').forEach((c) => c.remove())
    const chipContainer = document.querySelector(DISCORD_SELECTORS.chipContainer)
    chipContainer?.querySelectorAll('.discord-chip').forEach((c) => c.remove())

    try {
      const authHeader          = getStoredAuthHeader()
      let totalLoadedChannels   = 0

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

        const candidateChannels = channels.filter((channel) => {
          if (![0, 2, 5, 15].includes(channel.type)) return false

          if (isWhitelist  && !filterList.includes(channel.id)) return false
          if (!isWhitelist && filterList.includes(channel.id))  return false

          return true
        })

        const count = await scanAndLoadMediaChannels(candidateChannels, grid, authHeader)
        totalLoadedChannels += count
      }

      if (totalLoadedChannels === 0) {
        alert('No accessible channels with media were found in the configured servers.')
      }
    } catch (error) {
      alert(`Discord Connection Error: ${error.message}`)
    }
  }

  async function scanAndLoadMediaChannels(channels, gridContainer, authHeader) {
    const currentToken = ++discordState.previewQueueToken
    const batchSize    = 5
    let mediaChannelsFound = 0

    for (let i = 0; i < channels.length; i += batchSize) {
      if (currentToken !== discordState.previewQueueToken) break
      const batch = channels.slice(i, i + batchSize)

      await Promise.all(batch.map(async (channel) => {
        try {
          let hasMedia             = false
          let previewAttachmentUrl = null
          let lastId               = null
          let attempts             = 0
          const maxAttempts        = 2

          while (!hasMedia && attempts < maxAttempts) {
            attempts += 1
            let endpointUrl = `${DISCORD_API_BASE}/channels/${channel.id}/messages?limit=100`
            if (lastId) endpointUrl += `&before=${lastId}`

            const response = await fetch(endpointUrl, {
              headers: { Authorization: authHeader },
            })

            if (response.status === 403) return
            if (!response.ok) break

            const messages = await response.json()
            if (!Array.isArray(messages) || messages.length === 0) break

            lastId = messages[messages.length - 1].id

            for (const message of messages) {
              if (!message.attachments || message.attachments.length === 0) continue

              for (const attachment of message.attachments) {
                const extension = (attachment.filename.split('.').pop() || '').toLowerCase()
                const isImage   = ALLOWED_IMAGE_EXTS.includes(extension)
                const isVideo   = ALLOWED_VIDEO_EXTS.includes(extension)

                if (isImage || isVideo) {
                  hasMedia = true
                  if (isImage && !previewAttachmentUrl) {
                    previewAttachmentUrl = attachment.url
                  }
                }
              }
            }

            if (messages.length < 100) break
          }

          if (hasMedia) {
            mediaChannelsFound += 1
            createDiscordFolderCard(channel, gridContainer, previewAttachmentUrl)
            createDiscordFolderChip(channel.id, channel.name)
          }
        } catch (error) {
          console.warn(`[Discord Plugin] Verification error for channel ${channel.id}:`, error)
        }
      }))

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    return mediaChannelsFound
  }

  // ================================================================================================== //
  // GALLERY & CHIP FILTERING
  // ================================================================================================== //
  function createDiscordFolderChip(channelId, channelName) {
    const chipContainer = document.querySelector(DISCORD_SELECTORS.chipContainer)
    if (!chipContainer) return

    if (chipContainer.querySelector(`.chip[data-discord-channel="${channelId}"]`)) return

    const chip                  = document.createElement('button')
    chip.className              = 'chip discord-chip'
    chip.dataset.folder         = `discord-${channelId}`
    chip.dataset.discordChannel = channelId
    chip.dataset.channelName    = channelName
    chip.innerHTML              = `<span># ${channelName}</span>`

    chip.addEventListener('click', () => {
      handleDiscordChipToggle(channelId, channelName, chip)
    })

    chipContainer.appendChild(chip)
  }

  function handleDiscordChipToggle(channelId, channelName, chip) {
    const chipContainer = document.querySelector(DISCORD_SELECTORS.chipContainer)
    if (!chipContainer) return

    const allChip      = chipContainer.querySelector('.chip[data-folder="all"]')
    const willBeActive = !chip.classList.contains('active')

    allChip?.classList.remove('active')
    chip.classList.toggle('active', willBeActive)

    const activeDiscordChips = Array.from(chipContainer.querySelectorAll('.discord-chip.active'))

    if (activeDiscordChips.length === 0 && !chipContainer.querySelector('.chip:not(.discord-chip):not([data-folder="all"]).active')) {
      allChip?.classList.add('active')
    }

    if (willBeActive && !discordState.loadedChannels.has(channelId)) {
      fetchDiscordChannelMedia(channelId, channelName)
    }

    applyGalleryFilters()
  }

  function openDiscordChannelInGallery(channelId, channelName) {
    const chipContainer = document.querySelector(DISCORD_SELECTORS.chipContainer)
    const allChip       = chipContainer?.querySelector('.chip[data-folder="all"]')

    document.querySelectorAll(DISCORD_SELECTORS.navTabs)[1]?.click()

    chipContainer?.querySelectorAll('.chip').forEach((item) => item.classList.remove('active'))
    allChip?.classList.remove('active')

    const targetChip = chipContainer?.querySelector(`.chip[data-discord-channel="${channelId}"]`)
    if (targetChip) {
      targetChip.classList.add('active')
    }

    discordState.currentChannel     = channelId
    discordState.currentChannelName = channelName

    if (!discordState.loadedChannels.has(channelId)) {
      fetchDiscordChannelMedia(channelId, channelName)
    }

    applyGalleryFilters()
  }

  function applyGalleryFilters() {
    const chipContainer = document.querySelector(DISCORD_SELECTORS.chipContainer)
    const grid          = document.querySelector(DISCORD_SELECTORS.galleryMasonry)
    if (!chipContainer || !grid) return

    const allChip            = chipContainer.querySelector('.chip[data-folder="all"]')
    const isAllActive        = allChip?.classList.contains('active')
    const activeDiscordChips = Array.from(chipContainer.querySelectorAll('.discord-chip.active'))
    const activeChannelIds   = activeDiscordChips.map((c) => c.dataset.discordChannel)

    const discordCards = Array.from(grid.querySelectorAll('.gallery-card.discord-media'))
    const nativeCards  = Array.from(grid.querySelectorAll('.gallery-card:not(.discord-media)'))

    let visibleCount = 0

    if (isAllActive) {
      nativeCards.forEach((c)  => { c.style.display = ''; visibleCount++ })
      discordCards.forEach((c) => { c.style.display = ''; visibleCount++ })
    } else if (activeDiscordChips.length > 0) {
      nativeCards.forEach((c) => (c.style.display = 'none'))

      discordCards.forEach((card) => {
        const matches = activeChannelIds.includes(card.dataset.channelId)
        card.style.display = matches ? '' : 'none'
        if (matches) visibleCount++
      })
    } else {
      discordCards.forEach((c) => (c.style.display = 'none'))
      nativeCards.forEach((c) => {
        if (c.style.display !== 'none') visibleCount++
      })
    }

    discordCards.forEach((card) => {
      if (card.style.display !== 'none') {
        const image = card.querySelector('img')
        const video = card.querySelector('video')
        if (image && image.naturalWidth) packDiscordCard(card, image.naturalWidth, image.naturalHeight)
        if (video && video.videoWidth)   packDiscordCard(card, video.videoWidth,   video.videoHeight)
      }
    })

    const countLabel = document.querySelector(DISCORD_SELECTORS.imageCountLabel)
    if (countLabel) countLabel.textContent = `${visibleCount} Media`
  }

  async function fetchDiscordChannelMedia(channelId, channelName) {
    discordState.currentChannel     = channelId
    discordState.currentChannelName = channelName
    discordState.isLoading          = true

    const grid = document.querySelector(DISCORD_SELECTORS.galleryMasonry)
    if (!grid) return

    try {
      let mediaResolvedCount = 0
      let skippedBatches     = 0
      let lastId             = discordState.channelCursors[channelId] || null
      let hasMore            = true

      while (mediaResolvedCount === 0 && hasMore && skippedBatches < 5) {
        skippedBatches += 1

        let endpointUrl = `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=100`
        if (lastId) endpointUrl += `&before=${lastId}`

        const response = await fetch(endpointUrl, {
          headers: { Authorization: getStoredAuthHeader() },
        })

        if (!response.ok) {
          if (response.status === 403) {
            document.querySelector(`.folder-card[data-channel-id="${channelId}"]`)?.remove()
            document.querySelector(`.chip[data-discord-channel="${channelId}"]`)?.remove()
            alert(`Channel #${channelName} is restricted or forbidden.`)
            return
          }
          throw new Error(`HTTP Error ${response.status}`)
        }

        const messages = await response.json()
        if (messages.length < 100) hasMore = false
        if (messages.length === 0) break

        lastId = messages[messages.length - 1].id
        discordState.channelCursors[channelId] = lastId

        messages.forEach((message) => {
          if (!message.attachments) return

          message.attachments.forEach((attachment) => {
            const extension = (attachment.filename.split('.').pop() || '').toLowerCase()
            const isImage   = ALLOWED_IMAGE_EXTS.includes(extension)
            const isVideo   = ALLOWED_VIDEO_EXTS.includes(extension)

            if (isImage || isVideo) {
              mediaResolvedCount += 1
              createDiscordMediaCard(attachment, extension, channelId, channelName, grid)
            }
          })
        })
      }

      discordState.loadedChannels.add(channelId)
      applyGalleryFilters()
    } catch (error) {
      console.error('[Discord Plugin] Fetch error:', error)
    } finally {
      discordState.isLoading = false
    }
  }

  async function fetchDiscordMediaBatch() {
    if (discordState.isLoading || !discordState.currentChannel) return
    await fetchDiscordChannelMedia(discordState.currentChannel, discordState.currentChannelName)
  }

  // ================================================================================================== //
  // DOM CARD & MASONRY
  // ================================================================================================== //
  function createDiscordFolderCard(channel, gridContainer, previewUrl) {
    if (gridContainer.querySelector(`.folder-card[data-channel-id="${channel.id}"]`)) return

    const card = document.createElement('div')
    card.className = 'folder-card discord-folder'
    card.style.setProperty('--accent', 'var(--ctp-mauve-rgb)')

    card.dataset.channelId = channel.id
    card.dataset.name      = channel.name.toLowerCase()
    card.dataset.size      = '0'
    card.dataset.date      = String(snowflakeToTimestamp(channel.id))
    card.dataset.type      = 'folder'

    const previewContent = previewUrl
      ? `<img loading="lazy" decoding="async" src="${previewUrl}" alt="${channel.name} Preview">`
      : `<i class="brands fa-discord"></i>`

    card.innerHTML = `
      <div class="folder-tab">
        <span class="file-count">Discord</span>
      </div>
      <div class="folder-body">
        <div class="folder-preview" id="discord-preview-${channel.id}">
          ${previewContent}
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

  function createDiscordMediaCard(attachment, extension, channelId, channelName, gridContainer) {
    const card = document.createElement('div')
    card.className = 'gallery-card discord-media'
    card.style.setProperty('--accent', 'var(--ctp-mauve-rgb)')

    card.dataset.channelId  = channelId
    card.dataset.name       = (attachment.filename || '').toLowerCase()
    card.dataset.size       = String(attachment.size || 0)
    card.dataset.date       = String(snowflakeToTimestamp(attachment.id))
    card.dataset.type       = extension
    card.dataset.folderName = channelName

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

  // ================================================================================================== //
  // FULLSCREEN MODAL
  // ================================================================================================== //
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

  // ================================================================================================== //
  // SORT PILL
  // ================================================================================================== //
  function sortDiscordGalleryMedia() {
    const grid = document.querySelector(DISCORD_SELECTORS.galleryMasonry)
    if (!grid || discordState.mediaCards.length === 0) return

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
      if (card.style.display !== 'none') {
        const image = card.querySelector('img')
        const video = card.querySelector('video')
        if (image && image.naturalWidth) packDiscordCard(card, image.naturalWidth, image.naturalHeight)
        if (video && video.videoWidth)   packDiscordCard(card, video.videoWidth,   video.videoHeight)
      }
    })
  }

  // ================================================================================================== //
  // CSS STYLES
  // ================================================================================================== //
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

  // ================================================================================================== //
  // INITIALIZATION
  // ================================================================================================== //
  function initDiscordPlugin() {
    injectDiscordPluginStyles()
    ensureSettingsSynced()

    const chipContainer = document.querySelector(DISCORD_SELECTORS.chipContainer)
    const allChip       = chipContainer?.querySelector('.chip[data-folder="all"]')
    if (allChip && !allChip.dataset.discordHooked) {
      allChip.dataset.discordHooked = 'true'
      allChip.addEventListener('click', () => {
        chipContainer.querySelectorAll('.discord-chip').forEach((c) => c.classList.remove('active'))
        setTimeout(applyGalleryFilters, 10)
      })
    }

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
        setTimeout(sortDiscordGalleryMedia, 35)
      })
    }

    const contentPanel = document.querySelector(DISCORD_SELECTORS.contentPanel)
    if (contentPanel && !contentPanel.dataset.discordScrollHooked) {
      contentPanel.dataset.discordScrollHooked = 'true'
      contentPanel.addEventListener('scroll', () => {
        if (discordState.isLoading) return
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
})()