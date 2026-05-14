import type {
	AutomaticSpeechRecognitionPipeline,
	PreTrainedModel,
	Processor,
} from "@huggingface/transformers";
import type { KokoroTTS } from "kokoro-js";
import type {
	ActionHandlerContext,
	ActionHandlers,
	MachineAction,
	MachineState,
} from "./conversation-agent.types.ts";
import type { ChatMessage } from "./conversation-inference.ts";

export const INTERNAL = {
	SPEECH_CHUNK: "internal.speechChunk",
	CAPTURE_SAMPLE_RATE: "internal.captureSampleRate",
	RESPONSE_TEXT_CHUNK: "internal.responseTextChunk",
	WAIT_RESPONSE_DONE: "internal.waitResponseDone",
	PLAYBACK_SYNC: "internal.playbackSync",
	PLAY_RESPONSE_DONE: "internal.playResponseDone",
	CLEAR_CHAT_HISTORY: "CLEAR_CHAT_HISTORY",
} as const;

export type AgentContext = {
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
};

export type AgentInput = {
	handlers: ActionHandlers;
};

export type AgentEvents =
	| { type: MachineAction }
	| {
			type: typeof INTERNAL.SPEECH_CHUNK;
			chunk: Float32Array;
			rms: number;
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

export function runHandler(
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

export function handlerSignal(context: AgentContext): AbortSignal {
	return context.active?.signal ?? new AbortController().signal;
}
