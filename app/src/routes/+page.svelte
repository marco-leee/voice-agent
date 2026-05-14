<script lang="ts">
	import ConversationDisplayAside from "$lib/components/conversation-page/ConversationDisplayAside.svelte";
	import ConversationHistoryAside from "$lib/components/conversation-page/ConversationHistoryAside.svelte";
	import ConversationMainPanel from "$lib/components/conversation-page/ConversationMainPanel.svelte";
	import {
		ConversationAgent,
		type ConversationAgentState,
		MachineStates,
	} from "$lib";

	const agentState: ConversationAgentState = $state({
		state: MachineStates.INIT,
		gen: 0,
		active: null,
		micStreamId: null,
		micMediaStream: null,
		audioQueue: [] as Float32Array[],
		responseQueue: [],
		playbackTranscript: null,
		playbackMediaStream: null,
		chatHistory: [],
		systemPrompt: "",
	});

	const agent = new ConversationAgent({ strict: true, publicState: agentState });
</script>

<div
	class="bg-background text-foreground flex h-[100dvh] min-h-0 flex-row overflow-hidden"
>
	<ConversationDisplayAside />

	<ConversationMainPanel {agentState} {agent} />

	<ConversationHistoryAside {agentState} {agent} />
</div>
