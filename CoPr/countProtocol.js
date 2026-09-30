/**
 * countProtocol.js (CoPr -- pronounced "Copper")
 * CoPr messaging utility running on https://countapi.mileshilliard.com
 */

// GO ADD A MASSIVE DECOMPRESSOR FOR DATA!!!

// USE THIS FOR NOW
const originalConsoleError = console.error
console.error = (...errorArguments) => {
  if (errorArguments.some((errorItem) => String(errorItem?.message || errorItem).includes('/get/'))) return
  originalConsoleError.apply(console, errorArguments)
}

const DEFAULT_CONFIG = {
  apiBaseEndpoint:   'https://countapi.mileshilliard.com/api/v1',
  discoveryKeyLabel: 'copr_discovery_registry',
  frameStartMarker:  '999001',
  frameEndMarker:    '999002',
  defaultPollDelay:  250,
  lengthDigitsWidth: 6,
  hashDigitsWidth:   6
}

export const stringToNumeric = (rawInputText) => {
  const textEncoder = new TextEncoder()
  const byteStream  = textEncoder.encode(String(rawInputText))
  let numericOutput = ''
  
  for (let byteIndex = 0; byteIndex < byteStream.length; byteIndex++) {
    numericOutput += String(byteStream[byteIndex]).padStart(3, '0')
  }
  return numericOutput
}

export const numericToString = (pureNumericText) => {
  const cleanNumericText = String(pureNumericText).trim()
  const totalBytesLength = Math.floor(cleanNumericText.length / 3)
  const byteBufferArray  = new Uint8Array(totalBytesLength)
  
  for (let byteIndex = 0; byteIndex < totalBytesLength; byteIndex++) {
    const byteOffset           = byteIndex * 3
    const parsedByteValue      = parseInt(cleanNumericText.substring(byteOffset, byteOffset + 3), 10)
    byteBufferArray[byteIndex] = isNaN(parsedByteValue) ? 63 : (parsedByteValue % 256)
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(byteBufferArray)
}

export const computeNumericChecksum = (numericPayloadText, hashWidth = 6) => {
  let computedHash = 5381
  for (let charIndex = 0; charIndex < numericPayloadText.length; charIndex++) {
    computedHash = ((computedHash * 33) ^ numericPayloadText.charCodeAt(charIndex)) >>> 0
  }
  return String(computedHash % 1000000).padStart(hashWidth, '0')
}

export const encodeProtocolFrame = (rawMessagePayload, config = DEFAULT_CONFIG) => {
  const numericPayloadText   = stringToNumeric(rawMessagePayload)
  const payloadDigitsLength  = String(numericPayloadText.length).padStart(config.lengthDigitsWidth, '0')
  const validationHashDigits = computeNumericChecksum(numericPayloadText, config.hashDigitsWidth)
  
  return (
    config.frameStartMarker +
    payloadDigitsLength     +
    numericPayloadText      +
    validationHashDigits    +
    config.frameEndMarker
  )
}

export const decodeProtocolFrame = (rawNumericFrame, config = DEFAULT_CONFIG) => {
  if (!rawNumericFrame || !rawNumericFrame.startsWith(config.frameStartMarker)) return null
  try {
    const lengthStart   = config.frameStartMarker.length
    const lengthEnd     = lengthStart + config.lengthDigitsWidth
    const payloadLength = parseInt(rawNumericFrame.substring(lengthStart, lengthEnd), 10)

    const payloadStart = lengthEnd
    const payloadEnd   = payloadStart + payloadLength
    const hashStart    = payloadEnd
    const hashEnd      = hashStart    + config.hashDigitsWidth
    const markerEnd    = hashEnd      + config.frameEndMarker.length

    if (rawNumericFrame.substring(hashEnd, markerEnd) !== config.frameEndMarker) return null

    const payloadDigits = rawNumericFrame.substring(payloadStart, payloadEnd)
    const expectedHash  = rawNumericFrame.substring(hashStart,    hashEnd)
    const hashIsValid   = (expectedHash === computeNumericChecksum(payloadDigits, config.hashDigitsWidth))

    return {
      payloadText: numericToString(payloadDigits),
      isValid:     hashIsValid,
      isCorrupted: !hashIsValid
    }
  } catch {
    return null
  }
}

export class CoPrProtocol {
  constructor(protocolOptions = {}) {
    this.config          = { ...DEFAULT_CONFIG, ...protocolOptions }
    this.activeListeners = new Map()
  }

  // ===== UTILITIES =====
  async dispatchApiRequest(actionEndpoint, queryParams = '') {
    try {
      const fullEndpointUrl = `${this.config.apiBaseEndpoint}/${actionEndpoint}${queryParams}`
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
    return stringToNumeric(`copr_idx_${targetChannel}`)
  }

  resolveMessageKey(targetChannel, sequenceIndex) {
    return stringToNumeric(`copr_msg_${targetChannel}_${sequenceIndex}`)
  }

  resolveDiscoveryKey() {
    return stringToNumeric(this.config.discoveryKeyLabel)
  }

  resolveDiscoverySlotKey(slotIndex) {
    return stringToNumeric(`copr_disco_slot_${slotIndex}`)
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
    const encodedFrameData = encodeProtocolFrame(messagePayload, this.config)
    const channelIndexKey  = this.resolveChannelIndexKey(targetChannel)
    const assignedSequence = await this.hitCounter(channelIndexKey)
    
    if (assignedSequence === null || assignedSequence <= 0) {
      throw new Error('Failed to acquire sequence index from counter API.')
    }

    const messageKey = this.resolveMessageKey(targetChannel, assignedSequence)
    const wasSuccess = await this.setRawCounter(messageKey, encodedFrameData)
    
    if (!wasSuccess) {
      throw new Error(`Failed to store message at sequence ${assignedSequence}`)
    }

    return { sequence: assignedSequence, frame: encodedFrameData }
  }

  async fetchChannelHistory(targetChannel, fromSequence = null, toSequence = null) {
    const channelIndexKey   = this.resolveChannelIndexKey(targetChannel)
    const rawLatestSequence = await this.fetchRawCounter(channelIndexKey)
    if (rawLatestSequence === null) return []

    const latestSequence = toSequence !== null ? toSequence : (parseInt(rawLatestSequence, 10) || 0)
    if (latestSequence <= 0) return []

    const startSequence = fromSequence !== null ? Math.max(1, fromSequence) : Math.max(1, latestSequence - 35)
    if (startSequence > latestSequence) return []

    const fetchPromises = []
    
    for (let currentSequence = startSequence; currentSequence <= latestSequence; currentSequence++) {
      const messageKey = this.resolveMessageKey(targetChannel, currentSequence)
      fetchPromises.push(
        this.fetchRawCounter(messageKey).then((rawFrame) => ({ sequence: currentSequence, rawFrame }))
      )
    }

    const fetchedResults = await Promise.all(fetchPromises)
    
    return fetchedResults
      .sort((itemA, itemB) => itemA.sequence - itemB.sequence)
      .map(({ sequence, rawFrame }) => {
        if (!rawFrame) return null
        const decodedFrame = decodeProtocolFrame(rawFrame, this.config)
        if (!decodedFrame) return null
        
        return {
          channel:     targetChannel,
          sequence:    sequence,
          payload:     decodedFrame.payloadText,
          isValid:     decodedFrame.isValid,
          isCorrupted: decodedFrame.isCorrupted,
          timestamp:   Date.now()
        }
      })
      .filter(Boolean)
  }

  listenToChannel(targetChannel, onMessageCallback, customPollDelay = null) {
    const channelIndexKey = this.resolveChannelIndexKey(targetChannel)
    const delayDuration   = customPollDelay || this.config.defaultPollDelay
    let   localSequence   = null

    const intervalHandle = setInterval(async () => {
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
          if (rawFrame) {
            const decodedFrame = decodeProtocolFrame(rawFrame, this.config)
            if (decodedFrame) {
              onMessageCallback({
                isResetState: false,
                channel:      targetChannel,
                sequence:     sequence,
                payload:      decodedFrame.payloadText,
                isValid:      decodedFrame.isValid,
                isCorrupted:  decodedFrame.isCorrupted,
                timestamp:    Date.now()
              })
            }
          }
          localSequence = sequence
        }
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
    return await this.setRawCounter(slotKey, encodeProtocolFrame(targetChannel, this.config))
  }

  async unregisterChannel(targetChannel) {
    const discoveryKey = this.resolveDiscoveryKey()
    const rawTotal     = await this.fetchRawCounter(discoveryKey)
    const totalSlots   = parseInt(rawTotal, 10) || 0
    if (totalSlots <= 0) return true

    const fetchPromises = []
    
    for (let currentSlot = 1; currentSlot <= totalSlots; currentSlot++) {
      const slotKey = this.resolveDiscoverySlotKey(currentSlot)
      fetchPromises.push(
        this.fetchRawCounter(slotKey).then((rawFrame) => ({ slotKey, rawFrame }))
      )
    }

    const fetchedResults = await Promise.all(fetchPromises)
    const wipePromises   = []

    fetchedResults.forEach(({ slotKey, rawFrame }) => {
      if (rawFrame) {
        const decodedFrame = decodeProtocolFrame(rawFrame, this.config)
        if (decodedFrame?.payloadText?.trim() === targetChannel.trim()) {
          wipePromises.push(this.setRawCounter(slotKey, '0'))
        }
      }
    })

    if (wipePromises.length > 0) {
      await Promise.all(wipePromises)
      return true
    }
    return false
  }

  async discoverChannels() {
    const discoveryKey = this.resolveDiscoveryKey()
    const rawTotal     = await this.fetchRawCounter(discoveryKey)

    if (rawTotal === null) {
      await this.setRawCounter(discoveryKey, '0')
      return []
    }

    const totalSlots = parseInt(rawTotal, 10)
    if (isNaN(totalSlots) || totalSlots <= 0) return []

    const startSlot     = Math.max(1, totalSlots - 25)
    const fetchPromises = []
    
    for (let currentSlot = startSlot; currentSlot <= totalSlots; currentSlot++) {
      const slotKey = this.resolveDiscoverySlotKey(currentSlot)
      fetchPromises.push(this.fetchRawCounter(slotKey))
    }

    const fetchedResults = await Promise.all(fetchPromises)
    const discoveredList = []

    fetchedResults.forEach((rawFrame) => {
      if (rawFrame) {
        const decodedFrame = decodeProtocolFrame(rawFrame, this.config)
        if (decodedFrame && decodedFrame.isValid && decodedFrame.payloadText.trim()) {
          discoveredList.push(decodedFrame.payloadText.trim())
        }
      }
    })

    return Array.from(new Set(discoveredList))
  }
}

export default CoPrProtocol