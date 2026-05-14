/**
 * Conversation agent — XState v5 actor and UI facade barrel.
 */

export {
	conversationAgentMachine,
	type ConversationAgentMachineSnapshot,
} from "./conversation-agent.machine.logic.ts";
export { ConversationAgent } from "./conversation-agent.machine-facade.ts";
