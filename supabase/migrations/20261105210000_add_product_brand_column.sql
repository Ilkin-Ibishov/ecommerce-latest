-- products.brand is read by fn_update_search_text() (20260613123817_add_search_text_column.sql)
-- but no migration ever created it; it must have been added by hand against a real project
-- outside migration history. Recorded as a tracked migration so a fresh database matches.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand text;
