<script lang="ts">
	import AudioFrequencyVisualizer from "$lib/AudioFrequencyVisualizer.svelte";
	import type { ConversationAgent } from "$lib/conversation-agent.machine-facade";
	import type { ConversationAgentState } from "$lib/conversation-agent.types";
	import { MachineActions, MachineStates } from "$lib";
	import { Button } from "$lib/components/ui/button";

	type Props = {
		agentState: ConversationAgentState;
		agent: ConversationAgent;
	};

	let { agentState, agent }: Props = $props();
</script>

<main class="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
	<header
		class="border-border flex min-h-20 shrink-0 items-center px-4 py-3 md:px-6"
	>
		<h1 class="font-[family-name:'Raleway'] text-xl font-light tracking-tight text-[#78716c] md:text-2xl">
			Conversation agent (Shall take a moment to load for the first time. A pictogram will appear when ready.)
		</h1>
	</header>

	<div class="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 py-6 md:px-6">
		<section class="min-w-0" aria-label="User microphone spectrum">
			<h2
				class="font-[family-name:'Raleway'] text-muted-foreground mb-3 text-lg font-light tracking-tight"
			>
				User speech
			</h2>
			<AudioFrequencyVisualizer
				mediaStream={agentState.micMediaStream}
				idleHint="Mic spectrum appears after Boot when the stream is live."
			/>
		</section>

		<section class="min-w-0 gap-4" aria-label="Assistant reply playback">
			<h2
				class="font-[family-name:'Raleway'] text-muted-foreground mb-3 text-lg font-light tracking-tight"
			>
				Response playback
			</h2>
			<AudioFrequencyVisualizer
				mediaStream={agentState.playbackMediaStream}
				idleHint="Spectrum appears while TTS audio is playing (captureStream from playback)."
			/>
			{#if agentState.playbackTranscript}
				<p
					class="border-border bg-secondary text-foreground mb-3 whitespace-pre-wrap break-words rounded-[4px] border px-3.5 py-2.5 text-[15px] leading-[1.7]"
				>
					{agentState.playbackTranscript}
				</p>
			{:else if agentState.state === MachineStates.PLAY_RESPONSE}
				<p
					class="border-border bg-secondary text-muted-foreground mb-3 whitespace-pre-wrap break-words rounded-[4px] border px-3.5 py-2.5 text-[15px] leading-[1.7] italic"
				>
					Generating speech…
				</p>
			{:else}
				<p
					class="border-border bg-secondary text-muted-foreground mb-3 whitespace-pre-wrap break-words rounded-[4px] border px-3.5 py-2.5 text-[15px] leading-[1.7] italic"
				>
					Transcript appears during PLAY_RESPONSE.
				</p>
			{/if}
		</section>
	</div>

	<div class="border-border bg-background flex shrink-0 justify-end px-4 py-2 md:px-6">
		<div
			class="text-foreground max-w-[min(100%,18rem)] text-right text-[13px] leading-snug md:max-w-xs"
			aria-label="agentState machine status"
		>
			<dl class="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-left">
				<dt class="text-muted-foreground font-medium whitespace-nowrap">FSM</dt>
				<dd class="m-0 font-mono text-[12px] break-words">{agentState.state}</dd>
				<dt class="text-muted-foreground font-medium">Gen</dt>
				<dd class="m-0 font-mono">{agentState.gen}</dd>
				<dt class="text-muted-foreground font-medium">Mic</dt>
				<dd class="m-0 font-mono text-[11px] break-words">
					{agentState.micStreamId ?? "—"}
				</dd>
				<dt class="text-muted-foreground font-medium">Queues</dt>
				<dd class="m-0 font-mono text-[11px]">
					A{agentState.audioQueue.length} · R{agentState.responseQueue.length}
				</dd>
			</dl>
		</div>
	</div>

	<nav
		class="border-border bg-background flex min-h-[4.25rem] shrink-0 items-center justify-center gap-3  px-4 py-3 md:gap-4 md:px-6"
		aria-label="Session controls"
	>
		<Button
			class="h-10 min-w-[7rem] rounded-[4px] px-5 text-sm font-medium hover:bg-[#57534e] active:bg-[#44403c]"
			onclick={() => agent.send(MachineActions.BOOT)}
		>
			Start
		</Button>
		<Button
			variant="destructive"
			class="h-10 min-w-[7rem] rounded-[4px] px-5 text-sm font-medium !border-transparent !bg-[#dc2626] !text-white hover:!bg-[#b91c1c] hover:!text-white"
			onclick={() => agent.send(MachineActions.SHUTDOWN)}
		>
			Shutdown
		</Button>
	</nav>
</main>
