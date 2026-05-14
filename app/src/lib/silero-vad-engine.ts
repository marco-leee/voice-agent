/**
 * Silero VAD via ONNX Runtime (onnx-community/silero-vad).
 * I/O matches snakers4 / @ricky0123/vad-web v5: input [1,N], state [2,1,128], sr int64.
 */

import * as ort from "onnxruntime-web";

const DEFAULT_MODEL_URL =
	"https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model_q4f16.onnx";

export const SILERO_FRAME_SAMPLES = 512;
export const SILERO_SAMPLE_RATE = 16_000;

function newState(): ort.Tensor {
	const z = new Float32Array(2 * 128);
	return new ort.Tensor("float32", z, [2, 1, 128]);
}

export type SileroVadEngine = {
	/** One 512-sample mono @ 16 kHz chunk; updates internal state. */
	process(chunk512: Float32Array): Promise<number>;
	reset(): void;
	dispose(): Promise<void>;
};

export async function createSileroVadEngine(
	opts?: { modelUrl?: string; wasmPaths?: string },
): Promise<SileroVadEngine> {
	if (opts?.wasmPaths) {
		ort.env.wasm.wasmPaths = opts.wasmPaths;
	}
	const url = opts?.modelUrl ?? DEFAULT_MODEL_URL;
	const session = await ort.InferenceSession.create(url, {
		executionProviders: ["wasm"],
		graphOptimizationLevel: "all",
	});
	const sr = new ort.Tensor("int64", [16_000n]);
	let state = newState();

	return {
		async process(chunk512: Float32Array) {
			if (chunk512.length !== SILERO_FRAME_SAMPLES) {
				throw new Error(
					`silero: expected ${SILERO_FRAME_SAMPLES} samples, got ${chunk512.length}`,
				);
			}
			const input = new ort.Tensor("float32", chunk512, [
				1,
				SILERO_FRAME_SAMPLES,
			]);
			const out = await session.run({ input, state, sr });
			input.dispose();
			const next = out.stateN as ort.Tensor;
			const prev = state;
			state = next;
			prev.dispose();
			const logits = out.output as ort.Tensor;
			const p = logits.data[0] as number;
			logits.dispose();
			return p;
		},
		reset() {
			state.dispose();
			state = newState();
		},
		async dispose() {
			state.dispose();
			sr.dispose();
			await session.release();
		},
	};
}
