-- ─── M2c Reservations & Deposits Schema ──────────────────────────────
-- Invariant: A reservation is not a movement.
-- Three quantities are distinguished: on_hand, reserved, available.

CREATE TABLE IF NOT EXISTS public.reservations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number  text UNIQUE NOT NULL,
  variant_id          uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity            numeric(12,3) NOT NULL CHECK (quantity > 0),
  customer_name       text NOT NULL CHECK (char_length(trim(customer_name)) > 0),
  customer_phone      text NOT NULL CHECK (char_length(trim(customer_phone)) > 0),
  hold_type           text NOT NULL DEFAULT 'deposit' CHECK (hold_type IN ('deposit', 'order_hold', 'cart_hold')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'released', 'expired')),
  agreed_price        numeric(10,2) NOT NULL CHECK (agreed_price >= 0),
  paid_amount         numeric(10,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= agreed_price),
  notes               text,
  expires_at          timestamptz,
  created_by          uuid NOT NULL REFERENCES public.users(id),
  fulfilled_by        uuid REFERENCES public.users(id),
  fulfilled_at        timestamptz,
  released_by         uuid REFERENCES public.users(id),
  released_at         timestamptz,
  release_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_fulfilled_attribution CHECK (status <> 'fulfilled' OR (fulfilled_at IS NOT NULL AND fulfilled_by IS NOT NULL)),
  CONSTRAINT chk_released_attribution CHECK (status <> 'released' OR (released_at IS NOT NULL AND released_by IS NOT NULL))
);

-- Partial and lookup indexes
CREATE INDEX IF NOT EXISTS idx_reservations_active_variant
  ON public.reservations (variant_id, quantity)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_reservations_aged_list
  ON public.reservations (created_at ASC)
  WHERE status = 'active' AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_customer_phone
  ON public.reservations (customer_phone);

-- Row Level Security
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reservations: staff/admin read" ON public.reservations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

CREATE POLICY "Reservations: staff insert" ON public.reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
    AND status = 'active'
    AND created_by = auth.uid()
    AND fulfilled_by IS NULL
    AND released_by IS NULL
  );

CREATE POLICY "Reservations: staff update" ON public.reservations
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'))
  WITH CHECK (
    status IN ('active', 'fulfilled')
    AND agreed_price = (SELECT r.agreed_price FROM public.reservations r WHERE r.id = reservations.id)
  );

CREATE POLICY "Reservations: admin all" ON public.reservations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
