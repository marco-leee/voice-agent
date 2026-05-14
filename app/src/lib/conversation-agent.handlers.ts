import type {
	ActionHandler,
	ActionHandlerContext,
	ActionHandlers,
	MachineAction,
} from "./conversation-agent.types.ts";

function logAction(name: MachineAction, ctx: ActionHandlerContext): void {
	console.log(`[action:${name}]`, { from: ctx.from, to: ctx.to });
}

export function handleBoot(ctx: ActionHandlerContext): void {
	logAction("BOOT", ctx);
}

export function handlePrepared(ctx: ActionHandlerContext): void {
	logAction("PREPARED", ctx);
}

export function handleStartListen(ctx: ActionHandlerContext): void {
	logAction("START_LISTEN", ctx);
}

export function handleEndListeningTurn(ctx: ActionHandlerContext): void {
	logAction("END_LISTENING_TURN", ctx);
}

export function handleUploadDone(ctx: ActionHandlerContext): void {
	logAction("UPLOAD_DONE", ctx);
}

export function handleResponseStreamDone(ctx: ActionHandlerContext): void {
	logAction("RESPONSE_STREAM_DONE", ctx);
}

export function handlePlaybackDone(ctx: ActionHandlerContext): void {
	logAction("PLAYBACK_DONE", ctx);
}

export function handleInterruptPlayback(ctx: ActionHandlerContext): void {
	logAction("INTERRUPT_PLAYBACK", ctx);
}

export function handleShutdown(ctx: ActionHandlerContext): void {
	logAction("SHUTDOWN", ctx);
}

export function handleClosed(ctx: ActionHandlerContext): void {
	logAction("CLOSED", ctx);
}

/** Default handler map — one named function per action. */
export const defaultActionHandlers: ActionHandlers = {
	BOOT: handleBoot,
	PREPARED: handlePrepared,
	START_LISTEN: handleStartListen,
	END_LISTENING_TURN: handleEndListeningTurn,
	UPLOAD_DONE: handleUploadDone,
	RESPONSE_STREAM_DONE: handleResponseStreamDone,
	PLAYBACK_DONE: handlePlaybackDone,
	INTERRUPT_PLAYBACK: handleInterruptPlayback,
	SHUTDOWN: handleShutdown,
	CLOSED: handleClosed,
};
