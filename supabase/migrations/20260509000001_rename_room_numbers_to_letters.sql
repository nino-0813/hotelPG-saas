-- ============================================================
-- Rename existing room_number values (digits -> letters)
-- This is needed when the DB was already seeded with 101/201/301...
-- before switching to A/B/C... naming.
--
-- NOTE:
-- - We only update rooms.room_number. room_id is stable, so reservations/tasks remain intact.
-- - Mappings are scoped per property to avoid cross-property collisions.
-- ============================================================

-- PG-I: 101-104 -> A-D
with
  map(old_room_number, new_room_number) as (
    values
      ('101', 'A'),
      ('102', 'B'),
      ('103', 'C'),
      ('104', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG1'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.reservations res
set room_id = pairs.new_room_id
from pairs
where res.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('101', 'A'),
      ('102', 'B'),
      ('103', 'C'),
      ('104', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG1'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.tasks t
set room_id = pairs.new_room_id
from pairs
where t.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('101', 'A'),
      ('102', 'B'),
      ('103', 'C'),
      ('104', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG1'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.room_status rs
set room_id = pairs.new_room_id
from pairs
where rs.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('101', 'A'),
      ('102', 'B'),
      ('103', 'C'),
      ('104', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG1'
  ),
  pairs as (
    select
      ro.id as old_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
delete from public.rooms r
using pairs
where r.id = pairs.old_room_id
  and not exists (select 1 from public.reservations res where res.room_id = r.id)
  and not exists (select 1 from public.tasks t where t.room_id = r.id)
  and not exists (select 1 from public.room_status rs where rs.room_id = r.id);

with
  map(old_room_number, new_room_number) as (
    values
      ('101', 'A'),
      ('102', 'B'),
      ('103', 'C'),
      ('104', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG1'
  )
update public.rooms r
set room_number = m.new_room_number
from prop p, map m
where r.property_id = p.id
  and r.room_number = m.old_room_number
  and not exists (
    select 1
    from public.rooms r2
    where r2.property_id = r.property_id
      and r2.room_number = m.new_room_number
  );

-- PG-II: 201-205 -> family A/B/E, single C/D
with
  map(old_room_number, new_room_number) as (
    values
      ('201', 'A'),
      ('202', 'B'),
      ('203', 'E'),
      ('204', 'C'),
      ('205', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG2'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.reservations res
set room_id = pairs.new_room_id
from pairs
where res.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('201', 'A'),
      ('202', 'B'),
      ('203', 'E'),
      ('204', 'C'),
      ('205', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG2'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.tasks t
set room_id = pairs.new_room_id
from pairs
where t.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('201', 'A'),
      ('202', 'B'),
      ('203', 'E'),
      ('204', 'C'),
      ('205', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG2'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.room_status rs
set room_id = pairs.new_room_id
from pairs
where rs.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('201', 'A'),
      ('202', 'B'),
      ('203', 'E'),
      ('204', 'C'),
      ('205', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG2'
  ),
  pairs as (
    select
      ro.id as old_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
delete from public.rooms r
using pairs
where r.id = pairs.old_room_id
  and not exists (select 1 from public.reservations res where res.room_id = r.id)
  and not exists (select 1 from public.tasks t where t.room_id = r.id)
  and not exists (select 1 from public.room_status rs where rs.room_id = r.id);

with
  map(old_room_number, new_room_number) as (
    values
      ('201', 'A'),
      ('202', 'B'),
      ('203', 'E'),
      ('204', 'C'),
      ('205', 'D')
  ),
  prop as (
    select id from public.properties where code = 'PG2'
  )
update public.rooms r
set room_number = m.new_room_number
from prop p, map m
where r.property_id = p.id
  and r.room_number = m.old_room_number
  and not exists (
    select 1
    from public.rooms r2
    where r2.property_id = r.property_id
      and r2.room_number = m.new_room_number
  );

-- PG-III: 301-310 -> A-J
with
  map(old_room_number, new_room_number) as (
    values
      ('301', 'A'),
      ('302', 'B'),
      ('303', 'C'),
      ('304', 'D'),
      ('305', 'E'),
      ('306', 'F'),
      ('307', 'G'),
      ('308', 'H'),
      ('309', 'I'),
      ('310', 'J')
  ),
  prop as (
    select id from public.properties where code = 'PG3'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.reservations res
set room_id = pairs.new_room_id
from pairs
where res.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('301', 'A'),
      ('302', 'B'),
      ('303', 'C'),
      ('304', 'D'),
      ('305', 'E'),
      ('306', 'F'),
      ('307', 'G'),
      ('308', 'H'),
      ('309', 'I'),
      ('310', 'J')
  ),
  prop as (
    select id from public.properties where code = 'PG3'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.tasks t
set room_id = pairs.new_room_id
from pairs
where t.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('301', 'A'),
      ('302', 'B'),
      ('303', 'C'),
      ('304', 'D'),
      ('305', 'E'),
      ('306', 'F'),
      ('307', 'G'),
      ('308', 'H'),
      ('309', 'I'),
      ('310', 'J')
  ),
  prop as (
    select id from public.properties where code = 'PG3'
  ),
  pairs as (
    select
      ro.id as old_room_id,
      rn.id as new_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
update public.room_status rs
set room_id = pairs.new_room_id
from pairs
where rs.room_id = pairs.old_room_id;

with
  map(old_room_number, new_room_number) as (
    values
      ('301', 'A'),
      ('302', 'B'),
      ('303', 'C'),
      ('304', 'D'),
      ('305', 'E'),
      ('306', 'F'),
      ('307', 'G'),
      ('308', 'H'),
      ('309', 'I'),
      ('310', 'J')
  ),
  prop as (
    select id from public.properties where code = 'PG3'
  ),
  pairs as (
    select
      ro.id as old_room_id
    from prop p
    join map m on true
    left join public.rooms ro
      on ro.property_id = p.id and ro.room_number = m.old_room_number
    left join public.rooms rn
      on rn.property_id = p.id and rn.room_number = m.new_room_number
    where ro.id is not null and rn.id is not null and ro.id <> rn.id
  )
delete from public.rooms r
using pairs
where r.id = pairs.old_room_id
  and not exists (select 1 from public.reservations res where res.room_id = r.id)
  and not exists (select 1 from public.tasks t where t.room_id = r.id)
  and not exists (select 1 from public.room_status rs where rs.room_id = r.id);

with
  map(old_room_number, new_room_number) as (
    values
      ('301', 'A'),
      ('302', 'B'),
      ('303', 'C'),
      ('304', 'D'),
      ('305', 'E'),
      ('306', 'F'),
      ('307', 'G'),
      ('308', 'H'),
      ('309', 'I'),
      ('310', 'J')
  ),
  prop as (
    select id from public.properties where code = 'PG3'
  )
update public.rooms r
set room_number = m.new_room_number
from prop p, map m
where r.property_id = p.id
  and r.room_number = m.old_room_number
  and not exists (
    select 1
    from public.rooms r2
    where r2.property_id = r.property_id
      and r2.room_number = m.new_room_number
  );

