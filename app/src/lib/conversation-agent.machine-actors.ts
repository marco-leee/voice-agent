import type { KokoroTTS } from "kokoro-js";
import type {
	AutomaticSpeechRecognitionPipeline,
	PreTrainedModel,
	Processor,
} from "@huggingface/transformers";
import { concatFloatChunks, normaliseAudio, resampleLinear } from "./audio.ts";
import { runVadListening } from "./vad.ts";
import { prepareVoiceStack } from "./voice-models.ts";
import { playTtsLine } from "./tts-playback.ts";
import {
	transcribeUtterance,
	streamAssistantReply,
	type ChatMessage,
} from "./conversation-inference.ts";
import { fromCallback, fromPromise } from "xstate";
import { MachineActions } from "./conversation-agent.types.ts";
import type { AgentContext } from "./conversation-agent.machine-context.ts";
import { INTERNAL } from "./conversation-agent.machine-context.ts";

export const conversationAgentActors = {
		prepareVoice: fromPromise(
			async ({
				input,
				signal,
			}: {
				input: AgentContext;
				signal: AbortSignal;
			}) => {
				console.log("[prepare] checking microphone permission…");
				const { ok, stream, streamId, models } = await prepareVoiceStack(
					signal,
					() => !signal.aborted,
				);
				return { ok, stream, streamId, models };
			},
		),
		vadListen: fromCallback(({ sendBack, input }) => {
			const ac = new AbortController();
			const { signal } = ac;
			const stream =
				(input as { stream: MediaStream | null } | null | undefined)?.stream ??
				null;
			const localQueue: Float32Array[] = [];

			void (async () => {
				try {
					const hasLiveMic =
						typeof window !== "undefined" &&
						stream &&
						stream.getAudioTracks().some((t) => t.readyState === "live");

					if (!hasLiveMic) {
						console.warn(
							"[listen] no live microphone track; ending turn with empty capture",
						);
						sendBack({ type: MachineActions.END_LISTENING_TURN });
						return;
					}

					await runVadListening(stream!, signal, {
						isAlive: () => !signal.aborted,
						onSampleRate: (hz) =>
							sendBack({ type: INTERNAL.CAPTURE_SAMPLE_RATE, hz }),
						onSpeechChunk: (chunk, { rms }) => {
							localQueue.push(chunk);
							sendBack({
								type: INTERNAL.SPEECH_CHUNK,
								chunk: Float32Array.from(chunk),
								rms,
							});
							console.log(
								"[listen] speech rms",
								rms.toFixed(4),
								"→ queue len",
								localQueue.length,
							);
						},
						hasQueuedUtterance: () => localQueue.length > 0,
						onEndTurn: () => {
							sendBack({ type: MachineActions.END_LISTENING_TURN });
						},
					});
				} catch (e) {
					console.error("[vad listen]", e);
				}
			})();

			return () => ac.abort();
		}),
		drainUpload: fromPromise(
			async ({
				input,
				signal,
			}: {
				input: { chunks: Float32Array[] };
				signal: AbortSignal;
			}) => {
				console.log(
					"[sending] upload",
					input.chunks.map((c) => c.length),
				);
				for (const chunk of input.chunks) {
					if (signal.aborted) return {};
					console.log("[sending] sent float32 len", chunk.length);
				}
				return {};
			},
		),
		waitResponse: fromCallback(({ sendBack, input }) => {
			const ac = new AbortController();
			const { signal } = ac;
			const inp = input as {
				capturedUtteranceChunks: Float32Array[];
				utteranceCaptureSampleRate: number;
				messages: ChatMessage[];
				stt: AutomaticSpeechRecognitionPipeline | null;
				processor: Processor | null;
				llm: PreTrainedModel | null;
			};

			void (async () => {
				let messages = [...inp.messages];
				try {
					const chunks = inp.capturedUtteranceChunks;
					const utteranceCaptureSampleRate = inp.utteranceCaptureSampleRate;
					const stt = inp.stt;
					const processor = inp.processor;
					const llm = inp.llm;

					const rawMono = concatFloatChunks(chunks);
					const fromSr = utteranceCaptureSampleRate || 48_000;
					const targetSr = 16_000;

					let mono =
						rawMono.length > 0 && fromSr !== targetSr
							? resampleLinear(rawMono, fromSr, targetSr)
							: rawMono;

					const hasAudio = mono.length > 0;
					if (hasAudio) normaliseAudio(mono);

					const tokenizer = processor?.tokenizer;
					if (!llm || !processor || !tokenizer) {
						console.warn("[wait response] model not ready");
						sendBack({
							type: INTERNAL.WAIT_RESPONSE_DONE,
							messages,
						});
						return;
					}

					console.log(messages);

					let transcript = "";
					if (hasAudio && stt) {
						transcript = await transcribeUtterance(stt, mono);
					}

					const runReply = async (msgs: ChatMessage[]) => {
						let accum = "";
						await streamAssistantReply(
							processor,
							llm,
							tokenizer,
							msgs,
							signal,
							() => !signal.aborted,
							(text) => {
								accum += text;
								sendBack({ type: INTERNAL.RESPONSE_TEXT_CHUNK, text });
							},
						);
						return accum.trim();
					};

					if (transcript) {
						messages = [...messages, { role: "user", content: transcript }];
						console.log(
							"[wait response] transcript →",
							JSON.stringify(transcript),
						);
						const assistantContent = await runReply([...messages]);
						messages = [
							...messages,
							{ role: "assistant", content: assistantContent },
						];
					} else {
						const userContent = hasAudio
							? "Speech was captured but could not be transcribed (STT missing or failed). Reply in one short sentence asking me to try again."
							: "No speech was captured in the last turn. Reply in one short sentence asking me to repeat, a bit louder or closer to the microphone.";
						messages = [...messages, { role: "user", content: userContent }];
						const assistantContent = await runReply([...messages]);
						messages = [
							...messages,
							{ role: "assistant", content: assistantContent },
						];
					}

					sendBack({ type: INTERNAL.WAIT_RESPONSE_DONE, messages });
				} catch (e) {
					console.error("[wait response]", e);
					sendBack({ type: INTERNAL.WAIT_RESPONSE_DONE, messages });
				}
			})();

			return () => ac.abort();
		}),
		playResponse: fromCallback(({ sendBack, input }) => {
			const ac = new AbortController();
			const { signal } = ac;
			const { line, tts } = input as {
				line: string;
				tts: KokoroTTS | null;
			};

			void (async () => {
				sendBack({
					type: INTERNAL.PLAYBACK_SYNC,
					transcript: line || null,
					stream: null,
				});

				if (!tts || !line) {
					sendBack({
						type: INTERNAL.PLAYBACK_SYNC,
						transcript: null,
						stream: null,
					});
					sendBack({ type: INTERNAL.PLAY_RESPONSE_DONE });
					return;
				}

				await playTtsLine(
					tts,
					line,
					signal,
					{
						setPlaybackTranscript: (t) =>
							sendBack({
								type: INTERNAL.PLAYBACK_SYNC,
								transcript: t,
								stream: null,
							}),
						setPlaybackMediaStream: (s) =>
							sendBack({
								type: INTERNAL.PLAYBACK_SYNC,
								transcript: line,
								stream: s,
							}),
						syncPublicState: () => {},
					},
					() => !signal.aborted,
				);

				if (!signal.aborted) {
					sendBack({ type: INTERNAL.PLAY_RESPONSE_DONE });
				}
			})();

			return () => ac.abort();
		}),
		closeActor: fromPromise(
			async ({
				input,
				signal,
			}: {
				input: { micMediaStream: MediaStream | null };
				signal: AbortSignal;
			}) => {
				if (signal.aborted) return {};
				console.log("[closing] draining queues / releasing mic");
				input.micMediaStream?.getTracks().forEach((t) => t.stop());
				return {};
			},
		),
};
