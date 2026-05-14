import type { KokoroTTS } from "kokoro-js";
import type { AutomaticSpeechRecognitionPipeline, PreTrainedModel, Processor } from "@huggingface/transformers";
import { defaultConversationMessages } from "./conversation-inference.ts";
import {
	MachineActions,
	MachineStates,
} from "./conversation-agent.types.ts";
import {
	INTERNAL,
	handlerSignal,
	runHandler,
	type AgentContext,
	type AgentEvents,
	type AgentInput,
} from "./conversation-agent.machine-context.ts";
import { conversationAgentActors } from "./conversation-agent.machine-actors.ts";
import { assign, enqueueActions, setup, raise, type SnapshotFrom } from "xstate";

export const conversationAgentMachine = setup({
	types: {
		context: {} as AgentContext,
		events: {} as AgentEvents,
		input: {} as AgentInput,
	},
	actors: conversationAgentActors,
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
									  }
									| undefined;
							};
							const next: Partial<AgentContext> = {};
							if (out.models) {
								next.stt = out.models.stt;
								next.processor = out.models.processor;
								next.llm = out.models.llm;
								next.tts = out.models.tts;
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
				input: ({ context }) => ({ stream: context.micMediaStream }),
			},
			on: {
				[INTERNAL.SPEECH_CHUNK]: {
					actions: assign({
						audioQueue: ({ context, event }) =>
							event.type === INTERNAL.SPEECH_CHUNK
								? [...context.audioQueue, Float32Array.from(event.chunk)]
								: context.audioQueue,
					}),
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
				input: ({ context }) => ({ micMediaStream: context.micMediaStream }),
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

export type ConversationAgentMachineSnapshot = SnapshotFrom<typeof conversationAgentMachine>;
