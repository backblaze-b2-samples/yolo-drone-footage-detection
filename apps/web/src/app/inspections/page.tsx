import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InspectionLibrary } from "@/components/inspections/inspection-library";

export default function InspectionsPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <h1 className="page-title">Inspections</h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
            Your drone and dashcam footage inspections. Each one runs local YOLO
            object detection and stores the video, annotated keyframes, per-frame
            detections, and a GPS track on Backblaze B2.
          </p>
        </div>
        <Button asChild size="sm" className="h-8 shrink-0">
          <Link href="/inspections/new">
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            New inspection
          </Link>
        </Button>
      </div>
      <div className="animate-fade-in-up stagger-2">
        <InspectionLibrary />
      </div>
    </div>
  );
}
