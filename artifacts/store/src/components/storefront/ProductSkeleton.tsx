import { Shimmer } from "@/components/ui/shimmer"

function ProductSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      <Shimmer className="aspect-square" />
      <div className="p-3 space-y-2.5">
        <Shimmer className="h-3.5 rounded-md" />
        <Shimmer className="h-3.5 w-3/5 rounded-md" />
        <Shimmer className="h-4 w-2/5 rounded-md" />
      </div>
    </div>
  );
}

export function ProductSkeletonGrid({
  count = 8,
  className = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`grid ${className} gap-4`}>
      {Array.from({ length: count }, (_, i) => (
        <ProductSkeleton key={i} />
      ))}
    </div>
  );
}

export default ProductSkeleton;
