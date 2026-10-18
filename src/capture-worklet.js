/* Independent microphone capture. Copies mono samples; emits no audible output. */
class InkVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(2048);
    this.length = 0;
    this.stopped = false;
    this.port.onmessage = ({data}) => {
      if (data?.type === 'flush') {
        this.flush();
        this.stopped = true;
        this.port.postMessage({type: 'flushed'});
      }
    };
  }
  flush() {
    if (!this.length) return;
    const samples = this.pending.slice(0, this.length);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    this.port.postMessage({type: 'samples', samples, rms: Math.sqrt(sum / samples.length)}, [samples.buffer]);
    this.length = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    if (this.stopped) return true;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.pending[this.length++] = value / channels.length;
      if (this.length === this.pending.length) this.flush();
    }
    return true;
  }
}
registerProcessor('inkvoice-capture', InkVoiceCapture);
