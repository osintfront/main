-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 5 — automatic location resolution
--
-- Events that arrive without coordinates (e.g. WhatsApp imports that only
-- say "לבנון" or "דרום לבנון") are placed on the map from their place
-- fields using a curated gazetteer. Resolution goes from most to least
-- specific: location name → its comma parts → city → region → country.
-- The result's precision is stored so the UI can say "approximate".
--
-- Imported drafts from configured sources are auto-published once they
-- have a location (setting: app_settings.auto_publish).
-- ════════════════════════════════════════════════════════════════════

-- ─── Columns ───────────────────────────────────────────────────────
alter table public.events
  add column location_precision text
  check (location_precision in ('exact', 'city', 'region', 'country'));

update public.events set location_precision = 'exact' where latitude is not null and location_precision is null;

-- Public read surface gains the precision column.
grant select (location_precision) on public.events to anon;

-- ─── Settings ──────────────────────────────────────────────────────
create table public.app_settings (
  key         text primary key check (key ~ '^[a-z_]{1,60}$'),
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
create policy "settings: staff read" on public.app_settings for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "settings: managers write" on public.app_settings for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create or replace function public.app_settings_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select id from public.profiles where id = auth.uid());
  perform public.write_audit('settings.changed', 'settings', null,
    jsonb_build_object('key', new.key, 'from', old.value, 'to', new.value));
  return new;
end;
$$;
create trigger app_settings_stamp before update on public.app_settings
  for each row execute function public.app_settings_stamp();
revoke execute on function public.app_settings_stamp() from public, anon, authenticated;

insert into public.app_settings (key, value) values
  ('auto_publish', '{"enabled": true, "source_prefixes": ["WhatsApp"]}');

-- ─── Name normalisation ────────────────────────────────────────────
-- Lower-case, strip Hebrew points/cantillation, turn punctuation (including
-- geresh ׳/' and gershayim ״/") into spaces, collapse whitespace.
create or replace function public.normalize_place(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(lower(coalesce(p, '')), '[֑-ׇ]', '', 'g'),
    '[^a-z0-9א-ת؀-ۿ]+', ' ', 'g'));
$$;

create or replace function public.normalize_places(p text[])
returns text[] language sql immutable parallel safe set search_path = '' as $$
  select coalesce(array_agg(distinct public.normalize_place(x)) filter (where public.normalize_place(x) <> ''), '{}')
  from unnest(p) x;
$$;

-- ─── Gazetteer ─────────────────────────────────────────────────────
create table public.place_gazetteer (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('city', 'region', 'country')),
  canonical     text not null,
  country_code  text check (country_code ~ '^[a-z]{2}$'),
  latitude      numeric(9, 6) not null check (latitude between -90 and 90),
  longitude     numeric(9, 6) not null check (longitude between -180 and 180),
  names         text[] not null,
  names_norm    text[] generated always as (public.normalize_places(names)) stored,
  created_at    timestamptz not null default now()
);
create index place_gazetteer_names_idx on public.place_gazetteer using gin (names_norm);

alter table public.place_gazetteer enable row level security;
revoke all on public.place_gazetteer from anon;
create policy "gazetteer: staff read" on public.place_gazetteer for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "gazetteer: managers write" on public.place_gazetteer for all to authenticated
  using ((select public.has_permission('category.manage')))
  with check ((select public.has_permission('category.manage')));

insert into public.place_gazetteer (kind, canonical, country_code, latitude, longitude, names) values
-- Countries / territories (points inside each country, not on borders or at sea)
('country','Israel','il',31.400000,35.000000,'{ישראל,israel}'),
('country','Lebanon','lb',33.850000,35.860000,'{לבנון,lebanon,lebanese}'),
('country','Syria','sy',35.000000,38.500000,'{סוריה,syria}'),
('country','Iraq','iq',33.200000,43.700000,'{עיראק,עירק,iraq}'),
('country','Iran','ir',32.400000,53.700000,'{איראן,iran}'),
('country','Jordan','jo',31.200000,36.500000,'{ירדן,jordan}'),
('country','Egypt','eg',26.800000,30.800000,'{מצרים,egypt}'),
-- Bare "עזה/Gaza" is ambiguous (city or strip): it resolves to the Strip at approximate precision.
('country','Gaza Strip','ps',31.420000,34.370000,'{רצועת עזה,עזה,gaza,gaza strip,the gaza strip}'),
('country','West Bank','ps',32.000000,35.250000,'{הגדה המערבית,יהודה ושומרון,איו ש,west bank,judea and samaria}'),
('country','Yemen','ye',15.600000,48.000000,'{תימן,yemen}'),
('country','Saudi Arabia','sa',24.000000,45.000000,'{ערב הסעודית,סעודיה,saudi arabia}'),
('country','Turkey','tr',39.000000,35.200000,'{טורקיה,turkey,türkiye}'),
('country','Cyprus','cy',35.000000,33.200000,'{קפריסין,cyprus}'),
('country','United Arab Emirates','ae',24.000000,54.000000,'{איחוד האמירויות,האמירויות,uae,united arab emirates}'),
('country','Qatar','qa',25.300000,51.200000,'{קטאר,qatar}'),
('country','Bahrain','bh',26.070000,50.550000,'{בחריין,bahrain}'),
('country','Kuwait','kw',29.300000,47.600000,'{כווית,kuwait}'),
('country','Oman','om',21.000000,57.000000,'{עומאן,oman}'),
-- Regions / areas
('region','Middle East',null,29.500000,42.000000,'{המזרח התיכון,מזרח התיכון,middle east,the middle east}'),
('region','South Lebanon','lb',33.270000,35.400000,'{דרום לבנון,south lebanon,southern lebanon}'),
('region','Bekaa Valley','lb',33.850000,36.000000,'{בקעת הלבנון,הבקאע,הבקעא,bekaa,bekaa valley}'),
('region','Dahiyeh (Beirut)','lb',33.850000,35.510000,'{הדאחיה,דאחיה,דאחייה,dahieh,dahiyeh}'),
('region','Litani River','lb',33.330000,35.250000,'{הליטני,ליטני,litani}'),
('region','Golan Heights','il',33.000000,35.750000,'{רמת הגולן,הגולן,golan,golan heights}'),
('region','Mount Hermon','il',33.410000,35.860000,'{החרמון,חרמון,הר החרמון,mount hermon,hermon}'),
('region','Galilee','il',32.900000,35.400000,'{הגליל,גליל,galilee}'),
('region','Upper Galilee','il',33.050000,35.500000,'{הגליל העליון,גליל עליון,upper galilee}'),
('region','Western Galilee','il',32.980000,35.150000,'{הגליל המערבי,גליל מערבי,western galilee}'),
('region','Northern Israel','il',32.900000,35.400000,'{צפון ישראל,הצפון,northern israel}'),
('region','Confrontation line (Israel–Lebanon)','il',33.100000,35.400000,'{קו העימות,גבול לבנון,הגבול הצפוני,israel lebanon border}'),
('region','Gaza envelope','il',31.450000,34.480000,'{עוטף עזה,gaza envelope}'),
('region','Negev','il',30.800000,34.800000,'{הנגב,נגב,negev}'),
('region','Jordan Valley','il',32.000000,35.520000,'{בקעת הירדן,jordan valley}'),
('region','Sinai','eg',29.500000,33.800000,'{סיני,חצי האי סיני,sinai}'),
('region','Southern Syria','sy',32.900000,36.200000,'{דרום סוריה,south syria,southern syria}'),
('region','Quneitra Governorate','sy',33.100000,35.850000,'{מחוז קונייטרה,quneitra governorate}'),
('region','Rif Dimashq','sy',33.500000,36.400000,'{ריף דמשק,רייף דמשק,rif dimashq,damascus countryside}'),
('region','Iraq–Iran border','iq',33.500000,45.800000,'{גבול עיראק איראן,גבול איראן עיראק,הגבול העיראקי האיראני,iraq iran border}'),
('region','Southwest Iran (Khuzestan)','ir',31.300000,48.700000,'{דרום מערב איראן,חוזסתאן,khuzestan,southwest iran,southwestern iran}'),
('region','Strait of Hormuz',null,26.570000,56.250000,'{מצר הורמוז,מיצרי הורמוז,הורמוז,strait of hormuz,hormuz}'),
('region','Persian Gulf',null,27.000000,51.500000,'{המפרץ הפרסי,persian gulf,the gulf}'),
('region','Red Sea',null,20.000000,38.500000,'{הים האדום,red sea}'),
('region','Bab el-Mandeb',null,12.600000,43.400000,'{באב אל מנדב,bab el mandeb,bab al mandab}'),
('region','Eastern Mediterranean',null,33.500000,34.000000,'{מזרח הים התיכון,eastern mediterranean}'),
-- Israel
('city','Jerusalem','il',31.768300,35.213700,'{ירושלים,jerusalem,al quds}'),
('city','Tel Aviv','il',32.085300,34.781800,'{תל אביב,תל אביב יפו,tel aviv}'),
('city','Haifa','il',32.794000,34.989600,'{חיפה,haifa}'),
('city','Beersheba','il',31.252000,34.791500,'{באר שבע,beersheba,beer sheva}'),
('city','Ashkelon','il',31.668800,34.574300,'{אשקלון,ashkelon}'),
('city','Ashdod','il',31.801400,34.643500,'{אשדוד,ashdod}'),
('city','Sderot','il',31.525000,34.596400,'{שדרות,sderot}'),
('city','Netivot','il',31.423100,34.588600,'{נתיבות,netivot}'),
('city','Ofakim','il',31.314100,34.620300,'{אופקים,ofakim}'),
('city','Kiryat Shmona','il',33.207300,35.571300,'{קריית שמונה,קרית שמונה,kiryat shmona}'),
('city','Metula','il',33.279700,35.578600,'{מטולה,metula}'),
('city','Nahariya','il',33.005900,35.098100,'{נהריה,nahariya}'),
('city','Acre','il',32.928100,35.081800,'{עכו,acre,akko}'),
('city','Safed','il',32.964600,35.496000,'{צפת,safed,tzfat}'),
('city','Tiberias','il',32.795900,35.530900,'{טבריה,tiberias}'),
('city','Karmiel','il',32.917100,35.304900,'{כרמיאל,karmiel}'),
('city','Shlomi','il',33.077300,35.144500,'{שלומי,shlomi}'),
('city','Maalot-Tarshiha','il',33.016700,35.271700,'{מעלות תרשיחא,מעלות,maalot}'),
('city','Katzrin','il',32.992700,35.690100,'{קצרין,katzrin}'),
('city','Eilat','il',29.557700,34.951900,'{אילת,eilat}'),
('city','Dimona','il',31.068600,35.033300,'{דימונה,dimona}'),
('city','Netanya','il',32.321500,34.853200,'{נתניה,netanya}'),
('city','Herzliya','il',32.166300,34.843300,'{הרצליה,herzliya}'),
('city','Rishon LeZion','il',31.973000,34.792500,'{ראשון לציון,rishon lezion}'),
('city','Petah Tikva','il',32.087100,34.887500,'{פתח תקווה,פתח תקוה,petah tikva}'),
('city','Holon','il',31.999700,34.779400,'{חולון,holon}'),
('city','Bat Yam','il',32.023100,34.750300,'{בת ים,bat yam}'),
('city','Ramat Gan','il',32.068400,34.824800,'{רמת גן,ramat gan}'),
('city','Bnei Brak','il',32.080700,34.833800,'{בני ברק,bnei brak}'),
('city','Rehovot','il',31.892800,34.811300,'{רחובות,rehovot}'),
('city','Modiin','il',31.896900,35.009500,'{מודיעין,modiin}'),
('city','Kfar Saba','il',32.178200,34.907600,'{כפר סבא,kfar saba}'),
('city','Hadera','il',32.434000,34.919000,'{חדרה,hadera}'),
('city','Afula','il',32.607800,35.289700,'{עפולה,afula}'),
('city','Nazareth','il',32.699600,35.303500,'{נצרת,nazareth}'),
('city','Beit Shean','il',32.497300,35.496400,'{בית שאן,beit shean}'),
('city','Kiryat Gat','il',31.610000,34.764200,'{קריית גת,קרית גת,kiryat gat}'),
('city','Ariel','il',32.104700,35.171400,'{אריאל,ariel}'),
('city','Maale Adumim','il',31.777200,35.298400,'{מעלה אדומים,maale adumim}'),
-- West Bank / Gaza
('city','Jenin','ps',32.460900,35.295800,'{ג''נין,גנין,jenin}'),
('city','Nablus','ps',32.221100,35.254400,'{שכם,nablus}'),
('city','Tulkarm','ps',32.310400,35.028600,'{טולכרם,tulkarm}'),
('city','Qalqilya','ps',32.189600,34.970600,'{קלקיליה,qalqilya}'),
('city','Ramallah','ps',31.903800,35.203400,'{רמאללה,ramallah}'),
('city','Hebron','ps',31.532600,35.099800,'{חברון,hebron}'),
('city','Bethlehem','ps',31.705400,35.202400,'{בית לחם,bethlehem}'),
('city','Jericho','ps',31.866700,35.450000,'{יריחו,jericho}'),
('city','Tubas','ps',32.320900,35.369800,'{טובאס,tubas}'),
('city','Gaza City','ps',31.501700,34.466800,'{העיר עזה,עזה העיר,gaza city}'),
('city','Khan Younis','ps',31.346200,34.306300,'{חאן יונס,ח''אן יונס,khan younis}'),
('city','Rafah','ps',31.296900,34.243600,'{רפיח,rafah}'),
('city','Deir al-Balah','ps',31.416700,34.350000,'{דיר אל בלח,deir al balah}'),
('city','Beit Hanoun','ps',31.538900,34.536700,'{בית חאנון,beit hanoun}'),
('city','Beit Lahia','ps',31.550000,34.500000,'{בית להיא,beit lahia}'),
('city','Jabalia','ps',31.528100,34.483100,'{ג''באליה,גבאליה,jabalia}'),
('city','Nuseirat','ps',31.450000,34.390000,'{נוסייראת,נוסיראת,nuseirat}'),
-- Lebanon
('city','Beirut','lb',33.893800,35.501800,'{ביירות,beirut}'),
('city','Tyre','lb',33.270500,35.203800,'{צור,tyre,sour}'),
('city','Sidon','lb',33.557100,35.372900,'{צידון,צידא,sidon,saida}'),
('city','Nabatieh','lb',33.377200,35.483900,'{נבטיה,נבטייה,nabatieh}'),
('city','Bint Jbeil','lb',33.119700,35.433100,'{בינת ג''בייל,בנת ג''בייל,bint jbeil}'),
('city','Marjayoun','lb',33.360300,35.591700,'{מרג''עיון,מרגעיון,marjayoun}'),
('city','Hasbaya','lb',33.397600,35.685300,'{חאצביא,hasbaya}'),
('city','Baalbek','lb',34.004700,36.211000,'{בעלבק,baalbek}'),
('city','Zahle','lb',33.846300,35.902000,'{זחלה,zahle}'),
('city','Tripoli (Lebanon)','lb',34.436700,35.849700,'{טריפולי,tripoli}'),
('city','Hermel','lb',34.394200,36.384700,'{הרמל,hermel}'),
('city','Khiam','lb',33.328300,35.610600,'{ח''יאם,חיאם,אל ח''יאם,khiam,el khiam}'),
('city','Kfar Kila','lb',33.283300,35.550000,'{כפר כילא,kfar kila}'),
('city','Naqoura','lb',33.116700,35.133300,'{נאקורה,naqoura}'),
('city','Aita al-Shaab','lb',33.098900,35.338100,'{עיתא א שעב,עיתא אש שעב,aita al shaab}'),
('city','Meifadoun','lb',33.332600,35.509600,'{מיפדון,meifadoun}'),
-- Syria
('city','Damascus','sy',33.513800,36.276500,'{דמשק,damascus}'),
('city','Aleppo','sy',36.202100,37.134300,'{חלב,aleppo}'),
('city','Homs','sy',34.732400,36.713700,'{חומס,homs}'),
('city','Hama','sy',35.131800,36.757800,'{חמה,hama}'),
('city','Latakia','sy',35.531700,35.790100,'{לטקיה,latakia}'),
('city','Tartus','sy',34.889000,35.886600,'{טרטוס,tartus}'),
('city','Daraa','sy',32.618900,36.102100,'{דרעא,daraa}'),
('city','Suwayda','sy',32.708900,36.569500,'{סווידא,א סווידא,suwayda,sweida}'),
('city','Quneitra','sy',33.125900,35.824400,'{קונייטרה,קוניטרה,quneitra}'),
('city','Deir ez-Zor','sy',35.335900,40.140800,'{דיר א זור,דיר אל זור,deir ez zor}'),
('city','Abu Kamal','sy',34.450800,40.918200,'{אבו כמאל,אל בוכמאל,abu kamal,al bukamal}'),
('city','Palmyra','sy',34.556000,38.267800,'{תדמור,palmyra}'),
('city','Qatana','sy',33.436600,36.078900,'{קוטנה,קטנה,qatana}'),
-- Iraq
('city','Baghdad','iq',33.315200,44.366100,'{בגדד,baghdad}'),
('city','Erbil','iq',36.191100,44.009200,'{ארביל,erbil}'),
('city','Basra','iq',30.508500,47.780400,'{בצרה,basra}'),
('city','Mosul','iq',36.340000,43.130000,'{מוסול,mosul}'),
('city','Karbala','iq',32.616000,44.024900,'{כרבלא,karbala}'),
('city','Najaf','iq',31.999600,44.314900,'{נג''ף,נגף,najaf}'),
-- Iran
('city','Tehran','ir',35.689200,51.389000,'{טהרן,tehran}'),
('city','Isfahan','ir',32.654600,51.668000,'{איספהאן,אספהאן,isfahan}'),
('city','Shiraz','ir',29.591800,52.583700,'{שיראז,shiraz}'),
('city','Tabriz','ir',38.080000,46.291900,'{תבריז,tabriz}'),
('city','Mashhad','ir',36.260500,59.616800,'{משהד,mashhad}'),
('city','Bandar Abbas','ir',27.183200,56.266600,'{בנדר עבאס,bandar abbas}'),
('city','Ahvaz','ir',31.318300,48.670600,'{אחוואז,אהוואז,ahvaz}'),
('city','Kermanshah','ir',34.314200,47.065000,'{כרמאנשאה,קרמנשאה,kermanshah}'),
('city','Natanz','ir',33.723800,51.727600,'{נתנז,natanz}'),
('city','Bushehr','ir',28.923400,50.820300,'{בושהר,bushehr}'),
-- Yemen, Jordan, Egypt, Cyprus, Turkey, Gulf
('city','Sanaa','ye',15.369400,44.191000,'{צנעא,sanaa}'),
('city','Hodeidah','ye',14.797800,42.954500,'{חודיידה,hodeidah}'),
('city','Aden','ye',12.785500,45.018700,'{עדן,aden}'),
('city','Amman','jo',31.953900,35.910600,'{עמאן,amman}'),
('city','Aqaba','jo',29.532100,35.006300,'{עקבה,aqaba}'),
('city','Cairo','eg',30.044400,31.235700,'{קהיר,cairo}'),
('city','El Arish','eg',31.131600,33.798400,'{אל עריש,el arish}'),
('city','Larnaca','cy',34.900300,33.623200,'{לרנקה,larnaca}'),
('city','Nicosia','cy',35.185600,33.382300,'{ניקוסיה,nicosia}'),
('city','Ankara','tr',39.933400,32.859700,'{אנקרה,ankara}'),
('city','Istanbul','tr',41.008200,28.978400,'{איסטנבול,istanbul}'),
('city','Doha','qa',25.285400,51.531000,'{דוחה,doha}');

-- ─── Resolver ──────────────────────────────────────────────────────
create or replace function public.lookup_place(p_name text)
returns public.place_gazetteer language plpgsql stable set search_path = '' as $$
declare
  v_norm text := public.normalize_place(p_name);
  v_try  text;
  v_row  public.place_gazetteer;
begin
  if v_norm = '' then return null; end if;
  -- Exact name, then the name without one Hebrew prefix letter (ה/ב/ל/מ/ו), e.g. "בבעלבק" → "בעלבק".
  foreach v_try in array array[v_norm, case when v_norm ~ '^[הבלמו][\u05D0-\u05EA]{2}' then substr(v_norm, 2) end] loop
    continue when v_try is null;
    select * into v_row from public.place_gazetteer g
    where g.names_norm @> array[v_try]
    order by case g.kind when 'city' then 1 when 'region' then 2 else 3 end
    limit 1;
    if found then return v_row; end if;
  end loop;
  return null;
end;
$$;

-- Most specific match among the event's place fields.
create or replace function public.resolve_event_place(
  p_location_name text, p_city text, p_region text, p_country text
)
returns table (place_id uuid, matched_on text)
language plpgsql stable set search_path = '' as $$
declare
  v_candidates text[] := '{}';
  v_part text;
  v_hit public.place_gazetteer;
begin
  v_candidates := v_candidates || coalesce(p_location_name, '');
  foreach v_part in array regexp_split_to_array(coalesce(p_location_name, ''), '\s*[,،;|]\s*|\s+[-–—]\s+') loop
    v_candidates := v_candidates || v_part;
  end loop;
  v_candidates := v_candidates || coalesce(p_city, '') || coalesce(p_region, '');
  foreach v_part in array regexp_split_to_array(coalesce(p_country, ''), '\s*[/,]\s*') loop
    v_candidates := v_candidates || v_part;
  end loop;

  foreach v_part in array v_candidates loop
    continue when btrim(v_part) = '';
    v_hit := public.lookup_place(v_part);
    if v_hit.id is not null then
      place_id := v_hit.id;
      matched_on := v_part;
      return next;
      return;
    end if;
  end loop;
end;
$$;

-- Deterministic scatter so many "Lebanon"-level events don't stack on one pixel.
create or replace function public.place_jitter(p_seed uuid, p_kind text, p_axis int)
returns numeric language sql immutable set search_path = '' as $$
  select ((abs(hashtext(p_seed::text || p_axis::text)::bigint) % 1000) / 1000.0 - 0.5)
         * case p_kind when 'country' then 0.30 when 'region' then 0.12 else 0.01 end;
$$;

-- BEFORE INSERT/UPDATE: runs before events_before_* (trigger names fire alphabetically).
create or replace function public.events_resolve_location()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_place     public.place_gazetteer;
  v_place_id  uuid;
  v_matched   text;
  v_settings  jsonb;
  v_prefix    text;
  v_imported  boolean := false;
begin
  -- Coordinates supplied by a person or an importer are exact unless the writer says otherwise.
  if new.latitude is not null and new.longitude is not null then
    if new.location_precision is null then
      new.location_precision := 'exact';
    elsif tg_op = 'UPDATE'
          and (new.latitude, new.longitude) is distinct from (old.latitude, old.longitude)
          and new.location_precision is not distinct from old.location_precision
          and old.location_precision <> 'exact' then
      -- Someone moved an approximate pin without stating a precision: treat as exact.
      new.location_precision := 'exact';
    end if;
  elsif new.latitude is null and new.longitude is null then
    select r.place_id, r.matched_on into v_place_id, v_matched
    from public.resolve_event_place(new.location_name, new.city, new.region, new.country) r;
    if v_place_id is not null then
      select * into v_place from public.place_gazetteer where id = v_place_id;
      new.latitude  := round(v_place.latitude + public.place_jitter(new.id, v_place.kind, 1), 6);
      new.longitude := round(v_place.longitude + public.place_jitter(new.id, v_place.kind, 2), 6);
      new.location_precision := v_place.kind;
      new.geocoding_confidence := case v_place.kind when 'city' then 0.8 when 'region' then 0.5 else 0.3 end;
      if coalesce(new.country, '') = '' and v_place.kind = 'country' then
        new.country := v_place.canonical;
      end if;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object(
          'method', 'gazetteer', 'matched_on', v_matched, 'place', v_place.canonical,
          'kind', v_place.kind, 'country_code', v_place.country_code, 'resolved_at', now()));
    end if;
  end if;

  -- Auto-publish imported drafts once they have everything publishing needs.
  if tg_op = 'INSERT' and new.status = 'draft' then
    select value into v_settings from public.app_settings where key = 'auto_publish';
    if coalesce((v_settings ->> 'enabled')::boolean, false) then
      for v_prefix in select jsonb_array_elements_text(coalesce(v_settings -> 'source_prefixes', '[]'::jsonb)) loop
        if coalesce(new.source_name, '') ilike v_prefix || '%' then v_imported := true; end if;
      end loop;
      if v_imported and new.latitude is not null and new.category_id is not null and btrim(new.title) <> '' then
        new.status := 'published';
        new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object('auto_published', true);
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.events_resolve_location() from public, anon, authenticated;

create trigger events_a_resolve_location before insert or update on public.events
  for each row execute function public.events_resolve_location();

-- ─── Public view: expose precision ────────────────────────────────
create or replace view public.published_events
with (security_invoker = true, security_barrier = true)
as
select
  e.id, e.title, e.description, e.severity, e.latitude, e.longitude,
  e.location_name, e.country, e.region, e.city,
  e.source_name, e.source_url, e.source_type,
  e.occurred_at, e.published_at, e.updated_at,
  e.is_breaking, e.is_verified, e.translations, e.category_id,
  c.slug as category_slug, c.name as category_name, c.icon as category_icon,
  c.color as category_color, c.marker_color as category_marker_color,
  e.location_precision
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'published'
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null;
grant select on public.published_events to anon, authenticated;

-- ─── Backfill existing events ─────────────────────────────────────
-- 1) Resolve locations for events without coordinates (touch → trigger).
update public.events set location_name = location_name
where latitude is null and deleted_at is null;

-- 2) Publish imported drafts that now have a location.
update public.events e
set status = 'published',
    ai_suggestions = e.ai_suggestions || '{"auto_published": true}'::jsonb
where e.status = 'draft' and e.deleted_at is null
  and e.latitude is not null and e.category_id is not null and btrim(e.title) <> ''
  and exists (
    select 1 from public.app_settings s, jsonb_array_elements_text(s.value -> 'source_prefixes') p(prefix)
    where s.key = 'auto_publish' and (s.value ->> 'enabled')::boolean and coalesce(e.source_name, '') ilike p.prefix || '%'
  );
