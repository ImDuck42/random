import CoPrProtocol from './countProtocol.js'

const protocolClient    = new CoPrProtocol()
const signalLeave       = '__SYS_LEAVE__'
const signalJoin        = '__SYS_JOIN__'
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
const membersMap          = new Map()
const stagedFiles         = []

const avatarColors = [
  '#e11d48', '#d97706', '#059669', '#0284c7',
  '#7c3aed', '#db2777', '#4f46e5', '#0891b2'
]

const getAvatarColor = (nameString) => {
  let nameHash = 0
  for (let index = 0; index < nameString.length; index++) {
    nameHash = nameString.charCodeAt(index) + ((nameHash << 5) - nameHash)
  }
  return avatarColors[Math.abs(nameHash) % avatarColors.length]
}

const getInitials = (nameString) => (nameString.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'CP').toUpperCase()

const formatFileSize = (byteCount) => {
  if (byteCount < 1024)                 return `${byteCount} B`
  if (byteCount < 1024 * 1024)          return `${(byteCount / 1024).toFixed(1)} KB`
  if (byteCount < 1024 * 1024 * 1024)   return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`
  return `${(byteCount / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

let audioContext   = null
let compressorNode = null

const initializeAudioContext = async () => {
  if (!audioContext) {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
    audioContext                  = new AudioContextConstructor()
    compressorNode                = audioContext.createDynamicsCompressor()
    
    compressorNode.threshold.setValueAtTime(-14, audioContext.currentTime)
    compressorNode.connect(audioContext.destination)
  }
  if (audioContext.state === 'suspended') await audioContext.resume()
  return audioContext
}

window.addEventListener('click',   () => initializeAudioContext(), { once: true })
window.addEventListener('keydown', () => initializeAudioContext(), { once: true })

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
      oscillatorOne.frequency.setValueAtTime(659.25, startTime)
      oscillatorOne.frequency.exponentialRampToValueAtTime(880, startTime + 0.08)
      
      gainNodeOne.gain.setValueAtTime(0.85,  startTime)
      gainNodeOne.gain.setValueAtTime(0.85,  startTime + 0.12)
      gainNodeOne.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5)

      oscillatorTwo.type = 'sine'
      oscillatorTwo.frequency.setValueAtTime(1318.5, startTime + 0.05)
      
      gainNodeTwo.gain.setValueAtTime(0.001, startTime)
      gainNodeTwo.gain.setValueAtTime(0.65,  startTime + 0.06)
      gainNodeTwo.gain.setValueAtTime(0.65,  startTime + 0.15)
      gainNodeTwo.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45)

      oscillatorOne.connect(gainNodeOne).connect(compressorNode)
      oscillatorTwo.connect(gainNodeTwo).connect(compressorNode)
      
      oscillatorOne.start(startTime);        oscillatorOne.stop(startTime + 0.52)
      oscillatorTwo.start(startTime + 0.05); oscillatorTwo.stop(startTime + 0.47)
    } else {
      const oscillator = context.createOscillator()
      const gainNode   = context.createGain()
      
      oscillator.type  = 'triangle'
      oscillator.frequency.setValueAtTime(523.25, startTime)
      oscillator.frequency.exponentialRampToValueAtTime(783.99, startTime + 0.09)
      
      gainNode.gain.setValueAtTime(0.75, startTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35)

      oscillator.connect(gainNode).connect(compressorNode)
      oscillator.start(startTime); oscillator.stop(startTime + 0.37)
    }
  } catch (audioError) {
    console.warn('Audio playback error:', audioError)
  }
}

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index++) {
  let currentCrc = index
  for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
    currentCrc = (currentCrc & 1) ? (0xedb88320 ^ (currentCrc >>> 1)) : (currentCrc >>> 1)
  }
  crcTable[index] = currentCrc >>> 0
}

const computeCrc32 = (dataArray) => {
  let crcValue = 0xffffffff
  for (let index = 0; index < dataArray.length; index++) {
    crcValue = crcTable[(crcValue ^ dataArray[index]) & 0xff] ^ (crcValue >>> 8)
  }
  return (crcValue ^ 0xffffffff) >>> 0
}

const createZipArchive = async (fileList) => {
  const fileEntries = []
  for (const fileItem of fileList) {
    const arrayBuffer = await fileItem.arrayBuffer()
    const binaryData  = new Uint8Array(arrayBuffer)
    const nameBytes   = new TextEncoder().encode(fileItem.name)
    const crcValue    = computeCrc32(binaryData)
    
    fileEntries.push({ 
      name: fileItem.name, 
      nameBytes, 
      data: binaryData, 
      crc: crcValue, 
      size: binaryData.length 
    })
  }

  const archiveChunks  = []
  const centralRecords = []
  let   byteOffset     = 0

  for (const fileEntry of fileEntries) {
    const localHeader = new Uint8Array(30 + fileEntry.nameBytes.length)
    const localView   = new DataView(localHeader.buffer)

    localView.setUint32(0,  0x04034b50,                 true)
    localView.setUint16(4,  20,                         true)
    localView.setUint16(6,  0x0800,                     true)
    localView.setUint16(8,  0,                          true)
    localView.setUint16(10, 0,                          true)
    localView.setUint16(12, 0,                          true)
    localView.setUint32(14, fileEntry.crc,              true)
    localView.setUint32(18, fileEntry.size,             true)
    localView.setUint32(22, fileEntry.size,             true)
    localView.setUint16(26, fileEntry.nameBytes.length, true)
    localView.setUint16(28, 0,                          true)
    localHeader.set(fileEntry.nameBytes,                30)

    archiveChunks.push(localHeader)
    archiveChunks.push(fileEntry.data)

    const centralHeader = new Uint8Array(46 + fileEntry.nameBytes.length)
    const centralView   = new DataView(centralHeader.buffer)
    
    centralView.setUint32(0,  0x02014b50,                 true)
    centralView.setUint16(4,  20,                         true)
    centralView.setUint16(6,  20,                         true)
    centralView.setUint16(8,  0x0800,                     true)
    centralView.setUint16(10, 0,                          true)
    centralView.setUint16(12, 0,                          true)
    centralView.setUint16(14, 0,                          true)
    centralView.setUint32(16, fileEntry.crc,              true)
    centralView.setUint32(20, fileEntry.size,             true)
    centralView.setUint32(24, fileEntry.size,             true)
    centralView.setUint16(28, fileEntry.nameBytes.length, true)
    centralView.setUint16(30, 0,                          true)
    centralView.setUint16(32, 0,                          true)
    centralView.setUint16(34, 0,                          true)
    centralView.setUint16(36, 0,                          true)
    centralView.setUint32(38, 0,                          true)
    centralView.setUint32(42, byteOffset,                 true)
    centralHeader.set(fileEntry.nameBytes,                46)

    centralRecords.push(centralHeader)
    byteOffset += localHeader.length + fileEntry.data.length
  }

  const centralDirectoryOffset = byteOffset
  let   centralDirectorySize   = 0

  for (const centralRecord of centralRecords) {
    archiveChunks.push(centralRecord)
    centralDirectorySize += centralRecord.length
  }

  const endRecord = new Uint8Array(22)
  const endView   = new DataView(endRecord.buffer)
  
  endView.setUint32(0,  0x06054b50,             true)
  endView.setUint16(4,  0,                      true)
  endView.setUint16(6,  0,                      true)
  endView.setUint16(8,  fileEntries.length,     true)
  endView.setUint16(10, fileEntries.length,     true)
  endView.setUint32(12, centralDirectorySize,   true)
  endView.setUint32(16, centralDirectoryOffset, true)
  endView.setUint16(20, 0,                      true)
  archiveChunks.push(endRecord)

  const bundleFilename = `bundle_${fileEntries.length}_files.zip`
  return new File([new Blob(archiveChunks, { type: 'application/zip' })], bundleFilename, { type: 'application/zip' })
}

const getAttachmentType = (fileUrl) => {
  const cleanUrl = fileUrl.split('?')[0].split('#')[0].toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(cleanUrl))                                  return 'image'
  if (/\.(mp4|webm|ogg|mov)$/.test(cleanUrl))                                                 return 'video'
  if (/\.(mp3|wav|m4a|aac|flac)$/.test(cleanUrl))                                             return 'audio'
  if (/\.zip$/.test(cleanUrl))                                                                return 'zip'
  if (/litter\.catbox\.moe|catbox\.moe/.test(cleanUrl) || /\.[a-z0-9]{2,5}$/i.test(cleanUrl)) return 'file'
  return null
}

const renderAttachmentHtml = (fileUrl) => {
  const mediaType = getAttachmentType(fileUrl)
  if (!mediaType) return ''

  if (mediaType === 'image') {
    return `
      <div class="attachment-preview-box">
        <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">
          <img src="${fileUrl}" alt="Attachment preview" loading="lazy" class="attachment-media attachment-image">
        </a>
      </div>`
  }

  if (mediaType === 'video') {
    return `
      <div class="attachment-preview-box">
        <video src="${fileUrl}" controls preload="metadata" class="attachment-media attachment-video"></video>
      </div>`
  }

  if (mediaType === 'audio') {
    return `
      <div class="attachment-preview-box">
        <audio src="${fileUrl}" controls class="attachment-media attachment-audio"></audio>
      </div>`
  }

  if (mediaType === 'zip') {
    const filename = fileUrl.split('/').pop().split('?')[0] || 'bundle.zip'
    return `
      <div class="attachment-preview-box" data-zip-url="${fileUrl}">
        <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" download class="attachment-download-card">
          <div class="file-icon"><i class="fa-solid fa-file-zipper"></i></div>
          <div class="file-info">
            <span class="file-name">${filename}</span>
            <span class="file-subtext">Multi-file bundle • Click to download</span>
          </div>
          <i class="fa-solid fa-arrow-down file-arrow"></i>
        </a>
        <div class="zip-contents-grid" style="display: none; margin-top: 8px;"></div>
      </div>`
  }

  const filename = fileUrl.split('/').pop().split('?')[0] || 'Download Attachment'
  return `
    <div class="attachment-preview-box">
      <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" download class="attachment-download-card">
        <div class="file-icon"><i class="fa-solid fa-file-arrow-down"></i></div>
        <div class="file-info">
          <span class="file-name">${filename}</span>
          <span class="file-subtext">Click to download</span>
        </div>
        <i class="fa-solid fa-arrow-down file-arrow"></i>
      </a>
    </div>`
}

const unpackZipPreviews = async (containerNode, zipUrl) => {
  try {
    const fetchResponse = await fetch(zipUrl)
    if (!fetchResponse.ok) return
    
    const arrayBuffer = await fetchResponse.arrayBuffer()
    const byteData    = new Uint8Array(arrayBuffer)
    const dataView    = new DataView(arrayBuffer)
    
    let   byteOffset  = 0
    const mediaBlobs  = []

    while (byteOffset + 30 <= byteData.length) {
      if (dataView.getUint32(byteOffset, true) !== 0x04034b50) break
      
      const compressionMethod = dataView.getUint16(byteOffset + 8,  true)
      const compressedSize    = dataView.getUint32(byteOffset + 18, true)
      const nameLength        = dataView.getUint16(byteOffset + 26, true)
      const extraLength       = dataView.getUint16(byteOffset + 28, true)

      const nameBytes = byteData.subarray(byteOffset + 30, byteOffset + 30 + nameLength)
      const filename  = new TextDecoder().decode(nameBytes)
      const dataStart = byteOffset + 30 + nameLength + extraLength
      const dataEnd   = dataStart + compressedSize

      if (dataEnd > byteData.length) break

      if (compressionMethod === 0) {
        const fileBytes = byteData.slice(dataStart, dataEnd)
        const mediaType = getAttachmentType(filename)

        if (mediaType && mediaType !== 'file' && mediaType !== 'zip') {
          const extension = filename.split('.').pop().toLowerCase()
          const mimeType  = `${mediaType}/${extension === 'svg' ? 'svg+xml' : extension}`
          const fileBlob  = new Blob([fileBytes], { type: mimeType })
          const blobUrl   = URL.createObjectURL(fileBlob)
          
          mediaBlobs.push({ type: mediaType, blobUrl, filename })
        }
      }
      byteOffset = dataEnd
    }

    if (mediaBlobs.length > 0) {
      const gridElement = containerNode.querySelector('.zip-contents-grid')
      if (gridElement) {
        gridElement.style.display  = 'flex'
        gridElement.style.flexWrap = 'wrap'
        gridElement.style.gap      = '8px'
        gridElement.innerHTML      = mediaBlobs.map((item) => {
          if (item.type === 'image') return `<a href="${item.blobUrl}" target="_blank" rel="noopener noreferrer"><img src="${item.blobUrl}" alt="${item.filename}" class="attachment-media attachment-image" style="max-height: 200px;"></a>`
          if (item.type === 'video') return `<video src="${item.blobUrl}" controls class="attachment-media attachment-video" style="max-height: 200px;"></video>`
          if (item.type === 'audio') return `<audio src="${item.blobUrl}" controls class="attachment-media attachment-audio"></audio>`
          return ''
        }).join('')
      }
    }
  } catch (unpackError) {
    console.warn('Could not unpack zip preview:', unpackError)
  }
}

const parseMessageText = (rawText, currentUser) => {
  let safeHtml = String(rawText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const detectedUrls = []
  safeHtml = safeHtml.replace(/(https?:\/\/[^\s]+)/g, (fullUrl) => {
    detectedUrls.push(fullUrl)
    return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${fullUrl}</a>`
  })

  let hasPingedSelf = false
  safeHtml = safeHtml.replace(/@([a-zA-Z0-9_-]+)/g, (fullMatch, username) => {
    const isSelf = username === currentUser
    if (isSelf) hasPingedSelf = true
    return `<span class="mention-badge ${isSelf ? 'mention-self' : ''}">@${username}</span>`
  })

  safeHtml = safeHtml.replace(/`([^`]+)`/g,       '<span class="code-snippet">$1</span>')
  safeHtml = safeHtml.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  const attachmentsHtml = detectedUrls
    .map((urlItem) => renderAttachmentHtml(urlItem))
    .filter(Boolean)
    .join('')

  return { html: safeHtml, attachmentsHtml, detectedUrls, hasPingedSelf }
}

const refreshProfileAvatar = () => {
  const handleString = userHandleInput.value.trim() || 'Anonymous'
  userAvatarBadge.textContent           = getInitials(handleString)
  userAvatarBadge.style.backgroundColor = getAvatarColor(handleString)
}

const setMemberStatus = (username, isOnline, timestamp = Date.now()) => {
  if (!username || username === 'Anonymous') return
  membersMap.set(username, { online: isOnline, lastActive: timestamp })
  if (activeChannel) channelMembersCache.set(activeChannel, new Map(membersMap))
  renderMembersList()
}

const renderMembersList = () => {
  activeMembersList.innerHTML = ''
  const currentHandle = userHandleInput.value.trim() || 'Anonymous'
  membersMap.set(currentHandle, { online: true, lastActive: Date.now() })

  const onlineMembers = Array.from(membersMap.entries())
    .filter(([memberName, metaData]) => metaData.online)
    .sort((userA, userB) => userA[0].localeCompare(userB[0]))

  memberCountBadge.textContent = onlineMembers.length

  if (onlineMembers.length === 0) {
    activeMembersList.innerHTML = '<div class="empty-members"><i class="fa-solid fa-users-slash"></i><span>No active users</span></div>'
    return
  }

  onlineMembers.forEach(([memberName]) => {
    const memberItem       = document.createElement('div')
    memberItem.className   = 'member-item'
    memberItem.title       = `${memberName} - Click to mention`
    memberItem.innerHTML   = `
      <div class="member-avatar" style="background:${getAvatarColor(memberName)}">${getInitials(memberName)}</div>
      <span class="member-name">${memberName}</span>
    `
    memberItem.addEventListener('click', () => {
      chatMessageInput.value = `${chatMessageInput.value.trim()} @${memberName} `.trimStart()
      chatMessageInput.focus()
    })
    activeMembersList.appendChild(memberItem)
  })
}

setInterval(() => {
  const currentTime = Date.now()
  const myHandle    = userHandleInput.value.trim() || 'Anonymous'
  let   hasChanged  = false
  
  membersMap.forEach((metaData, memberName) => {
    if (memberName !== myHandle && metaData.online && (currentTime - metaData.lastActive > 90000)) {
      metaData.online = false
      hasChanged      = true
    }
  })
  if (hasChanged) renderMembersList()
}, 15000)

window.addEventListener('beforeunload', () => {
  if (activeChannel) {
    const currentUser = userHandleInput.value.trim() || 'Anonymous'
    protocolClient.sendMessage(activeChannel, `[${currentUser}]: ${signalLeave}`).catch(() => {})
  }
})

const renderMessageCard = ({ author, body, sequence, isValid = true, isPending = false, silent = false, shouldPrepend = false }) => {
  if (emptyStatePlaceholder) emptyStatePlaceholder.style.display = 'none'

  const currentUser = userHandleInput.value.trim() || 'Anonymous'
  const { html, attachmentsHtml, hasPingedSelf } = parseMessageText(body, currentUser)

  if (!silent && !isPending && sequence > audioWatermarkSequence) {
    if (hasPingedSelf)         playChime('mention')
    else if (author !== currentUser) playChime('message')
  }

  const messageCard     = document.createElement('div')
  messageCard.className = `message-card ${hasPingedSelf ? 'highlight-mention' : ''} ${!isValid ? 'corrupt-message' : ''} ${isPending ? 'is-pending' : ''}`.trim()
  if (sequence) messageCard.dataset.sequence = sequence

  messageCard.innerHTML = `
    <div class="message-avatar" style="background:${getAvatarColor(author)}">${getInitials(author)}</div>
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

  if (shouldPrepend) {
    const firstExistingCard = messageStreamFeed.querySelector('.message-card')
    if (firstExistingCard) {
      messageStreamFeed.insertBefore(messageCard, firstExistingCard)
    } else {
      messageStreamFeed.appendChild(messageCard)
    }
  } else {
    messageStreamFeed.appendChild(messageCard)
    messageStreamFeed.scrollTop = messageStreamFeed.scrollHeight
  }

  totalMessagesReceived++
  messageCounterText.textContent = totalMessagesReceived
  
  return messageCard
}

const resetFeedState = () => {
  messageStreamFeed.innerHTML = ''
  messageStreamFeed.appendChild(emptyStatePlaceholder)
  emptyStatePlaceholder.style.display = 'block'
  totalMessagesReceived               = 0
  messageCounterText.textContent      = '0'

  lowestLoadedSequence   = Infinity
  isLoadingOlderMessages = false
  hasReachedHistoryStart = false
}

const loadOlderMessages = async () => {
  if (isLoadingOlderMessages || hasReachedHistoryStart || !activeChannel) return
  if (lowestLoadedSequence <= 1 || lowestLoadedSequence === Infinity) {
    hasReachedHistoryStart = true
    return
  }

  isLoadingOlderMessages = true

  const targetToSequence   = lowestLoadedSequence - 1
  const targetFromSequence = Math.max(1, targetToSequence - 35)

  if (targetFromSequence === 1) {
    hasReachedHistoryStart = true
  }

  try {
    const previousScrollHeight = messageStreamFeed.scrollHeight
    const olderMessages        = await protocolClient.fetchChannelHistory(
      activeChannel, 
      targetFromSequence, 
      targetToSequence
    )

    olderMessages.sort((itemA, itemB) => itemB.sequence - itemA.sequence)

    olderMessages.forEach((olderItem) => {
      if (olderItem.sequence && seenSequences.has(olderItem.sequence)) return
      if (olderItem.sequence) seenSequences.add(olderItem.sequence)

      let   authorName  = 'Anonymous'
      let   messageBody = olderItem.payload || ''
      const regexMatch  = messageBody.match(/^\[(.*?)\]:\s*([\s\S]*)$/)

      if (regexMatch) {
        authorName  = regexMatch[1]
        messageBody = regexMatch[2]
      }

      if (messageBody === signalLeave || messageBody === signalJoin) return

      if (olderItem.sequence < lowestLoadedSequence) {
        lowestLoadedSequence = olderItem.sequence
      }

      renderMessageCard({
        author:        authorName,
        body:          messageBody,
        sequence:      olderItem.sequence,
        isValid:       olderItem.isValid,
        silent:        true,
        shouldPrepend: true
      })
    })

    const newScrollHeight       = messageStreamFeed.scrollHeight
    messageStreamFeed.scrollTop = newScrollHeight - previousScrollHeight
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
    channelListenerUnsubscribe = null
  }

  audioWatermarkSequence            = Infinity
  activeChannel                     = targetChannel
  currentRoomHeader.textContent     = activeChannel
  chatMessageInput.disabled         = false
  attachFileBtn.disabled            = false
  sendMessageBtn.disabled           = false
  chatMessageInput.placeholder      = `Message #${activeChannel}...`
  chatMessageInput.focus()
  copyRoomLinkBtn.style.display     = 'inline-flex'
  leaveRoomBtn.style.display        = 'inline-flex'
  messageCounterBadge.style.display = 'inline-flex'

  resetFeedState()
  seenSequences.clear()
  membersMap.clear()
  highlightChannelButton(activeChannel)

  const cachedMessages  = channelHistoryCache.get(activeChannel) || []
  let   highestSequence = 0

  if (cachedMessages.length > 0) {
    cachedMessages.forEach((cachedItem) => {
      if (cachedItem.sequence) {
        seenSequences.add(cachedItem.sequence)
        if (cachedItem.sequence > highestSequence) highestSequence = cachedItem.sequence
        if (cachedItem.sequence < lowestLoadedSequence) lowestLoadedSequence = cachedItem.sequence
      }
      renderMessageCard({ author: cachedItem.author, body: cachedItem.body, sequence: cachedItem.sequence, isValid: cachedItem.isValid, silent: true })
    })
  }

  const cachedMembers = channelMembersCache.get(activeChannel)
  if (cachedMembers) cachedMembers.forEach((metaData, memberName) => membersMap.set(memberName, metaData))
  renderMembersList()

  const latestRaw       = await protocolClient.fetchRawCounter(protocolClient.resolveChannelIndexKey(activeChannel))
  const latestServerSeq = parseInt(latestRaw, 10) || 0
  audioWatermarkSequence = latestServerSeq

  if (latestServerSeq > highestSequence) {
    try {
      const startSequence = highestSequence > 0 ? highestSequence + 1 : Math.max(1, latestServerSeq - 35)
      const missingDelta  = await protocolClient.fetchChannelHistory(activeChannel, startSequence, latestServerSeq)

      missingDelta.forEach((deltaItem) => {
        if (deltaItem.sequence && seenSequences.has(deltaItem.sequence)) return
        if (deltaItem.sequence) {
          seenSequences.add(deltaItem.sequence)
          if (deltaItem.sequence < lowestLoadedSequence) lowestLoadedSequence = deltaItem.sequence
        }

        let   authorName  = 'Anonymous'
        let   messageBody = deltaItem.payload || ''
        const regexMatch  = messageBody.match(/^\[(.*?)\]:\s*([\s\S]*)$/)
        
        if (regexMatch) { 
          authorName  = regexMatch[1]
          messageBody = regexMatch[2] 
        }

        if (messageBody === signalLeave || messageBody === signalJoin) return
        
        const currentUser = userHandleInput.value.trim() || 'Anonymous'
        if (authorName !== currentUser && !membersMap.has(authorName)) membersMap.set(authorName, { online: false, lastActive: 0 })

        const messageObject = { author: authorName, body: messageBody, timestamp: deltaItem.timestamp || Date.now(), sequence: deltaItem.sequence, isValid: deltaItem.isValid }
        cachedMessages.push(messageObject)
        renderMessageCard({ author: authorName, body: messageBody, sequence: deltaItem.sequence, isValid: deltaItem.isValid, silent: true })
      })

      if (startSequence <= 1) {
        hasReachedHistoryStart = true
      }

      channelHistoryCache.set(activeChannel, cachedMessages)
      channelMembersCache.set(activeChannel, new Map(membersMap))
      renderMembersList()
    } catch (syncError) {
      console.warn('History synchronization error:', syncError)
    }
  }

  while (!hasReachedHistoryStart && messageStreamFeed.scrollHeight <= messageStreamFeed.clientHeight) {
    await loadOlderMessages()
  }

  const currentUser = userHandleInput.value.trim() || 'Anonymous'
  protocolClient.sendMessage(activeChannel, `[${currentUser}]: ${signalJoin}`).catch(() => {})

  channelListenerUnsubscribe = protocolClient.listenToChannel(activeChannel, (eventData) => {
    if (eventData.isResetState) {
      resetFeedState()
      seenSequences.clear()
      membersMap.clear()
      channelHistoryCache.delete(activeChannel)
      channelMembersCache.delete(activeChannel)
      renderMembersList()
      return
    }

    if (eventData.sequence && seenSequences.has(eventData.sequence)) return
    if (eventData.sequence) seenSequences.add(eventData.sequence)

    let   authorName  = 'Anonymous'
    let   messageBody = eventData.payload || ''
    const regexMatch  = messageBody.match(/^\[(.*?)\]:\s*([\s\S]*)$/)
    
    if (regexMatch) { 
      authorName  = regexMatch[1]
      messageBody = regexMatch[2] 
    }

    if (messageBody === signalLeave) return setMemberStatus(authorName, false, 0)
    if (messageBody === signalJoin)  return setMemberStatus(authorName, true, Date.now())

    setMemberStatus(authorName, true, Date.now())
    
    const messageObject = { author: authorName, body: messageBody, timestamp: eventData.timestamp || Date.now(), sequence: eventData.sequence, isValid: eventData.isValid }
    const currentList   = channelHistoryCache.get(activeChannel) || []
    
    currentList.push(messageObject)
    channelHistoryCache.set(activeChannel, currentList)
    renderMessageCard({ author: authorName, body: messageBody, sequence: eventData.sequence, isValid: eventData.isValid })
  })
}

const leaveChannel = async () => {
  if (activeChannel) {
    const currentUser = userHandleInput.value.trim() || 'Anonymous'
    await protocolClient.sendMessage(activeChannel, `[${currentUser}]: ${signalLeave}`).catch(() => {})
  }
  if (channelListenerUnsubscribe) {
    channelListenerUnsubscribe()
    channelListenerUnsubscribe = null
  }

  audioWatermarkSequence            = Infinity
  activeChannel                     = ''
  currentRoomHeader.textContent     = "This ain't no chat"
  chatMessageInput.disabled         = true
  attachFileBtn.disabled            = true
  sendMessageBtn.disabled           = true
  chatMessageInput.placeholder      = 'Select a channel to start chatting...'
  chatMessageInput.style.height     = 'auto'
  copyRoomLinkBtn.style.display     = 'none'
  leaveRoomBtn.style.display        = 'none'
  messageCounterBadge.style.display = 'none'
  stagedFiles.length                = 0

  renderStagedFiles()
  resetFeedState()
  seenSequences.clear()
  membersMap.clear()
  
  activeMembersList.innerHTML  = '<div class="empty-members"><i class="fa-solid fa-users-slash"></i><span>Not in an active channel</span></div>'
  memberCountBadge.textContent = '0'
  highlightChannelButton('')
}

const handleClearCommand = async (countToClear) => {
  if (!activeChannel) return
  const targetChannel = activeChannel

  const latestRaw    = await protocolClient.fetchRawCounter(protocolClient.resolveChannelIndexKey(targetChannel))
  const maxSequence  = parseInt(latestRaw, 10) || 0
  const channelCache = channelHistoryCache.get(targetChannel) || []
  const wipeCount    = parseInt(countToClear, 10)

  const isFullWipe = !wipeCount || wipeCount >= channelCache.length

  if (isFullWipe) {
    const wipePromises = Array.from({ length: maxSequence }, (item, index) =>
      protocolClient.setRawCounter(protocolClient.resolveMessageKey(targetChannel, index + 1), '0')
    )
    await Promise.all(wipePromises)
    await protocolClient.clearChannelHistory(targetChannel)
    
    channelHistoryCache.delete(targetChannel)
    seenSequences.clear()
    resetFeedState()
    return
  }

  const remainingMessages = channelCache.slice(0, channelCache.length - wipeCount)
  const removedMessages   = channelCache.slice(channelCache.length - wipeCount)
  const wipePromises      = removedMessages
    .filter((messageItem) => messageItem.sequence)
    .map((messageItem) => {
      seenSequences.delete(messageItem.sequence)
      return protocolClient.setRawCounter(protocolClient.resolveMessageKey(targetChannel, messageItem.sequence), '0')
    })

  await Promise.all(wipePromises)
  channelHistoryCache.set(targetChannel, remainingMessages)

  const renderedCards = messageStreamFeed.querySelectorAll('.message-card')
  Array.from(renderedCards).slice(-wipeCount).forEach((cardElement) => cardElement.remove())

  totalMessagesReceived          = Math.max(0, totalMessagesReceived - wipeCount)
  messageCounterText.textContent = String(totalMessagesReceived)

  if (messageStreamFeed.querySelectorAll('.message-card').length === 0) resetFeedState()
}

const handleDeleteCommand = async () => {
  if (!activeChannel) return
  const targetChannel = activeChannel

  const latestRaw   = await protocolClient.fetchRawCounter(protocolClient.resolveChannelIndexKey(targetChannel))
  const maxSequence = parseInt(latestRaw, 10) || 0

  const wipePromises = Array.from({ length: maxSequence }, (item, index) =>
    protocolClient.setRawCounter(protocolClient.resolveMessageKey(targetChannel, index + 1), '0')
  )
  await Promise.all(wipePromises)
  await protocolClient.clearChannelHistory(targetChannel)
  await protocolClient.unregisterChannel(targetChannel)

  channelHistoryCache.delete(targetChannel)
  channelMembersCache.delete(targetChannel)
  allDiscoveredChannels = allDiscoveredChannels.filter((channelItem) => channelItem !== targetChannel)
  
  renderChannels(allDiscoveredChannels)
  await leaveChannel()
  await scanChannels()
}

const uploadToLitterbox = async (fileObject) => {
  const requestData = new FormData()
  requestData.append('reqtype',      'fileupload')
  requestData.append('time',         '24h')
  requestData.append('fileToUpload', fileObject)

  const uploadResponse = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    body:   requestData
  })

  if (!uploadResponse.ok) throw new Error('Litterbox upload request failed')
  const uploadedUrl = (await uploadResponse.text()).trim()
  if (!uploadedUrl.startsWith('http')) throw new Error('Invalid Litterbox response')
  
  return uploadedUrl
}

const renderStagedFiles = () => {
  if (stagedFiles.length === 0) {
    stagedFilesContainer.innerHTML     = ''
    stagedFilesContainer.style.display = 'none'
    return
  }

  stagedFilesContainer.style.display = 'flex'
  stagedFilesContainer.innerHTML     = ''

  let totalBytes = 0
  stagedFiles.forEach((fileItem, index) => {
    totalBytes += fileItem.size
    const chipElement       = document.createElement('div')
    chipElement.className   = 'staged-chip'
    chipElement.innerHTML   = `
      <i class="fa-solid fa-file"></i>
      <span class="chip-name" title="${fileItem.name}">${fileItem.name}</span>
      <span class="chip-size">${formatFileSize(fileItem.size)}</span>
      <button class="chip-remove-btn" type="button" title="Remove file">&times;</button>
    `
    chipElement.querySelector('.chip-remove-btn').addEventListener('click', () => {
      stagedFiles.splice(index, 1)
      renderStagedFiles()
    })
    stagedFilesContainer.appendChild(chipElement)
  })

  const metaBadgeElement       = document.createElement('div')
  metaBadgeElement.className   = 'staged-tray-meta'
  metaBadgeElement.textContent = `${stagedFiles.length} file${stagedFiles.length > 1 ? 's' : ''} (${formatFileSize(totalBytes)} / 1 GB)`
  stagedFilesContainer.appendChild(metaBadgeElement)
}

const addFilesToStaging = (newFiles) => {
  let currentTotal = stagedFiles.reduce((sumSize, fileItem) => sumSize + fileItem.size, 0)
  let refusedCount = 0

  for (const fileItem of newFiles) {
    if (currentTotal + fileItem.size > litterboxMaxBytes) {
      refusedCount++
      continue
    }
    stagedFiles.push(fileItem)
    currentTotal += fileItem.size
  }

  if (refusedCount > 0) {
    alert(`Refused ${refusedCount} file(s): combined upload would exceed the 1 GB maximum limit per request.`)
  }
  renderStagedFiles()
}

attachFileBtn.addEventListener('click', () => {
  if (!activeChannel) return
  fileAttachmentInput.click()
})

fileAttachmentInput.addEventListener('change', () => {
  const chosenFiles = Array.from(fileAttachmentInput.files || [])
  if (chosenFiles.length > 0) addFilesToStaging(chosenFiles)
  fileAttachmentInput.value = ''
})

const dispatchMessage = async () => {
  const messageText = chatMessageInput.value.trim()
  if (!activeChannel || (!messageText && stagedFiles.length === 0)) return

  const clearRegexMatch = messageText.match(/^\/clear(?:\s+(\d+))?$/i)
  if (clearRegexMatch) {
    chatMessageInput.value        = ''
    chatMessageInput.style.height = 'auto'
    return handleClearCommand(clearRegexMatch[1])
  }

  if (messageText.trim().toLowerCase() === '/delete') {
    chatMessageInput.value        = ''
    chatMessageInput.style.height = 'auto'
    return handleDeleteCommand()
  }

  const currentUser             = userHandleInput.value.trim() || 'Anonymous'
  chatMessageInput.value        = ''
  chatMessageInput.style.height = 'auto'

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
      alert('Failed to upload file(s) to Litterbox. Please try again.')
      sendMessageBtn.disabled  = false
      attachFileBtn.disabled   = false
      sendMessageBtn.innerHTML = originalSendIcon
      chatMessageInput.value   = messageText
      return
    } finally {
      sendMessageBtn.disabled  = false
      attachFileBtn.disabled   = false
      sendMessageBtn.innerHTML = originalSendIcon
    }
  }

  const finalMessageBody  = [messageText, uploadedFileUrl].filter(Boolean).join('\n')
  const { hasPingedSelf } = parseMessageText(finalMessageBody, currentUser)
  if (hasPingedSelf) playChime('mention')

  const optimisticCard = renderMessageCard({ author: currentUser, body: finalMessageBody, sequence: null, isPending: true, silent: true })

  try {
    const publishResult = await protocolClient.sendMessage(activeChannel, `[${currentUser}]: ${finalMessageBody}`)
    if (publishResult?.sequence) {
      seenSequences.add(publishResult.sequence)
      optimisticCard.classList.remove('is-pending')
      optimisticCard.dataset.sequence = publishResult.sequence

      const currentCache = channelHistoryCache.get(activeChannel) || []
      currentCache.push({ author: currentUser, body: finalMessageBody, timestamp: Date.now(), sequence: publishResult.sequence, isValid: true })
      channelHistoryCache.set(activeChannel, currentCache)
    }
  } catch {
    optimisticCard.style.borderColor = '#ef4444'
    optimisticCard.classList.add('corrupt-message')
  }
}

const highlightChannelButton = (channelName) => {
  document.querySelectorAll('.channel-item').forEach((buttonElement) => {
    buttonElement.classList.toggle('active', buttonElement.dataset.room === channelName)
  })
}

const renderChannels = (channelList) => {
  discoveredRoomsContainer.innerHTML = ''
  if (!channelList || channelList.length === 0) {
    discoveredRoomsContainer.innerHTML = '<div class="empty-channels"><i class="fa-solid fa-folder-open"></i><span>No public channels yet.<br>Click sync or create one.</span></div>'
    return
  }

  channelList.forEach((channelName) => {
    const channelButton        = document.createElement('div')
    channelButton.className    = `channel-item ${channelName === activeChannel ? 'active' : ''}`
    channelButton.dataset.room = channelName
    channelButton.innerHTML    = `<i class="fa-solid fa-hashtag"></i><span>${channelName}</span>`
    channelButton.addEventListener('click', () => joinChannel(channelName))
    discoveredRoomsContainer.appendChild(channelButton)
  })
}

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
  if (messageStreamFeed.scrollTop <= 60) {
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

toggleMembersBtn.addEventListener('click', () => membersSidebar.classList.toggle('is-hidden'))

userHandleInput.value = `copr${Math.floor(Math.random() * 899 + 100)}`
refreshProfileAvatar()

userHandleInput.addEventListener('input', () => {
  refreshProfileAvatar()
  renderMembersList()
})

toggleAudioBtn.addEventListener('click', async () => {
  soundEnabled = !soundEnabled
  toggleAudioBtn.classList.toggle('active', soundEnabled)
  toggleAudioBtn.innerHTML = soundEnabled ? '<i class="fa-solid fa-bell"></i>' : '<i class="fa-solid fa-bell-slash"></i>'
  if (soundEnabled) await playChime('mention')
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
  if (keyboardEvent.key === 'Enter') connectChannelBtn.click()
})

acceptTermsBtn.addEventListener('click', async () => {
  await initializeAudioContext()
  termsModal.style.display = 'none'
  playChime('mention')
})

sendMessageBtn.addEventListener('click',      dispatchMessage)
copyRoomLinkBtn.addEventListener('click',     () => navigator.clipboard.writeText(activeChannel))
leaveRoomBtn.addEventListener('click',        leaveChannel)
refreshDiscoveryBtn.addEventListener('click', scanChannels)

searchChannelsInput.addEventListener('input', (inputEvent) => {
  const searchQuery = inputEvent.target.value
  renderChannels(allDiscoveredChannels.filter((channelItem) => channelItem.includes(searchQuery)))
})

scanChannels()