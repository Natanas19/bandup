"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("pt-BR") || "•";
}

export default function ProfileAvatar({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  useEffect(() => setFailedImage(null), [imageUrl]);
  const showImage = !!imageUrl && imageUrl !== failedImage;

  return <span aria-hidden="true" className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline bg-accent-soft text-sm font-bold text-accent sm:h-12 sm:w-12">
    {showImage ? <Image src={imageUrl!} alt="" fill sizes="48px" unoptimized className="object-cover" onError={() => setFailedImage(imageUrl!)} /> : initials(name)}
  </span>;
}
