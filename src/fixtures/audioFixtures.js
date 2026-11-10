/**
 * Synthetic Audio Fixtures & Generators
 * Generates 16kHz, 16-bit Linear PCM chunks (100ms = 1600 samples)
 * Supports dual-channel stereo tracks, echo bleed injection, and multi-speaker frequencies.
 */

const SAMPLE_RATE = 16000;
const CHUNK_MS = 100;
const SAMPLES_PER_CHUNK = (SAMPLE_RATE * CHUNK_MS) / 1000; // 1600 samples
const BYTES_PER_SAMPLE = 2; // 16-bit

/**
 * Generate a 16-bit PCM mono chunk for a given frequency and amplitude
 */
function generateToneChunk(freqHz, amplitude = 0.5, startSample = 0) {
  const buffer = Buffer.alloc(SAMPLES_PER_CHUNK * BYTES_PER_SAMPLE);
  for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
    const t = (startSample + i) / SAMPLE_RATE;
    const sampleVal = Math.sin(2 * Math.PI * freqHz * t) * amplitude;
    const int16 = Math.max(-32768, Math.min(32767, Math.floor(sampleVal * 32767)));
    buffer.writeInt16LE(int16, i * 2);
  }
  return buffer;
}

/**
 * Generate a silence chunk with low ambient dither/noise
 */
function generateSilenceChunk(noiseLevel = 0.005) {
  const buffer = Buffer.alloc(SAMPLES_PER_CHUNK * BYTES_PER_SAMPLE);
  for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
    const noise = (Math.random() * 2 - 1) * noiseLevel;
    const int16 = Math.floor(noise * 32767);
    buffer.writeInt16LE(int16, i * 2);
  }
  return buffer;
}

/**
 * Calculate RMS (Root Mean Square) energy of a 16-bit PCM buffer
 */
function calculateRMS(pcmBuffer) {
  const numSamples = pcmBuffer.length / 2;
  if (numSamples === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < numSamples; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2) / 32768.0;
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / numSamples);
}

/**
 * Calculate channel cross-bleed ratio between two channels
 */
function calculateCrossBleedRatio(activeChannelBuffer, targetChannelBuffer) {
  const rmsActive = calculateRMS(activeChannelBuffer);
  const rmsTarget = calculateRMS(targetChannelBuffer);
  if (rmsActive === 0) return 0;
  return rmsTarget / rmsActive;
}

/**
 * Creates dual synthetic stereo tracks for isolation testing
 * Channel 0 (Mic): active tone (e.g. 440 Hz) during user turn, silence during remote turn
 * Channel 1 (System): active tone (e.g. 880 Hz) during remote turn, silence during user turn
 */
function createDualSyntheticTracks(durationSeconds = 2) {
  const totalChunks = Math.floor((durationSeconds * 1000) / CHUNK_MS);
  const channel0Chunks = [];
  const channel1Chunks = [];

  for (let c = 0; c < totalChunks; c++) {
    const sampleOffset = c * SAMPLES_PER_CHUNK;
    if (c < totalChunks / 2) {
      // First half: Remote participant talks on Channel 1 (System audio)
      channel0Chunks.push(generateSilenceChunk(0.001)); // Mic silent (<0.1% noise)
      channel1Chunks.push(generateToneChunk(880, 0.7, sampleOffset)); // System active
    } else {
      // Second half: User talks on Channel 0 (Mic)
      channel0Chunks.push(generateToneChunk(440, 0.7, sampleOffset)); // Mic active
      channel1Chunks.push(generateSilenceChunk(0.001)); // System silent
    }
  }

  return { channel0Chunks, channel1Chunks, totalChunks };
}

/**
 * Simulates laptop speakerphone bleed:
 * Remote meeting audio plays over speakers at amplitude A.
 * A fraction (e.g. -12dB ~= 0.25) bleeds back into the hardware microphone with an acoustic delay (~45ms).
 */
function createBleedSimulation(durationSeconds = 2, bleedAttenuation = 0.25, delaySamples = 720) {
  const totalChunks = Math.floor((durationSeconds * 1000) / CHUNK_MS);
  const micChunks = [];
  const systemChunks = [];

  const delayBuffer = new Array(delaySamples).fill(0);

  for (let c = 0; c < totalChunks; c++) {
    const sysBuf = generateToneChunk(600, 0.65, c * SAMPLES_PER_CHUNK);
    systemChunks.push(sysBuf);

    // Apply delayed speakerphone bleed to Mic buffer
    const micBuf = Buffer.alloc(SAMPLES_PER_CHUNK * BYTES_PER_SAMPLE);
    for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
      const sysSample = sysBuf.readInt16LE(i * 2) / 32768.0;
      delayBuffer.push(sysSample);
      const delayedSample = delayBuffer.shift();

      // Bleed sample
      const bledSample = delayedSample * bleedAttenuation;
      const int16 = Math.max(-32768, Math.min(32767, Math.floor(bledSample * 32767)));
      micBuf.writeInt16LE(int16, i * 2);
    }
    micChunks.push(micBuf);
  }

  return { systemChunks, micChunks, totalChunks };
}

/**
 * Multi-speaker synthetic test set (3 speakers with distinct pitch signatures)
 */
const MOCK_SPEAKERS = [
  { id: "Speaker 1", name: "Alex (Eng Lead)", pitchHz: 155, label: "Remote: Eng Lead" },
  { id: "Speaker 2", name: "Sarah (Product)", pitchHz: 235, label: "Remote: Product" },
  { id: "Speaker 3", name: "Marcus (Architect)", pitchHz: 320, label: "Remote: Architect" }
];

module.exports = {
  SAMPLE_RATE,
  CHUNK_MS,
  SAMPLES_PER_CHUNK,
  BYTES_PER_SAMPLE,
  generateToneChunk,
  generateSilenceChunk,
  calculateRMS,
  calculateCrossBleedRatio,
  createDualSyntheticTracks,
  createBleedSimulation,
  MOCK_SPEAKERS
};

