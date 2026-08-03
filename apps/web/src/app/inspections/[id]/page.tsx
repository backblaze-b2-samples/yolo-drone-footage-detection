import { InspectionDetail } from "@/components/inspections/inspection-detail";

export default async function InspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="animate-fade-in">
      <InspectionDetail id={id} />
    </div>
  );
}
