"use client";

import Link from "next/link";
import { Radar, Video } from "lucide-react";

import type { Inspection } from "@yolo-drone-footage-detection/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useInspections } from "@/lib/queries";
import {
  formatTimestamp,
  statusBadgeVariant,
  statusLabel,
} from "@/lib/inspection-format";

function topClasses(counts: Record<string, number>, limit = 3): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  return entries
    .slice(0, limit)
    .map(([name, n]) => `${name} ×${n}`)
    .join(", ");
}

function InspectionCard({ inspection }: { inspection: Inspection }) {
  const classes = topClasses(inspection.class_counts);
  return (
    <Link href={`/inspections/${inspection.id}`} className="group block">
      <Card className="transition-colors group-hover:border-primary/50">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{inspection.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <Video className="h-3 w-3 shrink-0" />
                {inspection.source_filename}
              </p>
            </div>
            <Badge variant={statusBadgeVariant(inspection.status)}>
              {statusLabel(inspection.status)}
            </Badge>
          </div>

          {inspection.status === "done" && (
            <p className="text-sm text-muted-foreground">
              {inspection.detection_count} detection
              {inspection.detection_count === 1 ? "" : "s"} across{" "}
              {inspection.frame_count} frame
              {inspection.frame_count === 1 ? "" : "s"}
              {classes && <> · {classes}</>}
            </p>
          )}
          {inspection.status === "processing" && (
            <p className="text-sm text-muted-foreground">Running detection…</p>
          )}
          {inspection.status === "queued" && (
            <p className="text-sm text-muted-foreground">Queued for detection.</p>
          )}
          {inspection.status === "failed" && (
            <p className="line-clamp-2 text-sm text-destructive">
              {inspection.error ?? "Detection failed."}
            </p>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {inspection.has_track ? (
              <span>{inspection.track_point_count} GPS points</span>
            ) : (
              <span>No GPS track</span>
            )}
            <span aria-hidden>·</span>
            <span>{formatTimestamp(inspection.created_at)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function InspectionLibrary() {
  const { data, isLoading, isError, error, refetch } = useInspections();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Radar}
        title="No inspections yet"
        description="Create one from a drone or dashcam video to run object detection and map the results."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((inspection) => (
        <InspectionCard key={inspection.id} inspection={inspection} />
      ))}
    </div>
  );
}
