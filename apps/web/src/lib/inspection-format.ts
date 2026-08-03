import type { InspectionStatus } from "@yolo-drone-footage-detection/shared";

// Presentational mappings for the inspection status — kept in one place so the
// library list and the detail header always render a status the same way.

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const STATUS_LABELS: Record<InspectionStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  done: "Done",
  failed: "Failed",
};

const STATUS_VARIANTS: Record<InspectionStatus, BadgeVariant> = {
  queued: "outline",
  processing: "secondary",
  done: "default",
  failed: "destructive",
};

export function statusLabel(status: InspectionStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusBadgeVariant(status: InspectionStatus): BadgeVariant {
  return STATUS_VARIANTS[status] ?? "outline";
}

/** A run is "in flight" (still working) while queued or processing. */
export function isInFlightStatus(status: InspectionStatus): boolean {
  return status === "queued" || status === "processing";
}

/** Compact absolute-ish timestamp for list rows and the detail header. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
