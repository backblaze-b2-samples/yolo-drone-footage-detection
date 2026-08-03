"use client";

import Image from "next/image";
import { Images } from "lucide-react";

import type { FrameDetections } from "@yolo-drone-footage-detection/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useInspectionKeyframeUrls } from "@/lib/queries";

export function KeyframeGallery({
  inspectionId,
  frames,
}: {
  inspectionId: string;
  frames: FrameDetections[];
}) {
  const annotated = frames.filter((f) => f.annotated_key);
  const { data: urls, isLoading, isError, error, refetch } =
    useInspectionKeyframeUrls(inspectionId, frames, annotated.length > 0);

  if (annotated.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="No annotated keyframes"
        description="Keyframes appear here once detection has run on this video."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {annotated.slice(0, 6).map((f) => (
          <Skeleton key={f.frame_index} className="aspect-video w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {annotated.map((frame) => {
        const src = urls?.[frame.annotated_key as string];
        return (
          <figure
            key={frame.frame_index}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="relative aspect-video bg-muted">
              {src && (
                <Image
                  src={src}
                  alt={`Annotated frame at ${frame.timestamp_s.toFixed(1)}s`}
                  fill
                  unoptimized
                  className="object-contain"
                  sizes="(max-width: 640px) 100vw, 33vw"
                />
              )}
            </div>
            <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">
                {frame.timestamp_s.toFixed(1)}s
              </span>
              <span>
                {frame.detections.length} detection
                {frame.detections.length === 1 ? "" : "s"}
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
