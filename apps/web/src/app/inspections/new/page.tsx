import { InspectionCreateForm } from "@/components/inspections/inspection-create-form";

export default function NewInspectionPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">New inspection</h1>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground text-pretty">
          Upload a drone or dashcam video and choose detection parameters.
          Detection runs automatically once the upload lands on B2 — you can
          re-run it any time from the inspection.
        </p>
      </div>
      <div className="animate-fade-in-up stagger-2">
        <InspectionCreateForm />
      </div>
    </div>
  );
}
