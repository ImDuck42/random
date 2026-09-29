import CoPrProtocol from './countingProtocol.js'

const copr = new CoPrProtocol({ pollIntervalMs: 250 })

// Protocol System Messages
const SYSTEM_SIGNAL_LEAVE = '__SYS_LEAVE__'
const SYSTEM_SIGNAL_JOIN  = '__SYS_JOIN__'

// DOM References
const termsModal               = document.getElementById('termsModal')
const acceptTermsBtn           = document.getElementById('acceptTermsBtn')

const userHandleInput          = document.getElementById('userHandleInput')
const userAvatarBadge          = document.getElementById('userAvatarBadge')
const toggleAudioBtn           = document.getElementById('toggleAudioBtn')
const channelNameInput         = document.getElementById('channelNameInput')
const publicDiscoveryToggle    = document.getElementById('publicDiscoveryToggle')
const connectChannelBtn        = document.getElementById('connectChannelBtn')
const refreshDiscoveryBtn      = document.getElementById('refreshDiscoveryBtn')
const searchChannelsInput      = document.getElementById('searchChannelsInput')
const discoveredRoomsContainer = document.getElementById('discoveredRoomsContainer')

const currentRoomHeader        = document.getElementById('currentRoomHeader')
const messageCounterBadge      = document.getElementById('messageCounterBadge')
const messageCounterText       = document.getElementById('messageCounterText')
const copyRoomLinkBtn          = document.getElementById('copyRoomLinkBtn')
const clearRoomBtn             = document.getElementById('clearRoomBtn')
const toggleMembersBtn         = document.getElementById('toggleMembersBtn')
const leaveRoomBtn             = document.getElementById('leaveRoomBtn')

const messageStreamFeed        = document.getElementById('messageStreamFeed')
const emptyStatePlaceholder    = document.getElementById('emptyStatePlaceholder')
const chatMessageInput         = document.getElementById('chatMessageInput')
const sendMessageBtn           = document.getElementById('sendMessageBtn')
const toastContainer           = document.getElementById('toastContainer')

const membersSidebar           = document.getElementById('membersSidebar')
const activeMembersList        = document.getElementById('activeMembersList')
const memberCountBadge         = document.getElementById('memberCountBadge')

// Application State
let activeRoom = ''
let activeUnsubscribe = null
let soundEnabled = true
let allDiscoveredChannels = []
let totalMessagesReceived = 0

// Strict Audio Watermark: ANY message with sequence <= audioWatermarkSeq is MUTED
let audioWatermarkSeq = Infinity

// In-Memory Channel Caching (Instant 0ms Channel Switching)
const roomHistoryCache = new Map() // room -> Array of parsed message objects
const roomMembersCache = new Map() // room -> Map of { online, lastActive }

const seenSequences = new Set()
const membersMap    = new Map()

// Avatar Procedural Palette
const AVATAR_COLORS = [
  '#e11d48',
  '#d97706',
  '#059669',
  '#0284c7',
  '#7c3aed',
  '#db2777',
  '#4f46e5',
  '#0891b2'
]

const getAvatarColor = (name) => {
  let hash = 0
  for (let index = 0; index < name.length; index++) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

const getInitials = (name) => {
  return (name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2) || 'CP').toUpperCase()
}

// =========================================================================
// AUDIO ENGINE (Dual-Tone Bell Chime + Compressor)
// =========================================================================
let audioContext = null
let compressorNode = null

const getAudioContext = async () => {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    audioContext = new AudioContextClass()
    compressorNode = audioContext.createDynamicsCompressor()
    compressorNode.threshold.setValueAtTime(-14, audioContext.currentTime)
    compressorNode.knee.setValueAtTime(8, audioContext.currentTime)
    compressorNode.ratio.setValueAtTime(6, audioContext.currentTime)
    compressorNode.attack.setValueAtTime(0.002, audioContext.currentTime)
    compressorNode.release.setValueAtTime(0.12, audioContext.currentTime)
    compressorNode.connect(audioContext.destination)
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }

  return audioContext
}

window.addEventListener('click', () => { getAudioContext() }, { once: true })
window.addEventListener('keydown', () => { getAudioContext() }, { once: true })

const playChime = async (type = 'message') => {
  if (!soundEnabled) return

  try {
    const context = await getAudioContext()
    const startTime = context.currentTime

    if (type === 'mention') {
      const oscillator1 = context.createOscillator()
      const gainNode1   = context.createGain()
      oscillator1.type = 'triangle'
      oscillator1.frequency.setValueAtTime(659.25, startTime)
      oscillator1.frequency.exponentialRampToValueAtTime(880, startTime + 0.08)
      gainNode1.gain.setValueAtTime(0.85, startTime)
      gainNode1.gain.setValueAtTime(0.85, startTime + 0.12)
      gainNode1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5)

      const oscillator2 = context.createOscillator()
      const gainNode2   = context.createGain()
      oscillator2.type = 'sine'
      oscillator2.frequency.setValueAtTime(1318.5, startTime + 0.05)
      gainNode2.gain.setValueAtTime(0.001, startTime)
      gainNode2.gain.setValueAtTime(0.65, startTime + 0.06)
      gainNode2.gain.setValueAtTime(0.65, startTime + 0.15)
      gainNode2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45)

      oscillator1.connect(gainNode1).connect(compressorNode)
      oscillator2.connect(gainNode2).connect(compressorNode)

      oscillator1.start(startTime)
      oscillator1.stop(startTime + 0.52)
      oscillator2.start(startTime + 0.05)
      oscillator2.stop(startTime + 0.47)
    } else {
      const oscillator = context.createOscillator()
      const gainNode   = context.createGain()
      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(523.25, startTime)
      oscillator.frequency.exponentialRampToValueAtTime(783.99, startTime + 0.09)
      gainNode.gain.setValueAtTime(0.75, startTime)
      gainNode.gain.setValueAtTime(0.75, startTime + 0.09)
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35)

      oscillator.connect(gainNode).connect(compressorNode)
      oscillator.start(startTime)
      oscillator.stop(startTime + 0.37)
    }
  } catch (audioError) {
    console.warn('Audio playback error:', audioError)
  }
}

acceptTermsBtn.addEventListener('click', async () => {
  await getAudioContext()
  termsModal.style.display = 'none'
  playChime('mention')
  showToast('Audio enabled & Terms accepted', 'fa-volume-high')
})

const showToast = (message, icon = 'fa-circle-info') => {
  const toast = document.createElement('div')
  toast.className = 'toast-card'
  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`
  toastContainer.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(-10px)'
    toast.style.transition = 'all 0.2s ease'
    setTimeout(() => toast.remove(), 200)
  }, 2400)
}

const parseMessageText = (rawText, currentUser) => {
  let safeHtml = String(rawText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  safeHtml = safeHtml.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  )

  let hasPingedSelf = false
  safeHtml = safeHtml.replace(/@([a-zA-Z0-9_-]+)/g, (fullMatch, username) => {
    const isSelf = username === currentUser
    if (isSelf) hasPingedSelf = true
    return `<span class="mention-badge ${isSelf ? 'mention-self' : ''}">@${username}</span>`
  })

  safeHtml = safeHtml.replace(/`([^`]+)`/g, '<span class="code-snippet">$1</span>')
  safeHtml = safeHtml.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  return { html: safeHtml, hasPingedSelf }
}

const refreshProfileAvatar = () => {
  const handle = userHandleInput.value.trim() || 'Anonymous'
  userAvatarBadge.textContent = getInitials(handle)
  userAvatarBadge.style.backgroundColor = getAvatarColor(handle)
}

// Presence Engine
const setMemberStatus = (username, isOnline, timestamp = Date.now()) => {
  if (!username || username === 'Anonymous') return
  membersMap.set(username, { online: isOnline, lastActive: timestamp })
  if (activeRoom) {
    roomMembersCache.set(activeRoom, new Map(membersMap))
  }
  renderMembersList()
}

const renderMembersList = () => {
  activeMembersList.innerHTML = ''
  const currentHandle = userHandleInput.value.trim() || 'Anonymous'
  membersMap.set(currentHandle, { online: true, lastActive: Date.now() })

  const sortedMembers = Array.from(membersMap.entries()).sort((memberA, memberB) => {
    if (memberA[1].online === memberB[1].online) {
      return memberA[0].localeCompare(memberB[0])
    }
    return memberA[1].online ? -1 : 1
  })

  let onlineCount = 0
  sortedMembers.forEach(([memberName, meta]) => {
    if (meta.online) onlineCount++
  })
  memberCountBadge.textContent = onlineCount

  sortedMembers.forEach(([memberName, meta]) => {
    const item = document.createElement('div')
    item.className = 'member-item'
    item.title = `${memberName} (${meta.online ? 'Online' : 'Offline'}) - Click to mention`
    item.innerHTML = `
      <div class="member-avatar" style="background:${getAvatarColor(memberName)}">${getInitials(memberName)}</div>
      <span class="member-name" style="${meta.online ? '' : 'color: var(--text-dim);'}">${memberName}</span>
      <span class="online-dot ${meta.online ? 'is-online' : 'is-offline'}"></span>
    `
    item.addEventListener('click', () => {
      chatMessageInput.value = `${chatMessageInput.value.trim()} @${memberName} `.trimStart()
      chatMessageInput.focus()
    })
    activeMembersList.appendChild(item)
  })
}

// 90s Inactivity Heartbeat Cleanup
setInterval(() => {
  const currentTime = Date.now()
  const currentHandle = userHandleInput.value.trim() || 'Anonymous'
  let hasChanges = false

  membersMap.forEach((meta, memberName) => {
    if (memberName !== currentHandle && meta.online && (currentTime - meta.lastActive > 90000)) {
      meta.online = false
      hasChanges = true
    }
  })

  if (hasChanges) renderMembersList()
}, 15000)

window.addEventListener('beforeunload', () => {
  if (activeRoom) {
    const user = userHandleInput.value.trim() || 'Anonymous'
    copr.sendMessage(activeRoom, `[${user}]: ${SYSTEM_SIGNAL_LEAVE}`).catch(() => {})
  }
})

// =========================================================================
// MESSAGE RENDERING (Watermark-Guarded Audio)
// =========================================================================
const renderMessageCard = ({
  author,
  body,
  timestamp,
  seq,
  isValid = true,
  isPending = false,
  silent = false
}) => {
  if (emptyStatePlaceholder) {
    emptyStatePlaceholder.style.display = 'none'
  }

  const currentUser = userHandleInput.value.trim() || 'Anonymous'
  const { html, hasPingedSelf } = parseMessageText(body, currentUser)

  // ONLY play chime if sequence is strictly GREATER than watermark at join time
  const isPostJoinLive = !silent && !isPending && (seq > audioWatermarkSeq)
  if (isPostJoinLive) {
    if (hasPingedSelf) {
      playChime('mention')
    } else if (author !== currentUser) {
      playChime('message')
    }
  }

  const card = document.createElement('div')
  const mentionClass = hasPingedSelf ? 'highlight-mention' : ''
  const corruptClass = !isValid ? 'corrupt-message' : ''
  const pendingClass = isPending ? 'is-pending' : ''
  card.className = `message-card ${mentionClass} ${corruptClass} ${pendingClass}`.trim()
  if (seq) card.dataset.seq = seq

  const formattedTime = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })

  card.innerHTML = `
    <div class="message-avatar" style="background:${getAvatarColor(author)}">${getInitials(author)}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="sender-name">${author}</span>
        ${seq ? `<span class="message-seq">#${seq}</span>` : '<span class="message-seq">Sending...</span>'}
        <span class="message-time">${formattedTime}</span>
        ${!isValid ? '<span style="color:#ef4444; font-weight:800; font-size:0.8rem;">[CORRUPTED]</span>' : ''}
      </div>
      <div class="message-text">${html}</div>
    </div>
  `

  messageStreamFeed.appendChild(card)
  messageStreamFeed.scrollTop = messageStreamFeed.scrollHeight

  totalMessagesReceived++
  messageCounterText.textContent = totalMessagesReceived
  return card
}

// =========================================================================
// INSTANT CHANNEL SWITCHING (Zero Reload Lag via Cache)
// =========================================================================
const joinChannel = async (room) => {
  const targetRoom = String(room).trim()
  if (!targetRoom) return

  // Unsubscribe old room
  if (activeUnsubscribe) {
    activeUnsubscribe()
    activeUnsubscribe = null
  }

  // Lock watermark to Infinity during switch: zero audio triggers
  audioWatermarkSeq = Infinity

  activeRoom = targetRoom
  currentRoomHeader.textContent = activeRoom

  chatMessageInput.disabled = false
  sendMessageBtn.disabled = false
  chatMessageInput.placeholder = `Message #${activeRoom}...`
  chatMessageInput.focus()

  copyRoomLinkBtn.style.display     = 'inline-flex'
  clearRoomBtn.style.display        = 'inline-flex'
  leaveRoomBtn.style.display        = 'inline-flex'
  messageCounterBadge.style.display = 'inline-flex'

  // Screen Reset
  messageStreamFeed.innerHTML = ''
  totalMessagesReceived = 0
  messageCounterText.textContent = '0'
  seenSequences.clear()
  membersMap.clear()

  highlightChannelButton(activeRoom)

  // 1. Instant Cache Restoration
  const cachedMessages = roomHistoryCache.get(activeRoom) || []
  let highestCachedSeq = 0

  if (cachedMessages.length > 0) {
    cachedMessages.forEach((cachedMsg) => {
      if (cachedMsg.sequence) {
        seenSequences.add(cachedMsg.sequence)
        if (cachedMsg.sequence > highestCachedSeq) {
          highestCachedSeq = cachedMsg.sequence
        }
      }

      renderMessageCard({
        author: cachedMsg.author,
        body: cachedMsg.body,
        timestamp: cachedMsg.timestamp,
        seq: cachedMsg.sequence,
        isValid: cachedMsg.isValid,
        isPending: false,
        silent: true
      })
    })
  } else {
    messageStreamFeed.appendChild(emptyStatePlaceholder)
    emptyStatePlaceholder.style.display = 'block'
  }

  // Restore cached members
  const cachedMembers = roomMembersCache.get(activeRoom)
  if (cachedMembers) {
    cachedMembers.forEach((meta, memberName) => membersMap.set(memberName, meta))
  }
  renderMembersList()

  // 2. Fetch Server Sequence State
  const rawLatest = await copr.fetchRawCounter(copr.resolveRoomIndexKey(activeRoom))
  const latestServerSeq = parseInt(rawLatest, 10) || 0

  // Watermark locks to server state: anything <= this number will never ring
  audioWatermarkSeq = latestServerSeq

  // 3. Fetch ONLY the delta of missing messages
  if (latestServerSeq > highestCachedSeq) {
    try {
      const fromSeq = highestCachedSeq > 0 ? highestCachedSeq + 1 : Math.max(1, latestServerSeq - 35)
      const deltaHistory = await copr.fetchRoomHistory(activeRoom, fromSeq, latestServerSeq)

      deltaHistory.forEach((item) => {
        if (item.sequence && seenSequences.has(item.sequence)) return
        if (item.sequence) seenSequences.add(item.sequence)

        let author = 'Anonymous'
        let body = item.payload || ''
        const match = body.match(/^\[(.*?)\]:\s*([\s\S]*)$/)
        if (match) {
          author = match[1]
          body = match[2]
        }

        if (body === SYSTEM_SIGNAL_LEAVE || body === SYSTEM_SIGNAL_JOIN) return

        const currentUser = userHandleInput.value.trim() || 'Anonymous'
        if (author !== currentUser && !membersMap.has(author)) {
          membersMap.set(author, { online: false, lastActive: 0 })
        }

        const messageObject = {
          author,
          body,
          timestamp: item.timestamp || Date.now(),
          sequence: item.sequence,
          isValid: item.isValid
        }
        cachedMessages.push(messageObject)

        renderMessageCard({
          author,
          body,
          timestamp: messageObject.timestamp,
          seq: item.sequence,
          isValid: item.isValid,
          isPending: false,
          silent: true
        })
      })

      roomHistoryCache.set(activeRoom, cachedMessages)
      roomMembersCache.set(activeRoom, new Map(membersMap))
      renderMembersList()
    } catch (historyError) {
      console.warn('History synchronization error:', historyError)
    }
  }

  showToast(`Joined #${activeRoom}`, 'fa-arrow-right-to-bracket')

  // Announce Presence
  const user = userHandleInput.value.trim() || 'Anonymous'
  copr.sendMessage(activeRoom, `[${user}]: ${SYSTEM_SIGNAL_JOIN}`).catch(() => {})

  // 4. Real-time Influx Listener
  activeUnsubscribe = copr.listenToRoom(activeRoom, (event) => {
    if (event.isResetState) {
      messageStreamFeed.innerHTML = ''
      messageStreamFeed.appendChild(emptyStatePlaceholder)
      emptyStatePlaceholder.style.display = 'block'
      totalMessagesReceived = 0
      messageCounterText.textContent = '0'
      seenSequences.clear()
      membersMap.clear()
      roomHistoryCache.delete(activeRoom)
      roomMembersCache.delete(activeRoom)
      renderMembersList()
      showToast('Channel was wiped.', 'fa-trash-can')
      return
    }

    if (event.sequence && seenSequences.has(event.sequence)) return
    if (event.sequence) seenSequences.add(event.sequence)

    let author = 'Anonymous'
    let body = event.payload || ''
    const match = body.match(/^\[(.*?)\]:\s*([\s\S]*)$/)
    if (match) {
      author = match[1]
      body = match[2]
    }

    if (body === SYSTEM_SIGNAL_LEAVE) {
      setMemberStatus(author, false, 0)
      return
    }

    if (body === SYSTEM_SIGNAL_JOIN) {
      setMemberStatus(author, true, Date.now())
      return
    }

    setMemberStatus(author, true, Date.now())

    const messageObject = {
      author,
      body,
      timestamp: event.timestamp || Date.now(),
      sequence: event.sequence,
      isValid: event.isValid
    }

    const currentCached = roomHistoryCache.get(activeRoom) || []
    currentCached.push(messageObject)
    roomHistoryCache.set(activeRoom, currentCached)

    renderMessageCard({
      author,
      body,
      timestamp: messageObject.timestamp,
      seq: event.sequence,
      isValid: event.isValid,
      isPending: false,
      silent: false
    })
  })
}

// Disconnect
const leaveChannel = async () => {
  if (activeRoom) {
    const user = userHandleInput.value.trim() || 'Anonymous'
    await copr.sendMessage(activeRoom, `[${user}]: ${SYSTEM_SIGNAL_LEAVE}`).catch(() => {})
  }

  if (activeUnsubscribe) {
    activeUnsubscribe()
    activeUnsubscribe = null
  }

  audioWatermarkSeq = Infinity
  activeRoom = ''
  currentRoomHeader.textContent = 'idle'

  chatMessageInput.disabled = true
  sendMessageBtn.disabled = true
  chatMessageInput.placeholder = 'Select a channel to chat...'
  chatMessageInput.style.height = 'auto'

  copyRoomLinkBtn.style.display     = 'none'
  clearRoomBtn.style.display        = 'none'
  leaveRoomBtn.style.display        = 'none'
  messageCounterBadge.style.display = 'none'

  messageStreamFeed.innerHTML = ''
  messageStreamFeed.appendChild(emptyStatePlaceholder)
  emptyStatePlaceholder.style.display = 'block'

  seenSequences.clear()
  membersMap.clear()
  activeMembersList.innerHTML = `
    <div class="empty-members">
      <i class="fa-solid fa-users-slash"></i>
      <span>No active channel</span>
    </div>
  `
  memberCountBadge.textContent = '0'

  highlightChannelButton('')
  showToast('Disconnected from room.')
}

// Dispatch Message
const dispatchMessage = async () => {
  const text = chatMessageInput.value.trim()
  if (!activeRoom || !text) return

  const user = userHandleInput.value.trim() || 'Anonymous'
  chatMessageInput.value = ''
  chatMessageInput.style.height = 'auto'

  if (text.startsWith('/clear')) {
    await copr.clearRoomHistory(activeRoom)
    roomHistoryCache.delete(activeRoom)
    showToast('Sent clear signal.', 'fa-trash')
    return
  }

  // Chime ONLY on self-mention
  const { hasPingedSelf } = parseMessageText(text, user)
  if (hasPingedSelf) {
    playChime('mention')
  }

  // Optimistic Card
  const optimisticCard = renderMessageCard({
    author: user,
    body: text,
    timestamp: Date.now(),
    seq: null,
    isPending: true,
    silent: true
  })

  try {
    const result = await copr.sendMessage(activeRoom, `[${user}]: ${text}`)
    if (result && result.sequence) {
      seenSequences.add(result.sequence)
      optimisticCard.classList.remove('is-pending')
      const sequenceElement = optimisticCard.querySelector('.message-seq')
      if (sequenceElement) sequenceElement.textContent = `#${result.sequence}`

      const cached = roomHistoryCache.get(activeRoom) || []
      cached.push({
        author: user,
        body: text,
        timestamp: Date.now(),
        sequence: result.sequence,
        isValid: true
      })
      roomHistoryCache.set(activeRoom, cached)
    }
  } catch (sendError) {
    optimisticCard.style.borderColor = '#ef4444'
    const sequenceElement = optimisticCard.querySelector('.message-seq')
    if (sequenceElement) sequenceElement.textContent = 'Failed'
    showToast('Failed to post message', 'fa-triangle-exclamation')
  }
}

const highlightChannelButton = (room) => {
  document.querySelectorAll('.channel-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.room === room)
  })
}

const renderChannels = (rooms) => {
  discoveredRoomsContainer.innerHTML = ''
  if (!rooms || rooms.length === 0) {
    discoveredRoomsContainer.innerHTML = `
      <div class="empty-channels">
        <i class="fa-solid fa-folder-open"></i>
        <span>No public channels yet.<br>Click sync or create one.</span>
      </div>`
    return
  }

  rooms.forEach((channelName) => {
    const itemButton = document.createElement('div')
    itemButton.className = `channel-item ${channelName === activeRoom ? 'active' : ''}`
    itemButton.dataset.room = channelName
    itemButton.innerHTML = `<i class="fa-solid fa-hashtag"></i><span>${channelName}</span>`
    itemButton.addEventListener('click', () => joinChannel(channelName))
    discoveredRoomsContainer.appendChild(itemButton)
  })
}

const scanChannels = async () => {
  const icon = refreshDiscoveryBtn.querySelector('i')
  icon.classList.add('fa-spin')
  try {
    allDiscoveredChannels = await copr.discoverRooms()
    renderChannels(allDiscoveredChannels)
  } catch (discoveryError) {
    renderChannels([])
  } finally {
    icon.classList.remove('fa-spin')
  }
}

// Event Listeners
chatMessageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
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

userHandleInput.value = `copr${Math.floor(Math.random() * 899 + 100)}`
refreshProfileAvatar()

userHandleInput.addEventListener('input', () => {
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
  showToast(soundEnabled ? 'Bell alerts on (Loud verified)' : 'Bell alerts muted')
})

connectChannelBtn.addEventListener('click', async () => {
  const room = channelNameInput.value.trim()
  if (!room) return
  if (publicDiscoveryToggle.checked) {
    await copr.registerRoom(room)
  }
  joinChannel(room)
  channelNameInput.value = ''
})

channelNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') connectChannelBtn.click()
})

sendMessageBtn.addEventListener('click', dispatchMessage)

clearRoomBtn.addEventListener('click', async () => {
  if (confirm(`Wipe chat history for #${activeRoom}?`)) {
    await copr.clearRoomHistory(activeRoom)
    roomHistoryCache.delete(activeRoom)
  }
})

copyRoomLinkBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(activeRoom)
  showToast(`Copied #${activeRoom} to clipboard`, 'fa-clipboard')
})

leaveRoomBtn.addEventListener('click', leaveChannel)
refreshDiscoveryBtn.addEventListener('click', scanChannels)

searchChannelsInput.addEventListener('input', (event) => {
  const query = event.target.value
  renderChannels(allDiscoveredChannels.filter((room) => room.includes(query)))
})

// Boot scan
scanChannels()