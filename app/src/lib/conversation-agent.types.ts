export enum MachineStates {
	INIT = "INIT",
	PREPARING = "PREPARING",
	READY = "READY",
	LISTENING = "LISTENING",
	SENDING = "SENDING",
	WAITING_RESPONSE = "WAITING_RESPONSE",
	PLAY_RESPONSE = "PLAY_RESPONSE",
	CLOSING = "CLOSING",
	CLOSED = "CLOSED",
}

export enum MachineActions {
	BOOT = "BOOT",
	PREPARED = "PREPARED",
	START_LISTEN = "START_LISTEN",
	/** 1s silence after last speech with non-empty audio queue → SENDING */
	END_LISTENING_TURN = "END_LISTENING_TURN",
	UPLOAD_DONE = "UPLOAD_DONE",
	RESPONSE_STREAM_DONE = "RESPONSE_STREAM_DONE",
	PLAYBACK_DONE = "PLAYBACK_DONE",
	/** User speaks during playback → LISTENING */
	INTERRUPT_PLAYBACK = "INTERRUPT_PLAYBACK",
	SHUTDOWN = "SHUTDOWN",
	CLOSED = "CLOSED",
}

export type MachineState = keyof typeof MachineStates;
export type MachineAction = keyof typeof MachineActions;

/** Fired after a valid transition is committed; `signal` is the one for the new state's work. */
export type ActionHandlerContext = {
	from: MachineState;
	to: MachineState;
	action: MachineAction;
	signal: AbortSignal;
};

export type ActionHandler = (
	ctx: ActionHandlerContext,
) => void | Promise<void>;

export type ActionHandlers = Record<MachineAction, ActionHandler>;

/** User-visible chat turns (system prompt excluded). */
export type ChatHistoryEntry = {
	role: "user" | "assistant";
	content: string;
};

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
	/** Conversation turns for UI (mirrors machine messages minus system). */
	chatHistory: ChatHistoryEntry[];
	/** Current system message content (for history panel). */
	systemPrompt: string;
}
