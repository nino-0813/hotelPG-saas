import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const root = process.cwd();
// Compile local TS without adding a test runtime or loading real server credentials.
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file);
    const compiled = { exports: {} };
    cache.set(file, compiled.exports);
    const nativeRequire = createRequire(file);
    function localRequire(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
        const source = [base, `${base}.ts`, `${base}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (source?.match(/\.tsx?$/)) return load(source);
      }
      return nativeRequire(name);
    }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    }, fileName: file }).outputText;
    new Function('require', 'module', 'exports', code)(localRequire, compiled, compiled.exports);
    cache.set(file, compiled.exports);
    return compiled.exports;
  }
  return load;
}

function database(initial = {}, options = {}) {
  const state = { external_calendars: [{ id: 'cal', enabled: true, ics_url: 'https://fixture.invalid/calendar', target_room_type: 'standard', property_id: 'property', source: 'ota' }],
    reservations: [], rooms: [], room_blocks: [], tasks: [], staff: [], ...structuredClone(initial) };
  const calls = [];
  const client = { from(table) {
    let verb = 'select', payload, single = false;
    const filters = [];
    const query = {
      select() { return query; }, returns() { return query; }, order() { return query; },
      eq(k,v) { filters.push(r => r[k] === v); return query; },
      neq(k,v) { filters.push(r => r[k] !== v); return query; },
      in(k,v) { filters.push(r => v.includes(r[k])); return query; },
      is(k,v) { filters.push(r => (r[k] ?? null) === v); return query; },
      not(k,op,v) { assert.equal(op, 'is'); filters.push(r => r[k] !== v); return query; },
      lt(k,v) { filters.push(r => r[k] < v); return query; },
      lte(k,v) { filters.push(r => r[k] <= v); return query; },
      gt(k,v) { filters.push(r => r[k] > v); return query; },
      gte(k,v) { filters.push(r => r[k] >= v); return query; },
      single() { single = true; return query; },
      insert(value) { verb = 'insert'; payload = value; return query; },
      update(value) { verb = 'update'; payload = value; return query; },
      then(resolve, reject) {
        try {
          calls.push({ table, verb, payload });
          if (options.fail?.(table, verb, payload)) return Promise.resolve({ data: null, error: { message: 'synthetic failure' } }).then(resolve, reject);
          const selected = state[table].filter(r => filters.every(f => f(r)));
          if (verb === 'insert') {
            if (state[table].some(r => r.external_uid && r.external_uid === payload.external_uid)) return Promise.resolve({ error: {message:'unique conflict'} }).then(resolve, reject);
            state[table].push({ id: `new-${state[table].length}`, ...payload });
          }
          if (verb === 'update') selected.forEach(r => Object.assign(r, payload));
          return Promise.resolve({ data: single ? selected[0] ?? null : structuredClone(selected), error: null, count: selected.length }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return query;
  } };
  return { client, state, calls };
}
function event(uid = 'uid', extra = '') {
  return `BEGIN:VEVENT\nUID:${uid}\nSUMMARY:Same name\nDTSTART;VALUE=DATE:20300101\nDTEND;VALUE=DATE:20300104\n${extra}\nEND:VEVENT`;
}
function calendar(...events) { return `BEGIN:VCALENDAR\n${events.join('\n')}\nEND:VCALENDAR`; }
async function sync(db, text) {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://fixture.invalid/calendar');
    return new Response(text);
  };
  try { return await loader()('lib/ical/sync.ts').syncOneCalendar(db.client, 'cal'); }
  finally { globalThis.fetch = original; }
}
const booking = { id: 'existing', external_uid: 'uid', external_calendar_id: 'cal', room_id: 'room', status: 'confirmed', check_in_time: '17:00', check_out_time: '12:30' };

test('new import defaults to 10:00; repeat sync keeps ID and intentional times/status', async () => {
  const db = database();
  let result = await sync(db, calendar(event()));
  assert.equal(result.created, 1);
  assert.equal(db.state.reservations[0].check_out_time, '10:00');
  Object.assign(db.state.reservations[0], { check_out_time: '12:30', check_in_time: '17:00', status: 'checked_in', room_id: 'room' });
  result = await sync(db, calendar(event()));
  assert.equal(result.updated, 1);
  assert.equal(db.state.reservations.length, 1);
  assert.equal(db.state.reservations[0].check_out_time, '12:30');
  assert.equal(db.state.reservations[0].check_in_time, '17:00');
  assert.equal(db.state.reservations[0].status, 'checked_in');
});
for (const reason of ['manual', 'guest-link', 'OTA']) {
  test(`${reason} cancellation retained when UID reappears`, async () => {
    const db = database({ reservations: [{ ...booking, status: 'cancelled', guest_cancelled_at: reason === 'guest-link' ? '2030-01-01' : null }] });
    await sync(db, calendar(event()));
    assert.equal(db.state.reservations[0].status, 'cancelled');
    assert.equal(db.calls.filter(c => c.table === 'reservations' && c.verb !== 'select').length, 0);
  });
}
test('OTA missing UID and explicit STATUS:CANCELLED cancel existing reservations', async () => {
  for (const text of [calendar(), calendar(event('uid', 'STATUS:CANCELLED'))]) {
    const db = database({ reservations: [booking] });
    const result = await sync(db, text);
    assert.equal(result.cancelled, 1);
    assert.equal(db.state.reservations[0].status, 'cancelled');
  }
});
test('duplicate UID in one feed produces one new reservation', async () => {
  const db = database();
  const result = await sync(db, calendar(event(), event()));
  assert.equal(result.created, 1);
  assert.equal(db.state.reservations.length, 1);
});
test('new cancelled event is not imported', async () => {
  const db = database();
  await sync(db, calendar(event('new', 'STATUS:CANCELLED')));
  assert.equal(db.state.reservations.length, 0);
});
test('read failure fails closed; partial write/cancellation failures are reported', async () => {
  const db = database({}, { fail: (table, verb) => table === 'reservations' && verb === 'select' });
  assert.equal((await sync(db, calendar(event()))).ok, false);
  assert.equal(db.calls.filter(c => c.verb !== 'select').length, 0);
  const partial = database({ reservations: [booking] }, { fail: (table, verb) => table === 'reservations' && verb === 'update' });
  assert.equal((await sync(partial, calendar(event('new')))).ok, false);
  assert.equal(partial.state.external_calendars[0].last_sync_status, 'error');
});

const room = { room_number: 'A', property: { name: 'Synthetic hotel' } };
const stay = { id: 'stay', room_id: 'room', guest_name: 'Same name', guest_count: 2, check_in_date: '2030-01-01', check_out_date: '2030-01-04', check_in_time: '15:00', status: 'confirmed', room, special_notes: null };
function cleaning(overrides = {}) {
  return { id: 'task', reservation_id: 'stay', room_id: 'room', type: 'cleaning', status: 'todo', assignee_id: null,
    scheduled_for: '2030-01-04T01:00:00.000Z', cleaning_date: '2030-01-04', cleaning_origin: 'checkout',
    cleaning_requirement: 'required', superseded_at: null, room, reservation: { ...stay, check_out_time: '10:00' }, ...overrides };
}
function page(db) {
  return loader({ '@/lib/supabase/server': { getCachedSupabaseAuth: async () => ({supabase:db.client, user:{id:'staff'}}) },
    'next/navigation': { useRouter: () => ({ push() {} }), redirect() { throw Error('redirect'); } },
    './actions': { updateCleaningTask: async () => ({ok:true}), setStayCleaningRequirement: async () => ({ok:true}) },
  })('app/(dashboard)/housekeeping/page.tsx').default;
}
test('3-night arrival, both middle dates (unconfirmed), departure and same-day turnover UI', async () => {
  const next = {...stay, id:'next', check_in_date:'2030-01-04', check_out_date:'2030-01-05'};
  const db = database({ reservations: [stay, next], tasks:[cleaning()] });
  const Page = page(db);
  for (const date of ['2030-01-01','2030-01-02','2030-01-03','2030-01-04']) {
    const element = await Page({searchParams: Promise.resolve({date})});
    const html = renderToStaticMarkup(element);
    if (date === '2030-01-01') { assert.equal(element.props.checkIns.length,1); assert.equal(element.props.stays.length,0); }
    if (['2030-01-02','2030-01-03'].includes(date)) {
      assert.equal(element.props.stays.length,1); assert.match(html,/滞在中/); assert.match(html,/selected="">未確認/);
    }
    if (date === '2030-01-04') { assert.equal(element.props.tasks.length,1); assert.equal(element.props.checkIns[0].id,'next'); assert.match(html,/チェックアウト清掃/); assert.match(html,/チェックイン/); }
  }
});
test('cancelled linked tasks hidden; standalone manual work retained; JST half-open boundaries', async () => {
  const db = database({tasks: [
    cleaning({ id:'cancelled', reservation:{...stay,status:'cancelled'} }),
    cleaning({ id:'retired', superseded_at:'2030-01-01' }),
    cleaning({ id:'unreadable', reservation:null }),
    cleaning({ id:'manual', reservation_id:null, reservation:null, cleaning_origin:null }),
    cleaning({ id:'start', scheduled_for:'2030-01-03T15:00:00.000Z' }),
    cleaning({ id:'end', scheduled_for:'2030-01-04T15:00:00.000Z' }),
  ]});
  const element = await page(db)({searchParams:Promise.resolve({date:'2030-01-04'})});
  assert.deepEqual(element.props.tasks.map(t=>t.id),['manual','start']);
});
test('saved not-required display has no start/complete actions; required display has controls', async () => {
  for (const requirement of ['required','not_required']) {
    const db = database({reservations:[stay],tasks:[cleaning({cleaning_origin:'stay',cleaning_date:'2030-01-02',scheduled_for:'2030-01-02T01:00:00.000Z',cleaning_requirement:requirement})]});
    const html=renderToStaticMarkup(await page(db)({searchParams:Promise.resolve({date:'2030-01-02'})}));
    assert.match(html,new RegExp(`value="${requirement}" selected`));
    assert.equal(html.includes('作業開始'),requirement==='required');
  }
});
test('same-name stays in different reservations never share decisions', async () => {
  const other={...stay,id:'other',room_id:'other-room',room:{...room,room_number:'B'}};
  const db=database({reservations:[stay,other],tasks:[cleaning({cleaning_origin:'stay',cleaning_date:'2030-01-02',scheduled_for:'2030-01-02T01:00:00.000Z',cleaning_requirement:'not_required'})]});
  const html=renderToStaticMarkup(await page(db)({searchParams:Promise.resolve({date:'2030-01-02'})}));
  assert.equal((html.match(/value="not_required" selected/g)||[]).length,1);
  assert.equal((html.match(/value="unconfirmed" selected/g)||[]).length,1);
});
test('query errors do not render a misleading empty list',async()=>{
  const db=database({}, {fail:table=>table==='tasks'});
  await assert.rejects(()=>page(db)({searchParams:Promise.resolve({date:'2030-01-01'})}),/取得できません/);
});

test('cancellation during sync cannot be resurrected or counted as updated', async () => {
  let db;
  db = database({ reservations: [booking] }, { fail: (table, verb) => {
    if (table === 'reservations' && verb === 'update') db.state.reservations[0].status = 'cancelled';
    return false;
  } });
  const result = await sync(db, calendar(event()));
  assert.equal(result.updated, 0);
  assert.equal(db.state.reservations[0].status, 'cancelled');
});

test('server action sends reservation ID/date/decision to scoped RPC, revalidates and reports failures', async () => {
  const calls=[], invalidated=[];
  let loggedIn=true, fail=false;
  const client={auth:{getUser:async()=>({data:{user:loggedIn?{id:'staff'}:null}})},rpc:async(name,args)=>{calls.push({name,args});return {error:fail?{message:'denied'}:null};}};
  const actions=loader({'@/lib/supabase/server':{createClient:async()=>client},'next/cache':{revalidatePath:p=>invalidated.push(p)}})('app/(dashboard)/housekeeping/actions.ts');
  assert.deepEqual(await actions.setStayCleaningRequirement('reservation-id','2030-01-02','not_required'),{ok:true});
  assert.deepEqual(calls[0],{name:'set_stay_cleaning_requirement',args:{p_reservation_id:'reservation-id',p_date:'2030-01-02',p_requirement:'not_required'}});
  assert.deepEqual(invalidated,['/tasks','/housekeeping','/rooms']);
  fail=true;
  assert.ok((await actions.setStayCleaningRequirement('reservation-id','2030-01-02','required')).error);
  loggedIn=false;
  const before=calls.length;
  assert.ok((await actions.setStayCleaningRequirement('reservation-id','2030-01-02','required')).error);
  assert.equal(calls.length,before);
});
test('cleaning action refuses cancelled/unknown work and preserves completed_at on assignment', async () => {
  const db=database({tasks:[cleaning({status:'done',completed_at:'2030-01-04T01:30:00Z'})]});
  db.client.auth={getUser:async()=>({data:{user:{id:'staff'}}})};
  const actions=loader({'@/lib/supabase/server':{createClient:async()=>db.client},'next/cache':{revalidatePath(){}}})('app/(dashboard)/housekeeping/actions.ts');
  assert.deepEqual(await actions.updateCleaningTask('task','done','staff'),{ok:true});
  assert.equal(db.state.tasks[0].completed_at,'2030-01-04T01:30:00Z');
  db.state.tasks[0].reservation.status='cancelled';
  assert.ok((await actions.updateCleaningTask('task','todo','staff')).error);
  assert.ok((await actions.updateCleaningTask('missing','todo','staff')).error);
});
