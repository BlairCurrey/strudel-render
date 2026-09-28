// WAV output, and the time format used in messages.

/** m:ss.s */
export function clock(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** 44-byte header for interleaved stereo PCM (16/24-bit) or IEEE float (32-bit). */
export function wavHeader(frames: number, rate: number, bits: number) {
  const ch = 2;
  const bps = bits / 8;
  const data = frames * ch * bps;
  if (data + 36 > 0xffffffff) throw new Error('output too large for WAV — lower the sample rate or bits');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(bits === 32 ? 3 : 1, 20); // 3 = IEEE float
  h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * ch * bps, 28);
  h.writeUInt16LE(ch * bps, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(data, 40);
  return h;
}
