/**
 * Kokoro TTS → blob → HTMLAudio playback with spectrum UI via Web Audio graph.
 * (captureStream() on HTMLAudioElement is often empty until after play() and is inconsistent across browsers.)
 */

import type { KokoroTTS } from "kokoro-js";

export type TtsPlaybackHooks = {
	setPlaybackTranscript: (t: string | null) => void;
	setPlaybackMediaStream: (s: MediaStream | null) => void;
	syncPublicState: () => void;
};

/**
 * Routes element audio to speakers and to a MediaStream for AnalyserNode / visualizers.
 */
function streamFromElementViaWebAudio(el: HTMLAudioElement): {
	stream: MediaStream;
	release: () => void;
} | null {
	try {
		const ctx = new AudioContext();
		const src = ctx.createMediaElementSource(el);
		const dest = ctx.createMediaStreamDestination();
		src.connect(dest);
		src.connect(ctx.destination);
		void ctx.resume();
		return {
			stream: dest.stream,
			release: () => {
				try {
					src.disconnect();
					void ctx.close();
				} catch {
					/* ignore */
				}
			},
		};
	} catch (e) {
		console.warn("[tts-playback] Web Audio spectrum graph failed", e);
		return null;
	}
}

/**
 * Generate audio, play to completion, then clear playback hooks (mirrors `#enterPlayResponse` cleanup).
 * Does not send FSM actions — caller sends PLAYBACK_DONE after return if still alive.
 */
export async function playTtsLine(
	tts: KokoroTTS,
	line: string,
	signal: AbortSignal,
	hooks: TtsPlaybackHooks,
	isAlive: () => boolean,
): Promise<void> {
	hooks.setPlaybackTranscript(line);
	hooks.setPlaybackMediaStream(null);
	hooks.syncPublicState();

	let objectUrl: string | null = null;
	let mediaEl: HTMLAudioElement | null = null;
	let releaseSpectrum: (() => void) | null = null;

	const clearPlayback = () => {
		releaseSpectrum?.();
		releaseSpectrum = null;
		mediaEl?.pause();
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
		hooks.setPlaybackMediaStream(null);
		hooks.setPlaybackTranscript(null);
		hooks.syncPublicState();
	};

	try {
		if (!line) {
			clearPlayback();
			return;
		}

		const genAbort = new AbortController();
		const onMachineAbort = () => genAbort.abort();
		signal.addEventListener("abort", onMachineAbort, { once: true });
		if (signal.aborted) {
			signal.removeEventListener("abort", onMachineAbort);
			clearPlayback();
			return;
		}

		const whenGenAborted = new Promise<never>((_, reject) => {
			if (genAbort.signal.aborted) {
				reject(new DOMException("Aborted", "AbortError"));
				return;
			}
			genAbort.signal.addEventListener(
				"abort",
				() => reject(new DOMException("Aborted", "AbortError")),
				{ once: true },
			);
		});

		let raw;
		try {
			console.log("[play response] generating TTS", line);
			console.time("TTS generate");
			raw = await Promise.race([
				tts.generate(line, { voice: "af_heart", speed: 1.0 }),
				whenGenAborted,
			]);
			console.timeEnd("TTS generate");
		} catch (e) {
			if (e instanceof DOMException && e.name === "AbortError") {
				console.log("[play response] TTS generation ditched (aborted)");
			} else {
				console.error("[play response] TTS generate failed", e);
			}
			clearPlayback();
			return;
		} finally {
			signal.removeEventListener("abort", onMachineAbort);
		}

		if (!isAlive()) {
			clearPlayback();
			return;
		}

		const blob = raw.toBlob();
		objectUrl = URL.createObjectURL(blob);
		mediaEl = new Audio(objectUrl);

		await mediaEl.play();

		if (!isAlive()) {
			clearPlayback();
			return;
		}

		const fb = streamFromElementViaWebAudio(mediaEl);
		if (fb) {
			hooks.setPlaybackMediaStream(fb.stream);
			releaseSpectrum = fb.release;
		} else {
			hooks.setPlaybackMediaStream(null);
		}
		hooks.syncPublicState();

		await new Promise<void>((resolve, reject) => {
			const onAbort = () => {
				mediaEl?.pause();
				reject(new DOMException("Aborted", "AbortError"));
			};
			signal.addEventListener("abort", onAbort, { once: true });

			const done = () => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			};

			mediaEl!.addEventListener("ended", done, { once: true });
			mediaEl!.addEventListener(
				"error",
				() => {
					signal.removeEventListener("abort", onAbort);
					reject(new Error("audio element error"));
				},
				{ once: true },
			);
		});
	} catch (e) {
		if (!(e instanceof DOMException && e.name === "AbortError")) {
			console.error("[play response]", e);
		}
	} finally {
		clearPlayback();
	}
}
