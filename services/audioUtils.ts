export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  // Ensure even byte length for 16-bit PCM
  if (data.byteLength % 2 !== 0) {
    data = data.slice(0, data.byteLength - 1);
  }

  const frameCount = data.byteLength / 2 / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  
  // Use DataView to ensure Little Endian reading regardless of platform architecture
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Calculate byte index: frameIndex * channels * bytesPerSample + channelOffset * bytesPerSample
      const byteIndex = (i * numChannels + channel) * 2;
      
      // Read 16-bit integer, little-endian = true
      const int16 = dataView.getInt16(byteIndex, true);
      
      // Normalize to [-1.0, 1.0]
      channelData[i] = int16 / 32768.0;
    }
  }
  return buffer;
}

// Helper to play a buffer
export function playBuffer(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return source;
}

// Convert AudioBuffer to WAV Blob
export function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // Helper to write strings
  function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // write WAVE header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + buffer.length * numOfChan * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, buffer.length * numOfChan * 2, true);

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  offset = 44;
  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // Clamp the sample to [-1, 1]
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      // Convert to 16-bit PCM
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([view], { type: 'audio/wav' });
}