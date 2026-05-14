/**
 * Smart Turn v3 ONNX + WhisperFeatureExtractor from onnx-community/smart-turn-v3-ONNX.
 * Uses the same preprocessor as the published model (chunk_length 8 = 128000 samples @ 16 kHz).
 */

import {
	AutoFeatureExtractor,
	type FeatureExtractor,
	type ProgressCallback,
} from "@huggingface/transformers";
import * as ort from "onnxruntime-web";

export const SMART_TURN_PCM_SAMPLES = 128_000;
export const SMART_TURN_MODEL_URL_DEFAULT =
	"https://huggingface.co/onnx-community/smart-turn-v3-ONNX/resolve/main/onnx/model_q4f16.onnx";

export type SmartTurnEngine = {
	/** P(turn complete) in [0,1] for the given tail of mono 16 kHz PCM. */
	scorePcm16kMono(recentPcm16k: Float32Array): Promise<number>;
	dispose(): Promise<void>;
};

function rightAlignTo8s(audio: Float32Array): Float32Array {
	const n = SMART_TURN_PCM_SAMPLES;
	const out = new Float32Array(n);
	if (audio.length >= n) {
		out.set(audio.subarray(audio.length - n));
	} else {
		out.set(audio, n - audio.length);
	}
	return out;
}

export async function createSmartTurnEngine(opts?: {
	modelUrl?: string;
	wasmPaths?: string;
	progress_callback?: ProgressCallback;
}): Promise<SmartTurnEngine> {
	if (opts?.wasmPaths) {
		ort.env.wasm.wasmPaths = opts.wasmPaths;
	}
	const modelUrl = opts?.modelUrl ?? SMART_TURN_MODEL_URL_DEFAULT;
	const [fx, session] = await Promise.all([
		AutoFeatureExtractor.from_pretrained(
			"onnx-community/smart-turn-v3-ONNX",
			opts?.progress_callback
				? { progress_callback: opts.progress_callback }
				: undefined,
		) as Promise<FeatureExtractor>,
		ort.InferenceSession.create(modelUrl, {
			executionProviders: ["wasm"],
			graphOptimizationLevel: "all",
		}),
	]);

	return {
		async scorePcm16kMono(recentPcm16k: Float32Array) {
			const window = rightAlignTo8s(recentPcm16k);
			const { input_features: feats } = (await (fx as CallableFeatureExtractor)(
				window,
			)) as { input_features: { data: Float32Array; dims: readonly number[] } };
			const inputTensor = new ort.Tensor("float32", feats.data, feats.dims);
			const out = await session.run({ input_features: inputTensor });
			inputTensor.dispose();
			const logits = out.logits as ort.Tensor;
			const p = logits.data[0] as number;
			logits.dispose();
			return p;
		},
		async dispose() {
			await session.release();
		},
	};
}

type CallableFeatureExtractor = FeatureExtractor & {
	(audio: Float32Array): Promise<{ input_features: { data: Float32Array; dims: readonly number[] } }>;
};
