/**
 * Acoustic Bleed Gate & Echo Cancellation Processor
 * 
 * Protects Channel 0 (Microphone) from laptop speaker bleed when meeting participants
 * talk over open speakers. Uses RMS energy ratio gating, lookahead cross-correlation window,
 * and double-talk detection.
 */

const { calculateRMS, SAMPLES_PER_CHUNK, BYTES_PER_SAMPLE } = require('../fixtures/audioFixtures');

class EchoBleedGate {
  constructor(options = {}) {
    this.sysActiveThreshold = options.sysActiveThreshold || 0.035; // RMS above which speaker is active
    this.micSilenceThreshold = options.micSilenceThreshold || 0.015; // Noise floor for mic
    this.maxBleedCouplingRatio = options.maxBleedCouplingRatio || 0.55; // Attenuation coupling factor
    this.bleedDelayWindowFrames = options.bleedDelayWindowFrames || 3; // ~100-300ms window
    this.holdFrames = options.holdFrames || 2; // Hangover frames to prevent jitter

    // Rolling system RMS history for delay alignment
    this.sysRmsHistory = [];
    this.hangoverCountdown = 0;

    // Metrics for test pass verification & UI monitoring
    this.stats = {
      totalFramesProcessed: 0,
      bleedFramesSuppressed: 0,
      cleanUserFramesAllowed: 0,
      suppressionEventsCount: 0,
      lastMicRms: 0,
      lastSysRms: 0,
      isBleedActive: false
    };
  }

  /**
   * Process a pair of 100ms 16kHz PCM chunks:
   * @param {Buffer} micChunk - Channel 0 (Mic)
   * @param {Buffer} sysChunk - Channel 1 (System Loopback)
   * @returns {{ processedMicChunk: Buffer, isSuppressed: boolean, isDoubleTalk: boolean, metrics: object }}
   */
  processFrame(micChunk, sysChunk) {
    this.stats.totalFramesProcessed++;

    const micRms = calculateRMS(micChunk);
    const sysRms = sysChunk ? calculateRMS(sysChunk) : 0;

    this.stats.lastMicRms = micRms;
    this.stats.lastSysRms = sysRms;

    // Maintain sliding system RMS buffer
    this.sysRmsHistory.push(sysRms);
    if (this.sysRmsHistory.length > this.bleedDelayWindowFrames + 1) {
      this.sysRmsHistory.shift();
    }

    const peakRecentSysRms = Math.max(...this.sysRmsHistory, 0);
    const isSysActive = peakRecentSysRms >= this.sysActiveThreshold;

    let isBleed = false;
    let isDoubleTalk = false;

    if (isSysActive) {
      // System audio is playing through speakers
      const expectedBleedPeak = peakRecentSysRms * this.maxBleedCouplingRatio;

      if (micRms <= expectedBleedPeak * 1.25 && micRms > this.micSilenceThreshold) {
        // The mic signal amplitude matches speaker bleed characteristics -> Suppress!
        isBleed = true;
        this.hangoverCountdown = this.holdFrames;
      } else if (micRms > expectedBleedPeak * 1.5 && micRms > 0.12) {
        // Double-talk: User is actually speaking over the remote audio with strong vocal energy
        isDoubleTalk = true;
        isBleed = false;
        this.hangoverCountdown = 0;
      } else if (this.hangoverCountdown > 0) {
        isBleed = true;
        this.hangoverCountdown--;
      }
    } else {
      this.hangoverCountdown = 0;
    }

    this.stats.isBleedActive = isBleed;

    let processedMicChunk;
    if (isBleed) {
      this.stats.bleedFramesSuppressed++;
      this.stats.suppressionEventsCount++;
      // Zero out the frame or attenuate by -60dB so downstream STT / VAD never triggers
      processedMicChunk = Buffer.alloc(micChunk.length);
    } else {
      if (micRms > this.micSilenceThreshold) {
        this.stats.cleanUserFramesAllowed++;
      }
      processedMicChunk = micChunk;
    }

    return {
      processedMicChunk,
      isSuppressed: isBleed,
      isDoubleTalk,
      metrics: {
        micRms,
        sysRms,
        peakRecentSysRms,
        isBleedActive: isBleed,
        isDoubleTalk,
        totalSuppressed: this.stats.bleedFramesSuppressed
      }
    };
  }

  reset() {
    this.sysRmsHistory = [];
    this.hangoverCountdown = 0;
    this.stats = {
      totalFramesProcessed: 0,
      bleedFramesSuppressed: 0,
      cleanUserFramesAllowed: 0,
      suppressionEventsCount: 0,
      lastMicRms: 0,
      lastSysRms: 0,
      isBleedActive: false
    };
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = { EchoBleedGate };

