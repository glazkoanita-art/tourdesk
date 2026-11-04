-- TourDesk hardening for future fresh installs after 001 and 002.
-- Restrict trigger function and prevent anonymous RPC access to RLS helpers.
revoke all on function public.create_personal_workspace() from public, anon, authenticated;
revoke all on function public.is_member(uuid),public.can_edit(uuid),public.has_tour_access(uuid,boolean) from public, anon;
