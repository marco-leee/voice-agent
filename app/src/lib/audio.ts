/** Mono float32 PCM helpers for capture, VAD, and model prep. */

/** How many whole samples fit in `durationMs` at `sampleRate` (at least 1). */
export function samplesForDurationMs(
	sampleRate: number,
	durationMs: number,
): number {
	return Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
}

/** Root-mean-square level of the buffer; use as a simple energy / speech proxy. */
export function rms(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i]!;
		sum += s * s;
	}
	return Math.sqrt(sum / samples.length);
}

/** Concatenate several mono chunks in order; skips empty chunks; returns a new array. */
export function concatFloatChunks(chunks: Float32Array[]): Float32Array {
	let len = 0;
	for (const c of chunks) {
		if (c.length > 0) len += c.length;
	}
	if (len === 0) return new Float32Array(0);
	const out = new Float32Array(len);
	let o = 0;
	for (const c of chunks) {
		if (c.length === 0) continue;
		out.set(c, o);
		o += c.length;
	}
	return out;
}

/** Change sample rate by linear interpolation between neighbouring samples. */
export function resampleLinear(
	input: Float32Array,
	fromRate: number,
	toRate: number,
): Float32Array {
	if (fromRate === toRate || input.length === 0) return input;
	const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
	const out = new Float32Array(outLen);
	for (let i = 0; i < outLen; i++) {
		const srcPos = (i * fromRate) / toRate;
		const j = Math.floor(srcPos);
		const f = srcPos - j;
		const a = input[Math.min(j, input.length - 1)] ?? 0;
		const b = input[Math.min(j + 1, input.length - 1)] ?? 0;
		out[i] = a + f * (b - a);
	}
	return out;
}

/** Scales the buffer in place so the largest absolute sample becomes 1 (or no-op if silent). */
export function normaliseAudio(mono: Float32Array): void {
	if (mono.length === 0) return;
	let max = 0;
	for (let i = 0; i < mono.length; i++) {
		const v = Math.abs(mono[i]!);
		if (v > max) max = v;
	}
	if (max > 0) {
		for (let i = 0; i < mono.length; i++) {
			mono[i]! /= max;
		}
	}
}
