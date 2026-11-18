-- Migration: orders delivery fee column and automatic total computation trigger (note §2).
-- delivery_fee_azn is nullable with check (>= 0).
-- Trigger computes total_azn = subtotal_azn - discount_azn + (delivery_fee_azn if present, else 0).

ALTER TABLE public.orders ADD COLUMN delivery_fee_azn numeric(10,2) NULL
  CHECK (delivery_fee_azn >= 0);

CREATE FUNCTION public.orders_compute_total() RETURNS trigger LANGUAGE plpgsql
  SET search_path = '' AS $$
BEGIN
  NEW.total_azn := NEW.subtotal_azn - NEW.discount_azn
    + CASE WHEN NEW.delivery_fee_azn IS NULL THEN 0 ELSE NEW.delivery_fee_azn END;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_orders_compute_total BEFORE INSERT OR UPDATE OF
  subtotal_azn, discount_azn, delivery_fee_azn, total_azn ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_compute_total();
