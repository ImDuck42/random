/**
 * countProtocol.js (CoPr -- pronounced "Copper")
 * CoPr messaging utility running on https://countapi.mileshilliard.com
 */
// WEIIRD behaviour when one deletes a channel - commands do not affect each eg o n use /clear 1 ther other ones msg stays
// - Both need releads to fix themselves


export const CoPrProtocol_Version = 'maybe 1.5 idk'

// ========== DEFAULT CONFIGURATION ==========
const DEFAULT_CONFIG = {
  apiBase:      'https://countapi.mileshilliard.com/api/v1',
  discoveryKey: 'copr_registry',
  seedValue:    0x436f5072, // Needs manual editing, not in teh constructor
  apiPollRate:  250,        // 4 per second || https://github.com/syntaxerror019/countapi/blob/main/api/index.py#L151
  fetchRange:   25
}

// ========== Mulberry32 SCRAMBLER ==========
const scrambleBytes = (bytes) => {
  let seed = DEFAULT_CONFIG.seedValue
  const result = new Uint8Array(bytes.length)
  
  for (let index = 0; index < bytes.length; index++) {
    seed          = (seed + 0x6d2b79f5) | 0
    let temporary = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    temporary     = (temporary     + Math.imul(temporary ^ (temporary >>> 7), 61 | temporary)) ^ temporary
    const mask    = (temporary     ^ (temporary >>> 14)) & 0xff
    result[index] = bytes[index]   ^ mask
  }
  return result
}

// ========== NUMERIC <--> BYTES CONVERSION ==========
export const bytesToNumeric = (input) => {
  if (!input || input.length === 0) return '0'
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let packed  = 1n
  for (let index = 0; index < bytes.length; index++) {
    packed = (packed << 8n) | BigInt(bytes[index])
  }
  return packed.toString(10)
}

export const numericToBytes = (numericPayload) => {
  if (!numericPayload || numericPayload === '0') return new Uint8Array(0)
  try {
    let packed = BigInt(numericPayload)
    const byteBuffer = []
    while (packed > 1n) {
      byteBuffer.push(Number(packed & 0xffn))
      packed >>= 8n
    }
    return new Uint8Array(byteBuffer.reverse())
  } catch {
    return new Uint8Array(0)
  }
}

// ========== COMPRESSION <--> DECOMPRESSION ==========
export const compressMessage = async (rawInputText) => {
  if (!rawInputText) return '0'
  const textStream  = new Blob([String(rawInputText)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const streamBytes = new Uint8Array(await new Response(textStream).arrayBuffer())
  return bytesToNumeric(scrambleBytes(streamBytes))
}

export const decompressMessage = async (numericPayload) => {
  const bytes = numericToBytes(numericPayload)
  if (bytes.length === 0) return ''
  try {
    const byteStream = new Blob([scrambleBytes(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return await new Response(byteStream).text()
  } catch {
    return ''
  }
}

// ========== CoPrProtocol CLASS ==========
export class CoPrProtocol {
  constructor(protocolOptions = {}) {
    this.config          = { ...DEFAULT_CONFIG, ...protocolOptions }
    this.activeListeners = new Map()
    this.nextRequestTime = 0
  }

  // ===== UTILITIES =====
  async dispatchApiRequest(actionEndpoint, queryParams = '') {
    const now            = Date.now()
    const scheduledTime  = Math.max(now, this.nextRequestTime)
    this.nextRequestTime = scheduledTime + 110
    if (scheduledTime > now) await new Promise((resolve) => setTimeout(resolve, scheduledTime - now))

    try {
      const fullEndpointUrl = `${this.config.apiBase}/${actionEndpoint}${queryParams}`
      const fetchResponse   = await fetch(fullEndpointUrl, { cache: 'no-store' })
      if (!fetchResponse.ok) return null
      return await fetchResponse.text()
    } catch {
      return null
    }
  }

  extractRegexValue(responseText) {
    if (!responseText) return null
    const regexMatch = responseText.match(/"value"\s*:\s*"?([0-9]+)"?/)
    return regexMatch ? regexMatch[1] : null
  }

  // ===== KEY RESOLVERS =====
  resolveChannelIndexKey(targetChannel) {
    return bytesToNumeric(`copr_channel_${targetChannel}`)
  }

  resolveMessageKey(targetChannel, sequenceIndex) {
    return bytesToNumeric(`copr_message_${targetChannel}_${sequenceIndex}`)
  }

  resolveDiscoveryKey() {
    return bytesToNumeric(this.config.discoveryKey)
  }

  resolveDiscoverySlotKey(slotIndex) {
    return bytesToNumeric(`copr_registry_${slotIndex}`)
  }

  resolveDiscoverySlotPointerKey(targetChannel) {
    return bytesToNumeric(`copr_registry_pointer_${targetChannel}`)
  }

  // ===== COUNTER OPERATIONS =====
  async hitCounter(targetKeyName) {
    const responseText = await this.dispatchApiRequest(`hit/${targetKeyName}`)
    const extractedVal = this.extractRegexValue(responseText)
    return extractedVal ? parseInt(extractedVal, 10) : null
  }

  async fetchRawCounter(targetKeyName) {
    const responseText = await this.dispatchApiRequest(`get/${targetKeyName}`)
    return this.extractRegexValue(responseText)
  }

  async setRawCounter(targetKeyName, targetNumericString) {
    const cleanValue   = String(targetNumericString).trim() || '0'
    const responseText = await this.dispatchApiRequest(`set/${targetKeyName}`, `?value=${cleanValue}`)
    return responseText !== null
  }

  // ===== MESSAGING LOGIC =====
  async sendMessage(targetChannel, messagePayload) {
    const encodedPayload   = await compressMessage(messagePayload)
    const channelIndexKey  = this.resolveChannelIndexKey(targetChannel)
    const assignedSequence = await this.hitCounter(channelIndexKey)
    
    if (assignedSequence === null || assignedSequence <= 0) {
      throw new Error('Failed to acquire sequence index from counter API')
    }

    const messageKey = this.resolveMessageKey(targetChannel, assignedSequence)
    const wasSuccess = await this.setRawCounter(messageKey, encodedPayload)
    
    if (!wasSuccess) {
      throw new Error(`Failed to store message at sequence ${assignedSequence}`)
    }

    return { sequence: assignedSequence, payload: messagePayload }
  }

  async fetchChannelHistory(targetChannel, fromSequence = null, toSequence = null, limit = null) {
    const channelIndexKey   = this.resolveChannelIndexKey(targetChannel)
    const rawLatestSequence = await this.fetchRawCounter(channelIndexKey)
    if (rawLatestSequence === null) return []

    const latestSequence = toSequence !== null ? toSequence : (parseInt(rawLatestSequence, 10) || 0)
    if (latestSequence <= 0) return []

    const targetCount = limit || this.config.fetchRange
    const minSequence = fromSequence !== null ? Math.max(1, fromSequence) : 1
    const collected   = []
    let   currentEnd  = latestSequence

    while (currentEnd >= minSequence && collected.length < targetCount) {
      const needed        = targetCount - collected.length
      const currentStart  = Math.max(minSequence, currentEnd - needed + 1)
      const fetchPromises = []

      for (let seq = currentStart; seq <= currentEnd; seq++) {
        const messageKey = this.resolveMessageKey(targetChannel, seq)
        fetchPromises.push(
          this.fetchRawCounter(messageKey).then((rawFrame) => ({ sequence: seq, rawFrame }))
        )
      }

      const batch = await Promise.all(fetchPromises)
      const valid = (await Promise.all(
        batch
          .filter((item) => item.rawFrame)
          .map(async ({ sequence, rawFrame }) => {
            const payloadText = await decompressMessage(rawFrame)
            return payloadText ? {
              channel:   targetChannel,
              sequence:  sequence,
              payload:   payloadText,
              timestamp: Date.now()
            } : null
          })
      )).filter(Boolean)

      collected.unshift(...valid)
      currentEnd = currentStart - 1
    }

    return collected.slice(-targetCount)
  }

  listenToChannel(targetChannel, onMessageCallback, customPollDelay = null) {
    const channelIndexKey = this.resolveChannelIndexKey(targetChannel)
    const delayDuration   = customPollDelay || this.config.apiPollRate
    let   localSequence   = null
    let   isPolling       = false

    const intervalHandle = setInterval(async () => {
      if (isPolling) return
      isPolling = true

      try {
        const rawCurrentSequence = await this.fetchRawCounter(channelIndexKey)

        if (rawCurrentSequence === null) {
          if (localSequence === null) await this.setRawCounter(channelIndexKey, '0')
          return
        }

        const currentSequence = parseInt(rawCurrentSequence, 10) || 0
        if (localSequence === null) {
          localSequence = currentSequence
          return
        }

        if (currentSequence < localSequence) {
          localSequence = currentSequence
          onMessageCallback({ isResetState: true })
          return
        }

        if (currentSequence > localSequence) {
          const startSequence = localSequence + 1
          const endSequence   = currentSequence
          const fetchPromises = []

          for (let currentSeq = startSequence; currentSeq <= endSequence; currentSeq++) {
            const messageKey = this.resolveMessageKey(targetChannel, currentSeq)
            fetchPromises.push(
              this.fetchRawCounter(messageKey).then((rawFrame) => ({ sequence: currentSeq, rawFrame }))
            )
          }

          const fetchedResults = await Promise.all(fetchPromises)
          fetchedResults.sort((itemA, itemB) => itemA.sequence - itemB.sequence)

          for (const { sequence, rawFrame } of fetchedResults) {
            if (!rawFrame) break

            const payloadText = await decompressMessage(rawFrame)
            if (payloadText) {
              onMessageCallback({
                isResetState: false,
                channel:      targetChannel,
                sequence:     sequence,
                payload:      payloadText,
                timestamp:    Date.now()
              })
            }
            localSequence = sequence
          }
        }
      } finally {
        isPolling = false
      }
    }, delayDuration)

    this.activeListeners.set(targetChannel, intervalHandle)
    return () => {
      clearInterval(intervalHandle)
      this.activeListeners.delete(targetChannel)
    }
  }

  async clearChannelHistory(targetChannel) {
    const channelIndexKey = this.resolveChannelIndexKey(targetChannel)
    return await this.setRawCounter(channelIndexKey, '0')
  }

  // ===== DISCOVERY LOGIC =====
  async registerChannel(targetChannel) {
    const discoveryKey = this.resolveDiscoveryKey()
    const slotIndex    = await this.hitCounter(discoveryKey)
    if (!slotIndex) return false
    
    const slotKey = this.resolveDiscoverySlotKey(slotIndex)
    const ptrKey  = this.resolveDiscoverySlotPointerKey(targetChannel)

    const isSlotStored = await this.setRawCounter(slotKey, bytesToNumeric(targetChannel))
    if (isSlotStored) {
      await this.setRawCounter(ptrKey, String(slotIndex))
    }
    return isSlotStored
  }

  async unregisterChannel(targetChannel) {
    const ptrKey    = this.resolveDiscoverySlotPointerKey(targetChannel)
    const rawSlot   = await this.fetchRawCounter(ptrKey)
    const slotIndex = parseInt(rawSlot, 10) || 0
    if (slotIndex <= 0) return false

    const slotKey = this.resolveDiscoverySlotKey(slotIndex)
    await this.setRawCounter(slotKey, '0')
    await this.setRawCounter(ptrKey,  '0')
    return true
  }

  async discoverChannels(limit = null) {
    const discoveryKey = this.resolveDiscoveryKey()
    const rawTotal     = await this.fetchRawCounter(discoveryKey)

    if (rawTotal === null) {
      await this.setRawCounter(discoveryKey, '0')
      return []
    }

    const totalSlots = parseInt(rawTotal, 10)
    if (isNaN(totalSlots) || totalSlots <= 0) return []

    const targetCount   = limit || this.config.fetchRange
    const discoveredSet = new Set()
    let   currentEnd    = totalSlots

    while (currentEnd >= 1 && discoveredSet.size < targetCount) {
      const needed        = targetCount - discoveredSet.size
      const currentStart  = Math.max(1, currentEnd - needed + 1)
      const fetchPromises = []

      for (let slot = currentStart; slot <= currentEnd; slot++) {
        const slotKey = this.resolveDiscoverySlotKey(slot)
        fetchPromises.push(this.fetchRawCounter(slotKey))
      }

      const batch = await Promise.all(fetchPromises)
      for (let index = batch.length - 1; index >= 0; index--) {
        const rawFrame = batch[index]
        if (rawFrame && rawFrame !== '0') {
          const channelName = new TextDecoder('utf-8', { fatal: false }).decode(numericToBytes(rawFrame)).trim()
          if (channelName) discoveredSet.add(channelName)
        }
      }
      currentEnd = currentStart - 1
    }

    return Array.from(discoveredSet)
  }
}

// ========== EXPORT CoPrProtocol ==========
export default CoPrProtocol