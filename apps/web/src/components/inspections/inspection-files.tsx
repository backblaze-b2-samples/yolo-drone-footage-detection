"use client";

import { Download, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDownloadUrl, useFiles } from "@/lib/queries";

/**
 * The inspection's own objects on B2 — the source video, GeoJSON track,
 * per-frame detection JSON, annotated JPEGs, and the manifest. Reuses the kept
 * full-bucket listing + presigned-download plumbing, scoped to this
 * inspection's prefix, so it stays consistent with the /files explorer.
 */
export function InspectionFiles({ inspectionId }: { inspectionId: string }) {
  const prefix = `inspections/${inspectionId}/`;
  const { data, isLoading, isError, error, refetch } = useFiles(prefix, 1000);
  const download = useDownloadUrl();

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }
  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No objects yet"
        description="Artifacts appear here as detection writes them to B2."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Object</TableHead>
            <TableHead className="w-28">Size</TableHead>
            <TableHead className="w-48">Type</TableHead>
            <TableHead className="w-24 text-right">Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((file) => {
            const relative = file.key.startsWith(prefix)
              ? file.key.slice(prefix.length)
              : file.key;
            const pending =
              download.isPending && download.variables?.key === file.key;
            return (
              <TableRow key={file.key}>
                <TableCell className="font-mono text-xs">{relative}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {file.size_human}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {file.content_type}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      download.mutate(file, {
                        onSuccess: ({ url }) =>
                          window.open(url, "_blank", "noopener,noreferrer"),
                      })
                    }
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
