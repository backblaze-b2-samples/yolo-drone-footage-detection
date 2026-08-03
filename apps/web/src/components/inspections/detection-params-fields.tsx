"use client";

import { z } from "zod";

import type { DetectionParams } from "@yolo-drone-footage-detection/shared";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// Finite option sets — mirror the backend `Literal` types in
// app/types/inspections.py. Rendered as selectors (never free text) so a bad
// value can't reach the detection worker.
export const YOLO_MODELS = ["yolo11n.pt", "yolo11s.pt", "yolo11m.pt"] as const;
export const YOLO_DEVICES = ["auto", "cpu", "cuda", "mps"] as const;
// sample_fps is a bounded preset, so it is a selector rather than a free spinner.
export const SAMPLE_FPS_OPTIONS = ["0.5", "1", "2"] as const;

const MODEL_LABELS: Record<(typeof YOLO_MODELS)[number], string> = {
  "yolo11n.pt": "Nano — fastest, good for a first run",
  "yolo11s.pt": "Small — more accurate, slower",
  "yolo11m.pt": "Medium — most accurate, slowest",
};

const DEVICE_LABELS: Record<(typeof YOLO_DEVICES)[number], string> = {
  auto: "Auto — CUDA if present, else CPU",
  cpu: "CPU",
  cuda: "CUDA (NVIDIA GPU)",
  mps: "Apple MPS (opt-in)",
};

// Numeric knobs are strings in the form and coerced on submit — exactly like
// settings-form's quotaThreshold — which keeps the react-hook-form value type
// simple and the zod input type clean.
export const detectionParamsSchema = z.object({
  model: z.enum(YOLO_MODELS),
  device: z.enum(YOLO_DEVICES),
  sample_fps: z.enum(SAMPLE_FPS_OPTIONS),
  conf_threshold: z
    .string()
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 1;
    }, "Must be between 0 and 1"),
  max_frames: z
    .string()
    .refine((v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 5000;
    }, "Whole number between 1 and 5000"),
});

export type DetectionParamsForm = z.infer<typeof detectionParamsSchema>;

// The safe defaults a CREATE form surfaces as guidance — never autofilled onto
// the edit form (which opens pre-filled with the inspection's real params).
export const CREATE_PARAM_DEFAULTS: DetectionParamsForm = {
  model: "yolo11n.pt",
  device: "auto",
  sample_fps: "1",
  conf_threshold: "0.25",
  max_frames: "300",
};

/** Form values -> the API's numeric DetectionParams payload. */
export function toDetectionParams(v: DetectionParamsForm): DetectionParams {
  return {
    model: v.model,
    device: v.device,
    sample_fps: Number(v.sample_fps),
    conf_threshold: Number(v.conf_threshold),
    max_frames: Number(v.max_frames),
  };
}

/** An inspection's stored params -> pre-filled edit-form values. */
export function toFormParams(p: DetectionParams): DetectionParamsForm {
  const fps = String(p.sample_fps) as (typeof SAMPLE_FPS_OPTIONS)[number];
  return {
    model: p.model,
    device: p.device,
    sample_fps: SAMPLE_FPS_OPTIONS.includes(fps) ? fps : "1",
    conf_threshold: String(p.conf_threshold),
    max_frames: String(p.max_frames),
  };
}

/**
 * The five detection knobs, bound to a react-hook-form context under the
 * `params.*` path. `showDefaultHints` turns on the create-form safe-default
 * guidance (the edit form passes it false and opens pre-filled instead).
 */
export function DetectionParamsFields({
  showDefaultHints = false,
}: {
  showDefaultHints?: boolean;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <FormField
        name="params.model"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Model</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {YOLO_MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m} — {MODEL_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {showDefaultHints
                ? "Default: yolo11n.pt (fastest, good for a first run)."
                : "COCO-pretrained YOLO detector."}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="params.device"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Device</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {YOLO_DEVICES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DEVICE_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {showDefaultHints
                ? "Default: auto. Runs on CPU when no GPU is present."
                : "Where inference runs. auto picks CUDA if available, else CPU."}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="params.sample_fps"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Frames sampled per second</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {SAMPLE_FPS_OPTIONS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {showDefaultHints
                ? "Default: 1 frame per second of video."
                : "How densely the clip is sampled for detection."}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="params.conf_threshold"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Confidence threshold</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                className="w-32 font-mono tabular-nums"
                {...field}
              />
            </FormControl>
            <FormDescription>
              {showDefaultHints
                ? "Default: 0.25. Lower finds more objects; higher is stricter."
                : "Between 0 and 1. Lower finds more; higher is stricter."}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="params.max_frames"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Max frames</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={1}
                max={5000}
                step={10}
                className="w-32 font-mono tabular-nums"
                {...field}
              />
            </FormControl>
            <FormDescription>
              {showDefaultHints
                ? "Default: 300. A hard cap so a long clip can't run unbounded."
                : "Hard cap on frames processed (1–5000)."}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
