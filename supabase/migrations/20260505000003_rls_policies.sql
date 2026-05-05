-- ============================================================
-- HotelPG SaaS: Row Level Security policies
--   admin: 全テーブルの全操作
--   staff: 自分の assigned_property_ids 内のデータのみ参照/更新
--          assigned_property_ids が空配列の場合は全プロパティを許可
--          (運用初期向けのフォールバック)
-- ============================================================

-- ------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------
create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where id = auth.uid();
$$;

create or replace function public.current_staff_property_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select assigned_property_ids from public.staff where id = auth.uid();
$$;

create or replace function public.staff_can_access_property(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_staff_role() = 'admin'
    or (
      public.current_staff_role() = 'staff'
      and (
        coalesce(array_length(public.current_staff_property_ids(), 1), 0) = 0
        or p_property_id = any(public.current_staff_property_ids())
      )
    );
$$;

-- ------------------------------------------------------------
-- Enable RLS
-- ------------------------------------------------------------
alter table public.properties       enable row level security;
alter table public.rooms            enable row level security;
alter table public.staff            enable row level security;
alter table public.reservations     enable row level security;
alter table public.tasks            enable row level security;
alter table public.room_status      enable row level security;
alter table public.task_status_log  enable row level security;
alter table public.notification_log enable row level security;

-- ------------------------------------------------------------
-- properties
-- ------------------------------------------------------------
create policy "properties_admin_all" on public.properties
  for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

create policy "properties_staff_read" on public.properties
  for select to authenticated
  using (auth.uid() is not null);

-- ------------------------------------------------------------
-- rooms
-- ------------------------------------------------------------
create policy "rooms_admin_all" on public.rooms
  for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

create policy "rooms_staff_read" on public.rooms
  for select to authenticated
  using (public.staff_can_access_property(property_id));

-- ------------------------------------------------------------
-- staff
-- ------------------------------------------------------------
create policy "staff_admin_all" on public.staff
  for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

create policy "staff_self_read" on public.staff
  for select to authenticated
  using (id = auth.uid());

-- ------------------------------------------------------------
-- reservations
-- ------------------------------------------------------------
create policy "reservations_admin_all" on public.reservations
  for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

create policy "reservations_staff_read" on public.reservations
  for select to authenticated
  using (
    public.current_staff_role() = 'staff'
    and exists (
      select 1 from public.rooms r
      where r.id = reservations.room_id
        and public.staff_can_access_property(r.property_id)
    )
  );

-- ------------------------------------------------------------
-- tasks
-- ------------------------------------------------------------
create policy "tasks_admin_all" on public.tasks
  for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

create policy "tasks_staff_read" on public.tasks
  for select to authenticated
  using (
    public.current_staff_role() = 'staff'
    and exists (
      select 1 from public.rooms r
      where r.id = tasks.room_id
        and public.staff_can_access_property(r.property_id)
    )
  );

create policy "tasks_staff_update" on public.tasks
  for update to authenticated
  using (
    public.current_staff_role() = 'staff'
    and (assignee_id = auth.uid() or assignee_id is null)
    and exists (
      select 1 from public.rooms r
      where r.id = tasks.room_id
        and public.staff_can_access_property(r.property_id)
    )
  )
  with check (
    public.current_staff_role() = 'staff'
    and (assignee_id = auth.uid() or assignee_id is null)
  );

-- ------------------------------------------------------------
-- room_status
-- ------------------------------------------------------------
create policy "room_status_admin_all" on public.room_status
  for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

create policy "room_status_staff_read" on public.room_status
  for select to authenticated
  using (auth.uid() is not null);

create policy "room_status_staff_update" on public.room_status
  for update to authenticated
  using (
    public.current_staff_role() = 'staff'
    and exists (
      select 1 from public.rooms r
      where r.id = room_status.room_id
        and public.staff_can_access_property(r.property_id)
    )
  );

-- ------------------------------------------------------------
-- Logs (admin read only; writes go via SECURITY DEFINER triggers)
-- ------------------------------------------------------------
create policy "task_status_log_admin_read" on public.task_status_log
  for select to authenticated
  using (public.current_staff_role() = 'admin');

create policy "notification_log_admin_read" on public.notification_log
  for select to authenticated
  using (public.current_staff_role() = 'admin');
