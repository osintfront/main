-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 36 — Gaza Strip places
--  1. country_iso(): Palestine / Gaza / West Bank → PS (GeoNames country of Gaza and the
--     West Bank, now imported: geonames-import {"country":"PS"} + OSM names, see
--     tools/osm/merge_osm_places.sql with v_cc = 'PS').
--  2. gaza_strip(): the Strip's border (rough polygon, same as src/lib/eventFilters.ts).
--  3. Hebrew names for the Strip's towns, camps and neighbourhoods (GeoNames has few),
--     and the places GeoNames lacks (camps, corridors, crossings, hospitals).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.country_iso(p text)
returns text language sql immutable set search_path = '' as $$
  select case lower(btrim(coalesce(p, '')))
    when 'israel' then 'IL' when 'ישראל' then 'IL'
    when 'syria' then 'SY' when 'סוריה' then 'SY'
    when 'lebanon' then 'LB' when 'לבנון' then 'LB'
    when 'iraq' then 'IQ' when 'עיראק' then 'IQ'
    when 'yemen' then 'YE' when 'תימן' then 'YE'
    when 'saudi arabia' then 'SA' when 'סעודיה' then 'SA' when 'ערב הסעודית' then 'SA'
    when 'iran' then 'IR' when 'איראן' then 'IR'
    when 'palestine' then 'PS' when 'palestinian territories' then 'PS' when 'state of palestine' then 'PS'
    when 'gaza' then 'PS' when 'gaza strip' then 'PS' when 'west bank' then 'PS'
    when 'פלסטין' then 'PS' when 'עזה' then 'PS' when 'רצועת עזה' then 'PS' when 'הגדה המערבית' then 'PS'
    when 'יהודה ושומרון' then 'PS' when 'הרשות הפלסטינית' then 'PS'
  end;
$$;

create or replace function public.gaza_strip()
returns extensions.geometry language sql immutable set search_path = '' as $$
  select extensions.st_geomfromtext('POLYGON((34.2166 31.3236,34.267 31.22,34.356 31.289,34.382 31.356,34.44 31.43,34.472 31.468,34.505 31.5,34.545 31.53,34.5664 31.5586,34.53 31.564,34.49 31.596,34.2166 31.3236))', 4326);
$$;

-- Hebrew names: matched by an English/Arabic name of a PS place inside the Strip.
with names(match, he) as (values
  ('Gaza', 'עזה'), ('Khan Yunis', 'חאן יונס'), ('Jabalia', 'ג''באליה'), ('Rafah', 'רפיח'),
  ('Deir el-Balah', 'דיר אל-בלח'), ('Beit Lahia', 'בית להיא'), ('Beit Hanoun', 'בית חאנון'),
  ('An Nusayrat', 'נוסייראת'), ('Al Burayj', 'בורייג'''), ('Bani Suheila', 'בני סוהילה'),
  ('Al-Qarara', 'אל-קרארה'), ('Az Zuwaydah', 'א-זוויידה'), ('Az-Zawayda', 'א-זוויידה'),
  ('Khuza''ah', 'ח''זאעה'), ('Khuza''a', 'ח''זאעה'), ('Abasan al Kabirah', 'עבסאן אל-כבירה'),
  ('Abasan al Jadidah', 'עבסאן אל-ג''דידה'), ('Abasan al-Saghira', 'עבסאן אל-צע''ירה'),
  ('Al Mughraqah', 'אל-מע''ראקה'), ('Al-Mughraqa', 'אל-מע''ראקה'), ('Al Fukhkhari', 'אל-פח''ארי'),
  ('al Fukhari', 'אל-פח''ארי'), ('Wadi as Salqa', 'ואדי א-סלקא'), ('Juhr ad Dik', 'ג''וחר א-דיכ'),
  ('Umm an Nasr', 'אום א-נאסר'), ('Al Mawasi', 'אל-מוואסי'), ('Remal', 'רימאל'),
  ('Ar Rimal al Janubi', 'רימאל הדרומית'), ('Ar Rimal ash Shamali', 'רימאל הצפונית'),
  ('As Sabra', 'סברה'), ('Ash Shaykh Ijlin', 'שייח'' עג''לין'), ('Az Zaytun', 'זייתון'),
  ('Ash Shaykh Radwan', 'שייח'' רדואן'), ('Ad Daraj', 'א-דרג'''), ('At Tuffah', 'א-תופאח'),
  ('Maydan ash Shujaiyah', 'שג''אעייה'), ('At Turkman', 'א-תורכמאן'), ('An Nasr', 'א-נאסר'),
  ('Shokat as-Sufi', 'שוכת א-סופי'), ('Tall az Zurub', 'תל א-זערוב'), ('Qizan an Najjar', 'קיזאן א-נג''אר'),
  ('Al Madinah al Qadimah', 'העיר העתיקה של עזה'), ('Atatra', 'אל-עטאטרה'), ('Al-Zahra''', 'א-זהרא'),
  ('Madinat al Awdah', 'מדינת אל-עודה'), ('Al Mashahirah', 'אל-משאהרה'), ('Al Amal', 'אל-אמל'),
  ('Nezarim', 'נצרים'), ('Newe Deqalim', 'נווה דקלים'), ('Neveh Dekalim', 'נווה דקלים'),
  ('Kefar Darom', 'כפר דרום'), ('Gan Or', 'גן אור'), ('Nisanit', 'ניסנית'), ('Dugit', 'דוגית'),
  ('Elei Sinai', 'אלי סיני'), ('Morag', 'מורג'), ('Kefar Yam', 'כפר ים'), ('Gadid', 'גדיד'),
  ('Bedolah', 'בדולח'), ('Nahal Qatif', 'נצר קטיף'), ('Qatif', 'קטיף'), ('Pe''at Sade', 'פאת שדה'),
  ('Bene Azmon', 'בני עצמון')
)
update public.geo_places g set
  name_he = n.he, he_from_ai = false,
  names = (select array_agg(distinct x) from unnest(g.names || public.normalize_places(array[n.he])) x)
from names n
where g.country_code = 'PS'
  and extensions.st_within(g.geom, public.gaza_strip())
  and g.names @> array[public.normalize_place(n.match)]
  and (g.name_he is null or g.he_from_ai or g.name_he = n.he);

-- Places GeoNames lacks (or has only as a building): camps, corridors, crossings, hospitals.
-- geonameid -9000000000000000-n (never clashes with GeoNames ids or the OSM node ids).
with extra(n, he, en, ar, lat, lng, cls, code) as (values
  (1, 'מחנה הפליטים ג''באליה', 'Jabalia camp', 'مخيم جباليا', 31.5317, 34.4831, 'P', 'PPL'),
  (2, 'מחנה שאטי', 'Al-Shati camp', 'مخيم الشاطئ', 31.5313, 34.4447, 'P', 'PPL'),
  (3, 'מע''אזי', 'Maghazi', 'المغازي', 31.4217, 34.3889, 'P', 'PPL'),
  (4, 'תל א-סולטאן', 'Tal al-Sultan', 'تل السلطان', 31.3050, 34.2380, 'P', 'PPLX'),
  (5, 'שאבורה', 'Shaboura', 'الشابورة', 31.2899, 34.2496, 'P', 'PPLX'),
  (6, 'תל אל-הווא', 'Tel al-Hawa', 'تل الهوى', 31.5040, 34.4440, 'P', 'PPLX'),
  (7, 'ציר נצרים', 'Netzarim Corridor', 'محور نتساريم', 31.4580, 34.4100, 'L', 'RGN'),
  (8, 'ציר פילדלפי', 'Philadelphi Corridor', 'محور فيلادلفيا', 31.2700, 34.2700, 'L', 'RGN'),
  (9, 'מעבר רפיח', 'Rafah crossing', 'معبر رفح', 31.2470, 34.2600, 'S', 'PSTB'),
  (10, 'בית החולים שיפא', 'Al-Shifa Hospital', 'مستشفى الشفاء', 31.5236, 34.4440, 'S', 'HSP'),
  (11, 'בית החולים נאסר', 'Nasser Hospital', 'مجمع ناصر الطبي', 31.3478, 34.2935, 'S', 'HSP'),
  (12, 'מחנה נוסייראת', 'Nuseirat camp', 'مخيم النصيرات', 31.4483, 34.3925, 'P', 'PPL'),
  (13, 'מחנה בורייג''', 'Bureij camp', 'مخيم البريج', 31.4400, 34.4030, 'P', 'PPL'),
  (14, 'שג''אעייה', 'Shuja''iyya', 'الشجاعية', 31.5000, 34.4800, 'P', 'PPLX'),
  (15, 'זייתון', 'Zeitoun', 'الزيتون', 31.4950, 34.4580, 'P', 'PPLX'),
  (16, 'מחנה חאן יונס', 'Khan Younis camp', 'مخيم خان يونس', 31.3450, 34.2900, 'P', 'PPLX')
)
insert into public.geo_places (geonameid, name, name_he, name_ar, name_en, names, country_code, feature_class, feature_code, population, geom)
select -(9000000000000000 + e.n), e.en, e.he, e.ar, e.en, public.normalize_places(array[e.he, e.en, e.ar]), 'PS', e.cls, e.code, 0,
       extensions.st_setsrid(extensions.st_makepoint(e.lng, e.lat), 4326)
from extra e
where not exists (
  select 1 from public.geo_places g
  where g.country_code = 'PS' and g.names && public.normalize_places(array[e.he, e.en, e.ar])
    and extensions.st_dwithin(g.geom, extensions.st_setsrid(extensions.st_makepoint(e.lng, e.lat), 4326), 0.03)
)
on conflict (geonameid) do nothing;
