import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ImageRef } from "@/contracts";
import { cn } from "@/lib/utils";

/** Thumbnails of images in the conversation; click one to see it full size. */
export function ImageStrip({ images, size = 96, className }: { images: ImageRef[]; size?: number; className?: string }) {
  const [shown, setShown] = useState<ImageRef | null>(null);

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            title={img.name}
            aria-label={`Open ${img.name}`}
            onClick={() => setShown(img)}
            className="shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-accent outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            style={{ width: size, height: size }}
          >
            <img src={img.url} alt={img.name} loading="lazy" draggable={false} className="size-full object-cover" />
          </button>
        ))}
      </div>
      <DialogPrimitive.Root open={shown != null} onOpenChange={(open) => !open && setShown(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onClick={() => setShown(null)}
            className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-2 p-8 outline-none"
          >
            <DialogPrimitive.Title className="text-[12px] text-white/70">{shown?.name}</DialogPrimitive.Title>
            {shown && <img src={shown.url} alt={shown.name} className="min-h-0 max-w-full rounded-lg object-contain shadow-2xl" />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

// What the server accepts (Workbench.Uploads): these types, at most 5 MB each.
export const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;
// Bigger than this and the model scales it down anyway; sending less is faster.
const MAX_EDGE = 2000;

export const isImage = (f: File) => IMAGE_TYPES.split(",").includes(f.type);

/**
 * A dropped or pasted image as the `send` op wants it: base64 without the
 * data-URL prefix. Big ones are scaled down first (GIFs are sent as they are,
 * so they keep their animation, unless they're too big to send at all).
 */
export async function encodeImage(file: File): Promise<{ data: string; mime: string; name: string }> {
  const name = file.name || "pasted image";
  let blob: Blob = file;
  if (file.type !== "image/gif" || file.size > MAX_BYTES) blob = await shrink(file);
  if (blob.size > MAX_BYTES) throw new Error(`${name} is too large (over 5 MB, even scaled down)`);
  return { data: await base64(blob), mime: blob.type, name };
}

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= MAX_BYTES) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // keep PNG (screenshots, transparency) when it fits; photos go to JPEG
    const png = file.type === "image/png" ? await toBlob(canvas, "image/png") : null;
    return png && png.size <= MAX_BYTES ? png : await toBlob(canvas, "image/jpeg", 0.88);
  } finally {
    bitmap.close();
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode image"))), type, quality));

const base64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
