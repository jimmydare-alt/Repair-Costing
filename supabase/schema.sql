-- FACE GmbH remedials app Supabase schema roll-up.
-- Run migrations in filename order from supabase/migrations.

-- 001_multi_company_foundation.sql
-- Creates profiles, companies, memberships, invitations, modules, currencies,
-- exchange rates, audit events, helper functions and seeds:
--   CoGri Group, GBP reporting/default currency
--   Face GmbH, EUR reporting/default currency

-- 002_company_owned_project_data.sql
-- Adds company_id, created_by, updated_by and currency snapshot fields to
-- existing project-owned tables where those tables already exist.

-- 003_rls_policies.sql
-- Enables Row Level Security and adds company/member/module access policies.

-- 004_storage_branding.sql
-- Creates the private company-branding bucket for PNG/JPG/WebP logos only.

-- 011_company_offices.sql
-- Adds the company office count used by new survey and remedial travel snapshots.

-- 012_rollout_hardening.sql
-- Adds protected project archiving/restoration, super-admin purge and app error references.
