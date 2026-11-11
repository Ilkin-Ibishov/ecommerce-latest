-- Migration: let allow_negative_stock work by dropping the column CHECK on on_hand.
--
-- product_variants.on_hand has carried CHECK (on_hand >= 0) since M1 (20261102100000).
-- With site_settings.allow_negative_stock = true, trg_apply_stock_movement runs an
-- unguarded UPDATE, so an oversell raised 23514 (check_violation) and rolled back instead
-- of going negative and marking negative_stock_override. The setting never worked.
-- With the setting off, the trigger's guarded UPDATE (on_hand + delta >= 0, else ST001)
-- already keeps stock non-negative, so the column CHECK is redundant there.
-- See docs/design-notes/m3-counter-sale.md Q1 (audit A1).

ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_on_hand_check;
