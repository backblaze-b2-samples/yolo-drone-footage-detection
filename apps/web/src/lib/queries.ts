"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  createInspection,
  deleteFile,
  deleteInspection,
  getDownloadUrl,
  getFileDetail,
  getFiles,
  getFileStats,
  getHealth,
  getInspection,
  getInspectionFrames,
  getInspectionObjectUrl,
  getInspections,
  getInspectionTrack,
  getPreviewUrl,
  getUploadActivity,
  runInspection,
  updateInspection,
  type InspectionInput,
} from "@/lib/api-client";
import type {
  FileMetadata,
  FileMetadataDetail,
  FrameDetections,
  Inspection,
  InspectionUpdate,
  TrackGeoJSON,
} from "@yolo-drone-footage-detection/shared";

// Single source of truth for query keys. Keep these tightly scoped so that
// invalidating "files" doesn't blow away unrelated caches, and so an IDE
// "find usages" of `qk.files` reveals every consumer.
export const qk = {
  all: ["b2"] as const,
  files: (prefix?: string, limit?: number) =>
    [...qk.all, "files", prefix ?? "", limit ?? 100] as const,
  stats: () => [...qk.all, "stats"] as const,
  uploadActivity: (days: number) =>
    [...qk.all, "stats", "activity", days] as const,
  preview: (key: string) => [...qk.all, "preview", key] as const,
  detail: (key: string) => [...qk.all, "detail", key] as const,
  health: () => [...qk.all, "health"] as const,
  // Inspections — the primary entity. Kept under the same `all` root so a
  // coarse invalidate reconciles them alongside file/stat caches.
  inspections: () => [...qk.all, "inspections"] as const,
  inspection: (id: string) => [...qk.all, "inspection", id] as const,
  inspectionTrack: (id: string) => [...qk.all, "inspection", id, "track"] as const,
  inspectionFrames: (id: string) => [...qk.all, "inspection", id, "frames"] as const,
  inspectionKeyframes: (id: string, count: number) =>
    [...qk.all, "inspection", id, "keyframes", count] as const,
};

// A detection run is asynchronous: the create/run endpoints return immediately
// and a worker transitions the manifest queued -> processing -> done|failed.
// The detail view polls the manifest on this cadence while work is outstanding.
const INSPECTION_POLL_MS = 2500;

function isInFlight(status: Inspection["status"] | undefined): boolean {
  return status === "queued" || status === "processing";
}

export type Health = Awaited<ReturnType<typeof getHealth>>;

/**
 * Gate a query on something being open/visible. Deliberately the only option we
 * expose, so callers can't drift the caching policy per call site — the ⌘K
 * palette reuses `useFiles`' key (and therefore its cache) instead of fetching
 * its own private, smaller list.
 */
export interface QueryGate {
  enabled?: boolean;
}

export function useFiles(prefix = "", limit = 100, { enabled = true }: QueryGate = {}) {
  return useQuery<FileMetadata[], ApiError>({
    queryKey: qk.files(prefix, limit),
    queryFn: () => getFiles(prefix, limit),
    enabled,
  });
}

export function useFileStats({ enabled = true }: QueryGate = {}) {
  return useQuery({
    queryKey: qk.stats(),
    queryFn: getFileStats,
    enabled,
  });
}

export function useUploadActivity(days = 7) {
  return useQuery({
    queryKey: qk.uploadActivity(days),
    queryFn: () => getUploadActivity(days),
  });
}

// Presigned preview URL — only fetched when `enabled` is true (e.g., when
// the dialog opens for a specific file). Kept short-lived (60s) because
// the URL itself has a presigned expiry and is cheap to regenerate.
export function usePreviewUrl(key: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.preview(key ?? ""),
    queryFn: () => getPreviewUrl(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Rich metadata for an already-stored file. The server recomputes it on demand
// (a full object download), so it's only fetched when `enabled` — i.e. the
// preview dialog is open AND the user expands "Detailed metadata". Kept
// short-lived like the preview URL; cheap correctness under key overwrites.
export function useFileDetail(key: string | undefined, enabled: boolean) {
  return useQuery<FileMetadataDetail, ApiError>({
    queryKey: qk.detail(key ?? ""),
    queryFn: () => getFileDetail(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Health poll for the top-of-app B2 banner. `retry: false` and letting a
// failed fetch leave `data` undefined keeps a down API silent (the
// per-component ErrorState covers that); the banner only reacts to an up API
// reporting b2_connected: false. Polls every 60s and on window focus.
export function useHealth() {
  return useQuery<Health>({
    queryKey: qk.health(),
    queryFn: getHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Drop a deleted object from every cached file list, plus its own cached
 * preview/detail entries.
 *
 * Invalidation alone is not enough: the refetch re-lists the whole bucket and
 * took 5-6s in practice, so the success toast fired while the row was still
 * listed — and using that stale row's Preview 404'd. Editing the cache makes
 * the row disappear with the toast; the invalidation that follows still
 * reconciles against the server.
 *
 * Exported for tests — the mutation below is its only production caller.
 */
export function dropDeletedFileFromCache(qc: QueryClient, fileKey: string) {
  qc.setQueriesData<FileMetadata[]>(
    // Partial key: matches qk.files(prefix, limit) for every prefix/limit.
    { queryKey: [...qk.all, "files"] },
    (previous) =>
      previous ? previous.filter((file) => file.key !== fileKey) : previous,
  );
  // A presigned URL for a deleted key can only 404 now.
  qc.removeQueries({ queryKey: qk.preview(fileKey) });
  qc.removeQueries({ queryKey: qk.detail(fileKey) });
}

/**
 * Fetch a download URL for one file.
 *
 * A mutation, not a query: it has a server side effect (it bumps the download
 * counter) and it must never be cached or replayed. Being a mutation is also
 * what gives the UI an honest pending state — the old code awaited the presign
 * inside a plain click handler, so a slow round trip left the screen completely
 * unchanged and a user could not tell a working download from a dead button.
 *
 * The caller performs the navigation (see `lib/browser-download.ts`) and gets
 * `isPending` / `variables` for the pending row.
 */
export function useDownloadUrl() {
  const qc = useQueryClient();
  return useMutation<{ url: string }, ApiError, FileMetadata>({
    mutationFn: (file) => getDownloadUrl(file.key),
    // The server counted a download, so the dashboard's "Total Downloads" is
    // now stale. Cheap: /files/stats reads a cached bucket listing.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.stats() }),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileKey: string) => deleteFile(fileKey),
    onSuccess: (_data, fileKey) => {
      // Remove the row immediately, then reconcile everything (lists, stats,
      // activity) against the server in the background.
      dropDeletedFileFromCache(qc, fileKey);
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

/** The scoped library list — this app's own inspections, newest first. */
export function useInspections() {
  return useQuery<Inspection[], ApiError>({
    queryKey: qk.inspections(),
    queryFn: getInspections,
    // While any inspection is still running, keep the library fresh so its
    // status badges advance without a manual refresh.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((i) => isInFlight(i.status))
        ? INSPECTION_POLL_MS
        : false,
  });
}

/**
 * One inspection's manifest. The manifest is the source of truth for status
 * and counts, so the detail view polls it while a run is in flight (queued or
 * processing) and stops the moment it settles to done/failed.
 */
export function useInspection(id: string | undefined, { enabled = true }: QueryGate = {}) {
  return useQuery<Inspection, ApiError>({
    queryKey: qk.inspection(id ?? ""),
    queryFn: () => getInspection(id as string),
    enabled: enabled && !!id,
    refetchInterval: (query) =>
      isInFlight(query.state.data?.status) ? INSPECTION_POLL_MS : false,
  });
}

/** GeoJSON track for the Map tab. Empty FeatureCollection when the clip had no GPS. */
export function useInspectionTrack(id: string | undefined, enabled: boolean) {
  return useQuery<TrackGeoJSON, ApiError>({
    queryKey: qk.inspectionTrack(id ?? ""),
    queryFn: () => getInspectionTrack(id as string),
    enabled: enabled && !!id,
  });
}

/** Per-frame detections for the Detections table and the Keyframes gallery. */
export function useInspectionFrames(id: string | undefined, enabled: boolean) {
  return useQuery<FrameDetections[], ApiError>({
    queryKey: qk.inspectionFrames(id ?? ""),
    queryFn: () => getInspectionFrames(id as string),
    enabled: enabled && !!id,
  });
}

/**
 * Resolve presigned URLs for every annotated keyframe in one batch, keyed by
 * object key. Presigned URLs live ~1h, so this is cached long and re-runs only
 * when the set of annotated frames changes (its count is part of the key).
 */
export function useInspectionKeyframeUrls(
  id: string | undefined,
  frames: FrameDetections[] | undefined,
  enabled: boolean,
) {
  const keys = (frames ?? [])
    .map((f) => f.annotated_key)
    .filter((k): k is string => !!k);
  return useQuery<Record<string, string>, ApiError>({
    queryKey: qk.inspectionKeyframes(id ?? "", keys.length),
    queryFn: async () => {
      const entries = await Promise.all(
        keys.map(
          async (key) =>
            [key, (await getInspectionObjectUrl(id as string, key)).url] as const,
        ),
      );
      return Object.fromEntries(entries);
    },
    enabled: enabled && !!id && keys.length > 0,
    staleTime: 30 * 60 * 1000,
  });
}

export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation<
    Inspection,
    ApiError,
    { input: InspectionInput; onProgress?: (percent: number) => void }
  >({
    mutationFn: ({ input, onProgress }) => createInspection(input, onProgress),
    onSuccess: () => {
      // A new inspection lands under the app prefix and bumps whole-bucket
      // stats, so reconcile both the library and the dashboard.
      qc.invalidateQueries({ queryKey: qk.inspections() });
      qc.invalidateQueries({ queryKey: qk.stats() });
    },
  });
}

export function useUpdateInspection(id: string) {
  const qc = useQueryClient();
  return useMutation<Inspection, ApiError, InspectionUpdate>({
    mutationFn: (update) => updateInspection(id, update),
    onSuccess: (data) => {
      qc.setQueryData(qk.inspection(id), data);
      qc.invalidateQueries({ queryKey: qk.inspections() });
    },
  });
}

export function useRunInspection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runInspection(id),
    onSuccess: () => {
      // Kick the manifest poll immediately; the run just moved it back to queued.
      qc.invalidateQueries({ queryKey: qk.inspection(id) });
      qc.invalidateQueries({ queryKey: qk.inspections() });
    },
  });
}

export function useDeleteInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteInspection(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: qk.inspection(id) });
      qc.invalidateQueries({ queryKey: qk.inspections() });
      qc.invalidateQueries({ queryKey: qk.stats() });
    },
  });
}
