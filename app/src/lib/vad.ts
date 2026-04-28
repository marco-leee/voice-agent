/**
 * Utterance capture / VAD for LISTENING: ~500ms windows, RMS threshold, silence gating.
 * Future: swap internals to MicVAD (@ricky0123/vad-web) without changing this module’s API.
 */

import { rms, samplesForDurationMs } from "./audio.ts";

export type VadListenResult = "completed" | "aborted" | "safety_stop";

export type VadListenCallbacks = {
	isAlive: () => boolean;
	onSampleRate: (hz: number) => void;
	onSpeechChunk: (chunk: Float32Array, meta: { rms: number }) => void;
	/** Whether the utterance queue has at least one speech window (same as original `#audioQueue.length > 0`). */
	hasQueuedUtterance: () => boolean;
	/** Fire when 1s accumulated silence with non-empty queue (caller typically sends END_LISTENING_TURN). */
	onEndTurn: () => void;
};

const DEFAULT_CHUNK_MS = 500;
const DEFAULT_SILENCE_END_MS = 1000;
const DEFAULT_SPEECH_RMS = 0.02;
const SAFETY_MAX_CHUNKS = 200;

/**
 * Pull ~500ms windows of mono PCM from the mic via ScriptProcessor accumulation.
 * (ScriptProcessor is deprecated but fine for a first pass; swap to AudioWorklet later.)
 */
export async function runVadListening(
	stream: MediaStream,
	signal: AbortSignal,
	callbacks: VadListenCallbacks,
	opts?: {
		chunkMs?: number;
		silenceEndMs?: number;
		speechRmsThreshold?: number;
	},
): Promise<VadListenResult> {
	const chunkMs = opts?.chunkMs ?? DEFAULT_CHUNK_MS;
	const silenceEndMs = opts?.silenceEndMs ?? DEFAULT_SILENCE_END_MS;
	const speechRmsThreshold = opts?.speechRmsThreshold ?? DEFAULT_SPEECH_RMS;

	let silenceAccumMs = 0;
	let chunkIdx = 0;

	const ctx = new AudioContext();
	const onAbort = () => {
		try {
			if (ctx.state === "running") {
				void ctx.close();
			}
		} catch {
			/* ignore */
		}
	};
	signal.addEventListener("abort", onAbort, { once: true });

	try {
		if (ctx.state === "suspended") await ctx.resume();

		const source = ctx.createMediaStreamSource(stream);
		const bufferSize = 4096;
		const numberOfChannels = 1;
		const processor = ctx.createScriptProcessor(
			bufferSize,
			numberOfChannels,
			numberOfChannels,
		);
		const gain = ctx.createGain();
		gain.gain.value = 0;

		const sampleRate = ctx.sampleRate;
		callbacks.onSampleRate(sampleRate);
		const samplesPerWindow = samplesForDurationMs(sampleRate, chunkMs);
		let ring = new Float32Array(0);

		const pending: Float32Array[] = [];
		let notify: (() => void) | null = null;

		const flushWaiter = () => {
			notify?.();
			notify = null;
		};

		processor.onaudioprocess = (ev) => {
			const input = ev.inputBuffer.getChannelData(0);
			const next = new Float32Array(ring.length + input.length);
			next.set(ring, 0);
			next.set(input, ring.length);
			ring = next;

			while (ring.length >= samplesPerWindow) {
				const slice = ring.subarray(0, samplesPerWindow);
				ring = ring.subarray(samplesPerWindow);
				pending.push(Float32Array.from(slice));
				flushWaiter();
			}
		};

		source.connect(processor);
		processor.connect(gain);
		gain.connect(ctx.destination);

		const waitWindow = () =>
			new Promise<Float32Array>((resolve) => {
				const q = pending.shift();
				if (q) {
					resolve(q);
					return;
				}
				notify = () => {
					const w = pending.shift();
					if (w) resolve(w);
				};
			});

		while (callbacks.isAlive()) {
			const windowPromise = waitWindow();
			const aborted = new Promise<Float32Array>((_, reject) => {
				signal.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
			let samples: Float32Array;
			try {
				samples = await Promise.race([windowPromise, aborted]);
			} catch {
				return "aborted";
			}
			if (!callbacks.isAlive()) return "aborted";

			const rmsVal = rms(samples);
			const speech = rmsVal >= speechRmsThreshold;
			if (speech) {
				callbacks.onSpeechChunk(Float32Array.from(samples), {
					rms: rmsVal,
				});
				silenceAccumMs = 0;
			} else {
				silenceAccumMs += chunkMs;
				console.log(
					"[listen] silence rms",
					rmsVal.toFixed(4),
					`${silenceAccumMs}ms`,
				);
				if (
					callbacks.hasQueuedUtterance() &&
					silenceAccumMs >= silenceEndMs
				) {
					callbacks.onEndTurn();
					return "completed";
				}
			}

			chunkIdx += 1;
			if (chunkIdx > SAFETY_MAX_CHUNKS) {
				console.warn("[listen] safety stop (mic)");
				return "safety_stop";
			}
		}
		return "aborted";
	} finally {
		signal.removeEventListener("abort", onAbort);
		try {
			if (ctx.state === "running") {
				void ctx.close();
			}
		} catch {
			/* ignore */
		}
	}
}
