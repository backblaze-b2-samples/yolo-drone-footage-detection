"use client";

import dynamic from "next/dynamic";

import type {
  FrameDetections,
  TrackGeoJSON,
} from "@yolo-drone-footage-detection/shared";
import { Skeleton } from "@/components/ui/skeleton";

// Leaflet reaches for `window` at import time, so the map must never render on
// the server. `ssr: false` is only allowed inside a client component, which is
// why this thin wrapper exists.
const InspectionMapImpl = dynamic(() => import("./inspection-map-impl"), {
  ssr: false,
  loading: () => <Skeleton className="h-[480px] w-full rounded-xl" />,
});

export function InspectionMap({
  track,
  frames,
}: {
  track: TrackGeoJSON;
  frames: FrameDetections[];
}) {
  return <InspectionMapImpl track={track} frames={frames} />;
}
