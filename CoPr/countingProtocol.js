/**
 * countingProtocol.js (CoPr - pronounced "Copper")
 * Decentralized messaging over CountAPI numeric counters.
 */

// Filter out 404s caused by checking non-existent counters
const _origConsoleError = console.error;
console.error = (...args) => {
  if (args.some(a => String(a?.message || a).includes('/get/'))) return;
  _origConsoleError.apply(console, args);
};

const API_BASE_ENDPOINT   = 'https://countapi.mileshilliard.com/api/v1';
const DISCOVERY_KEY_LABEL = 'copr_discovery_registry';

const FRAME_START_MARKER  = '999001';
const FRAME_END_MARKER    = '999002';
const LENGTH_DIGITS_WIDTH = 6;
const HASH_DIGITS_WIDTH   = 6;
const DEFAULT_POLL_MS     = 250;

export const stringToNumeric = (rawInputText) => {
  const textEncoder = new TextEncoder();
  const byteStream  = textEncoder.encode(String(rawInputText));
  let numericOutput = '';
  for (let byteIndex = 0; byteIndex < byteStream.length; byteIndex++) {
    numericOutput += String(byteStream[byteIndex]).padStart(3, '0');
  }
  return numericOutput;
};

export const numericToString = (pureNumericText) => {
  const cleanNumericString = String(pureNumericText).trim();
  const totalBytesLength   = Math.floor(cleanNumericString.length / 3);
  const byteBufferArray    = new Uint8Array(totalBytesLength);
  for (let byteIndex = 0; byteIndex < totalBytesLength; byteIndex++) {
    const byteOffset      = byteIndex * 3;
    const parsedByteValue = parseInt(cleanNumericString.substring(byteOffset, byteOffset + 3), 10);
    byteBufferArray[byteIndex] = isNaN(parsedByteValue) ? 63 : (parsedByteValue % 256);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(byteBufferArray);
};

export const computeNumericChecksum = (numericPayloadText) => {
  let computedHash = 5381;
  for (let i = 0; i < numericPayloadText.length; i++) {
    computedHash = ((computedHash * 33) ^ numericPayloadText.charCodeAt(i)) >>> 0;
  }
  return String(computedHash % 1000000).padStart(HASH_DIGITS_WIDTH, '0');
};

export const encodeProtocolFrame = (rawMessagePayload) => {
  const numericPayloadString = stringToNumeric(rawMessagePayload);
  const payloadDigitsLength  = String(numericPayloadString.length).padStart(LENGTH_DIGITS_WIDTH, '0');
  const validationHashDigits = computeNumericChecksum(numericPayloadString);
  return (
    FRAME_START_MARKER   +
    payloadDigitsLength  +
    numericPayloadString +
    validationHashDigits +
    FRAME_END_MARKER
  );
};

export const decodeProtocolFrame = (rawNumericFrame) => {
  if (!rawNumericFrame || !rawNumericFrame.startsWith(FRAME_START_MARKER)) return null;
  try {
    const lenStart = FRAME_START_MARKER.length;
    const lenEnd   = lenStart + LENGTH_DIGITS_WIDTH;
    const payloadLength = parseInt(rawNumericFrame.substring(lenStart, lenEnd), 10);

    const payloadStart = lenEnd;
    const payloadEnd   = payloadStart + payloadLength;
    const hashStart    = payloadEnd;
    const hashEnd      = hashStart + HASH_DIGITS_WIDTH;
    const markerEnd    = hashEnd + FRAME_END_MARKER.length;

    if (rawNumericFrame.substring(hashEnd, markerEnd) !== FRAME_END_MARKER) return null;

    const payloadDigits   = rawNumericFrame.substring(payloadStart, payloadEnd);
    const expectedHash    = rawNumericFrame.substring(hashStart, hashEnd);
    const isValid         = (expectedHash === computeNumericChecksum(payloadDigits));

    return {
      payloadText:   numericToString(payloadDigits),
      isValid:       isValid,
      isCorrupted:   !isValid
    };
  } catch {
    return null;
  }
};

export class CoPrProtocol {
  constructor(protocolOptions = {}) {
    this.baseApiEndpoint = protocolOptions.baseApiEndpoint || API_BASE_ENDPOINT;
    this.pollIntervalMs  = protocolOptions.pollIntervalMs  || DEFAULT_POLL_MS;
    this.activeListeners = new Map();
  }

  resolveRoomIndexKey(roomNameText) {
    return stringToNumeric(`copr_idx_${roomNameText}`);
  }

  resolveMessageKey(roomNameText, sequenceIndex) {
    return stringToNumeric(`copr_msg_${roomNameText}_${sequenceIndex}`);
  }

  resolveDiscoveryKey() {
    return stringToNumeric(DISCOVERY_KEY_LABEL);
  }

  resolveDiscoverySlotKey(slot) {
    return stringToNumeric(`copr_disco_slot_${slot}`);
  }

  async hitCounter(targetKeyName) {
    try {
      const response = await fetch(`${this.baseApiEndpoint}/hit/${targetKeyName}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const text = await response.text();
      const match = text.match(/"value"\s*:\s*"?([0-9]+)"?/);
      return match ? parseInt(match[1], 10) : null;
    } catch {
      return null;
    }
  }

  async fetchRawCounter(targetKeyName) {
    try {
      const response = await fetch(`${this.baseApiEndpoint}/get/${targetKeyName}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const text = await response.text();
      const match = text.match(/"value"\s*:\s*"?([0-9]+)"?/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  async setRawCounter(targetKeyName, targetNumericString) {
    try {
      const cleanValue = String(targetNumericString).trim() || '0';
      const response   = await fetch(`${this.baseApiEndpoint}/set/${targetKeyName}?value=${cleanValue}`, { cache: 'no-store' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async sendMessage(targetRoomName, messagePayload) {
    const encodedFrameData = encodeProtocolFrame(messagePayload);
    const indexKey         = this.resolveRoomIndexKey(targetRoomName);

    const assignedSeq = await this.hitCounter(indexKey);
    if (assignedSeq === null || assignedSeq <= 0) {
      throw new Error('Failed to acquire sequence index from counter API.');
    }

    const messageKey = this.resolveMessageKey(targetRoomName, assignedSeq);
    const success    = await this.setRawCounter(messageKey, encodedFrameData);
    if (!success) {
      throw new Error(`Failed to store message at sequence ${assignedSeq}`);
    }

    return { sequence: assignedSeq, frame: encodedFrameData };
  }

  // Delta-capable history fetcher
  async fetchRoomHistory(targetRoomName, fromSeq = null, toSeq = null) {
    const indexKey = this.resolveRoomIndexKey(targetRoomName);
    const rawLatestSeq = await this.fetchRawCounter(indexKey);
    if (rawLatestSeq === null) return [];

    const latestSeq = toSeq !== null ? toSeq : (parseInt(rawLatestSeq, 10) || 0);
    if (latestSeq <= 0) return [];

    const startSeq = fromSeq !== null ? Math.max(1, fromSeq) : Math.max(1, latestSeq - 35);
    if (startSeq > latestSeq) return [];

    const historyItems = [];
    for (let seq = startSeq; seq <= latestSeq; seq++) {
      const msgKey = this.resolveMessageKey(targetRoomName, seq);
      const rawFrame = await this.fetchRawCounter(msgKey);
      if (rawFrame) {
        const frame = decodeProtocolFrame(rawFrame);
        if (frame) {
          historyItems.push({
            room: targetRoomName,
            sequence: seq,
            payload: frame.payloadText,
            isValid: frame.isValid,
            isCorrupted: frame.isCorrupted,
            timestamp: Date.now()
          });
        }
      }
    }
    return historyItems;
  }

  listenToRoom(targetRoomName, onMessageCallback, customPollMs = null) {
    const indexKey   = this.resolveRoomIndexKey(targetRoomName);
    const pollDelay  = customPollMs || this.pollIntervalMs;
    let localSeq     = null;

    const intervalHandle = setInterval(async () => {
      const rawCurrentSeq = await this.fetchRawCounter(indexKey);

      // Do NOT set localSeq to 0 on network drop
      if (rawCurrentSeq === null) {
        if (localSeq === null) {
          await this.setRawCounter(indexKey, '0');
        }
        return;
      }

      const currentSeq = parseInt(rawCurrentSeq, 10) || 0;

      // Lock localSeq to real server sequence before listening
      if (localSeq === null) {
        localSeq = currentSeq;
        return;
      }

      if (currentSeq < localSeq) {
        localSeq = currentSeq;
        onMessageCallback({ isResetState: true });
        return;
      }

      if (currentSeq > localSeq) {
        const start = localSeq + 1;
        const end   = currentSeq;

        for (let seq = start; seq <= end; seq++) {
          const msgKey   = this.resolveMessageKey(targetRoomName, seq);
          const rawFrame = await this.fetchRawCounter(msgKey);

          if (rawFrame) {
            const frame = decodeProtocolFrame(rawFrame);
            if (frame) {
              onMessageCallback({
                isResetState: false,
                room:         targetRoomName,
                sequence:     seq,
                payload:      frame.payloadText,
                isValid:      frame.isValid,
                isCorrupted:  frame.isCorrupted,
                timestamp:    Date.now()
              });
            }
          }
          localSeq = seq;
        }
      }
    }, pollDelay);

    this.activeListeners.set(targetRoomName, intervalHandle);
    return () => {
      clearInterval(intervalHandle);
      this.activeListeners.delete(targetRoomName);
    };
  }

  async clearRoomHistory(targetRoomName) {
    const indexKey = this.resolveRoomIndexKey(targetRoomName);
    return await this.setRawCounter(indexKey, '0');
  }

  async registerRoom(targetRoomName) {
    const discoIndexKey = this.resolveDiscoveryKey();
    const slot = await this.hitCounter(discoIndexKey);
    if (!slot) return false;
    const slotKey = this.resolveDiscoverySlotKey(slot);
    return await this.setRawCounter(slotKey, encodeProtocolFrame(targetRoomName));
  }

  async discoverRooms() {
    const discoIndexKey = this.resolveDiscoveryKey();
    const rawTotal = await this.fetchRawCounter(discoIndexKey);

    if (rawTotal === null) {
      await this.setRawCounter(discoIndexKey, '0');
      return [];
    }

    const total = parseInt(rawTotal, 10);
    if (isNaN(total) || total <= 0) return [];

    const discovered = [];
    const start = Math.max(1, total - 25);
    for (let slot = start; slot <= total; slot++) {
      const slotKey = this.resolveDiscoverySlotKey(slot);
      const raw = await this.fetchRawCounter(slotKey);
      if (raw) {
        const frame = decodeProtocolFrame(raw);
        if (frame && frame.isValid && frame.payloadText.trim()) {
          discovered.push(frame.payloadText.trim());
        }
      }
    }
    return Array.from(new Set(discovered));
  }
}

export default CoPrProtocol;