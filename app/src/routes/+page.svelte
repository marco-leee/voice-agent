<script lang="ts">
	import AudioFrequencyVisualizer from "$lib/AudioFrequencyVisualizer.svelte";
	import { Button } from "$lib/components/ui/button";
	import { ConversationAgent, MachineActions, MachineStates } from "$lib";
	import type { ConversationAgentState } from "$lib/client.agent";

	const state: ConversationAgentState = $state({
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

	const agent = new ConversationAgent({ strict: true, publicState: state });
</script>

<div
	class="bg-background text-foreground flex h-[100dvh] min-h-0 flex-row overflow-hidden"
>
	<!-- Left: display — hidden on small screens; stacks above center in column layout -->
	<aside
		class="border-border bg-card text-card-foreground hidden h-full min-h-0 w-[256px] shrink-0 flex-col overflow-hidden  md:flex"
		aria-label="Display"
	>
		<div
			class="border-border flex min-h-20 shrink-0 items-center  px-4 py-3 md:px-6"
		>
			<h2 class="font-[family-name:'Raleway'] text-lg font-medium tracking-tight text-[#78716c]">
				Display
			</h2>
		</div>
		<div class="text-muted-foreground flex flex-1 items-center justify-center px-4 py-6 text-center text-xs leading-relaxed md:px-6">
			Reserved for visual output (e.g. avatar or slides).
		</div>
		<!-- Spacer to align with center / history footer bars -->
		<div class="border-border min-h-16 shrink-0  md:min-h-[4.25rem]" aria-hidden="true"></div>
	</aside>

	<!-- Center: title, scroll content, FSM strip above footer, nav --> 
	<main class="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
		<header
			class="border-border flex min-h-20 shrink-0 items-center px-4 py-3 md:px-6"
		>
			<h1 class="font-[family-name:'Raleway'] text-xl font-light tracking-tight text-[#78716c] md:text-2xl">
				Conversation agent
			</h1>
		</header>

		<div
			class="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 py-6 md:px-6"
		>
			<section class="min-w-0" aria-label="User microphone spectrum">
				<h2
					class="font-[family-name:'Raleway'] text-muted-foreground mb-3 text-lg font-light tracking-tight"
				>
					User speech
				</h2>
				<AudioFrequencyVisualizer
					mediaStream={state.micMediaStream}
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
					mediaStream={state.playbackMediaStream}
					idleHint="Spectrum appears while TTS audio is playing (captureStream from playback)."
				/>
				{#if state.playbackTranscript}
					<p
						class="border-border bg-secondary text-foreground mb-3 whitespace-pre-wrap break-words rounded-[4px] border px-3.5 py-2.5 text-[15px] leading-[1.7]"
					>
						{state.playbackTranscript}
					</p>
				{:else if state.state === MachineStates.PLAY_RESPONSE}
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

		<div
			class="border-border bg-background flex shrink-0 justify-end px-4 py-2 md:px-6"
		>
			<div
				class="text-foreground max-w-[min(100%,18rem)] text-right text-[13px] leading-snug md:max-w-xs"
				aria-label="State machine status"
			>
				<dl class="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-left">
					<dt class="text-muted-foreground font-medium whitespace-nowrap">FSM</dt>
					<dd class="m-0 font-mono text-[12px] break-words">{state.state}</dd>
					<dt class="text-muted-foreground font-medium">Gen</dt>
					<dd class="m-0 font-mono">{state.gen}</dd>
					<dt class="text-muted-foreground font-medium">Mic</dt>
					<dd class="m-0 font-mono text-[11px] break-words">
						{state.micStreamId ?? "—"}
					</dd>
					<dt class="text-muted-foreground font-medium">Queues</dt>
					<dd class="m-0 font-mono text-[11px]">
						A{state.audioQueue.length} · R{state.responseQueue.length}
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

	<!-- Right: conversation history — hidden on small screens -->
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
				{#if state.systemPrompt}
					<div class="mb-4 min-w-0">
						<div
							class="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase"
						>
							System
						</div>
						<div
							class="border-border bg-secondary text-foreground rounded-[4px] border px-3 py-2 text-[12px] leading-snug break-words whitespace-pre-wrap"
						>
							{state.systemPrompt}
						</div>
					</div>
				{/if}

				{#if state.chatHistory.length === 0}
					<p class="text-muted-foreground m-0 text-[13px] leading-relaxed">
						No user or assistant messages yet. Speak after booting and ending a listening turn to
						see turns here.
					</p>
				{:else}
					<ul class="m-0 flex list-none flex-col gap-4 p-0">
						{#each state.chatHistory as turn, i (i)}
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

			<div
				class="border-border flex min-h-[4.25rem] shrink-0 items-center  px-4 py-3 md:px-6"
			>
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
</div>
