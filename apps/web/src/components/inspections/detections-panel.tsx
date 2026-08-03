"use client";

import { ScanSearch } from "lucide-react";

import type {
  FrameDetections,
  Inspection,
} from "@yolo-drone-footage-detection/shared";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function frameClasses(frame: FrameDetections): string {
  const counts = new Map<string, number>();
  for (const d of frame.detections) {
    counts.set(d.class_name, (counts.get(d.class_name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(", ");
}

export function DetectionsPanel({
  inspection,
  frames,
}: {
  inspection: Inspection;
  frames: FrameDetections[];
}) {
  const classEntries = Object.entries(inspection.class_counts).sort(
    (a, b) => b[1] - a[1],
  );
  const framesWithDetections = frames.filter((f) => f.detections.length > 0);

  if (inspection.detection_count === 0 && framesWithDetections.length === 0) {
    return (
      <EmptyState
        icon={ScanSearch}
        title="No detections"
        description="This run found no objects above the confidence threshold. Try lowering it in Edit, then re-run."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          Class summary
          <span className="ml-2 font-normal text-muted-foreground">
            {inspection.detection_count} total across {inspection.frame_count}{" "}
            frames
          </span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {classEntries.map(([name, count]) => (
            <Badge key={name} variant="secondary">
              {name} · {count}
            </Badge>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Time</TableHead>
              <TableHead className="w-24">Objects</TableHead>
              <TableHead>Classes</TableHead>
              <TableHead className="w-40">GPS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {framesWithDetections.map((frame) => (
              <TableRow key={frame.frame_index}>
                <TableCell className="font-mono tabular-nums">
                  {frame.timestamp_s.toFixed(1)}s
                </TableCell>
                <TableCell className="tabular-nums">
                  {frame.detections.length}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {frameClasses(frame)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {frame.lat !== null && frame.lon !== null
                    ? `${frame.lat.toFixed(5)}, ${frame.lon.toFixed(5)}`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
