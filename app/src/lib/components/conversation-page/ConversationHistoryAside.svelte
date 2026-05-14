<script lang="ts">
	import type { ConversationAgent } from "$lib/conversation-agent.machine-facade";
	import type { ConversationAgentState } from "$lib/conversation-agent.types";
	import { Button } from "$lib/components/ui/button";

	type Props = {
		agentState: ConversationAgentState;
		agent: ConversationAgent;
	};

	let { agentState, agent }: Props = $props();
</script>

<aside
	class="border-border bg-card text-card-foreground hidden h-full min-h-0 w-[256px] shrink-0 flex-col overflow-hidden md:flex"
	aria-label="Conversation history"
>
	<div
		class="border-border flex min-h-20 shrink-0 flex-col justify-center gap-0.5  px-4 py-3 md:px-6"
	>
		<h2 class="font-[family-name:'Raleway'] text-lg font-medium leading-tight tracking-tight text-[#78716c]">
			History
		</h2>
	</div>

	<div class="flex min-h-0 flex-1 flex-col">
		<div
			class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-4 py-4 md:px-6"
			role="region"
			aria-label="Message list"
		>
			{#if agentState.systemPrompt}
				<div class="mb-4 min-w-0">
					<div
						class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase"
					>
						System
					</div>
					<div
						class="border-border bg-secondary text-foreground rounded-[4px] border px-3 py-2 text-[12px] leading-snug break-words whitespace-pre-wrap"
					>
						{agentState.systemPrompt}
					</div>
				</div>
			{/if}

			{#if agentState.chatHistory.length === 0}
				<p class="text-muted-foreground m-0 text-[13px] leading-relaxed">
					No user or assistant messages yet. Speak after booting and ending a listening turn to see
					turns here.
				</p>
			{:else}
				<ul class="m-0 flex list-none flex-col gap-4 p-0">
					{#each agentState.chatHistory as turn, i (i)}
						<li class="min-w-0">
							<div
								class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase"
							>
								{turn.role === "user" ? "You" : "Assistant"}
							</div>
							<div
								class="border-border bg-background text-foreground rounded-[4px] border px-3 py-2 text-[13px] leading-snug break-words whitespace-pre-wrap"
							>
								{turn.content}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="border-border flex min-h-[4.25rem] shrink-0 items-center  px-4 py-3 md:px-6">
			<Button
				type="button"
				variant="outline"
				class="h-10 w-full rounded-[4px] text-sm"
				onclick={() => agent.clearChatHistory()}
			>
				Clear history
			</Button>
		</div>
	</div>
</aside>
