"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FolderOpen,
  Images,
  MapPin,
  Play,
  ScanSearch,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ApiError } from "@/lib/api-client";
import {
  useDeleteInspection,
  useInspection,
  useInspectionFrames,
  useInspectionStatus,
  useInspectionTrack,
  useRunInspection,
} from "@/lib/queries";
import {
  formatTimestamp,
  isInFlightStatus,
  statusBadgeVariant,
  statusLabel,
} from "@/lib/inspection-format";
import { InspectionEditDialog } from "./inspection-edit-dialog";
import { InspectionMap } from "./inspection-map";
import { KeyframeGallery } from "./keyframe-gallery";
import { DetectionsPanel } from "./detections-panel";
import { InspectionFiles } from "./inspection-files";

export function InspectionDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: inspection, isLoading, isError, error } = useInspection(id);
  const run = useRunInspection(id);
  const remove = useDeleteInspection();

  const done = inspection?.status === "done";
  const status = useInspectionStatus(id, inspection?.status);
  const frames = useInspectionFrames(id, !!done);
  const track = useInspectionTrack(id, !!done);

  if (isLoading) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  if (isError || !inspection) {
    const notFound = error instanceof ApiError && error.isNotFound;
    return (
      <ErrorState
        error={error}
        title={notFound ? "Inspection not found" : undefined}
        onRetry={notFound ? undefined : () => router.refresh()}
      />
    );
  }

  const inFlight = isInFlightStatus(inspection.status);
  const progress = status.data;
  const pct =
    progress && progress.frames_total > 0
      ? Math.round((progress.frames_done / progress.frames_total) * 100)
      : 0;

  const onRun = () =>
    run.mutate(undefined, {
      onSuccess: () => toast.success("Detection started"),
      onError: (err) =>
        toast.error("Could not start detection", {
          description: err instanceof ApiError ? err.message : undefined,
        }),
    });

  const onDelete = () =>
    remove.mutate(inspection.id, {
      onSuccess: () => {
        toast.success("Inspection deleted");
        router.push("/inspections");
      },
      onError: (err) =>
        toast.error("Delete failed", {
          description: err instanceof ApiError ? err.message : undefined,
        }),
    });

  const framesData = frames.data ?? [];
  const hasGeo =
    inspection.has_track ||
    framesData.some((f) => f.lat !== null && f.lon !== null);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.push("/inspections")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          All inspections
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="page-title truncate">{inspection.name}</h1>
              <Badge variant={statusBadgeVariant(inspection.status)}>
                {statusLabel(inspection.status)}
              </Badge>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5" />
                {inspection.source_filename}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {inspection.has_track
                  ? `${inspection.track_point_count} GPS points`
                  : "No GPS track"}
              </span>
              <span>Created {formatTimestamp(inspection.created_at)}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={onRun} disabled={inFlight || run.isPending}>
              <Play className="h-3.5 w-3.5" />
              {inFlight ? "Running…" : "Run detection"}
            </Button>
            <InspectionEditDialog inspection={inspection} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this inspection?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the video and every derived artifact
                    under <code>inspections/{inspection.id}/</code> from Backblaze
                    B2. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {inFlight && (
        <div className="space-y-1.5" aria-live="polite">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {inspection.status === "queued" ? "Queued…" : "Detecting objects…"}
            </span>
            {progress && progress.frames_total > 0 && (
              <span className="font-mono tabular-nums">
                {progress.frames_done} / {progress.frames_total} frames
              </span>
            )}
          </div>
          <Progress value={progress && progress.frames_total > 0 ? pct : undefined} />
        </div>
      )}

      {inspection.status === "failed" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {inspection.error ?? "Detection failed. Try re-running."}
        </div>
      )}

      <Tabs defaultValue="map">
        <TabsList>
          <TabsTrigger value="map">
            <MapPin className="h-3.5 w-3.5" /> Map
          </TabsTrigger>
          <TabsTrigger value="keyframes">
            <Images className="h-3.5 w-3.5" /> Keyframes
          </TabsTrigger>
          <TabsTrigger value="detections">
            <ScanSearch className="h-3.5 w-3.5" /> Detections
          </TabsTrigger>
          <TabsTrigger value="files">
            <FolderOpen className="h-3.5 w-3.5" /> Files
          </TabsTrigger>
        </TabsList>

        <TabsContent value="map" className="pt-4">
          {!done ? (
            <EmptyState icon={MapPin} title="Map appears when detection completes" />
          ) : track.isLoading || frames.isLoading ? (
            <Skeleton className="h-[480px] w-full rounded-xl" />
          ) : hasGeo && track.data ? (
            <InspectionMap track={track.data} frames={framesData} />
          ) : (
            <EmptyState
              icon={MapPin}
              title="No GPS track for this video"
              description="Upload a .gpx/.srt sidecar (or enable embedded-telemetry extraction) to place detections on a map. Detections and keyframes are still available."
            />
          )}
        </TabsContent>

        <TabsContent value="keyframes" className="pt-4">
          {!done ? (
            <EmptyState icon={Images} title="Keyframes appear when detection completes" />
          ) : frames.isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : (
            <KeyframeGallery inspectionId={inspection.id} frames={framesData} />
          )}
        </TabsContent>

        <TabsContent value="detections" className="pt-4">
          {!done ? (
            <EmptyState icon={ScanSearch} title="Detections appear when the run completes" />
          ) : frames.isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : (
            <DetectionsPanel inspection={inspection} frames={framesData} />
          )}
        </TabsContent>

        <TabsContent value="files" className="pt-4">
          <InspectionFiles inspectionId={inspection.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
