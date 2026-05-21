function ProductSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      <div className="aspect-square shimmer" />
      <div className="p-3 space-y-2.5">
        <div className="h-3.5 rounded-md shimmer" />
        <div className="h-3.5 w-3/5 rounded-md shimmer" />
        <div className="h-4 w-2/5 rounded-md shimmer" />
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
