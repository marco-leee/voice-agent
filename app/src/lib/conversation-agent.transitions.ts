import {
	MachineActions,
	type MachineAction,
	type MachineState,
	MachineStates,
} from "./conversation-agent.types.ts";

export type ConversationAgentTransitionTable = {
	[S in MachineState]: Partial<Record<MachineAction, MachineState>>;
};

export const CONVERSATION_AGENT_TRANSITIONS: ConversationAgentTransitionTable =
	{
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

export function resolveConversationAgentTransition(
	state: MachineState,
	action: MachineAction,
	strict: boolean,
): MachineState | undefined {
	const next = CONVERSATION_AGENT_TRANSITIONS[state][action];
	if (!next) {
		const msg = `Action ${action} is not a valid step from state ${state}`;
		if (strict) throw new Error(msg);
		console.warn(msg);
		return undefined;
	}
	return next;
}
