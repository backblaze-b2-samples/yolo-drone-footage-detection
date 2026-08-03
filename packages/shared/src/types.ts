export type FileStatus = "uploading" | "complete" | "error";

export interface FileMetadata {
  key: string;
  filename: string;
  folder: string;
  size_bytes: number;
  size_human: string;
  content_type: string;
  uploaded_at: string;
  url: string | null;
}

export interface FileMetadataDetail {
  filename: string;
  size_bytes: number;
  size_human: string;
  mime_type: string;
  extension: string;
  md5: string;
  sha256: string;
  uploaded_at: string;
  /** Set when a format-specific extractor was skipped or failed (e.g. an image
   *  above the decompression-bomb decode limit). Core fields stay exact. */
  metadata_warning: string | null;
  // Image-specific
  image_width: number | null;
  image_height: number | null;
  exif: Record<string, string> | null;
  // PDF-specific
  pdf_pages: number | null;
  pdf_author: string | null;
  pdf_title: string | null;
  // Audio/Video
  duration_seconds: number | null;
  codec: string | null;
  bitrate: number | null;
}

export interface FileUploadResponse {
  key: string;
  filename: string;
  size_bytes: number;
  size_human: string;
  content_type: string;
  uploaded_at: string;
  url: string | null;
  metadata: FileMetadataDetail | null;
}

export interface DailyUploadCount {
  date: string;
  uploads: number;
}

export interface UploadStats {
  total_files: number;
  total_size_bytes: number;
  total_size_human: string;
  uploads_today: number;
  total_downloads: number;
}

// --- Drone footage inspection domain ---

export type YoloModel = "yolo11n.pt" | "yolo11s.pt" | "yolo11m.pt";
export type YoloDevice = "auto" | "cpu" | "cuda" | "mps";
export type InspectionStatus = "queued" | "processing" | "done" | "failed";

export interface DetectionParams {
  model: YoloModel;
  device: YoloDevice;
  conf_threshold: number;
  sample_fps: number;
  max_frames: number;
}

export interface Inspection {
  id: string;
  name: string;
  status: InspectionStatus;
  params: DetectionParams;
  source_key: string;
  source_filename: string;
  sidecar_key: string | null;
  created_at: string;
  updated_at: string;
  frame_count: number;
  detection_count: number;
  class_counts: Record<string, number>;
  has_track: boolean;
  track_point_count: number;
  error: string | null;
}

export interface Detection {
  class_name: string;
  confidence: number;
  /** Pixel bbox in the sampled frame: [x1, y1, x2, y2]. */
  bbox: number[];
}

export interface FrameDetections {
  frame_index: number;
  timestamp_s: number;
  detections: Detection[];
  lat: number | null;
  lon: number | null;
  annotated_key: string | null;
}

export interface DetectionSummary {
  frame_count: number;
  detection_count: number;
  class_counts: Record<string, number>;
  params: DetectionParams;
  has_track: boolean;
  track_point_count: number;
}

export interface InspectionStatusResponse {
  id: string;
  status: InspectionStatus;
  frames_done: number;
  frames_total: number;
  detection_count: number;
  error: string | null;
}

/** A GeoJSON FeatureCollection (track LineString + timestamped points). */
export interface TrackGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "LineString" | "Point";
      coordinates: number[] | number[][];
    };
  }>;
}

export interface InspectionUpdate {
  name?: string;
  params?: DetectionParams;
}
