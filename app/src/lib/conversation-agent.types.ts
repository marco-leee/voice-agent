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
