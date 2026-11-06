-- comments.rating is read and written by artifacts/api-server/src/routes/comments.ts
-- but no migration or schema entry previously created it.
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS rating integer CHECK (rating >= 1 AND rating <= 5);
