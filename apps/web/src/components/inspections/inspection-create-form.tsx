"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Radar } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ApiError } from "@/lib/api-client";
import { useCreateInspection } from "@/lib/queries";
import {
  CREATE_PARAM_DEFAULTS,
  DetectionParamsFields,
  detectionParamsSchema,
  toDetectionParams,
} from "./detection-params-fields";

const createSchema = z.object({
  name: z.string().max(200, "Keep the name under 200 characters"),
  params: detectionParamsSchema,
});

type CreateValues = z.infer<typeof createSchema>;

const VIDEO_ACCEPT = "video/mp4,video/quicktime,.mp4,.mov";
const SIDECAR_ACCEPT = ".gpx,.srt";

export function InspectionCreateForm() {
  const router = useRouter();
  const create = useCreateInspection();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [sidecarFile, setSidecarFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLInputElement>(null);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", params: CREATE_PARAM_DEFAULTS },
  });

  const onSubmit = (values: CreateValues) => {
    if (!videoFile) {
      setFileError("Choose a .mp4 or .mov video to inspect.");
      return;
    }
    setFileError(null);
    setProgress(0);
    create.mutate(
      {
        input: {
          file: videoFile,
          name: values.name,
          params: toDetectionParams(values.params),
          sidecar: sidecarFile,
        },
        onProgress: setProgress,
      },
      {
        onSuccess: (created) => {
          toast.success("Inspection created", {
            description: "Detection started — this can take a few minutes.",
          });
          router.push(`/inspections/${created.id}`);
        },
        onError: (err) => {
          const message =
            err instanceof ApiError ? err.message : "Could not create inspection";
          toast.error("Create failed", { description: message });
        },
      },
    );
  };

  const uploading = create.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader className="border-b border-border py-4 px-5">
            <CardTitle className="card-title">Footage</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="video">Video file</Label>
              <Input
                id="video"
                ref={videoRef}
                type="file"
                accept={VIDEO_ACCEPT}
                disabled={uploading}
                onChange={(e) => {
                  setVideoFile(e.target.files?.[0] ?? null);
                  setFileError(null);
                }}
              />
              <p className="text-muted-foreground text-sm">
                A drone or dashcam clip (.mp4 / .mov). Streamed straight to
                Backblaze B2 — large multi-GB files are never buffered in memory.
              </p>
              {fileError && (
                <p className="text-destructive text-sm">{fileError}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sidecar">GPS sidecar (optional)</Label>
              <Input
                id="sidecar"
                type="file"
                accept={SIDECAR_ACCEPT}
                disabled={uploading}
                onChange={(e) => setSidecarFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-muted-foreground text-sm">
                A .gpx or DJI/dashcam .srt track. The most reliable source of
                geotags — without it the app falls back to embedded telemetry or
                shows detections without a map.
              </p>
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. North tower survey — 2024-06"
                      disabled={uploading}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Defaults to the video filename if you leave it blank.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border py-4 px-5">
            <CardTitle className="card-title">Detection parameters</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <DetectionParamsFields showDefaultHints />
          </CardContent>
        </Card>

        {uploading && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Uploading to B2…</span>
              <span className="font-mono tabular-nums">{progress}%</span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => router.push("/inspections")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={uploading}>
            <Radar className="h-4 w-4" />
            {uploading ? "Creating…" : "Create & run detection"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
