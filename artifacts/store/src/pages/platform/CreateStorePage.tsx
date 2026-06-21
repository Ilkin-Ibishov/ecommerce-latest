import { useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { platformFetch } from "@/lib/platform/fetch";
import { Button } from "@/components/ui/button";

interface FormFields {
  name: string;
  owner_email: string;
  instance_url: string;
  metrics_endpoint_url: string;
  per_store_credential_hash: string;
}

const INITIAL: FormFields = {
  name: "",
  owner_email: "",
  instance_url: "",
  metrics_endpoint_url: "",
  per_store_credential_hash: "",
};

export default function CreateStorePage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormFields>(INITIAL);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormFields, string>>>({});
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  function validate(): boolean {
    const errors: Partial<Record<keyof FormFields, string>> = {};

    if (!form.name.trim()) errors.name = t("Platform.createStore.required");
    if (!form.owner_email.trim()) {
      errors.owner_email = t("Platform.createStore.required");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.owner_email)) {
      errors.owner_email = t("Platform.createStore.invalidEmail");
    }
    if (!form.instance_url.trim()) {
      errors.instance_url = t("Platform.createStore.required");
    } else if (!isValidUrl(form.instance_url)) {
      errors.instance_url = t("Platform.createStore.invalidUrl");
    }
    if (!form.metrics_endpoint_url.trim()) {
      errors.metrics_endpoint_url = t("Platform.createStore.required");
    } else if (!isValidUrl(form.metrics_endpoint_url)) {
      errors.metrics_endpoint_url = t("Platform.createStore.invalidUrl");
    }
    if (!form.per_store_credential_hash.trim()) {
      errors.per_store_credential_hash = t("Platform.createStore.required");
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    setServerError("");
    if (!validate()) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await platformFetch("/platform/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (res.status === 409) {
        setServerError(t("Platform.createStore.nameConflict"));
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setServerError(json?.error ?? t("Platform.createStore.genericError"));
        return;
      }

      toast({
        title: t("Platform.createStore.successTitle"),
        description: t("Platform.createStore.successDescription").replace("{name}", form.name),
      });
      navigate("/platform");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function updateField(field: keyof FormFields, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErrors((e) => ({ ...e, [field]: undefined }));
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("Platform.createStore.title")}</h1>
        <Link
          href="/platform"
          className="text-sm text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          {t("Platform.detail.backToList")}
        </Link>
      </div>

      {serverError && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md" role="alert">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput
          label={t("Platform.createStore.nameLabel")}
          value={form.name}
          onChange={(v) => updateField("name", v)}
          error={fieldErrors.name}
          placeholder="My Store"
          maxLength={120}
        />
        <FormInput
          label={t("Platform.createStore.ownerEmailLabel")}
          type="email"
          value={form.owner_email}
          onChange={(v) => updateField("owner_email", v)}
          error={fieldErrors.owner_email}
          placeholder="owner@example.com"
        />
        <FormInput
          label={t("Platform.createStore.instanceUrlLabel")}
          type="url"
          value={form.instance_url}
          onChange={(v) => updateField("instance_url", v)}
          error={fieldErrors.instance_url}
          placeholder="https://store.example.com"
        />
        <FormInput
          label={t("Platform.createStore.metricsUrlLabel")}
          type="url"
          value={form.metrics_endpoint_url}
          onChange={(v) => updateField("metrics_endpoint_url", v)}
          error={fieldErrors.metrics_endpoint_url}
          placeholder="https://store.example.com/api/metrics"
        />
        <FormInput
          label={t("Platform.createStore.credentialHashLabel")}
          value={form.per_store_credential_hash}
          onChange={(v) => updateField("per_store_credential_hash", v)}
          error={fieldErrors.per_store_credential_hash}
          placeholder="sha256:…"
        />

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? t("Platform.createStore.submitting") : t("Platform.createStore.submit")}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/platform")}>
            {t("Platform.plans.cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FormInput({
  label,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className="w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error && (
        <p id={errorId} className="text-destructive text-xs mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}
