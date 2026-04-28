/** Conversation agent: table-driven FSM + per-state async work. */

import { defaultActionHandlers } from "./client.agent.handlers.ts";
import {
	MachineActions,
	type ActionHandlers,
	type MachineAction,
	type MachineState,
	MachineStates,
	type ActionHandlerContext,
	type ActionHandler,
} from "./conversation-agent.types.ts";
import type { KokoroTTS } from "kokoro-js";
import type {
	AutomaticSpeechRecognitionPipeline,
	PreTrainedModel,
	Processor,
} from "@huggingface/transformers";
import {
	concatFloatChunks,
	normaliseAudio,
	resampleLinear,
} from "./audio.ts";
import { runVadListening } from "./vad.ts";
import { prepareVoiceStack } from "./voice-models.ts";
import { playTtsLine } from "./tts-playback.ts";
import {
	transcribeUtterance,
	streamAssistantReply,
	type ChatMessage,
} from "./conversation-inference.ts";

export {
	MachineActions,
	MachineStates,
	type ActionHandler,
	type ActionHandlerContext,
	type ActionHandlers,
	type MachineAction,
	type MachineState,
} from "./conversation-agent.types.ts";

export {
	defaultActionHandlers,
	handleBoot,
	handleClosed,
	handleEndListeningTurn,
	handleInterruptPlayback,
	handlePlaybackDone,
	handlePrepared,
	handleResponseStreamDone,
	handleShutdown,
	handleStartListen,
	handleUploadDone,
} from "./client.agent.handlers.ts";

type TransitionTable = {
	[S in MachineState]: Partial<Record<MachineAction, MachineState>>;
};

const TRANSITIONS: TransitionTable = {
	INIT: { [MachineActions.BOOT]: MachineStates.PREPARING },
	PREPARING: { [MachineActions.PREPARED]: MachineStates.READY },
	READY: {
		[MachineActions.START_LISTEN]: MachineStates.LISTENING,
		[MachineActions.SHUTDOWN]: MachineStates.CLOSING,
	},
	LISTENING: {
		[MachineActions.END_LISTENING_TURN]: MachineStates.SENDING,
		[MachineActions.SHUTDOWN]: MachineStates.CLOSING,
	},
	SENDING: {
		[MachineActions.UPLOAD_DONE]: MachineStates.WAITING_RESPONSE,
		[MachineActions.SHUTDOWN]: MachineStates.CLOSING,
	},
	WAITING_RESPONSE: {
		[MachineActions.RESPONSE_STREAM_DONE]: MachineStates.PLAY_RESPONSE,
		[MachineActions.SHUTDOWN]: MachineStates.CLOSING,
	},
	PLAY_RESPONSE: {
		[MachineActions.PLAYBACK_DONE]: MachineStates.READY,
		[MachineActions.INTERRUPT_PLAYBACK]: MachineStates.LISTENING,
		[MachineActions.SHUTDOWN]: MachineStates.CLOSING,
	},
	CLOSING: { [MachineActions.CLOSED]: MachineStates.CLOSED },
	CLOSED: {
		[MachineActions.BOOT]: MachineStates.INIT,
	},
};

/**
 * Each state has its own function
 *
 * 1. Prepare - check if browser has permission to use microphone. If no, ask for permission. If yes, get the audio stream, add a param to state machine and transition to ready
 * 2. Ready - Nothing for now. Transition to listening
 * 3. Listening - Chunk the audio stream into 500 ms chunks, run VAD on each chunk. If VAD detects speech, add the chunk to the audio queue. If no speech is detected for 1 second, transition to sending
 * 4. Sending - Send the audio queue to the server. Once queue is empty, transition to waiting response.
 * 4. Waiting Response - Just waiting here. Expect a stream of chunks from server. Upon arriving, save to response queue. On server signals completed, transition to play responses.
 * 5. Play Responses - Concatenate the response chunks and play them. While playing, if user speaks, stop playing and transition to listening. If playback completes, transition to ready.
 * 6. Closing - All states above, while handling the state, should monitor for user triggered shutdown or OS shutdown signals.
 * 7. Closed - The state machine is now closed.
 *
 */

/** User-visible chat turns (system prompt excluded). */
export type ChatHistoryEntry = {
	role: "user" | "assistant";
	content: string;
};

const DEFAULT_SYSTEM_CONTENT =
	"You are a helpful voice assistant. The user speaks in short audio clips. Answer in clear, concise text suitable for text-to-speech. Do not transcribe or echo their words unless they explicitly ask for a transcript.";

function defaultConversationMessages(): ChatMessage[] {
	return [{ role: "system", content: DEFAULT_SYSTEM_CONTENT }];
}

export interface ConversationAgentState {
	state: MachineState;
	gen: number;
	active: AbortController | null;
	micStreamId: string | null;
	micMediaStream: MediaStream | null;
	audioQueue: Float32Array[];
	responseQueue: string[];
	/** Text being spoken during PLAY_RESPONSE (null when idle). */
	playbackTranscript: string | null;
	/** MediaStream from TTS playback for spectrum UI (null when idle). */
	playbackMediaStream: MediaStream | null;
	/** Conversation turns for UI (mirrors `#messages` minus system). */
	chatHistory: ChatHistoryEntry[];
	/** Current system message content (for history panel). */
	systemPrompt: string;
}

export class ConversationAgent {
	readonly #strict: boolean;
	readonly #handlers: ActionHandlers;
	#tts: KokoroTTS | null = null;
	#processor: Processor | null = null;
	#llm: PreTrainedModel | null = null;
	#stt: AutomaticSpeechRecognitionPipeline | null = null;
	/** When set (e.g. Svelte `$state`), kept in sync with internal fields for UI. */
	#publicSnapshot: ConversationAgentState | null = null;
	#state: MachineState = MachineStates.INIT;
	#gen = 0;
	#active: AbortController | null = null;
	#messages: ChatMessage[] = defaultConversationMessages();

	/** Mic / stream — label for logs; real capture uses `#micMediaStream`. */
	#micStreamId: string | null = null;
	#micMediaStream: MediaStream | null = null;
	/** Outgoing utterance chunks: mono float32 PCM windows (~500 ms each). */
	#audioQueue: Float32Array[] = [];
	/** Snapshot of `#audioQueue` at start of SENDING (before drain). */
	#capturedUtteranceChunks: Float32Array[] = [];
	/** Sample rate of samples in `#audioQueue` chunks (from mic `AudioContext`). */
	#utteranceCaptureSampleRate = 48_000;
	/** TTS / reply text chunks from “server”. */
	#responseQueue: string[] = [];
	#playbackTranscript: string | null = null;
	#playbackMediaStream: MediaStream | null = null;

	constructor(opts: {
		strict: boolean;
		actionHandlers?: Partial<ActionHandlers>;
		/** Bind a reactive snapshot object (e.g. Svelte 5 `$state`) — updated on transitions and queue changes. */
		publicState?: ConversationAgentState;
	}) {
		this.#strict = opts.strict;
		this.#handlers = {
			...ConversationAgent.defaultActionHandlers(),
			...opts.actionHandlers,
		};
		this.#publicSnapshot = opts.publicState ?? null;
		if (this.#publicSnapshot) this.#syncPublicState();
	}

	/** Attach or replace the UI snapshot; call if you create the agent before `$state`. */
	bindPublicState(snapshot: ConversationAgentState): void {
		this.#publicSnapshot = snapshot;
		this.#syncPublicState();
	}

	#syncPublicState(): void {
		const s = this.#publicSnapshot;
		if (!s) return;
		s.state = this.#state;
		s.gen = this.#gen;
		s.active = this.#active;
		s.micStreamId = this.#micStreamId;
		s.micMediaStream = this.#micMediaStream;
		s.audioQueue = this.#audioQueue.map((c) => Float32Array.from(c));
		s.responseQueue = [...this.#responseQueue];
		s.playbackTranscript = this.#playbackTranscript;
		s.playbackMediaStream = this.#playbackMediaStream;
		s.chatHistory = this.#messages
			.filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
			.map((m) => ({ role: m.role, content: m.content }));
		s.systemPrompt =
			this.#messages.find((m) => m.role === "system")?.content ?? "";
	}

	/** Reset chat to the default system-only messages (same as initial load). */
	clearChatHistory(): void {
		this.#messages = defaultConversationMessages();
		this.#syncPublicState();
	}

	static defaultActionHandlers(): ActionHandlers {
		return { ...defaultActionHandlers };
	}

	static getNextState(
		state: MachineState,
		action: MachineAction,
		strict: boolean,
	): MachineState | undefined {
		const next = TRANSITIONS[state][action];
		if (!next) {
			const msg = `Action ${action} is not a valid step from state ${state}`;
			if (strict) throw new Error(msg);
			console.warn(msg);
			return undefined;
		}
		return next;
	}

	send(action: MachineAction): void {
		const next = ConversationAgent.getNextState(
			this.#state,
			action,
			this.#strict,
		);
		if (!next) {
			console.warn(`[ignored: invalid transition]`, {
				state: this.#state,
				action,
			});
			return;
		}

		const from = this.#state;

		console.log("[transition]", {
			from,
			action,
			to: next,
		});

		this.#active?.abort();
		this.#active = new AbortController();
		this.#gen += 1;
		const myGen = this.#gen;
		const signal = this.#active.signal;

		this.#state = next;
		this.#syncPublicState();
		this.#invokeActionHandler(action, from, next, signal);
		void this.#runEnter(next, myGen, signal);
	}

	#invokeActionHandler(
		action: MachineAction,
		from: MachineState,
		to: MachineState,
		signal: AbortSignal,
	): void {
		const ctx: ActionHandlerContext = { from, to, action, signal };
		try {
			const result = this.#handlers[action](ctx);
			void Promise.resolve(result).catch((err) =>
				console.error("[action handler error]", action, err),
			);
		} catch (err) {
			console.error("[action handler error]", action, err);
		}
	}
	#alive(myGen: number, signal: AbortSignal): boolean {
		return !signal.aborted && myGen === this.#gen;
	}

	async #runEnter(
		entered: MachineState,
		myGen: number,
		signal: AbortSignal,
	): Promise<void> {
		console.log("[enter]", entered, { gen: myGen });
		try {
			switch (entered) {
				case MachineStates.INIT:
					await this.#enterInit(signal, myGen);
					break;
				case MachineStates.PREPARING:
					await this.#enterPreparing(signal, myGen);
					break;
				case MachineStates.READY:
					await this.#enterReady(signal, myGen);
					break;
				case MachineStates.LISTENING:
					await this.#enterListening(signal, myGen);
					break;
				case MachineStates.SENDING:
					await this.#enterSending(signal, myGen);
					break;
				case MachineStates.WAITING_RESPONSE:
					await this.#enterWaitingResponse(signal, myGen);
					break;
				case MachineStates.PLAY_RESPONSE:
					await this.#enterPlayResponse(signal, myGen);
					break;
				case MachineStates.CLOSING:
					await this.#enterClosing(signal, myGen);
					break;
				case MachineStates.CLOSED:
					console.log("[closed] terminal");
					break;
				default:
					console.warn(`[ignored: invalid state]`, { state: entered });
					break;
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === "AbortError") {
				console.log("[aborted enter]", entered, { gen: myGen });
				return;
			}
			console.error("[enter error]", entered, e);
		}
	}

	/** 0. Init — nothing for now. */
	async #enterInit(signal: AbortSignal, myGen: number): Promise<void> {
		console.log("[init] idle");
		if (!this.#alive(myGen, signal)) return;
		this.send(MachineActions.BOOT);
	}

	/** 1. Prepare — permission + `getUserMedia` stream when possible, then READY. */
	async #enterPreparing(signal: AbortSignal, myGen: number): Promise<void> {
		console.log("[prepare] checking microphone permission…");

		const { ok, stream, streamId, models } = await prepareVoiceStack(
			signal,
			() => this.#alive(myGen, signal),
		);
		if (!this.#alive(myGen, signal)) return;

		if (models) {
			this.#stt = models.stt;
			this.#processor = models.processor;
			this.#llm = models.llm;
			this.#tts = models.tts;
		}

		if (ok && stream) {
			this.#micMediaStream = stream;
			this.#micStreamId = streamId;
		} else {
			this.#micStreamId = null;
			this.#micMediaStream = null;
			if (!ok || !stream) {
				console.warn("[prepare] no microphone stream");
			}
		}

		this.#syncPublicState();
		this.send(MachineActions.PREPARED);
	}

	/** 2. Ready — idle, then LISTENING. */
	async #enterReady(signal: AbortSignal, myGen: number): Promise<void> {
		console.log("[ready] idle");
		if (!this.#alive(myGen, signal)) return;
		this.send(MachineActions.START_LISTEN);
	}

	/**
	 * 3. Listening — 500ms PCM windows from mic, RMS VAD (`vad.ts`).
	 * 1s accumulated silence (no speech chunk) with non-empty queue → SENDING.
	 */
	async #enterListening(signal: AbortSignal, myGen: number): Promise<void> {
		const stream = this.#micMediaStream;
		const hasLiveMic =
			typeof window !== "undefined" &&
			stream &&
			stream.getAudioTracks().some((t) => t.readyState === "live");

		if (hasLiveMic) {
			await runVadListening(stream, signal, {
				isAlive: () => this.#alive(myGen, signal),
				onSampleRate: (hz) => {
					this.#utteranceCaptureSampleRate = hz;
				},
				onSpeechChunk: (chunk, { rms: rmsVal }) => {
					this.#audioQueue.push(chunk);
					this.#syncPublicState();
					console.log(
						"[listen] speech rms",
						rmsVal.toFixed(4),
						"→ queue len",
						this.#audioQueue.length,
					);
				},
				hasQueuedUtterance: () => this.#audioQueue.length > 0,
				onEndTurn: () => {
					this.send(MachineActions.END_LISTENING_TURN);
				},
			});
		} else {
			console.warn(
				"[listen] no live microphone track; ending turn with empty capture",
			);
			if (this.#alive(myGen, signal)) {
				this.send(MachineActions.END_LISTENING_TURN);
			}
		}
	}

	/** 4. Sending — drain `#audioQueue`, then WAITING_RESPONSE. */
	async #enterSending(signal: AbortSignal, myGen: number): Promise<void> {
		this.#capturedUtteranceChunks = [...this.#audioQueue];
		const snapshot = [...this.#audioQueue];
		console.log(
			"[sending] upload",
			snapshot.map((c) => c.length),
		);
		while (this.#audioQueue.length > 0) {
			const chunk = this.#audioQueue.shift()!;
			this.#syncPublicState();
			if (!this.#alive(myGen, signal)) return;
			console.log("[sending] sent float32 len", chunk.length);
		}
		if (!this.#alive(myGen, signal)) return;
		this.send(MachineActions.UPLOAD_DONE);
	}

	/**
	 * 5. Waiting response — Whisper STT → transcript in history → Gemma text reply
	 * streamed into `#responseQueue`, then PLAY_RESPONSE.
	 */
	async #enterWaitingResponse(
		signal: AbortSignal,
		myGen: number,
	): Promise<void> {
		this.#responseQueue = [];
		this.#syncPublicState();

		const chunks = this.#capturedUtteranceChunks;
		const rawMono = concatFloatChunks(chunks);
		const fromSr = this.#utteranceCaptureSampleRate || 48000;
		const targetSr = 16000;

		let mono =
			rawMono.length > 0 && fromSr !== targetSr
				? resampleLinear(rawMono, fromSr, targetSr)
				: rawMono;

		const hasAudio = mono.length > 0;
		if (hasAudio) normaliseAudio(mono);

		const tokenizer = this.#processor?.tokenizer;
		if (!this.#llm || !this.#processor || !tokenizer) {
			console.warn("[wait response] model not ready");
			this.#capturedUtteranceChunks = [];
			this.send(MachineActions.RESPONSE_STREAM_DONE);
			return;
		}

		console.log(this.#messages)

		let transcript = "";
		if (hasAudio && this.#stt) {
			transcript = await transcribeUtterance(this.#stt, mono);
		}

		const runReply = async (messages: ChatMessage[]) => {
			await streamAssistantReply(
				this.#processor!,
				this.#llm!,
				tokenizer,
				messages,
				signal,
				() => this.#alive(myGen, signal),
				(text) => {
					this.#responseQueue.push(text);
					this.#syncPublicState();
				},
			);
		};

		if (transcript) {
			this.#messages.push({ role: "user", content: transcript });
			this.#syncPublicState();
			console.log("[wait response] transcript →", JSON.stringify(transcript));

			await runReply([...this.#messages]);

			this.#messages.push({
				role: "assistant",
				content: this.#responseQueue.join("").trim(),
			});
			this.#syncPublicState();
		} else {
			const userContent = hasAudio
				? "Speech was captured but could not be transcribed (STT missing or failed). Reply in one short sentence asking me to try again."
				: "No speech was captured in the last turn. Reply in one short sentence asking me to repeat, a bit louder or closer to the microphone.";

			this.#messages.push({ role: "user", content: userContent });
			this.#syncPublicState();
			await runReply([...this.#messages]);

			this.#messages.push({
				role: "assistant",
				content: this.#responseQueue.join("").trim(),
			});
			this.#syncPublicState();
		}

		this.#capturedUtteranceChunks = [];
		this.send(MachineActions.RESPONSE_STREAM_DONE);
	}

	/**
	 * 6. Play responses — TTS from `#responseQueue`, expose transcript + captureStream for UI.
	 * INTERRUPT_PLAYBACK / SHUTDOWN abort via `signal` (pauses audio, clears playback snapshot).
	 */
	async #enterPlayResponse(signal: AbortSignal, myGen: number): Promise<void> {
		const line = this.#responseQueue.join("").trim();
		this.#responseQueue = [];
		this.#playbackTranscript = line;
		this.#playbackMediaStream = null;
		this.#syncPublicState();

		const hooks = {
			setPlaybackTranscript: (t: string | null) => {
				this.#playbackTranscript = t;
			},
			setPlaybackMediaStream: (s: MediaStream | null) => {
				this.#playbackMediaStream = s;
			},
			syncPublicState: () => this.#syncPublicState(),
		};

		if (!this.#tts || !line) {
			this.#playbackTranscript = null;
			this.#playbackMediaStream = null;
			this.#syncPublicState();
			return;
		}

		await playTtsLine(
			this.#tts,
			line,
			signal,
			hooks,
			() => this.#alive(myGen, signal),
		);

		if (!this.#alive(myGen, signal)) return;
		this.send(MachineActions.PLAYBACK_DONE);
	}

	/** 7. Closing — release mic and queues, then CLOSED. */
	async #enterClosing(signal: AbortSignal, myGen: number): Promise<void> {
		console.log("[closing] draining queues / releasing mic");
		if (!this.#alive(myGen, signal)) return;
		this.#audioQueue = [];
		this.#responseQueue = [];
		this.#micMediaStream?.getTracks().forEach((t) => t.stop());
		this.#micMediaStream = null;
		this.#micStreamId = null;
		this.#playbackTranscript = null;
		this.#playbackMediaStream = null;
		this.#syncPublicState();
		this.send(MachineActions.CLOSED);
	}
}
