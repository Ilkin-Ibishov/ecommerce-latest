-- Migration: add default_address column to users table
-- Run this in the Supabase SQL Editor for your project.
alter table public.users add column if not exists default_address text;
