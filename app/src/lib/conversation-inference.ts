/**
 * STT → chat history → Gemma streaming for the WAITING_RESPONSE state.
 */

import type { PreTrainedModel, Processor } from "@huggingface/transformers";
import { TextStreamer, load_image } from "@huggingface/transformers";
import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type ChatMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

export async function transcribeUtterance(
	stt: AutomaticSpeechRecognitionPipeline,
	mono: Float32Array,
): Promise<string> {
	try {
		const out = await stt(mono, {
			language: "en",
			task: "transcribe",
		});
		return typeof out === "object" && out !== null && "text" in out
			? String((out as { text: string }).text).trim()
			: "";
	} catch (e) {
		console.error("[wait response] STT failed", e);
		return "";
	}
}

const APPLY_OPTS = {
	tokenize: false,
	add_generation_prompt: true,
} as never;

export async function streamAssistantReply(
	processor: Processor,
	llm: PreTrainedModel,
	tokenizer: NonNullable<Processor["tokenizer"]>,
	messages: ChatMessage[],
	signal: AbortSignal,
	isAlive: () => boolean,
	onTextChunk: (text: string) => void,
): Promise<void> {
	const prompt = processor.apply_chat_template(messages as never, APPLY_OPTS);
	const inputs = await processor(prompt);
	await llm.generate({
		...inputs,
		max_new_tokens: 512,
		do_sample: false,
		streamer: new TextStreamer(tokenizer, {
			skip_prompt: true,
			skip_special_tokens: false,
			callback_function: (text) => {
				if (!isAlive()) return;
				if (text.includes("<turn|>")) return;
				onTextChunk(text);
				console.log("[wait response] chunk →", JSON.stringify(text));
			},
		}),
	});
}
