/**
 * Microphone acquisition and local ML stack (Whisper STT, Gemma, Kokoro TTS).
 */

import { KokoroTTS } from "kokoro-js";
import {
	Gemma4ForConditionalGeneration,
	AutoProcessor,
	PreTrainedModel,
	Processor,
	pipeline,
	type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

export type VoiceModelBundle = {
	stt: AutomaticSpeechRecognitionPipeline;
	processor: Processor;
	llm: PreTrainedModel;
	tts: KokoroTTS;
};

export type MicCaptureResult = {
	ok: boolean;
	stream: MediaStream | null;
	streamId: string | null;
};

/** Acquire mic stream (permission + getUserMedia). Caller should stop tracks if aborted mid-flight. */
export async function acquireMicrophoneStream(
	signal: AbortSignal,
	isAlive: () => boolean,
): Promise<MicCaptureResult> {
	let ok = false;
	let stream: MediaStream | null = null;
	let streamId: string | null = null;

	try {
		const nav = globalThis.navigator as Navigator | undefined;
		if (!nav?.mediaDevices?.getUserMedia) {
			ok = false;
		} else if (nav.permissions?.query) {
			const status = await nav.permissions.query({
				name: "microphone" as PermissionName,
			});
			if (status.state === "denied") {
				console.warn("[prepare] denied");
				ok = false;
			} else if (status.state === "granted") {
				const s = await nav.mediaDevices.getUserMedia({ audio: true });
				if (!isAlive()) {
					s.getTracks().forEach((t) => t.stop());
					return { ok: false, stream: null, streamId: null };
				}
				stream = s;
				streamId = s.id;
				console.log("[prepare] stream id:", streamId);
				ok = true;
			} else {
				console.log("[prepare] prompt — requesting getUserMedia");
				const s = await nav.mediaDevices.getUserMedia({ audio: true });
				if (!isAlive()) {
					s.getTracks().forEach((t) => t.stop());
					return { ok: false, stream: null, streamId: null };
				}
				stream = s;
				streamId = s.id;
				ok = true;
			}
		} else {
			const s = await nav.mediaDevices.getUserMedia({ audio: true });
			if (!isAlive()) {
				s.getTracks().forEach((t) => t.stop());
				return { ok: false, stream: null, streamId: null };
			}
			stream = s;
			streamId = s.id;
			ok = true;
		}
	} catch (e) {
		console.warn("[prepare] getUserMedia failed", e);
		ok = false;
	}

	return { ok, stream, streamId };
}

export async function loadSpeechToText(): Promise<AutomaticSpeechRecognitionPipeline> {
	const stt = await pipeline(
		"automatic-speech-recognition",
		"onnx-community/whisper-small",
		{
			dtype: "fp32",
			device: "webgpu",
			progress_callback: (info) => {
				if (info.status === "progress_total") {
					const progress = Math.round(info.progress);
					if (progress % 10 === 0) {
						console.log(`Loading STT model: ${progress}%`);
					}
				}
			},
		},
	);
	console.log("STT model loaded");
	return stt;
}

export async function loadGemmaProcessorAndModel(): Promise<{
	processor: Processor;
	llm: PreTrainedModel;
}> {
	const model_id = "onnx-community/gemma-4-E2B-it-ONNX";

	const [processor, llm] = await Promise.all([
		AutoProcessor.from_pretrained(model_id),
		Gemma4ForConditionalGeneration.from_pretrained(model_id, {
			dtype: "q4f16",
			device: "webgpu",
			progress_callback: (info) => {
				if (info.status === "progress_total") {
					const progress = Math.round(info.progress);
					if (progress % 10 === 0) {
						console.log(`Loading model: ${progress}%`);
					}
				}
			},
		}),
	]);
	return { processor, llm };
}

export async function loadKokoroTts(): Promise<KokoroTTS> {
	return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", {
		device: "webgpu",
		dtype: "fp32",
		progress_callback: (info) => {
			console.log(`Loading TTS model: ${info.status}`);
		},
	});
}

/**
 * Mic + STT in parallel, then LLM + TTS in parallel (avoids peak ArrayBuffer pressure).
 */
export async function prepareVoiceStack(
	signal: AbortSignal,
	isAlive: () => boolean,
): Promise<
	MicCaptureResult & {
		models: VoiceModelBundle | null;
	}
> {
	const [mic, stt] = await Promise.all([
		acquireMicrophoneStream(signal, isAlive),
		loadSpeechToText(),
	]);
	if (!isAlive()) {
		mic.stream?.getTracks().forEach((t) => t.stop());
		return { ...mic, models: null };
	}

	const [llmPack, tts] = await Promise.all([
		loadGemmaProcessorAndModel(),
		loadKokoroTts(),
	]);
	if (!isAlive()) {
		mic.stream?.getTracks().forEach((t) => t.stop());
		return { ...mic, models: null };
	}

	return {
		...mic,
		models: {
			stt,
			processor: llmPack.processor,
			llm: llmPack.llm,
			tts,
		},
	};
}
