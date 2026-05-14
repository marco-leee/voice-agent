import type { SileroVadEngine } from "./silero-vad-engine.ts";
import type { SmartTurnEngine } from "./smart-turn-engine.ts";

export type ListenEngines = {
	silero: SileroVadEngine;
	smartTurn: SmartTurnEngine;
};

export type ListenReleaseReason =
	| "smart_turn"
	| "max_utterance_duration"
	| "session_watchdog"
	| "fallback_rms"
	| "no_models_abort";

export type ListenOrchestratorConfig = {
	/** Silero probability above → speech frame. */
	sileroPositiveThreshold: number;
	/** Silero probability below → not speech (hysteresis). */
	sileroNegativeThreshold: number;
	/** Consecutive non-speech frames @ 512/16k (~32ms) before trailing silence is "real". */
	trailingSilenceFrames: number;
	/** Minimum Smart Turn score to commit. */
	smartTurnCompleteThreshold: number;
	/** After trailing silence, run Smart Turn at most every this many ms. */
	smartTurnMinIntervalMs: number;
	/** Stop listening and commit if utterance speech exceeds this (ms). */
	maxUtteranceSpeechMs: number;
	/** Hard cap for one LISTEN session (ms). */
	maxSessionMs: number;
	/** If true, log VAD / turn scores. */
	debug: boolean;
};

export const defaultListenOrchestratorConfig: ListenOrchestratorConfig = {
	sileroPositiveThreshold: 0.45,
	sileroNegativeThreshold: 0.25,
	trailingSilenceFrames: 12,
	smartTurnCompleteThreshold: 0.55,
	smartTurnMinIntervalMs: 180,
	maxUtteranceSpeechMs: 45_000,
	maxSessionMs: 120_000,
	debug: false,
};

export type ListenOrchestratorCallbacks = {
	isAlive: () => boolean;
	onSampleRate: (hz: number) => void;
	/** Optional RMS for UI (raw chunk before VAD strip). */
	onLevel?: (rms: number) => void;
	/** ML path: 16 kHz speech-only; RMS fallback: native-rate windows concatenated. */
	onRelease: (pcmMono: Float32Array, reason: ListenReleaseReason) => void;
};
