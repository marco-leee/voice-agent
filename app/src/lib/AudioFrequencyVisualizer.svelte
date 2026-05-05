<script lang="ts">
	/**
	 * Live frequency spectrum from a MediaStream (e.g. microphone).
	 * 8-bit segmented columns, symmetric about a center line (ZenGrid palette — DESIGN.md).
	 */
	interface Props {
		mediaStream?: MediaStream | null;
		/** Number of vertical columns. */
		barCount?: number;
		/** Message when there is no live audio track. */
		idleHint?: string;
	}

	let {
		mediaStream = null,
		barCount = 72,
		idleHint = "No live audio on this stream.",
	}: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();
	let rafId = 0;

	/** ZenGrid — stone / sage only; deep warm panel for contrast */
	const Z = {
		bg: "#252320",
		line: "#78716c",
		idleText: "#a8a29e",
	} as const;

	/** Three horizontal bands: core + tip (border) per DESIGN muted tiers */
	const regions = [
		{ core: "#d6d3d1", tip: "#78716c" },
		{ core: "#a8a29e", tip: "#57534e" },
		{ core: "#c4c2bd", tip: "#a8a29e" },
	] as const;

	function regionIndex(barIndex: number, bars: number): number {
		const t = barIndex / Math.max(1, bars - 1);
		if (t < 1 / 3) return 0;
		if (t < 2 / 3) return 1;
		return 2;
	}


	$effect(() => {
		const stream = mediaStream;
		const live =
			stream &&
			stream.getAudioTracks().some((t) => t.readyState !== "ended");

		if (!live || !canvas || !container) {
			return () => {};
		}

		const audioCtx = new AudioContext();
		const source = audioCtx.createMediaStreamSource(stream);
		const analyser = audioCtx.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0.82;
		analyser.minDecibels = -85;
		analyser.maxDecibels = -10;

		const gain = audioCtx.createGain();
		gain.gain.value = 0;
		source.connect(analyser);
		analyser.connect(gain);
		gain.connect(audioCtx.destination);

		const frequencyBinCount = analyser.frequencyBinCount;
		const data = new Uint8Array(frequencyBinCount);

		const syncCanvasSize = () => {
			const el = canvas;
			const box = container;
			if (!el || !box) return;
			const rect = box.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
			const w = Math.max(1, Math.floor(rect.width * dpr));
			const h = Math.max(1, Math.floor(rect.height * dpr));
			if (el.width !== w || el.height !== h) {
				el.width = w;
				el.height = h;
			}
		};

		const draw = () => {
			const el = canvas;
			if (!el) return;
			syncCanvasSize();
			const ctx2d = el.getContext("2d");
			if (!ctx2d) return;

			const w = el.width;
			const h = el.height;
			const cssW = container?.getBoundingClientRect().width ?? 1;
			const dpr = w / cssW;

			analyser.getByteFrequencyData(data);

			ctx2d.fillStyle = Z.bg;
			ctx2d.fillRect(0, 0, w, h);

			const midY = Math.floor(h / 2);
			const gapPx = Math.max(1, dpr);
			const blockPx = 3 * dpr;
			const unit = blockPx + gapPx;
			const halfH = Math.max(0, midY - 2 * dpr);
			const maxSeg = Math.max(1, Math.floor(halfH / unit));

			const bars = Math.max(8, Math.min(barCount, 128));
			const colGap = gapPx;
			const totalGap = (bars - 1) * colGap;
			const colW = Math.max(blockPx, (w - totalGap) / bars);

			const maxHz = audioCtx.sampleRate / 2;
			const usableBins = frequencyBinCount;
			const hzPerBin = maxHz / usableBins;

			const binForBar = (i: number) => {
				const t = i / bars;
				const hz = 80 * 2 ** (t * Math.log2(maxHz / 80));
				return Math.min(usableBins - 1, Math.floor(hz / hzPerBin));
			};

			for (let i = 0; i < bars; i++) {
				const b0 = binForBar(i);
				const b1 = Math.max(b0 + 1, binForBar(Math.min(i + 1, bars)));
				let peak = 0;
				for (let b = b0; b < b1; b++) peak = Math.max(peak, data[b]!);
				const norm = peak / 255;
				const n = Math.max(0, Math.floor(norm * maxSeg));

				const x = i * (colW + colGap);
				const { core, tip } = regions[regionIndex(i, bars)]!;

				for (let j = 0; j < n; j++) {
					const isTip = j === n - 1;
					const fill = isTip ? tip : core;

					const bottomU = midY - gapPx - j * unit;
					const topU = bottomU - blockPx;
					ctx2d.fillStyle = fill;
					ctx2d.fillRect(x, topU, colW, blockPx);

					const topL = midY + gapPx + j * unit;
					ctx2d.fillRect(x, topL, colW, blockPx);
				}
			}

			ctx2d.fillStyle = Z.line;
			ctx2d.fillRect(0, midY, w, Math.max(1, dpr));

			rafId = requestAnimationFrame(draw);
		};

		void audioCtx.resume().then(() => {
			rafId = requestAnimationFrame(draw);
		});

		const ro = new ResizeObserver(() => syncCanvasSize());
		ro.observe(container);

		return () => {
			cancelAnimationFrame(rafId);
			ro.disconnect();
			source.disconnect();
			analyser.disconnect();
			gain.disconnect();
			void audioCtx.close();
		};
	});
</script>

<div class="viz" bind:this={container}>
	<canvas bind:this={canvas} class="canvas" aria-hidden="true"></canvas>
	{#if !mediaStream?.getAudioTracks().some((t) => t.readyState !== "ended")}
		<p class="hint">{idleHint}</p>
	{/if}
</div>

<style>
	.viz {
		position: relative;
		width: 100%;
		height: 180px;
		border-radius: 4px;
		overflow: hidden;
		background: #252320;
		border: 1px solid #a8a29e;
		box-shadow: none;
	}
	.canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: crisp-edges;
	}
	.hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0;
		padding: 1rem;
		text-align: center;
		font: 13px/1.4 DM Sans, system-ui, sans-serif;
		color: #a8a29e;
		pointer-events: none;
	}
</style>
