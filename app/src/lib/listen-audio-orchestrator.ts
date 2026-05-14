/**
 * Client listen pipeline: 16 kHz → Silero (speech buffer) + Smart Turn (commit) + RMS fallback.
 */

import { concatFloatChunks, resampleLinear, rms } from "./audio.ts";
import { runVadListening } from "./vad.ts";
import {
	SILERO_FRAME_SAMPLES,
	SILERO_SAMPLE_RATE,
} from "./silero-vad-engine.ts";
import {
	defaultListenOrchestratorConfig,
	type ListenEngines,
	type ListenOrchestratorCallbacks,
	type ListenOrchestratorConfig,
	type ListenReleaseReason,
} from "./listen-audio-orchestrator.types.ts";

export type {
	ListenEngines,
	ListenOrchestratorCallbacks,
	ListenOrchestratorConfig,
	ListenReleaseReason,
} from "./listen-audio-orchestrator.types.ts";
export { defaultListenOrchestratorConfig } from "./listen-audio-orchestrator.types.ts";

const RING_CAP = 128_000;

function mergeCfg(
	partial?: Partial<ListenOrchestratorConfig>,
): ListenOrchestratorConfig {
	return { ...defaultListenOrchestratorConfig, ...partial };
}

function appendCap16k(
	prev: Float32Array,
	chunk: Float32Array,
	cap: number,
): Float32Array {
	const t = new Float32Array(prev.length + chunk.length);
	t.set(prev);
	t.set(chunk, prev.length);
	if (t.length <= cap) return t;
	return t.subarray(t.length - cap);
}

export async function runListenOrchestrator(
	stream: MediaStream,
	signal: AbortSignal,
	models: ListenEngines | null,
	callbacks: ListenOrchestratorCallbacks,
	cfg?: Partial<ListenOrchestratorConfig>,
): Promise<"completed" | "aborted" | "safety_stop"> {
	const config = mergeCfg(cfg);
	const log = (...a: unknown[]) => {
		if (config.debug) console.log("[listen-orch]", ...a);
	};

	if (!models) {
		log("no ML models; RMS fallback");
		const captured: Float32Array[] = [];
		const res = await runVadListening(stream, signal, {
			isAlive: callbacks.isAlive,
			onSampleRate: callbacks.onSampleRate,
			onSpeechChunk: (chunk, meta) => {
				callbacks.onLevel?.(meta.rms);
				captured.push(Float32Array.from(chunk));
			},
			hasQueuedUtterance: () => captured.length > 0,
			onEndTurn: () => {
				const pcm = concatFloatChunks(captured);
				if (pcm.length > 0)
					callbacks.onRelease(pcm, "fallback_rms");
			},
		});
		if (res === "completed" && captured.length === 0) {
			/* empty */
		}
		return res === "aborted" ? "aborted" : res;
	}

	let released = false;
	const releaseOnce = (pcm: Float32Array, reason: ListenReleaseReason) => {
		if (released) return;
		released = true;
		callbacks.onSampleRate(SILERO_SAMPLE_RATE);
		callbacks.onRelease(Float32Array.from(pcm), reason);
	};

	const ctx = new AudioContext();
	const onAbort = () => {
		try {
			if (ctx.state === "running") void ctx.close();
		} catch {
			/* ignore */
		}
	};
	signal.addEventListener("abort", onAbort, { once: true });

	try {
		if (ctx.state === "suspended") await ctx.resume();

		const source = ctx.createMediaStreamSource(stream);
		const bufferSize = 4096;
		const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
		const gain = ctx.createGain();
		gain.gain.value = 0;
		callbacks.onSampleRate(SILERO_SAMPLE_RATE);

		const pending: Float32Array[] = [];
		let notify: (() => void) | null = null;
		const flushWaiter = () => {
			notify?.();
			notify = null;
		};

		processor.onaudioprocess = (ev) => {
			const input = ev.inputBuffer.getChannelData(0);
			const out = ev.outputBuffer.getChannelData(0);
			out.fill(0);
			callbacks.onLevel?.(rms(input));
			const at16k = resampleLinear(input, ctx.sampleRate, SILERO_SAMPLE_RATE);
			pending.push(Float32Array.from(at16k));
			flushWaiter();
		};

		source.connect(processor);
		processor.connect(gain);
		gain.connect(ctx.destination);

		const waitChunk = () =>
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

		let pending16k = new Float32Array(0);
		let ringRecent16k = new Float32Array(0);
		const speechChunks: Float32Array[] = [];
		let trailingSilentFrames = 0;
		let speechStarted = false;
		let lastSmartTurnAt = 0;
		let speechMsAccum = 0;
		let lastSmartTurnScore = 0;
		const sessionStart = performance.now();
		const { silero, smartTurn } = models;
		silero.reset();

		outer: while (callbacks.isAlive() && !released) {
			let chunk: Float32Array;
			try {
				chunk = await Promise.race([
					waitChunk(),
					new Promise<Float32Array>((_, reject) => {
						signal.addEventListener(
							"abort",
							() =>
								reject(new DOMException("Aborted", "AbortError")),
							{ once: true },
						);
					}),
				]);
			} catch {
				break outer;
			}
			if (signal.aborted) break outer;

			pending16k = Float32Array.from(
				concatFloatChunks([pending16k, chunk]),
			);

			frameLoop: while (pending16k.length >= SILERO_FRAME_SAMPLES) {
				const frame = pending16k.subarray(0, SILERO_FRAME_SAMPLES);
				pending16k = pending16k.subarray(SILERO_FRAME_SAMPLES);
				const frameCopy = Float32Array.from(frame);

				let prob = 0;
				try {
					prob = await silero.process(frameCopy);
				} catch (e) {
					console.error("[listen-orch] silero", e);
					break outer;
				}

				if (signal.aborted || !callbacks.isAlive()) break outer;

				ringRecent16k = Float32Array.from(
					appendCap16k(ringRecent16k, frameCopy, RING_CAP),
				);

				const isSpeech = prob >= config.sileroPositiveThreshold;
				const isNonSpeech = prob < config.sileroNegativeThreshold;

				if (isSpeech) {
					trailingSilentFrames = 0;
					speechChunks.push(frameCopy);
					speechStarted = true;
					speechMsAccum +=
						(SILERO_FRAME_SAMPLES / SILERO_SAMPLE_RATE) * 1000;
				} else if (isNonSpeech) {
					trailingSilentFrames += 1;
				}

				const now = performance.now();
				if (now - sessionStart > config.maxSessionMs) {
					const pcm = concatFloatChunks(speechChunks);
					if (pcm.length > 0) releaseOnce(pcm, "session_watchdog");
					break outer;
				}
				if (
					speechStarted &&
					speechMsAccum >= config.maxUtteranceSpeechMs
				) {
					const pcm = concatFloatChunks(speechChunks);
					if (pcm.length > 0)
						releaseOnce(pcm, "max_utterance_duration");
					break outer;
				}

				if (
					speechStarted &&
					trailingSilentFrames >= config.trailingSilenceFrames &&
					speechChunks.length > 0 &&
					now - lastSmartTurnAt >= config.smartTurnMinIntervalMs
				) {
					lastSmartTurnAt = now;
					try {
						lastSmartTurnScore =
							await smartTurn.scorePcm16kMono(ringRecent16k);
					} catch (e) {
						console.error("[listen-orch] smart-turn", e);
						continue frameLoop;
					}
					log("smart-turn", lastSmartTurnScore.toFixed(3));
					if (
						lastSmartTurnScore >=
						config.smartTurnCompleteThreshold
					) {
						const pcm = concatFloatChunks(speechChunks);
						if (pcm.length > 0) releaseOnce(pcm, "smart_turn");
						break outer;
					}
				}

				if (released) break outer;
			}
		}

		try {
			processor.disconnect();
			source.disconnect();
		} catch {
			/* ignore */
		}
		if (ctx.state === "running") await ctx.close();

		if (!released && speechChunks.length > 0) {
			const pcm = concatFloatChunks(speechChunks);
			if (lastSmartTurnScore >= config.smartTurnCompleteThreshold * 0.85) {
				releaseOnce(pcm, "smart_turn");
			} else if (pcm.length > 0) {
				releaseOnce(pcm, "session_watchdog");
			}
		}

		if (signal.aborted) return "aborted";
		if (!released && speechChunks.length === 0) return "aborted";
		return "completed";
	} finally {
		signal.removeEventListener("abort", onAbort);
		try {
			if (ctx.state === "running") await ctx.close();
		} catch {
			/* ignore */
		}
	}
}
