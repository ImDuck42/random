/**
 * countProtocol.js (CoPr -- pronounced "Copper")
 * CoPr messaging utility running on https://countapi.mileshilliard.com
 * /
 * QUICK START:
 *  import { CoPrProtocol, CoPrProtocol_Version } from './countProtocol.js'
 *
 *  const copr = new CoPrProtocol({
 *    clientName:       'my-app-name', // Namespace key to avoid collisions
 *    seedValue:        0x436f5072,    // Optional 32-bit obfuscation seed
 *    overwriteContent: false          // Refuse to overwrite non-CoPr keys
 *  })
 *
 *  // Listen for incoming messages (returns unsubscribe callback)
 *  const stop = copr.listenToChannel('general', ({ sequence, payload, isValid }) => {
 *    console.log(`[#${sequence}] ${payload}`)
 *  })
 *
 *  // Send a message
 *  await copr.sendMessage('general', 'Hello world!')
 *
 * PROTOCOL METHODS:
 *  - copr.sendMessage(channel, text)
 *  - copr.listenToChannel(channel, callback, pollDelay?)
 *  - copr.fetchChannelHistory(channel, fromSeq?, toSeq?, limit?)
 *  - copr.getChannelSequence(channel)
 *  - copr.deleteMessages(channel, sequence | [sequence, ...])
 *  - copr.clearChannelHistory(channel)
 *  - copr.destroyChannel(channel)
 *  - copr.registerChannel(channel)
 *  - copr.discoverChannels(limit?)
 *  - copr.unregisterChannel(channel)
 */
export const CoPrProtocol_Version = 'maybe 1.7, idk'

// ========== DEFAULT CONFIGURATION ==========
const DEFAULT_CONFIG = {
  apiBase:          'https://countapi.mileshilliard.com/api/v1',
  clientName:       'CoPr-Chat', // The default is 'CoPr-Chat', same named clients WILL merge
  seedValue:        0x436f5072,  // The default is 'CoPr' in hex
  overwriteContent: false,       // Refuse to overwrite keys that lack the '420' CoPr prefix
  apiPollRate:      333,         // 3 per second, bigger than average RT || https://github.com/syntaxerror019/countapi/blob/main/api/index.py#L151 -> maximum 10req/s
  fetchRange:       25           // Default maximum messages to fetch in one request is 25
}

// ========== Mulberry32 SCRAMBLER ==========
const scrambleBytes = (bytes, seed = DEFAULT_CONFIG.seedValue) => {
  let currentSeed = seed
  const result    = new Uint8Array(bytes.length)
  
  for (let index = 0; index < bytes.length; index++) {
    currentSeed   = (currentSeed + 0x6d2b79f5) | 0
    let temporary = Math.imul(currentSeed ^ (currentSeed >>> 15), 1 | currentSeed)
    temporary     = (temporary            + Math.imul(temporary ^ (temporary >>> 7), 61 | temporary)) ^ temporary
    const mask    = (temporary            ^ (temporary >>> 14)) & 0xff
    result[index] = bytes[index]          ^ mask
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
    const rawString    = String(numericPayload).trim()
    const cleanPayload = rawString.startsWith('420') ? rawString.slice(3) : rawString
    let packed = BigInt(cleanPayload)
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
export const compressMessage = async (rawInputText, seed = DEFAULT_CONFIG.seedValue) => {
  if (!rawInputText) return '0'
  const textStream  = new Blob([String(rawInputText)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const streamBytes = new Uint8Array(await new Response(textStream).arrayBuffer())
  return '420' + bytesToNumeric(scrambleBytes(streamBytes, seed))
}

export const decompressMessage = async (numericPayload, seed = DEFAULT_CONFIG.seedValue) => {
  const bytes = numericToBytes(numericPayload)
  if (bytes.length === 0) return ''
  try {
    const byteStream = new Blob([scrambleBytes(bytes, seed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
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
  resolveKey(...keyParts) {
    return bytesToNumeric(['copr', this.config.clientName, ...keyParts].join('_'))
  }

  resolveChannelIndexKey(targetChannel) {
    return this.resolveKey('channel', targetChannel)
  }

  resolveMessageKey(targetChannel, sequenceIndex) {
    return this.resolveKey('message', targetChannel, sequenceIndex)
  }

  resolveDiscoveryKey() {
    return this.resolveKey('registry')
  }

  resolveDiscoverySlotKey(slotIndex) {
    return this.resolveKey('registry', slotIndex)
  }

  resolveDiscoverySlotPointerKey(targetChannel) {
    return this.resolveKey('registry_pointer', targetChannel)
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
    const cleanValue = String(targetNumericString).trim() || '0'

    if (!this.config.overwriteContent && cleanValue !== '0') {
      const existingValue = await this.fetchRawCounter(targetKeyName)
      if (existingValue !== null && existingValue !== '0') {
        if (!existingValue.startsWith('420')) {
          throw new Error(
            `Refusing to overwrite key "${targetKeyName}" as its content does not start with '420'.`
          )
        }
      }
    }

    const responseText = await this.dispatchApiRequest(`set/${targetKeyName}`, `?value=${cleanValue}`)
    return responseText !== null
  }

  async getChannelSequence(targetChannel) {
    const channelIndexKey = this.resolveChannelIndexKey(targetChannel)
    const rawSequence     = await this.fetchRawCounter(channelIndexKey)
    return parseInt(rawSequence, 10) || 0
  }

  // ===== INTERNAL HELPERS =====
  async decodeMessageFrame(targetChannel, sequenceIndex, rawFrame) {
    const payloadText = await decompressMessage(rawFrame, this.config.seedValue)
    const isValid     = Boolean(payloadText)
    return {
      channel:   targetChannel,
      sequence:  sequenceIndex,
      payload:   payloadText || `<<[Shits broken]>>\n${rawFrame}`,
      isValid:   isValid,
      timestamp: Date.now()
    }
  }

  async fetchKeyRange(startIndex, endIndex, keyResolver) {
    const fetchPromises = []
    for (let index = startIndex; index <= endIndex; index++) {
      const targetKey = keyResolver(index)
      fetchPromises.push(
        this.fetchRawCounter(targetKey).then((rawFrame) => ({ index, rawFrame }))
      )
    }
    return Promise.all(fetchPromises)
  }

  async paginateReverse(totalEndIndex, minIndex, targetLimit, keyResolver, batchProcessor) {
    let currentEnd = totalEndIndex

    while (currentEnd >= minIndex && !batchProcessor.isFull(targetLimit)) {
      const needed       = batchProcessor.remaining(targetLimit)
      const currentStart = Math.max(minIndex, currentEnd - needed + 1)
      const batch        = await this.fetchKeyRange(currentStart, currentEnd, keyResolver)

      await batchProcessor.process(batch)
      currentEnd = currentStart - 1
    }
  }

  // ===== MESSAGING LOGIC =====
  async sendMessage(targetChannel, messagePayload) {
    const encodedPayload   = await compressMessage(messagePayload, this.config.seedValue)
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

    await this.paginateReverse( latestSequence, minSequence, targetCount, (sequence) =>
      this.resolveMessageKey(targetChannel, sequence), {
        isFull:    (maximum)     => collected.length >= maximum,
        remaining: (maximum)     => maximum - collected.length,
        process:   async (batch) => {
          const valid = (await Promise.all(
            batch
              .filter((item)             => item.rawFrame && item.rawFrame !== '0')
              .map(({ index, rawFrame }) => this.decodeMessageFrame(targetChannel, index, rawFrame))
          )).filter(Boolean)

          collected.unshift(...valid)
        }
      }
    )

    return collected.slice(-targetCount)
  }

  listenToChannel(targetChannel, onMessageCallback, customPollDelay = null) {
    if (this.activeListeners.has(targetChannel)) {
      clearInterval(this.activeListeners.get(targetChannel))
    }

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
          const startSequence  = localSequence + 1
          const endSequence    = currentSequence
          const fetchedResults = await this.fetchKeyRange(
            startSequence, 
            endSequence, 
            (sequence) => this.resolveMessageKey(targetChannel, sequence)
          )
          
          fetchedResults.sort((itemA, itemB) => itemA.index - itemB.index)

          for (const { index, rawFrame } of fetchedResults) {
            if (!rawFrame) break
            if (rawFrame === '0') {
              localSequence = index
              continue
            }

            const messageData = await this.decodeMessageFrame(targetChannel, index, rawFrame)
            onMessageCallback({
              isResetState: false,
              ...messageData
            })
            localSequence = index
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

  async deleteMessages(targetChannel, sequenceList) {
    const sequences     = Array.isArray(sequenceList) ? sequenceList : [sequenceList]
    const fetchPromises = sequences.map((sequence) => {
      const messageKey = this.resolveMessageKey(targetChannel, sequence)
      return this.setRawCounter(messageKey, '0')
    })
    const results = await Promise.all(fetchPromises)
    return results.every(Boolean)
  }

  async clearChannelHistory(targetChannel) {
    const channelIndexKey = this.resolveChannelIndexKey(targetChannel)
    return await this.setRawCounter(channelIndexKey, '0')
  }

  async destroyChannel(targetChannel) {
    const maxSequence = await this.getChannelSequence(targetChannel)
    if (maxSequence > 0) {
      const allSequences = Array.from({ length: maxSequence }, (sadExistence, index) => index + 1)
      await this.deleteMessages(targetChannel, allSequences)
    }
    await this.clearChannelHistory(targetChannel)
    await this.unregisterChannel(targetChannel)
    return true
  }

  // ===== DISCOVERY LOGIC =====
  async registerChannel(targetChannel) {
    try {
      const discoveryKey = this.resolveDiscoveryKey()
      const slotIndex    = await this.hitCounter(discoveryKey)
      if (!slotIndex) return false
      
      const slotKey = this.resolveDiscoverySlotKey(slotIndex)
      const ptrKey  = this.resolveDiscoverySlotPointerKey(targetChannel)

      const encodedChannel = await compressMessage(targetChannel, this.config.seedValue)
      const isSlotStored   = await this.setRawCounter(slotKey, encodedChannel)
      if (isSlotStored) {
        await this.setRawCounter(ptrKey, `420${slotIndex}`)
      }
      return isSlotStored
    } catch {
      return false
    }
  }

  async unregisterChannel(targetChannel) {
    const ptrKey    = this.resolveDiscoverySlotPointerKey(targetChannel)
    const rawSlot   = await this.fetchRawCounter(ptrKey)
    const cleanSlot = rawSlot && rawSlot.startsWith('420') ? rawSlot.slice(3) : (rawSlot || '0')
    const slotIndex = parseInt(cleanSlot, 10) || 0
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
      return []
    }

    const totalSlots = parseInt(rawTotal, 10)
    if (isNaN(totalSlots) || totalSlots <= 0) return []

    const targetCount   = limit || this.config.fetchRange
    const discoveredSet = new Set()

    await this.paginateReverse(totalSlots, 1, targetCount, (slot) =>
      this.resolveDiscoverySlotKey(slot), {
        isFull:    (maximum)     => discoveredSet.size >= maximum,
        remaining: (maximum)     => maximum - discoveredSet.size,
        process:   async (batch) => {
          for (let index = batch.length - 1; index >= 0; index--) {
            const rawFrame = batch[index].rawFrame
            if (rawFrame && rawFrame !== '0') {
              const channelName = await decompressMessage(rawFrame, this.config.seedValue)
              if (channelName) discoveredSet.add(channelName)
            }
          }
        }
      }
    )

    return Array.from(discoveredSet)
  }
}

// ========== EXPORT CoPrProtocol ==========
export default CoPrProtocol