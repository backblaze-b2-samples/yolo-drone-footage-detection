"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

import type { Inspection } from "@yolo-drone-footage-detection/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ApiError } from "@/lib/api-client";
import { useUpdateInspection } from "@/lib/queries";
import {
  DetectionParamsFields,
  detectionParamsSchema,
  toDetectionParams,
  toFormParams,
} from "./detection-params-fields";

const editSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  params: detectionParamsSchema,
});

type EditValues = z.infer<typeof editSchema>;

export function InspectionEditDialog({ inspection }: { inspection: Inspection }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateInspection(inspection.id);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: inspection.name,
      params: toFormParams(inspection.params),
    },
  });

  // Re-seed the form from the latest inspection every time the dialog opens so
  // it always opens PRE-FILLED with the real params (no default hints).
  const handleOpenChange = (next: boolean) => {
    if (next) {
      form.reset({
        name: inspection.name,
        params: toFormParams(inspection.params),
      });
    }
    setOpen(next);
  };

  const onSubmit = (values: EditValues) => {
    update.mutate(
      { name: values.name, params: toDetectionParams(values.params) },
      {
        onSuccess: () => {
          toast.success("Inspection updated", {
            description: "Run detection again to apply the new parameters.",
          });
          setOpen(false);
        },
        onError: (err) => {
          const message =
            err instanceof ApiError ? err.message : "Could not update inspection";
          toast.error("Update failed", { description: message });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit inspection</DialogTitle>
          <DialogDescription>
            Change the name and detection parameters. Saving does not re-run
            detection — use “Run detection” afterward to apply them.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DetectionParamsFields />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
