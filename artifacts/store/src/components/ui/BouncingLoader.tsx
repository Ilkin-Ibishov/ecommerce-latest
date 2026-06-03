interface Props {
  label?: string;
  className?: string;
}

export default function BouncingLoader({ label, className = "" }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center gap-10 py-20 ${className}`}>
      <div className="bouncing-loader">
        <div className="bouncing-circle" />
        <div className="bouncing-circle" />
        <div className="bouncing-circle" />
        <div className="bouncing-shadow" />
        <div className="bouncing-shadow" />
        <div className="bouncing-shadow" />
      </div>
      {label && (
        <p className="text-sm text-muted-foreground">{label}</p>
      )}
    </div>
  );
}
