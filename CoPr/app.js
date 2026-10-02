import { CoPrProtocol, CoPrProtocol_Version } from './countProtocol.js'

const protocolClient    = new CoPrProtocol()
const signalLeave       = '__SYS_LEAVE__'
const signalJoin        = '__SYS_JOIN__'
const signalDelete      = '__SYS_DELETE__'
const signalClearPrefix = '__SYS_CLEAR__:'
const litterboxMaxBytes = 1024 * 1024 * 1024

const getElement = (identifier) => document.getElementById(identifier)

const termsModal               = getElement('termsModal')
const acceptTermsBtn           = getElement('acceptTermsBtn')
const userHandleInput          = getElement('userHandleInput')
const userAvatarBadge          = getElement('userAvatarBadge')
const toggleAudioBtn           = getElement('toggleAudioBtn')
const channelNameInput         = getElement('channelNameInput')
const publicDiscoveryToggle    = getElement('publicDiscoveryToggle')
const connectChannelBtn        = getElement('connectChannelBtn')
const refreshDiscoveryBtn      = getElement('refreshDiscoveryBtn')
const searchChannelsInput      = getElement('searchChannelsInput')
const discoveredRoomsContainer = getElement('discoveredRoomsContainer')

const currentRoomHeader   = getElement('currentRoomHeader')
const messageCounterBadge = getElement('messageCounterBadge')
const messageCounterText  = getElement('messageCounterText')
const copyRoomLinkBtn     = getElement('copyRoomLinkBtn')
const toggleMembersBtn    = getElement('toggleMembersBtn')
const leaveRoomBtn        = getElement('leaveRoomBtn')

const messageStreamFeed     = getElement('messageStreamFeed')
const emptyStatePlaceholder = getElement('emptyStatePlaceholder')
const chatMessageInput      = getElement('chatMessageInput')
const fileAttachmentInput   = getElement('fileAttachmentInput')
const attachFileBtn         = getElement('attachFileBtn')
const sendMessageBtn        = getElement('sendMessageBtn')
const stagedFilesContainer  = getElement('stagedFilesContainer')

const membersSidebar    = getElement('membersSidebar')
const activeMembersList = getElement('activeMembersList')
const memberCountBadge  = getElement('memberCountBadge')

const versionLabel = document.querySelector('.sidebar-brand .brand-info p')
if (versionLabel) {
  versionLabel.textContent = `Version: ${CoPrProtocol_Version}`
}

let activeChannel              = ''
let channelListenerUnsubscribe = null
let soundEnabled               = true
let allDiscoveredChannels      = []
let totalMessagesReceived      = 0
let audioWatermarkSequence     = Infinity
let lowestLoadedSequence       = Infinity
let isLoadingOlderMessages     = false
let hasReachedHistoryStart     = false

const channelHistoryCache = new Map()
const channelMembersCache = new Map()
const seenSequences       = new Set()
const stagedFiles         = []
let   currentMembersMap   = new Map()

const avatarColors = [
  '#e11d48', '#d97706', '#059669', '#0284c7', 
  '#7c3aed', '#db2777', '#4f46e5', '#0891b2'
]

const getCurrentUser = () => userHandleInput.value.trim() || 'Anonymous'

const getInitials = (name) => {
  return (name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'CP').toUpperCase()
}

const escapeHTML = (str) => {
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return String(str || '').replace(/[&<>"']/g, (match) => entityMap[match])
}

const getAvatarColor = (name) => {
  let hash = 0
  for (let index = 0; index < name.length; index++) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash)
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

const formatFileSize = (bytes) => {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

const parsePayload = (payload = '') => {
  const match = payload.match(/^\[(.*?)\]:\s*([\s\S]*)$/)
  if (match) {
    return { author: match[1], body: match[2] }
  }
  return { author: 'Anonymous', body: payload }
}

const isSystemMessage = (msg) => {
  return [signalLeave, signalJoin, signalDelete].includes(msg) || msg.startsWith(signalClearPrefix)
}

const processSequence = (sequence) => {
  if (!sequence) return true
  if (seenSequences.has(sequence)) return false
  seenSequences.add(sequence)
  return true
}

const resetInputHeight = () => {
  chatMessageInput.value        = ''
  chatMessageInput.style.height = 'auto'
}

let audioContext   = null
let compressorNode = null

const initializeAudioContext = async () => {
  if (!audioContext) {
    audioContext   = new (window.AudioContext || window.webkitAudioContext)()
    compressorNode = audioContext.createDynamicsCompressor()
    
    compressorNode.threshold.setValueAtTime(-14, audioContext.currentTime)
    compressorNode.connect(audioContext.destination)
  }
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
  return audioContext
}

window.addEventListener('click',   initializeAudioContext, { once: true })
window.addEventListener('keydown', initializeAudioContext, { once: true })

const playChime = async (chimeType = 'message') => {
  if (!soundEnabled) return

  try {
    const context   = await initializeAudioContext()
    const startTime = context.currentTime

    if (chimeType === 'mention') {
      const oscillatorOne = context.createOscillator()
      const oscillatorTwo = context.createOscillator()
      const gainNodeOne   = context.createGain()
      const gainNodeTwo   = context.createGain()

      oscillatorOne.type = 'triangle'
      oscillatorOne.frequency.setValueAtTime(659.25,            startTime)
      oscillatorOne.frequency.exponentialRampToValueAtTime(880, startTime + 0.08)

      gainNodeOne.gain.setValueAtTime(0.85, startTime)
      gainNodeOne.gain.setValueAtTime(0.85, startTime + 0.12)
      gainNodeOne.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5)

      oscillatorTwo.type = 'sine'
      oscillatorTwo.frequency.setValueAtTime(1318.5, startTime + 0.05)

      gainNodeTwo.gain.setValueAtTime(0.001, startTime)
      gainNodeTwo.gain.setValueAtTime(0.65,  startTime + 0.06)
      gainNodeTwo.gain.setValueAtTime(0.65,  startTime + 0.15)
      gainNodeTwo.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45)

      oscillatorOne.connect(gainNodeOne).connect(compressorNode)
      oscillatorTwo.connect(gainNodeTwo).connect(compressorNode)

      oscillatorOne.start(startTime)
      oscillatorOne.stop(startTime + 0.52)

      oscillatorTwo.start(startTime + 0.05)
      oscillatorTwo.stop(startTime  + 0.47)

    } else {
      const oscillator = context.createOscillator()
      const gainNode   = context.createGain()

      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(523.25, startTime)
      oscillator.frequency.exponentialRampToValueAtTime(783.99, startTime + 0.09)

      gainNode.gain.setValueAtTime(0.75, startTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35)

      oscillator.connect(gainNode).connect(compressorNode)

      oscillator.start(startTime)
      oscillator.stop(startTime + 0.37)
    }
  } catch (audioError) {
    console.warn('Audio playback error:', audioError)
  }
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let currentCrc = index
  for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
    currentCrc = (currentCrc & 1) ? (0xEDB88320 ^ (currentCrc >>> 1)) : (currentCrc >>> 1)
  }
  return currentCrc
})

const computeCrc32 = (dataArray) => {
  let crcValue = 0xFFFFFFFF
  for (let index = 0; index < dataArray.length; index++) {
    crcValue = crcTable[(crcValue ^ dataArray[index]) & 0xFF] ^ (crcValue >>> 8)
  }
  return (crcValue ^ 0xFFFFFFFF) >>> 0
}

const createZipArchive = async (fileList) => {
  const archiveChunks  = []
  const centralRecords = []
  let   byteOffset     = 0

  for (const fileItem of fileList) {
    const binaryData = new Uint8Array(await fileItem.arrayBuffer())
    const nameBytes  = new TextEncoder().encode(fileItem.name)
    const crcValue   = computeCrc32(binaryData)
    
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView   = new DataView(localHeader.buffer)
    
    localView.setUint32(0,  0x04034B50,        true)
    localView.setUint16(4,  20,                true)
    localView.setUint16(6,  0x0800,            true)
    localView.setUint32(14, crcValue,          true)
    localView.setUint32(18, binaryData.length, true)
    localView.setUint32(22, binaryData.length, true)
    localView.setUint16(26, nameBytes.length,  true)
    localHeader.set(nameBytes, 30)

    archiveChunks.push(localHeader, binaryData)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView   = new DataView(centralHeader.buffer)
    
    centralView.setUint32(0,  0x02014B50,        true)
    centralView.setUint16(4,  20,                true)
    centralView.setUint16(6,  20,                true)
    centralView.setUint16(8,  0x0800,            true)
    centralView.setUint32(16, crcValue,          true)
    centralView.setUint32(20, binaryData.length, true)
    centralView.setUint32(24, binaryData.length, true)
    centralView.setUint16(28, nameBytes.length,  true)
    centralView.setUint32(42, byteOffset,        true)
    centralHeader.set(nameBytes, 46)

    centralRecords.push(centralHeader)
    byteOffset += localHeader.length + binaryData.length
  }

  const centralDirectoryOffset = byteOffset
  centralRecords.forEach(record => archiveChunks.push(record))
  
  const endRecord = new Uint8Array(22)
  const endView   = new DataView(endRecord.buffer)
  
  endView.setUint32(0,  0x06054B50,                                       true)
  endView.setUint16(8,  fileList.length,                                  true)
  endView.setUint16(10, fileList.length,                                  true)
  endView.setUint32(12, centralRecords.reduce((a, b) => a + b.length, 0), true)
  endView.setUint32(16, centralDirectoryOffset,                           true)
  
  archiveChunks.push(endRecord)

  return new File(
    [new Blob(archiveChunks)], 
    `bundle_${fileList.length}_files.zip`, 
    { type: 'application/zip' }
  )
}

const getAttachmentType = (fileUrl) => {
  const extension = (fileUrl.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase()
  
  if (/^(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(extension))   return 'image'
  if (/^(mp4|webm|ogg|mov)$/.test(extension))                  return 'video'
  if (/^(mp3|wav|m4a|aac|flac)$/.test(extension))              return 'audio'
  if (extension === 'zip')                                     return 'zip'
  if (fileUrl.includes('catbox.moe') || extension.length <= 5) return 'file'
  
  return null
}

const renderAttachmentHtml = (fileUrl) => {
  const mediaType = getAttachmentType(fileUrl)
  if (!mediaType) return ''

  const filename = fileUrl.split('/').pop().split('?')[0] || 'Attachment'
  const wrapper  = (innerHtml) => `<div class="attachment-preview-box">${innerHtml}</div>`

  if (mediaType === 'image') {
    return wrapper(`
      <a href="${fileUrl}" target="_blank" rel="noopener">
        <img src="${fileUrl}" alt="Preview" loading="lazy" class="attachment-media attachment-image">
      </a>
    `)
  }
  
  if (mediaType === 'video') {
    return wrapper(`
      <video src="${fileUrl}" controls preload="metadata" class="attachment-media attachment-video"></video>
    `)
  }
  
  if (mediaType === 'audio') {
    return wrapper(`
      <audio src="${fileUrl}" controls class="attachment-media attachment-audio"></audio>
    `)
  }
  
  if (mediaType === 'zip') {
    return `
      <div class="attachment-preview-box" data-zip-url="${fileUrl}">
        <a href="${fileUrl}" target="_blank" rel="noopener" download class="attachment-download-card">
          <div class="file-icon"><i class="fa-solid fa-file-zipper"></i></div>
          <div class="file-info">
            <span class="file-name">${filename}</span>
            <span class="file-subtext">Multi-file bundle • Click to unpack</span>
          </div>
          <i class="fa-solid fa-arrow-down file-arrow"></i>
        </a>
        <div class="zip-contents-grid" style="display: none; margin-top: 8px; flex-wrap: wrap; gap: 8px;"></div>
      </div>`
  }

  return wrapper(`
    <a href="${fileUrl}" target="_blank" rel="noopener" download class="attachment-download-card">
      <div class="file-icon"><i class="fa-solid fa-file-arrow-down"></i></div>
      <div class="file-info">
        <span class="file-name">${filename}</span>
        <span class="file-subtext">Click to download</span>
      </div>
      <i class="fa-solid fa-arrow-down file-arrow"></i>
    </a>
  `)
}

const unpackZipPreviews = async (containerNode, zipUrl) => {
  try {
    const fetchResponse = await fetch(zipUrl)
    if (!fetchResponse.ok) return
    
    const arrayBuffer = await fetchResponse.arrayBuffer()
    const dataView    = new DataView(arrayBuffer)
    const byteData    = new Uint8Array(arrayBuffer)
    
    let   byteOffset = 0
    const mediaBlobs = []

    while (byteOffset + 30 <= byteData.length && dataView.getUint32(byteOffset, true) === 0x04034B50) {
      const compressionMethod = dataView.getUint16(byteOffset + 8,  true)
      const compressedSize    = dataView.getUint32(byteOffset + 18, true)
      const nameLength        = dataView.getUint16(byteOffset + 26, true)
      const extraLength       = dataView.getUint16(byteOffset + 28, true)
      
      const dataStart = byteOffset + 30 + nameLength + extraLength
      const dataEnd   = dataStart + compressedSize

      if (dataEnd > byteData.length) break
      
      if (compressionMethod === 0) {
        const nameBytes = byteData.subarray(byteOffset + 30, byteOffset + 30 + nameLength)
        const filename  = new TextDecoder().decode(nameBytes)
        const mediaType = getAttachmentType(filename)
        
        if (mediaType && !['file', 'zip'].includes(mediaType)) {
          const extension = filename.split('.').pop().toLowerCase()
          const mimeType  = `${mediaType}/${extension === 'svg' ? 'svg+xml' : extension}`
          const fileBlob  = new Blob([byteData.slice(dataStart, dataEnd)], { type: mimeType })
          
          mediaBlobs.push({ 
            type:    mediaType, 
            name:    filename, 
            blobUrl: URL.createObjectURL(fileBlob) 
          })
        }
      }
      byteOffset = dataEnd
    }

    if (mediaBlobs.length > 0) {
      const gridElement = containerNode.querySelector('.zip-contents-grid')
      if (gridElement) {
        gridElement.style.display = 'flex'
        gridElement.innerHTML     = mediaBlobs.map(item => {
          if (item.type === 'image') {
            return `<a href="${item.blobUrl}" target="_blank"><img src="${item.blobUrl}" alt="${item.name}" class="attachment-media attachment-image" style="max-height: 200px;"></a>`
          }
          if (item.type === 'video') {
            return `<video src="${item.blobUrl}" controls class="attachment-media attachment-video" style="max-height: 200px;"></video>`
          }
          if (item.type === 'audio') {
            return `<audio src="${item.blobUrl}" controls class="attachment-media attachment-audio"></audio>`
          }
          return ''
        }).join('')
      }
    }
  } catch (unpackError) {
    console.warn('Could not unpack zip preview:', unpackError)
  }
}

const parseMessageText = (rawText, currentUser) => {
  let safeHtml         = escapeHTML(rawText)
  const detectedUrls   = []
  let   hasPingedSelf  = false

  safeHtml = safeHtml.replace(/(https?:\/\/[^\s]+)/g, (fullUrl) => {
    detectedUrls.push(fullUrl)
    return `<a href="${fullUrl}" target="_blank" rel="noopener">${fullUrl}</a>`
  })

  safeHtml = safeHtml.replace(/@([a-zA-Z0-9_-]+)/g, (fullMatch, username) => {
    const isSelf = username === currentUser
    if (isSelf) hasPingedSelf = true
    return `<span class="mention-badge ${isSelf ? 'mention-self' : ''}">@${username}</span>`
  })

  safeHtml = safeHtml.replace(/`([^`]+)`/g, '<span class="code-snippet">$1</span>')
  safeHtml = safeHtml.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  const attachmentsHtml = detectedUrls.map(renderAttachmentHtml).join('')

  return { html: safeHtml, attachmentsHtml, hasPingedSelf }
}

const setMemberStatus = (username, isOnline, timestamp = Date.now()) => {
  if (!username || username === 'Anonymous' || !activeChannel) return
  currentMembersMap.set(username, { online: isOnline, lastActive: timestamp })
  renderMembersList()
}

const renderMembersList = () => {
  const currentUser = getCurrentUser()
  currentMembersMap.set(currentUser, { online: true, lastActive: Date.now() })

  const onlineMembers = Array.from(currentMembersMap.entries())
    .filter(([, metaData]) => metaData.online)
    .sort(([userA], [userB]) => userA.localeCompare(userB))

  memberCountBadge.textContent = onlineMembers.length

  if (onlineMembers.length === 0) {
    activeMembersList.innerHTML = `
      <div class="empty-members">
        <i class="fa-solid fa-users-slash"></i>
        <span>No active users</span>
      </div>
    `
    return
  }

  const fragment = document.createDocumentFragment()
  
  onlineMembers.forEach(([memberName]) => {
    const memberItem     = document.createElement('div')
    memberItem.className = 'member-item'
    memberItem.title     = `${memberName} - Click to mention`
    
    memberItem.innerHTML = `
      <div class="member-avatar" style="background:${getAvatarColor(memberName)}">
        ${getInitials(memberName)}
      </div>
      <span class="member-name">${memberName}</span>
    `
    
    memberItem.onclick = () => {
      chatMessageInput.value = `${chatMessageInput.value.trim()} @${memberName} `.trimStart()
      chatMessageInput.focus()
    }
    
    fragment.appendChild(memberItem)
  })

  activeMembersList.innerHTML = ''
  activeMembersList.appendChild(fragment)
}

setInterval(() => {
  if (!activeChannel) return
  
  let   hasChanged  = false
  const currentTime = Date.now()
  const myHandle    = getCurrentUser()
  
  currentMembersMap.forEach((metaData, memberName) => {
    if (memberName !== myHandle && metaData.online && (currentTime - metaData.lastActive > 90000)) {
      metaData.online = false
      hasChanged      = true
    }
  })
  
  if (hasChanged) {
    renderMembersList()
  }
}, 15000)

const resetFeedState = () => {
  messageStreamFeed.innerHTML = ''
  messageStreamFeed.appendChild(emptyStatePlaceholder)
  
  emptyStatePlaceholder.style.display = 'block'
  totalMessagesReceived               = 0
  messageCounterText.textContent      = '0'
  lowestLoadedSequence                = Infinity
  isLoadingOlderMessages              = false
  hasReachedHistoryStart              = false
}

const renderMessageCard = ({ author, body, sequence, isValid = true, isPending = false, silent = false, shouldPrepend = false }) => {
  if (emptyStatePlaceholder) emptyStatePlaceholder.style.display = 'none'

  const currentUser = getCurrentUser()
  const { html, attachmentsHtml, hasPingedSelf } = parseMessageText(body, currentUser)

  if (!silent && !isPending && sequence > audioWatermarkSequence) {
    if (hasPingedSelf) {
      playChime('mention')
      if (author !== currentUser && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`From ${author}:`, { body: body, icon: './CoPr.png' })
      }
    } else if (author !== currentUser) {
      playChime('message')
    }
  }

  const messageClasses = [
    'message-card',
    hasPingedSelf ? 'highlight-mention' : '',
    !isValid      ? 'corrupt-message'   : '',
    isPending     ? 'is-pending'        : ''
  ].filter(Boolean).join(' ')

  const messageCard     = document.createElement('div')
  messageCard.className = messageClasses
  if (sequence) {
    messageCard.dataset.sequence = sequence
  }

  messageCard.innerHTML = `
    <div class="message-avatar" style="background:${getAvatarColor(author)}">
      ${getInitials(author)}
    </div>
    <div class="message-content">
      <div class="message-header">
        <span class="sender-name">${author}</span>
        ${!isValid ? '<span class="corrupt-tag">[CORRUPTED]</span>' : ''}
      </div>
      <div class="message-text">${html}</div>
      ${attachmentsHtml}
    </div>
  `

  messageCard.querySelectorAll('.attachment-preview-box[data-zip-url]').forEach((previewBox) => {
    unpackZipPreviews(previewBox, previewBox.dataset.zipUrl)
  })

  if (shouldPrepend && messageStreamFeed.firstElementChild) {
    messageStreamFeed.insertBefore(messageCard, messageStreamFeed.firstElementChild)
  } else {
    messageStreamFeed.appendChild(messageCard)
    if (!shouldPrepend) {
      messageStreamFeed.scrollTop = messageStreamFeed.scrollHeight
    }
  }

  totalMessagesReceived++
  messageCounterText.textContent = totalMessagesReceived
  
  return messageCard
}

const loadOlderMessages = async () => {
  if (isLoadingOlderMessages || hasReachedHistoryStart || !activeChannel) return
  
  if (lowestLoadedSequence <= 1 || lowestLoadedSequence === Infinity) {
    hasReachedHistoryStart = true
    return
  }

  isLoadingOlderMessages = true
  
  const targetToSequence   = lowestLoadedSequence - 1
  const targetFromSequence = Math.max(1, targetToSequence - protocolClient.config.fetchRange + 1)
  
  if (targetFromSequence === 1) {
    hasReachedHistoryStart = true
  }

  try {
    const previousScrollHeight = messageStreamFeed.scrollHeight
    const olderMessages        = await protocolClient.fetchChannelHistory(activeChannel, targetFromSequence, targetToSequence)

    olderMessages.sort((itemA, itemB) => itemB.sequence - itemA.sequence)

    olderMessages.forEach((olderItem) => {
      if (!processSequence(olderItem.sequence)) return
      
      lowestLoadedSequence = Math.min(lowestLoadedSequence, olderItem.sequence)
      const { author, body } = parsePayload(olderItem.payload)
      
      if (!isSystemMessage(body)) {
        renderMessageCard({
          author:        author,
          body:          body,
          sequence:      olderItem.sequence,
          isValid:       olderItem.isValid,
          silent:        true,
          shouldPrepend: true
        })
      }
    })
    
    messageStreamFeed.scrollTop = messageStreamFeed.scrollHeight - previousScrollHeight
  } catch (historyError) {
    console.warn('Failed to load older messages:', historyError)
  } finally {
    isLoadingOlderMessages = false
  }
}

const joinChannel = async (channelName) => {
  const targetChannel = String(channelName).trim()
  if (!targetChannel) return

  if (channelListenerUnsubscribe) {
    channelListenerUnsubscribe()
  }

  activeChannel                 = targetChannel
  audioWatermarkSequence        = Infinity
  currentRoomHeader.textContent = activeChannel
  
  chatMessageInput.disabled    = false
  attachFileBtn.disabled       = false
  sendMessageBtn.disabled      = false
  chatMessageInput.placeholder = `Message #${activeChannel}...`
  
  chatMessageInput.focus()
  copyRoomLinkBtn.style.display     = 'inline-flex'
  leaveRoomBtn.style.display        = 'inline-flex'
  messageCounterBadge.style.display = 'inline-flex'

  resetFeedState()
  seenSequences.clear()
  
  document.querySelectorAll('.channel-item').forEach((buttonElement) => {
    buttonElement.classList.toggle('active', buttonElement.dataset.room === activeChannel)
  })

  if (!channelMembersCache.has(activeChannel)) {
    channelMembersCache.set(activeChannel, new Map())
  }
  currentMembersMap = channelMembersCache.get(activeChannel)
  renderMembersList()

  const cachedMessages = channelHistoryCache.get(activeChannel) || []
  let highestSequence  = 0

  cachedMessages.forEach((cachedItem) => {
    if (cachedItem.sequence) {
      seenSequences.add(cachedItem.sequence)
      highestSequence      = Math.max(highestSequence, cachedItem.sequence)
      lowestLoadedSequence = Math.min(lowestLoadedSequence, cachedItem.sequence)
    }
    renderMessageCard({ ...cachedItem, silent: true })
  })

  const latestServerSeq  = await protocolClient.getChannelSequence(activeChannel)
  audioWatermarkSequence = latestServerSeq

  if (latestServerSeq > highestSequence) {
    try {
      const startSequence = highestSequence > 0 
        ? highestSequence + 1 
        : Math.max(1, latestServerSeq - protocolClient.config.fetchRange + 1)
        
      const missingDelta = await protocolClient.fetchChannelHistory(activeChannel, startSequence, latestServerSeq)

      missingDelta.forEach((deltaItem) => {
        if (!processSequence(deltaItem.sequence)) return
        
        if (deltaItem.sequence) {
          lowestLoadedSequence = Math.min(lowestLoadedSequence, deltaItem.sequence)
        }

        const { author, body } = parsePayload(deltaItem.payload)
        
        if (isSystemMessage(body)) return
        
        if (author !== getCurrentUser() && !currentMembersMap.has(author)) {
          currentMembersMap.set(author, { online: false, lastActive: 0 })
        }

        const messageObject = {
          author:    author,
          body:      body,
          timestamp: deltaItem.timestamp || Date.now(),
          sequence:  deltaItem.sequence,
          isValid:   deltaItem.isValid
        }
        
        cachedMessages.push(messageObject)
        renderMessageCard({ ...messageObject, silent: true })
      })
      
      if (startSequence <= 1) {
        hasReachedHistoryStart = true
      }
      
      channelHistoryCache.set(activeChannel, cachedMessages)
      renderMembersList()
    } catch (syncError) {
      console.warn('History synchronization error:', syncError)
    }
  }

  while (!hasReachedHistoryStart && messageStreamFeed.scrollHeight <= messageStreamFeed.clientHeight) {
    await loadOlderMessages()
  }

  protocolClient.sendMessage(activeChannel, `[${getCurrentUser()}]: ${signalJoin}`).catch(() => {})

  channelListenerUnsubscribe = protocolClient.listenToChannel(activeChannel, (eventData) => {
    if (eventData.isResetState) {
      resetFeedState()
      seenSequences.clear()
      currentMembersMap.clear()
      channelHistoryCache.delete(activeChannel)
      renderMembersList()
      return
    }

    if (!processSequence(eventData.sequence)) return
    
    const { author, body } = parsePayload(eventData.payload)

    if (body === signalLeave) return setMemberStatus(author, false, 0)
    if (body === signalJoin)  return setMemberStatus(author, true, Date.now())

    if (body.startsWith(signalClearPrefix)) {
      const sequencePayload = body.slice(signalClearPrefix.length)
      if (sequencePayload === 'all') {
        return removeMessagesBySequence('all')
      } else {
        const sequencesArray = sequencePayload.split(',').map(Number).filter(Number.isFinite)
        return removeMessagesBySequence(sequencesArray)
      }
    }

    if (body === signalDelete) {
      channelHistoryCache.delete(activeChannel)
      channelMembersCache.delete(activeChannel)
      allDiscoveredChannels = allDiscoveredChannels.filter((channelItem) => channelItem !== activeChannel)
      
      renderChannels(allDiscoveredChannels)
      return leaveChannel(false)
    }

    setMemberStatus(author, true, Date.now())
    
    const messageObject = {
      author:    author,
      body:      body,
      timestamp: eventData.timestamp || Date.now(),
      sequence:  eventData.sequence,
      isValid:   eventData.isValid
    }
    
    channelHistoryCache.get(activeChannel).push(messageObject)
    renderMessageCard(messageObject)
  })
}

const leaveChannel = async (announcePeers = true) => {
  if (activeChannel && announcePeers) {
    await protocolClient.sendMessage(activeChannel, `[${getCurrentUser()}]: ${signalLeave}`).catch(() => {})
  }
  
  if (channelListenerUnsubscribe) {
    channelListenerUnsubscribe()
    channelListenerUnsubscribe = null
  }

  activeChannel                 = ''
  audioWatermarkSequence        = Infinity
  currentRoomHeader.textContent = "This ain't no chat"
  
  chatMessageInput.disabled = true
  attachFileBtn.disabled    = true
  sendMessageBtn.disabled   = true
  
  chatMessageInput.placeholder      = 'Select a channel to start chatting...'
  chatMessageInput.style.height     = 'auto'
  copyRoomLinkBtn.style.display     = 'none'
  leaveRoomBtn.style.display        = 'none'
  messageCounterBadge.style.display = 'none'

  stagedFiles.length = 0
  renderStagedFiles()
  resetFeedState()
  seenSequences.clear()
  currentMembersMap.clear()
  
  activeMembersList.innerHTML = `
    <div class="empty-members">
      <i class="fa-solid fa-users-slash"></i>
      <span>Not in an active channel</span>
    </div>
  `
  memberCountBadge.textContent = '0'
  
  document.querySelectorAll('.channel-item').forEach((buttonElement) => {
    buttonElement.classList.remove('active')
  })
}

const removeMessagesBySequence = (sequenceList) => {
  if (sequenceList === 'all') {
    channelHistoryCache.delete(activeChannel)
    return resetFeedState()
  }

  const sequenceSet = new Set(sequenceList)
  const cachedList  = channelHistoryCache.get(activeChannel) || []
  
  channelHistoryCache.set(activeChannel, cachedList.filter((item) => !sequenceSet.has(item.sequence)))

  messageStreamFeed.querySelectorAll('.message-card').forEach((cardElement) => {
    if (sequenceSet.has(Number(cardElement.dataset.sequence))) {
      cardElement.remove()
    }
  })

  const remainingCards           = messageStreamFeed.querySelectorAll('.message-card').length
  totalMessagesReceived          = remainingCards
  messageCounterText.textContent = String(remainingCards)
  
  if (remainingCards === 0) {
    resetFeedState()
  }
}

const handleClearCommand = async (countToClear) => {
  if (!activeChannel) return
  
  const targetChannel = activeChannel
  const maxSequence   = await protocolClient.getChannelSequence(targetChannel)
  const channelCache  = channelHistoryCache.get(targetChannel) || []
  const wipeCount     = parseInt(countToClear, 10)

  if (!wipeCount || wipeCount >= channelCache.length) {
    const allSequences = Array.from({ length: maxSequence }, (_, index) => index + 1)
    await protocolClient.deleteMessages(targetChannel, allSequences)
    await protocolClient.sendMessage(targetChannel, `[${getCurrentUser()}]: ${signalClearPrefix}all`).catch(() => {})
    
    channelHistoryCache.delete(targetChannel)
    return resetFeedState()
  }

  const removedMessages  = channelCache.slice(-wipeCount).filter((message) => message.sequence)
  const removedSequences = removedMessages.map((message) => message.sequence)
  
  await protocolClient.deleteMessages(targetChannel, removedSequences)
  await protocolClient.sendMessage(targetChannel, `[${getCurrentUser()}]: ${signalClearPrefix}${removedSequences.join(',')}`).catch(() => {})
  removeMessagesBySequence(removedSequences)
}

const handleDeleteCommand = async () => {
  if (!activeChannel) return
  
  const targetChannel = activeChannel

  await protocolClient.sendMessage(targetChannel, `[${getCurrentUser()}]: ${signalDelete}`).catch(() => {})
  await protocolClient.destroyChannel(targetChannel)

  channelHistoryCache.delete(targetChannel)
  channelMembersCache.delete(targetChannel)
  
  allDiscoveredChannels = allDiscoveredChannels.filter((channel) => channel !== targetChannel)
  renderChannels(allDiscoveredChannels)
  
  await leaveChannel(false)
  await scanChannels()
}

const uploadToLitterbox = async (fileObject) => {
  const formData = new FormData()
  formData.append('reqtype',      'fileupload')
  formData.append('time',         '24h')
  formData.append('fileToUpload', fileObject)

  const uploadResponse = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    body:   formData
  })
  
  if (!uploadResponse.ok) {
    throw new Error('Litterbox upload request failed')
  }
  
  const uploadedUrl = (await uploadResponse.text()).trim()
  if (!uploadedUrl.startsWith('http')) {
    throw new Error('Invalid Litterbox response')
  }
  
  return uploadedUrl
}

const renderStagedFiles = () => {
  if (stagedFiles.length === 0) {
    stagedFilesContainer.style.display = 'none'
    return
  }

  stagedFilesContainer.style.display = 'flex'
  stagedFilesContainer.innerHTML     = ''
  
  const fragment = document.createDocumentFragment()
  let totalBytes = 0

  stagedFiles.forEach((fileItem, index) => {
    totalBytes += fileItem.size
    
    const chipElement     = document.createElement('div')
    chipElement.className = 'staged-chip'
    chipElement.innerHTML = `
      <i class="fa-solid fa-file"></i>
      <span class="chip-name" title="${fileItem.name}">${fileItem.name}</span>
      <span class="chip-size">${formatFileSize(fileItem.size)}</span>
      <button class="chip-remove-btn" type="button" title="Remove file">&times;</button>
    `
    
    chipElement.querySelector('.chip-remove-btn').onclick = () => {
      stagedFiles.splice(index, 1)
      renderStagedFiles()
    }
    
    fragment.appendChild(chipElement)
  })

  const metaBadgeElement       = document.createElement('div')
  metaBadgeElement.className   = 'staged-tray-meta'
  metaBadgeElement.textContent = `${stagedFiles.length} file${stagedFiles.length > 1 ? 's' : ''} (${formatFileSize(totalBytes)} / 1 GB)`
  
  fragment.appendChild(metaBadgeElement)
  stagedFilesContainer.appendChild(fragment)
}

fileAttachmentInput.addEventListener('change', () => {
  let currentTotalBytes = stagedFiles.reduce((sum, file) => sum + file.size, 0)
  let refusedFileCount  = 0

  const chosenFiles = Array.from(fileAttachmentInput.files || [])
  
  chosenFiles.forEach((fileItem) => {
    if (currentTotalBytes + fileItem.size > litterboxMaxBytes) {
      refusedFileCount++
      return
    }
    stagedFiles.push(fileItem)
    currentTotalBytes += fileItem.size
  })

  if (refusedFileCount > 0) {
    alert(`Refused ${refusedFileCount} file(s): combined upload would exceed the 1 GB maximum.`)
  }
  
  renderStagedFiles()
  fileAttachmentInput.value = ''
})

const dispatchMessage = async () => {
  const messageText = chatMessageInput.value.trim()
  if (!activeChannel || (!messageText && stagedFiles.length === 0)) return

  const clearRegexMatch = messageText.match(/^\/clear(?:\s+(\d+))?$/i)
  if (clearRegexMatch) {
    resetInputHeight()
    return handleClearCommand(clearRegexMatch[1])
  }
  
  if (messageText.toLowerCase() === '/delete') {
    resetInputHeight()
    return handleDeleteCommand()
  }

  const currentUser = getCurrentUser()
  resetInputHeight()

  let uploadedFileUrl = ''
  
  if (stagedFiles.length > 0) {
    const originalSendIcon   = sendMessageBtn.innerHTML
    sendMessageBtn.disabled  = true
    attachFileBtn.disabled   = true
    sendMessageBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'

    try {
      const fileToUpload = stagedFiles.length === 1 ? stagedFiles[0] : await createZipArchive(stagedFiles)
      uploadedFileUrl    = await uploadToLitterbox(fileToUpload)
      stagedFiles.length = 0
      renderStagedFiles()
    } catch (uploadError) {
      console.error('Upload failed:', uploadError)
      alert('Failed to upload file(s). Please try again.')
      
      chatMessageInput.value   = messageText
      sendMessageBtn.disabled  = false
      attachFileBtn.disabled   = false
      sendMessageBtn.innerHTML = originalSendIcon
      return
    } finally {
      sendMessageBtn.disabled  = false
      attachFileBtn.disabled   = false
      sendMessageBtn.innerHTML = originalSendIcon
    }
  }

  const finalMessageBody  = [messageText, uploadedFileUrl].filter(Boolean).join('\n')
  const { hasPingedSelf } = parseMessageText(finalMessageBody, currentUser)
  
  if (hasPingedSelf) {
    playChime('mention')
  }

  const messageObject = {
    author:    currentUser,
    body:      finalMessageBody,
    timestamp: Date.now(),
    sequence:  null,
    isValid:   true
  }
  
  const optimisticCard = renderMessageCard({ ...messageObject, isPending: true, silent: true })

  try {
    const { sequence } = await protocolClient.sendMessage(activeChannel, `[${currentUser}]: ${finalMessageBody}`)
    
    if (sequence) {
      seenSequences.add(sequence)
      
      optimisticCard.classList.remove('is-pending')
      optimisticCard.dataset.sequence = sequence
      messageObject.sequence          = sequence
      
      channelHistoryCache.get(activeChannel).push(messageObject)
    }
  } catch (error) {
    console.error('Failed to send message:', error.message)
    optimisticCard.style.borderColor = '#ef4444'
    optimisticCard.title             = error.message
    optimisticCard.classList.add('corrupt-message')
  }
}

const renderChannels = (channelList) => {
  discoveredRoomsContainer.innerHTML = ''
  
  if (!channelList || channelList.length === 0) {
    discoveredRoomsContainer.innerHTML = `
      <div class="empty-channels">
        <i class="fa-solid fa-folder-open"></i>
        <span>No public channels yet<br>Click sync or create one</span>
      </div>
    `
    return
  }

  const fragment = document.createDocumentFragment()
  
  channelList.forEach((channelName) => {
    const channelButton        = document.createElement('div')
    channelButton.className    = `channel-item ${channelName === activeChannel ? 'active' : ''}`
    channelButton.dataset.room = channelName
    
    channelButton.innerHTML = '<i class="fa-solid fa-hashtag"></i>'

    const nameViewport     = document.createElement('span')
    nameViewport.className = 'channel-name'
    const nameTrack        = document.createElement('span')
    nameTrack.className    = 'channel-name-track'

    for (let copyIndex = 0; copyIndex < 2; copyIndex++) {
      const nameCopy       = document.createElement('span')
      nameCopy.className   = 'channel-name-copy'
      nameCopy.textContent = channelName
      nameTrack.appendChild(nameCopy)
    }

    nameViewport.appendChild(nameTrack)
    channelButton.appendChild(nameViewport)
    
    channelButton.onclick = () => joinChannel(channelName)
    fragment.appendChild(channelButton)
  })
  
  discoveredRoomsContainer.appendChild(fragment)
  updateChannelMarquees()
}

const updateChannelMarquees = () => {
  discoveredRoomsContainer.querySelectorAll('.channel-item').forEach((channelButton) => {
    const nameViewport = channelButton.querySelector('.channel-name')
    const firstCopy    = channelButton.querySelector('.channel-name-copy')
    const copySpacing  = parseFloat(getComputedStyle(firstCopy).paddingRight) || 0
    const textWidth    = firstCopy.scrollWidth - copySpacing
    channelButton.classList.toggle('has-overflow', textWidth > nameViewport.clientWidth)
  })
}

window.addEventListener('resize', updateChannelMarquees)

const scanChannels = async () => {
  const refreshIcon = refreshDiscoveryBtn.querySelector('i')
  refreshIcon.classList.add('fa-spin')
  
  try {
    allDiscoveredChannels = await protocolClient.discoverChannels()
    renderChannels(allDiscoveredChannels)
  } catch {
    renderChannels([])
  } finally {
    refreshIcon.classList.remove('fa-spin')
  }
}

messageStreamFeed.addEventListener('scroll', () => {
  if (messageStreamFeed.scrollTop <= 50) {
    loadOlderMessages()
  }
})

chatMessageInput.addEventListener('keydown', (keyboardEvent) => {
  if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
    keyboardEvent.preventDefault()
    dispatchMessage()
  }
})

chatMessageInput.addEventListener('input', () => {
  chatMessageInput.style.height = 'auto'
  chatMessageInput.style.height = `${Math.min(chatMessageInput.scrollHeight, 140)}px`
})

toggleMembersBtn.addEventListener('click', () => {
  membersSidebar.classList.toggle('is-hidden')
})

const refreshProfileAvatar = () => {
  const handleString = getCurrentUser()
  userAvatarBadge.textContent           = getInitials(handleString)
  userAvatarBadge.style.backgroundColor = getAvatarColor(handleString)
}

userHandleInput.value = `copr${Math.floor(Math.random() * 899 + 100)}`
let previousHandle    = getCurrentUser()
refreshProfileAvatar()

userHandleInput.addEventListener('input', () => {
  const currentHandle = getCurrentUser()
  if (currentHandle !== previousHandle) {
    currentMembersMap.delete(previousHandle)
    previousHandle = currentHandle
  }

  refreshProfileAvatar()
  renderMembersList()
})

toggleAudioBtn.addEventListener('click', async () => {
  soundEnabled = !soundEnabled
  
  toggleAudioBtn.classList.toggle('active', soundEnabled)
  toggleAudioBtn.innerHTML = soundEnabled 
    ? '<i class="fa-solid fa-bell"></i>' 
    : '<i class="fa-solid fa-bell-slash"></i>'
    
  if (soundEnabled) {
    await playChime('mention')
  }
})

connectChannelBtn.addEventListener('click', async () => {
  const newChannel = channelNameInput.value.trim()
  if (!newChannel) return
  
  if (publicDiscoveryToggle.checked && !allDiscoveredChannels.includes(newChannel)) {
    await protocolClient.registerChannel(newChannel)
    allDiscoveredChannels.push(newChannel)
    renderChannels(allDiscoveredChannels)
  }
  
  joinChannel(newChannel)
  channelNameInput.value = ''
})

channelNameInput.addEventListener('keydown', (keyboardEvent) => {
  if (keyboardEvent.key === 'Enter') {
    keyboardEvent.preventDefault()
    keyboardEvent.stopPropagation()
    connectChannelBtn.click()
  }
})

acceptTermsBtn.addEventListener('click', async () => {
  await initializeAudioContext()
  
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission()
  }
  
  termsModal.style.display = 'none'
  playChime('mention')
})

attachFileBtn.addEventListener('click', () => {
  if (activeChannel) {
    fileAttachmentInput.click()
  }
})

sendMessageBtn.addEventListener('click', dispatchMessage)

copyRoomLinkBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(activeChannel)
})

leaveRoomBtn.addEventListener('click', () => leaveChannel())
refreshDiscoveryBtn.addEventListener('click', scanChannels)

searchChannelsInput.addEventListener('input', (inputEvent) => {
  const searchQuery = inputEvent.target.value
  renderChannels(allDiscoveredChannels.filter((channel) => channel.includes(searchQuery)))
})

window.addEventListener('beforeunload', () => {
  if (activeChannel) {
    protocolClient.sendMessage(activeChannel, `[${getCurrentUser()}]: ${signalLeave}`).catch(() => {})
  }
})

setInterval(scanChannels, 60000)
scanChannels()