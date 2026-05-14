import { defaultActionHandlers } from "./conversation-agent.handlers.ts";
import {
	type ActionHandlers,
	type MachineAction,
	type MachineState,
	MachineStates,
} from "./conversation-agent.types.ts";
import type { ConversationAgentState } from "./conversation-agent.types.ts";
import { INTERNAL } from "./conversation-agent.machine-context.ts";
import { conversationAgentMachine } from "./conversation-agent.machine.logic.ts";
import type { ChatMessage } from "./conversation-inference.ts";
import { resolveConversationAgentTransition } from "./conversation-agent.transitions.ts";
import { createActor, getNextTransitions, type Actor } from "xstate";

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
		return resolveConversationAgentTransition(state, action, strict);
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
