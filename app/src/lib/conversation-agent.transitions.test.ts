import { describe, expect, it, vi } from "vitest";
import {
	CONVERSATION_AGENT_TRANSITIONS,
	resolveConversationAgentTransition,
} from "./conversation-agent.transitions.ts";
import { MachineActions, MachineStates } from "./conversation-agent.types.ts";
import type { MachineAction, MachineState } from "./conversation-agent.types.ts";

describe("CONVERSATION_AGENT_TRANSITIONS", () => {
	const states = Object.keys(MachineStates) as MachineState[];

	it("defines a row for every machine state", () => {
		for (const s of states) {
			expect(CONVERSATION_AGENT_TRANSITIONS[s]).toBeDefined();
		}
	});

	it("runs the main conversational loop skeleton", () => {
		expect(
			resolveConversationAgentTransition(MachineStates.CLOSED, MachineActions.BOOT, true),
		).toBe(MachineStates.INIT);
		expect(
			resolveConversationAgentTransition(MachineStates.INIT, MachineActions.BOOT, true),
		).toBe(MachineStates.PREPARING);
		expect(
			resolveConversationAgentTransition(
				MachineStates.PREPARING,
				MachineActions.PREPARED,
				true,
			),
		).toBe(MachineStates.READY);
		expect(
			resolveConversationAgentTransition(
				MachineStates.READY,
				MachineActions.START_LISTEN,
				true,
			),
		).toBe(MachineStates.LISTENING);
		expect(
			resolveConversationAgentTransition(
				MachineStates.LISTENING,
				MachineActions.END_LISTENING_TURN,
				true,
			),
		).toBe(MachineStates.SENDING);
		expect(
			resolveConversationAgentTransition(
				MachineStates.SENDING,
				MachineActions.UPLOAD_DONE,
				true,
			),
		).toBe(MachineStates.WAITING_RESPONSE);
		expect(
			resolveConversationAgentTransition(
				MachineStates.WAITING_RESPONSE,
				MachineActions.RESPONSE_STREAM_DONE,
				true,
			),
		).toBe(MachineStates.PLAY_RESPONSE);
		expect(
			resolveConversationAgentTransition(
				MachineStates.PLAY_RESPONSE,
				MachineActions.PLAYBACK_DONE,
				true,
			),
		).toBe(MachineStates.READY);
	});
});

describe("resolveConversationAgentTransition", () => {
	it("throws in strict mode on invalid transition", () => {
		expect(() =>
			resolveConversationAgentTransition(
				MachineStates.INIT,
				MachineActions.PREPARED as MachineAction,
				true,
			),
		).toThrow(/not a valid step/);
	});

	it("warns and returns undefined when not strict", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(
			resolveConversationAgentTransition(
				MachineStates.INIT,
				MachineActions.PREPARED as MachineAction,
				false,
			),
		).toBeUndefined();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
