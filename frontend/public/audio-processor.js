// frontend/public/audio-processor.js

/**
 * PCMProcessor class for AudioWorklet.
 * This processor receives audio data from an AudioContext, resamples it to a target sample rate,
 * converts it to 16-bit PCM, and sends it back to the main thread.
 */
class PCMProcessor extends AudioWorkletProcessor {
  // targetSampleRate: The desired output sample rate (e.g., 16000 for Vosk).
  // inputSampleRate: The sample rate of the audio coming from the AudioContext (global 'sampleRate').

  constructor(options) {
    super(); // Call the AudioWorkletProcessor constructor

    // Get processor options passed from the main thread
    this.targetSampleRate = options?.processorOptions?.targetSampleRate || 16000;
    // 'sampleRate' is a global read-only property in AudioWorkletGlobalScope,
    // representing the sample rate of the AudioContext running this worklet.
    this.inputSampleRate = sampleRate; // This is a global variable in AudioWorkletGlobalScope

    console.log(
      `PCMProcessor initialized. Input SR: ${this.inputSampleRate}, Target SR: ${this.targetSampleRate}`
    );

    // Optional: handle messages from the main thread (e.g., a 'stop' command)
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        // Perform any cleanup if needed, though the node being disconnected
        // usually handles stopping the 'process' calls.
        console.log('PCMProcessor received stop command.');
      }
    };
  }

  /**
   * Converts a Float32Array to an Int16Array.
   * @param {Float32Array} input - The audio data in Float32 format (-1.0 to 1.0).
   * @returns {Int16Array} - The audio data in Int16 format (-32768 to 32767).
   */
  floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i])); // Clamp to [-1, 1]
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff; // Scale to Int16 range
    }
    return output;
  }

  /**
   * Simple linear interpolation for resampling.
   * This is a basic resampling method. For higher quality, consider a Sinc filter
   * or other more advanced techniques if audio artifacts are noticeable.
   * @param {Float32Array} audioBuffer - The input audio buffer.
   * @param {number} fromRate - The sample rate of the input buffer.
   * @param {number} toRate - The desired output sample rate.
   * @returns {Float32Array} - The resampled audio buffer.
   */
  resampleLinear(audioBuffer, fromRate, toRate) {
    if (fromRate === toRate) {
      return audioBuffer;
    }

    const ratio = fromRate / toRate;
    const newLength = Math.round(audioBuffer.length / ratio);
    const result = new Float32Array(newLength);
    // let posInResult = 0; // This variable was defined but not used, can be removed if not needed for other logic

    for (let i = 0; i < newLength; i++) {
      const posInInput = i * ratio; // Corrected: const
      const indexBefore = Math.floor(posInInput); // Corrected: const
      const indexAfter = Math.min(indexBefore + 1, audioBuffer.length - 1); // Corrected: const, Ensure within bounds
      const fraction = posInInput - indexBefore; // Corrected: const

      result[i] =
        audioBuffer[indexBefore] +
        (audioBuffer[indexAfter] - audioBuffer[indexBefore]) * fraction;
    }
    return result;
  }

  /**
   * Called by the browser's audio engine to process audio.
   * 'inputs' is an array of inputs, each input is an array of channels (Float32Array).
   * We typically process the first input and first channel: inputs[0][0].
   * This method must return true to keep the processor alive.
   */
  process(inputs, outputs, parameters) {
    // Get the first channel of the first input.
    // Each 'inputChannel' is a Float32Array containing 128 samples by default.
    const inputChannel = inputs[0]?.[0]; // Optional chaining for safety

    // If there's no input data (e.g., microphone disconnected or muted), do nothing.
    if (!inputChannel || inputChannel.length === 0) {
      return true; // Keep processor alive
    }

    // 1. Resample the audio data if necessary
    let resampledAudio;
    if (this.inputSampleRate !== this.targetSampleRate) {
      resampledAudio = this.resampleLinear(
        inputChannel,
        this.inputSampleRate,
        this.targetSampleRate
      );
    } else {
      resampledAudio = inputChannel; // No resampling needed
    }

    // If resampling resulted in an empty buffer
    if (!resampledAudio || resampledAudio.length === 0) {
      return true;
    }

    // 2. Convert the (resampled) Float32 audio to Int16 PCM
    const pcm16Data = this.floatTo16BitPCM(resampledAudio);

    // 3. Post the Int16Array's underlying ArrayBuffer back to the main thread.
    // The second argument [pcm16Data.buffer] "transfers" ownership of the ArrayBuffer,
    // which is more efficient as it avoids copying.
    if (pcm16Data.buffer && pcm16Data.buffer.byteLength > 0) {
      try {
        this.port.postMessage(pcm16Data.buffer, [pcm16Data.buffer]);
      } catch (e) {
        // This can happen if the buffer is detached or already transferred,
        // or if the port is closed. Log it and continue.
        console.warn('PCMProcessor: Error posting message (buffer may be detached or port closed):', e.message);
      }
    }

    return true; // Important: return true to keep the processor alive.
  }
}

// Register the processor with the given name.
// This name will be used to create an AudioWorkletNode in the main thread.
try {
  registerProcessor('pcm-processor', PCMProcessor);
} catch (e) {
  console.error('Error registering PCMProcessor:', e);
  // This error often means the script is not being loaded in an AudioWorkletGlobalScope
  // or 'registerProcessor' is called incorrectly.
}