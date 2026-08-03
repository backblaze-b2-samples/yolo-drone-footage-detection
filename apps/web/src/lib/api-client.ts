import type {
  DailyUploadCount,
  DetectionParams,
  DetectionSummary,
  FileMetadata,
  FileMetadataDetail,
  FileUploadResponse,
  FrameDetections,
  Inspection,
  InspectionStatusResponse,
  InspectionUpdate,
  TrackGeoJSON,
  UploadStats,
} from "@yolo-drone-footage-detection/shared";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type ApiClientRoute = {
  method: "delete" | "get" | "post";
  path: string;
};

export const API_CLIENT_ROUTES = {
  health: { method: "get", path: "/health" },
  files: { method: "get", path: "/files" },
  fileStats: { method: "get", path: "/files/stats" },
  uploadActivity: { method: "get", path: "/files/stats/activity" },
  fileByKeyDownload: { method: "get", path: "/files-by-key/download" },
  fileByKeyPreview: { method: "get", path: "/files-by-key/preview" },
  fileByKeyMetadata: { method: "get", path: "/files-by-key/metadata" },
  fileByKeyDetail: { method: "get", path: "/files-by-key/detail" },
  fileByKeyDelete: { method: "delete", path: "/files-by-key" },
  legacyFileDownload: { method: "get", path: "/files/{key}/download" },
  legacyFilePreview: { method: "get", path: "/files/{key}/preview" },
  legacyFileMetadata: { method: "get", path: "/files/{key}" },
  legacyFileDelete: { method: "delete", path: "/files/{key}" },
  upload: { method: "post", path: "/upload" },
  inspections: { method: "get", path: "/inspections" },
  inspectionCreate: { method: "post", path: "/inspections" },
  inspection: { method: "get", path: "/inspections/{inspection_id}" },
  inspectionUpdate: { method: "post", path: "/inspections/{inspection_id}" },
  inspectionDelete: { method: "delete", path: "/inspections/{inspection_id}" },
  inspectionRun: { method: "post", path: "/inspections/{inspection_id}/run" },
  inspectionStatus: { method: "get", path: "/inspections/{inspection_id}/status" },
  inspectionTrack: { method: "get", path: "/inspections/{inspection_id}/track" },
  inspectionSummary: { method: "get", path: "/inspections/{inspection_id}/summary" },
  inspectionFrames: { method: "get", path: "/inspections/{inspection_id}/frames" },
  inspectionObject: { method: "get", path: "/inspections/{inspection_id}/object" },
} as const satisfies Record<string, ApiClientRoute>;

/** Substitute an inspection id into a `{inspection_id}` path template. */
function inspectionPath(
  path: `${string}{inspection_id}${string}`,
  id: string,
): string {
  return path.replace("{inspection_id}", encodeURIComponent(id));
}

/** Typed API error with HTTP status code for caller-side branching. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True for 408, 429, 500, 502, 503, 504 — worth retrying. */
  get isRetryable(): boolean {
    return [408, 429, 500, 502, 503, 504].includes(this.status);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

/**
 * Build the right status-0 ApiError for a thrown fetch().
 *
 * fetch() rejects with a TypeError for genuinely-offline/DNS failures AND for
 * responses the browser refused to expose — most notably a cross-origin 500
 * that shipped without `Access-Control-Allow-Origin`. We can't tell those apart
 * from the error object, but `navigator.onLine === false` reliably means the
 * device has no connectivity. Anything else reached the network, so the most
 * likely cause is the server erroring with a CORS-blocked response — point the
 * developer at the API logs instead of blaming their connection.
 */
function networkError(): ApiError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new ApiError("You appear to be offline — check your connection", 0);
  }
  return new ApiError(
    "Couldn't reach the API, or the server returned an error the browser blocked (CORS). Check the API logs.",
    0,
  );
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw networkError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.detail || `API error: ${res.status}`,
      res.status,
    );
  }
  return res.json();
}

function isEndpointUnavailable(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    (error.message === "Not Found" || error.message === "API error: 404")
  );
}

async function apiFetchWithLegacyFallback<T>(
  path: string,
  legacyPath: () => string,
  init?: RequestInit
): Promise<T> {
  try {
    return await apiFetch<T>(path, init);
  } catch (error) {
    if (isEndpointUnavailable(error)) {
      return apiFetch<T>(legacyPath(), init);
    }
    throw error;
  }
}

function fileKeyQuery(key: string): string {
  if (key.length === 0) {
    throw new ApiError("File key is required", 400);
  }
  return new URLSearchParams({ key }).toString();
}

function legacyFileKeyPath(
  key: string,
  options: { blockRouteCollisions?: boolean } = {}
): string {
  if (!isLegacyPathFallbackSafe(key, options)) {
    throw new ApiError("Current API version required for this file key", 404);
  }
  return encodeURIComponent(key);
}

/**
 * Substitute a file key into a legacy `{key}` path template. The parameter type
 * requires the literal `{key}` placeholder, so passing a registry path that has
 * no placeholder is a compile error rather than a silent no-op that would send
 * the request to a keyless URL.
 */
function legacyFileKeyRoute(
  path: `${string}{key}${string}`,
  key: string,
  options: { blockRouteCollisions?: boolean } = {}
): string {
  return path.replace("{key}", legacyFileKeyPath(key, options));
}

function isLegacyPathFallbackSafe(
  key: string,
  { blockRouteCollisions = false }: { blockRouteCollisions?: boolean } = {}
): boolean {
  if (/(\.\.\/|\/\.\.|\\|%2e%2e|%00|\x00)/i.test(key)) return false;
  if (!blockRouteCollisions) return true;

  const lowerKey = key.toLowerCase();
  if (lowerKey === "stats" || lowerKey === "stats/activity") return false;
  if (lowerKey.endsWith("/download") || lowerKey.endsWith("/preview")) return false;
  return true;
}

export async function getHealth() {
  return apiFetch<{ status: string; b2_connected: boolean }>(
    API_CLIENT_ROUTES.health.path
  );
}

export async function getFiles(prefix = "", limit = 100) {
  return apiFetch<FileMetadata[]>(
    `${API_CLIENT_ROUTES.files.path}?prefix=${encodeURIComponent(prefix)}&limit=${limit}`
  );
}

export async function getFileStats() {
  return apiFetch<UploadStats>(API_CLIENT_ROUTES.fileStats.path);
}

export async function getUploadActivity(days = 7) {
  return apiFetch<DailyUploadCount[]>(
    `${API_CLIENT_ROUTES.uploadActivity.path}?days=${days}`
  );
}

export async function getFile(key: string) {
  return apiFetchWithLegacyFallback<FileMetadata>(
    `${API_CLIENT_ROUTES.fileByKeyMetadata.path}?${fileKeyQuery(key)}`,
    () =>
      legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileMetadata.path, key, {
        blockRouteCollisions: true,
      })
  );
}

/**
 * Rich metadata (checksums, image/PDF fields) for an already-stored file.
 * The server recomputes this on demand by downloading the object, so it's a
 * heavier call than getFile — fetch it lazily (only when the user asks to see
 * details). No legacy path fallback: this endpoint is new, so an older backend
 * wouldn't serve it under any route.
 */
export async function getFileDetail(key: string) {
  return apiFetch<FileMetadataDetail>(
    `${API_CLIENT_ROUTES.fileByKeyDetail.path}?${fileKeyQuery(key)}`
  );
}

export async function getDownloadUrl(key: string) {
  return apiFetchWithLegacyFallback<{ url: string }>(
    `${API_CLIENT_ROUTES.fileByKeyDownload.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileDownload.path, key)
  );
}

/** Preview-only presigned URL — does NOT increment the download counter. */
export async function getPreviewUrl(key: string) {
  return apiFetchWithLegacyFallback<{ url: string }>(
    `${API_CLIENT_ROUTES.fileByKeyPreview.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFilePreview.path, key)
  );
}

export async function deleteFile(key: string) {
  return apiFetchWithLegacyFallback<{ deleted: boolean; key: string }>(
    `${API_CLIENT_ROUTES.fileByKeyDelete.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileDelete.path, key),
    {
      // Derived from the registry so the verb the contract test checks is the
      // verb actually sent — a hardcoded "DELETE" could silently disagree.
      method: API_CLIENT_ROUTES.fileByKeyDelete.method.toUpperCase(),
    }
  );
}

export function uploadFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new ApiError(body.detail || `Upload failed: ${xhr.status}`, xhr.status));
        } catch {
          reject(new ApiError(`Upload failed: ${xhr.status}`, xhr.status));
        }
      }
    });

    xhr.addEventListener("error", () => reject(networkError()));
    xhr.addEventListener("abort", () =>
      reject(new ApiError("Upload aborted", 0)),
    );

    xhr.open(
      API_CLIENT_ROUTES.upload.method.toUpperCase(),
      `${API_BASE}${API_CLIENT_ROUTES.upload.path}`
    );
    xhr.send(formData);
  });
}

// ---------------------------------------------------------------------------
// Inspections — the app's primary entity (one video + its derived detection/GPS
// record). Every function targets a route declared in API_CLIENT_ROUTES so the
// contract test can prove the client and the OpenAPI artifact agree.
// ---------------------------------------------------------------------------

/** The fields a create/edit form collects for one inspection. */
export interface InspectionInput {
  file: File;
  name: string;
  params: DetectionParams;
  sidecar?: File | null;
}

/** The delete route's structured acknowledgement. */
export interface InspectionDeleteResult {
  deleted: boolean;
  id: string;
  objects_removed: number;
}

export async function getInspections() {
  return apiFetch<Inspection[]>(API_CLIENT_ROUTES.inspections.path);
}

export async function getInspection(id: string) {
  return apiFetch<Inspection>(
    inspectionPath(API_CLIENT_ROUTES.inspection.path, id)
  );
}

/**
 * Create an inspection by streaming a (potentially multi-GB) video to the API,
 * which streams it on to B2. Uses XHR — not fetch — so the form can show real
 * upload progress; fetch has no upload-progress event. Detection auto-runs on
 * the server once the upload lands.
 */
export function createInspection(
  input: InspectionInput,
  onProgress?: (percent: number) => void
): Promise<Inspection> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", input.file);
    formData.append("name", input.name);
    formData.append("model", input.params.model);
    formData.append("device", input.params.device);
    formData.append("conf_threshold", String(input.params.conf_threshold));
    formData.append("sample_fps", String(input.params.sample_fps));
    formData.append("max_frames", String(input.params.max_frames));
    if (input.sidecar) {
      formData.append("sidecar", input.sidecar);
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(
            new ApiError(
              body.detail || `Create failed: ${xhr.status}`,
              xhr.status
            )
          );
        } catch {
          reject(new ApiError(`Create failed: ${xhr.status}`, xhr.status));
        }
      }
    });

    xhr.addEventListener("error", () => reject(networkError()));
    xhr.addEventListener("abort", () =>
      reject(new ApiError("Create aborted", 0))
    );

    xhr.open(
      API_CLIENT_ROUTES.inspectionCreate.method.toUpperCase(),
      `${API_BASE}${API_CLIENT_ROUTES.inspectionCreate.path}`
    );
    xhr.send(formData);
  });
}

export async function updateInspection(id: string, update: InspectionUpdate) {
  return apiFetch<Inspection>(
    inspectionPath(API_CLIENT_ROUTES.inspectionUpdate.path, id),
    {
      method: API_CLIENT_ROUTES.inspectionUpdate.method.toUpperCase(),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }
  );
}

export async function deleteInspection(id: string) {
  return apiFetch<InspectionDeleteResult>(
    inspectionPath(API_CLIENT_ROUTES.inspectionDelete.path, id),
    { method: API_CLIENT_ROUTES.inspectionDelete.method.toUpperCase() }
  );
}

export async function runInspection(id: string) {
  return apiFetch<InspectionStatusResponse>(
    inspectionPath(API_CLIENT_ROUTES.inspectionRun.path, id),
    { method: API_CLIENT_ROUTES.inspectionRun.method.toUpperCase() }
  );
}

export async function getInspectionStatus(id: string) {
  return apiFetch<InspectionStatusResponse>(
    inspectionPath(API_CLIENT_ROUTES.inspectionStatus.path, id)
  );
}

export async function getInspectionTrack(id: string) {
  return apiFetch<TrackGeoJSON>(
    inspectionPath(API_CLIENT_ROUTES.inspectionTrack.path, id)
  );
}

export async function getInspectionSummary(id: string) {
  return apiFetch<DetectionSummary | Record<string, never>>(
    inspectionPath(API_CLIENT_ROUTES.inspectionSummary.path, id)
  );
}

export async function getInspectionFrames(id: string) {
  return apiFetch<FrameDetections[]>(
    inspectionPath(API_CLIENT_ROUTES.inspectionFrames.path, id)
  );
}

/** Presign one object that lives under this inspection's own prefix. */
export async function getInspectionObjectUrl(id: string, key: string) {
  const path = inspectionPath(API_CLIENT_ROUTES.inspectionObject.path, id);
  return apiFetch<{ url: string }>(
    `${path}?key=${encodeURIComponent(key)}`
  );
}
