/**
 * XState v5 conversation agent (additive module — legacy `ConversationAgent` unchanged).
 */

import { defaultActionHandlers } from "./client.agent.handlers.ts";
import {
	MachineActions,
	type ActionHandlers,
	type MachineAction,
	type MachineState,
	MachineStates,
	type ActionHandlerContext,
} from "./conversation-agent.types.ts";
import type { ConversationAgentState } from "./client.agent.ts";
import type { KokoroTTS } from "kokoro-js";
import type {
	AutomaticSpeechRecognitionPipeline,
	PreTrainedModel,
	Processor,
} from "@huggingface/transformers";
import { concatFloatChunks, normaliseAudio, resampleLinear } from "./audio.ts";
import { runListenOrchestrator } from "./listen-audio-orchestrator.ts";
import {
	disposeListenEngines,
	prepareVoiceStack,
} from "./voice-models.ts";
import type { ListenEngines } from "./listen-audio-orchestrator.types.ts";
import { playTtsLine } from "./tts-playback.ts";
import {
	transcribeUtterance,
	streamAssistantReply,
	type ChatMessage,
	defaultConversationMessages,
} from "./conversation-inference.ts";
import {
	assign,
	createActor,
	fromCallback,
	fromPromise,
	getNextTransitions,
	setup,
	raise,
	enqueueActions,
	type Actor,
	type SnapshotFrom,
} from "xstate";

const INTERNAL = {
	COMMIT_LISTENING_TURN: "internal.commitListeningTurn",
	CAPTURE_SAMPLE_RATE: "internal.captureSampleRate",
	RESPONSE_TEXT_CHUNK: "internal.responseTextChunk",
	WAIT_RESPONSE_DONE: "internal.waitResponseDone",
	PLAYBACK_SYNC: "internal.playbackSync",
	PLAY_RESPONSE_DONE: "internal.playResponseDone",
	CLEAR_CHAT_HISTORY: "CLEAR_CHAT_HISTORY",
} as const;

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



type AgentContext = {
	gen: number;
	active: AbortController | null;
	resumedFromClosed: boolean;
	micStreamId: string | null;
	micMediaStream: MediaStream | null;
	audioQueue: Float32Array[];
	capturedUtteranceChunks: Float32Array[];
	utteranceCaptureSampleRate: number;
	responseQueue: string[];
	playbackTranscript: string | null;
	playbackMediaStream: MediaStream | null;
	messages: ChatMessage[];
	handlers: ActionHandlers;
	stt: AutomaticSpeechRecognitionPipeline | null;
	processor: Processor | null;
	llm: PreTrainedModel | null;
	tts: KokoroTTS | null;
	listen: ListenEngines | null;
};

type AgentInput = {
	handlers: ActionHandlers;
};

type AgentEvents =
	| { type: MachineAction }
	| {
			type: typeof INTERNAL.COMMIT_LISTENING_TURN;
			pcm: Float32Array;
	  }
	| { type: typeof INTERNAL.CAPTURE_SAMPLE_RATE; hz: number }
	| { type: typeof INTERNAL.RESPONSE_TEXT_CHUNK; text: string }
	| {
			type: typeof INTERNAL.WAIT_RESPONSE_DONE;
			messages: ChatMessage[];
	  }
	| {
			type: typeof INTERNAL.PLAYBACK_SYNC;
			transcript: string | null;
			stream: MediaStream | null;
	  }
	| { type: typeof INTERNAL.PLAY_RESPONSE_DONE }
	| { type: typeof INTERNAL.CLEAR_CHAT_HISTORY };

function runHandler(
	handlers: ActionHandlers,
	action: MachineAction,
	from: MachineState,
	to: MachineState,
	signal: AbortSignal,
): void {
	const ctx: ActionHandlerContext = { from, to, action, signal };
	try {
		void Promise.resolve(handlers[action](ctx)).catch((err) =>
			console.error("[action handler error]", action, err),
		);
	} catch (err) {
		console.error("[action handler error]", action, err);
	}
}

function handlerSignal(context: AgentContext): AbortSignal {
	return context.active?.signal ?? new AbortController().signal;
}

export const conversationAgentMachine = setup({
	types: {
		context: {} as AgentContext,
		events: {} as AgentEvents,
		input: {} as AgentInput,
	},
	actors: {
		prepareVoice: fromPromise(
			async ({
				input,
				signal,
			}: {
				input: AgentContext;
				signal: AbortSignal;
			}) => {
				console.log("[prepare] checking microphone permission…");
				const { ok, stream, streamId, models } = await prepareVoiceStack(
					signal,
					() => !signal.aborted,
				);
				return { ok, stream, streamId, models };
			},
		),
		vadListen: fromCallback(({ sendBack, input }) => {
			const ac = new AbortController();
			const { signal } = ac;
			const inp = input as {
				stream: MediaStream | null;
				listen: ListenEngines | null;
			} | null;
			const stream = inp?.stream ?? null;
			const listen = inp?.listen ?? null;

			void (async () => {
				try {
					const hasLiveMic =
						typeof window !== "undefined" &&
						stream &&
						stream.getAudioTracks().some((t) => t.readyState === "live");

					if (!hasLiveMic) {
						console.warn(
							"[listen] no live microphone track; ending turn with empty capture",
						);
						sendBack({
							type: INTERNAL.COMMIT_LISTENING_TURN,
							pcm: new Float32Array(0),
						});
						return;
					}

					await runListenOrchestrator(stream!, signal, listen, {
						isAlive: () => !signal.aborted,
						onSampleRate: (hz) =>
							sendBack({ type: INTERNAL.CAPTURE_SAMPLE_RATE, hz }),
						onRelease: (pcm, reason) => {
							if (import.meta.env.DEV) {
								console.log(
									"[listen] release",
									reason,
									"samples",
									pcm.length,
								);
							}
							sendBack({
								type: INTERNAL.COMMIT_LISTENING_TURN,
								pcm: Float32Array.from(pcm),
							});
						},
					});
				} catch (e) {
					console.error("[listen orchestrator]", e);
				}
			})();

			return () => ac.abort();
		}),
		drainUpload: fromPromise(
			async ({
				input,
				signal,
			}: {
				input: { chunks: Float32Array[] };
				signal: AbortSignal;
			}) => {
				console.log(
					"[sending] upload",
					input.chunks.map((c) => c.length),
				);
				for (const chunk of input.chunks) {
					if (signal.aborted) return {};
					console.log("[sending] sent float32 len", chunk.length);
				}
				return {};
			},
		),
		waitResponse: fromCallback(({ sendBack, input }) => {
			const ac = new AbortController();
			const { signal } = ac;
			const inp = input as {
				capturedUtteranceChunks: Float32Array[];
				utteranceCaptureSampleRate: number;
				messages: ChatMessage[];
				stt: AutomaticSpeechRecognitionPipeline | null;
				processor: Processor | null;
				llm: PreTrainedModel | null;
			};

			void (async () => {
				let messages = [...inp.messages];
				try {
					const chunks = inp.capturedUtteranceChunks;
					const utteranceCaptureSampleRate = inp.utteranceCaptureSampleRate;
					const stt = inp.stt;
					const processor = inp.processor;
					const llm = inp.llm;

					const rawMono = concatFloatChunks(chunks);
					const fromSr = utteranceCaptureSampleRate || 48_000;
					const targetSr = 16_000;

					let mono =
						rawMono.length > 0 && fromSr !== targetSr
							? resampleLinear(rawMono, fromSr, targetSr)
							: rawMono;

					const hasAudio = mono.length > 0;
					if (hasAudio) normaliseAudio(mono);

					const tokenizer = processor?.tokenizer;
					if (!llm || !processor || !tokenizer) {
						console.warn("[wait response] model not ready");
						sendBack({
							type: INTERNAL.WAIT_RESPONSE_DONE,
							messages,
						});
						return;
					}

					console.log(messages);

					let transcript = "";
					if (hasAudio && stt) {
						transcript = await transcribeUtterance(stt, mono);
					}

					const runReply = async (msgs: ChatMessage[]) => {
						let accum = "";
						await streamAssistantReply(
							processor,
							llm,
							tokenizer,
							msgs,
							signal,
							() => !signal.aborted,
							(text) => {
								accum += text;
								sendBack({ type: INTERNAL.RESPONSE_TEXT_CHUNK, text });
							},
						);
						return accum.trim();
					};

					if (transcript) {
						messages = [...messages, { role: "user", content: transcript }];
						console.log(
							"[wait response] transcript →",
							JSON.stringify(transcript),
						);
						const assistantContent = await runReply([...messages]);
						messages = [
							...messages,
							{ role: "assistant", content: assistantContent },
						];
					} else {
						const userContent = hasAudio
							? "Speech was captured but could not be transcribed (STT missing or failed). Reply in one short sentence asking me to try again."
							: "No speech was captured in the last turn. Reply in one short sentence asking me to repeat, a bit louder or closer to the microphone.";
						messages = [...messages, { role: "user", content: userContent }];
						const assistantContent = await runReply([...messages]);
						messages = [
							...messages,
							{ role: "assistant", content: assistantContent },
						];
					}

					sendBack({ type: INTERNAL.WAIT_RESPONSE_DONE, messages });
				} catch (e) {
					console.error("[wait response]", e);
					sendBack({ type: INTERNAL.WAIT_RESPONSE_DONE, messages });
				}
			})();

			return () => ac.abort();
		}),
		playResponse: fromCallback(({ sendBack, input }) => {
			const ac = new AbortController();
			const { signal } = ac;
			const { line, tts } = input as {
				line: string;
				tts: KokoroTTS | null;
			};

			void (async () => {
				sendBack({
					type: INTERNAL.PLAYBACK_SYNC,
					transcript: line || null,
					stream: null,
				});

				if (!tts || !line) {
					sendBack({
						type: INTERNAL.PLAYBACK_SYNC,
						transcript: null,
						stream: null,
					});
					sendBack({ type: INTERNAL.PLAY_RESPONSE_DONE });
					return;
				}

				await playTtsLine(
					tts,
					line,
					signal,
					{
						setPlaybackTranscript: (t) =>
							sendBack({
								type: INTERNAL.PLAYBACK_SYNC,
								transcript: t,
								stream: null,
							}),
						setPlaybackMediaStream: (s) =>
							sendBack({
								type: INTERNAL.PLAYBACK_SYNC,
								transcript: line,
								stream: s,
							}),
						syncPublicState: () => {},
					},
					() => !signal.aborted,
				);

				if (!signal.aborted) {
					sendBack({ type: INTERNAL.PLAY_RESPONSE_DONE });
				}
			})();

			return () => ac.abort();
		}),
		closeActor: fromPromise(
			async ({
				input,
				signal,
			}: {
				input: {
					micMediaStream: MediaStream | null;
					listen: ListenEngines | null;
				};
				signal: AbortSignal;
			}) => {
				if (signal.aborted) return {};
				console.log("[closing] draining queues / releasing mic");
				input.micMediaStream?.getTracks().forEach((t) => t.stop());
				await disposeListenEngines(input.listen);
				return {};
			},
		),
	},
	actions: {
		bumpGenRotateAbort: enqueueActions(({ enqueue, context }) => {
			const prev = context.active;
			enqueue(
				assign({
					gen: ({ context: c }) => c.gen + 1,
					active: () => new AbortController(),
				}),
			);
			prev?.abort();
		}),
	},
}).createMachine({
	id: "conversationAgent",
	initial: MachineStates.INIT,
	context: ({ input }) => ({
		gen: 0,
		active: null,
		resumedFromClosed: false,
		micStreamId: null,
		micMediaStream: null,
		audioQueue: [],
		capturedUtteranceChunks: [],
		utteranceCaptureSampleRate: 48_000,
		responseQueue: [],
		playbackTranscript: null,
		playbackMediaStream: null,
		messages: defaultConversationMessages(),
		handlers: input.handlers,
		stt: null,
		processor: null,
		llm: null,
		tts: null,
		listen: null,
	}),
	on: {
		[INTERNAL.CLEAR_CHAT_HISTORY]: {
			actions: assign({
				messages: () => defaultConversationMessages(),
			}),
		},
	},
	states: {
		[MachineStates.INIT]: {
			entry: enqueueActions(({ enqueue, context }) => {
				if (context.resumedFromClosed) {
					enqueue(assign({ resumedFromClosed: false }));
					enqueue(raise({ type: MachineActions.BOOT }));
				}
			}),
			on: {
				[MachineActions.BOOT]: {
					target: MachineStates.PREPARING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.BOOT,
								MachineStates.INIT,
								MachineStates.PREPARING,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.PREPARING]: {
			invoke: {
				src: "prepareVoice",
				input: ({ context }) => context,
				onDone: {
					target: MachineStates.READY,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign(({ event }) => {
							const out = event.output as {
								ok: boolean;
								stream: MediaStream | null | undefined;
								streamId: string | null | undefined;
								models:
									| {
											stt: AutomaticSpeechRecognitionPipeline;
											processor: Processor;
											llm: PreTrainedModel;
											tts: KokoroTTS;
											listen: ListenEngines | null;
									  }
									| undefined;
							};
							const next: Partial<AgentContext> = {};
							if (out.models) {
								next.stt = out.models.stt;
								next.processor = out.models.processor;
								next.llm = out.models.llm;
								next.tts = out.models.tts;
								next.listen = out.models.listen;
							}
							if (out.ok && out.stream) {
								next.micMediaStream = out.stream;
								next.micStreamId = out.streamId ?? null;
							} else {
								next.micStreamId = null;
								next.micMediaStream = null;
								if (!out.ok || !out.stream) {
									console.warn("[prepare] no microphone stream");
								}
							}
							return next;
						}),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.PREPARED,
								MachineStates.PREPARING,
								MachineStates.READY,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.READY]: {
			entry: raise({ type: MachineActions.START_LISTEN }),
			on: {
				[MachineActions.START_LISTEN]: {
					target: MachineStates.LISTENING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.START_LISTEN,
								MachineStates.READY,
								MachineStates.LISTENING,
								handlerSignal(context),
							),
					],
				},
				[MachineActions.SHUTDOWN]: {
					target: MachineStates.CLOSING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.SHUTDOWN,
								MachineStates.READY,
								MachineStates.CLOSING,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.LISTENING]: {
			invoke: {
				src: "vadListen",
				input: ({ context }) => ({
					stream: context.micMediaStream,
					listen: context.listen,
				}),
			},
			on: {
				[INTERNAL.COMMIT_LISTENING_TURN]: {
					target: MachineStates.SENDING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign({
							audioQueue: ({ event }) =>
								event.type === INTERNAL.COMMIT_LISTENING_TURN
									? [Float32Array.from(event.pcm)]
									: [],
						}),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.END_LISTENING_TURN,
								MachineStates.LISTENING,
								MachineStates.SENDING,
								handlerSignal(context),
							),
					],
				},
				[INTERNAL.CAPTURE_SAMPLE_RATE]: {
					actions: assign({
						utteranceCaptureSampleRate: ({ event }) =>
							event.type === INTERNAL.CAPTURE_SAMPLE_RATE ? event.hz : 48_000,
					}),
				},
				[MachineActions.END_LISTENING_TURN]: {
					target: MachineStates.SENDING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.END_LISTENING_TURN,
								MachineStates.LISTENING,
								MachineStates.SENDING,
								handlerSignal(context),
							),
					],
				},
				[MachineActions.SHUTDOWN]: {
					target: MachineStates.CLOSING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.SHUTDOWN,
								MachineStates.LISTENING,
								MachineStates.CLOSING,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.SENDING]: {
			entry: assign({
				capturedUtteranceChunks: ({ context }) =>
					context.audioQueue.map((c) => Float32Array.from(c)),
			}),
			invoke: {
				src: "drainUpload",
				input: ({ context }) => ({
					chunks: context.audioQueue.map((c) => Float32Array.from(c)),
				}),
				onDone: {
					target: MachineStates.WAITING_RESPONSE,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign({ audioQueue: () => [] }),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.UPLOAD_DONE,
								MachineStates.SENDING,
								MachineStates.WAITING_RESPONSE,
								handlerSignal(context),
							),
					],
				},
			},
			on: {
				[MachineActions.SHUTDOWN]: {
					target: MachineStates.CLOSING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.SHUTDOWN,
								MachineStates.SENDING,
								MachineStates.CLOSING,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.WAITING_RESPONSE]: {
			entry: assign({ responseQueue: () => [] }),
			invoke: {
				src: "waitResponse",
				input: ({ context }) => ({
					capturedUtteranceChunks: context.capturedUtteranceChunks.map((c) =>
						Float32Array.from(c),
					),
					utteranceCaptureSampleRate: context.utteranceCaptureSampleRate,
					messages: [...context.messages],
					stt: context.stt,
					processor: context.processor,
					llm: context.llm,
				}),
			},
			on: {
				[INTERNAL.RESPONSE_TEXT_CHUNK]: {
					actions: assign({
						responseQueue: ({ context, event }) =>
							event.type === INTERNAL.RESPONSE_TEXT_CHUNK
								? [...context.responseQueue, event.text]
								: context.responseQueue,
					}),
				},
				[INTERNAL.WAIT_RESPONSE_DONE]: {
					target: MachineStates.PLAY_RESPONSE,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign(({ event }) => {
							if (event.type !== INTERNAL.WAIT_RESPONSE_DONE) return {};
							return {
								messages: event.messages,
								capturedUtteranceChunks: [],
							};
						}),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.RESPONSE_STREAM_DONE,
								MachineStates.WAITING_RESPONSE,
								MachineStates.PLAY_RESPONSE,
								handlerSignal(context),
							),
					],
				},
				[MachineActions.SHUTDOWN]: {
					target: MachineStates.CLOSING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.SHUTDOWN,
								MachineStates.WAITING_RESPONSE,
								MachineStates.CLOSING,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.PLAY_RESPONSE]: {
			entry: assign(({ context }) => {
				const line = context.responseQueue.join("").trim();
				return {
					playbackTranscript: line || null,
					playbackMediaStream: null,
					responseQueue: [],
				};
			}),
			invoke: {
				src: "playResponse",
				input: ({ context }) => ({
					line: context.playbackTranscript ?? "",
					tts: context.tts,
				}),
			},
			on: {
				[INTERNAL.PLAYBACK_SYNC]: {
					actions: assign({
						playbackTranscript: ({ event }) =>
							event.type === INTERNAL.PLAYBACK_SYNC ? event.transcript : null,
						playbackMediaStream: ({ event }) =>
							event.type === INTERNAL.PLAYBACK_SYNC ? event.stream : null,
					}),
				},
				[INTERNAL.PLAY_RESPONSE_DONE]: {
					target: MachineStates.READY,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign({
							playbackTranscript: () => null,
							playbackMediaStream: () => null,
						}),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.PLAYBACK_DONE,
								MachineStates.PLAY_RESPONSE,
								MachineStates.READY,
								handlerSignal(context),
							),
					],
				},
				[MachineActions.INTERRUPT_PLAYBACK]: {
					target: MachineStates.LISTENING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign({
							playbackTranscript: () => null,
							playbackMediaStream: () => null,
						}),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.INTERRUPT_PLAYBACK,
								MachineStates.PLAY_RESPONSE,
								MachineStates.LISTENING,
								handlerSignal(context),
							),
					],
				},
				[MachineActions.SHUTDOWN]: {
					target: MachineStates.CLOSING,
					actions: [
						{ type: "bumpGenRotateAbort" },
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.SHUTDOWN,
								MachineStates.PLAY_RESPONSE,
								MachineStates.CLOSING,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.CLOSING]: {
			invoke: {
				src: "closeActor",
				input: ({ context }) => ({
					micMediaStream: context.micMediaStream,
					listen: context.listen,
				}),
				onDone: {
					target: MachineStates.CLOSED,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign({
							audioQueue: () => [],
							responseQueue: () => [],
							micMediaStream: () => null,
							micStreamId: () => null,
							playbackTranscript: () => null,
							playbackMediaStream: () => null,
							listen: () => null,
						}),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.CLOSED,
								MachineStates.CLOSING,
								MachineStates.CLOSED,
								handlerSignal(context),
							),
					],
				},
			},
		},
		[MachineStates.CLOSED]: {
			entry: () => console.log("[closed] terminal"),
			on: {
				[MachineActions.BOOT]: {
					target: MachineStates.INIT,
					actions: [
						{ type: "bumpGenRotateAbort" },
						assign({ resumedFromClosed: true }),
						({ context }) =>
							runHandler(
								context.handlers,
								MachineActions.BOOT,
								MachineStates.CLOSED,
								MachineStates.INIT,
								handlerSignal(context),
							),
					],
				},
			},
		},
	},
});

export type ConversationAgentMachineSnapshot = SnapshotFrom<
	typeof conversationAgentMachine
>;

export class ConversationAgent {
	readonly #strict: boolean;
	readonly #handlers: ActionHandlers;
	#actor: Actor<typeof conversationAgentMachine>;
	#publicSnapshot: ConversationAgentState | null = null;
	#unsubscribe: (() => void) | null = null;

	constructor(opts: {
		strict: boolean;
		actionHandlers?: Partial<ActionHandlers>;
		publicState?: ConversationAgentState;
	}) {
		this.#strict = opts.strict;
		this.#handlers = {
			...ConversationAgent.defaultActionHandlers(),
			...opts.actionHandlers,
		};
		this.#actor = createActor(conversationAgentMachine, {
			input: { handlers: this.#handlers },
		});
		this.#publicSnapshot = opts.publicState ?? null;
		const sub = this.#actor.subscribe(() => this.#syncPublicState());
		this.#unsubscribe = () => sub.unsubscribe();
		this.#actor.start();
		this.#syncPublicState();
	}

	bindPublicState(snapshot: ConversationAgentState): void {
		this.#publicSnapshot = snapshot;
		this.#syncPublicState();
	}

	#getMachineState(): MachineState {
		const v = this.#actor.getSnapshot().value;
		return typeof v === "string" ? v : MachineStates.INIT;
	}

	#syncPublicState(): void {
		const s = this.#publicSnapshot;
		if (!s) return;
		const snap = this.#actor.getSnapshot();
		const c = snap.context;
		s.state = this.#getMachineState();
		s.gen = c.gen;
		s.active = c.active;
		s.micStreamId = c.micStreamId;
		s.micMediaStream = c.micMediaStream;
		s.audioQueue = c.audioQueue.map((chunk) => Float32Array.from(chunk));
		s.responseQueue = [...c.responseQueue];
		s.playbackTranscript = c.playbackTranscript;
		s.playbackMediaStream = c.playbackMediaStream;
		s.chatHistory = c.messages
			.filter(
				(m): m is ChatMessage & { role: "user" | "assistant" } =>
					m.role !== "system",
			)
			.map((m) => ({ role: m.role, content: m.content }));
		s.systemPrompt = c.messages.find((m) => m.role === "system")?.content ?? "";
	}

	clearChatHistory(): void {
		this.#actor.send({ type: INTERNAL.CLEAR_CHAT_HISTORY });
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
		const snap = this.#actor.getSnapshot();
		const allowed = getNextTransitions(snap).some(
			(t) => t.eventType === action,
		);
		if (!allowed) {
			const msg = `Action ${action} is not a valid step from state ${String(snap.value)}`;
			if (this.#strict) throw new Error(msg);
			console.warn(msg, { state: snap.value, action });
			return;
		}

		const from = this.#getMachineState();
		const next = ConversationAgent.getNextState(from, action, this.#strict);
		if (!next) return;

		console.log("[transition]", { from, action, to: next });

		this.#actor.send({ type: action });
		this.#syncPublicState();
	}

	/** Stop subscription (e.g. tests). */
	dispose(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#actor.stop();
	}
}
