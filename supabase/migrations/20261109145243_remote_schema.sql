SET local check_function_bodies = off;

CREATE EXTENSION "fuzzystrmatch" SCHEMA "extensions";

CREATE EXTENSION "http" SCHEMA "extensions";

CREATE EXTENSION "pg_cron";

CREATE EXTENSION "pg_net" SCHEMA "public";

CREATE EXTENSION "postgis" SCHEMA "extensions";

CREATE SEQUENCE "public"."ai_search_log_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."ai_usage_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."ais_crossings_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."category_corrections_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."geo_staging_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."hfc_alerts_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."intel_items_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."learned_terms_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

REVOKE ALL ON SEQUENCE "public"."learned_terms_id_seq" FROM "anon";

CREATE SEQUENCE "public"."search_quota_log_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."wadi_lines_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE TABLE "public"."administrator_invitations" (
  "id"        uuid NOT NULL DEFAULT gen_random_uuid(),
  "email"     text NOT NULL,
  "full_name" text NOT NULL DEFAULT ''::text,
  CONSTRAINT "administrator_invitations_email_check" CHECK (((char_length(email) <= 254) AND (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'::text))),
  CONSTRAINT "administrator_invitations_full_name_check" CHECK ((char_length(full_name) <= 120)),
  CONSTRAINT "administrator_invitations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."administrator_invitations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."administrator_invitations" FROM "anon";

CREATE TABLE "public"."ai_cache" (
  "kind"       text                     NOT NULL,
  "key"        text                     NOT NULL,
  "result"     jsonb                    NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ai_cache_pkey" PRIMARY KEY (kind, key)
);

ALTER TABLE "public"."ai_cache"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."ai_cache" FROM "anon", "authenticated";

CREATE TABLE "public"."ai_search_log" (
  "id"       bigint                   NOT NULL DEFAULT nextval('public.ai_search_log_id_seq'::regclass),
  "at"       timestamp with time zone NOT NULL DEFAULT now(),
  "user_id"  uuid,
  "question" text                     NOT NULL,
  "results"  integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "ai_search_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ai_search_log"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."ai_search_log" FROM "anon", "authenticated";

CREATE TABLE "public"."ai_usage" (
  "id"            bigint                   NOT NULL DEFAULT nextval('public.ai_usage_id_seq'::regclass),
  "at"            timestamp with time zone NOT NULL DEFAULT now(),
  "fn"            text                     NOT NULL,
  "purpose"       text                     NOT NULL,
  "model"         text                     NOT NULL,
  "input_tokens"  integer                  NOT NULL DEFAULT 0,
  "output_tokens" integer                  NOT NULL DEFAULT 0,
  "cache_read"    integer                  NOT NULL DEFAULT 0,
  "cache_write"   integer                  NOT NULL DEFAULT 0,
  "web_searches"  integer                  NOT NULL DEFAULT 0,
  "cost_usd"      numeric(12,6)            NOT NULL DEFAULT 0,
  "event_id"      uuid,
  "user_id"       uuid,
  CONSTRAINT "ai_usage_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ai_usage"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."ai_usage" FROM "anon";

CREATE TABLE "public"."ais_crossings" (
  "id"        bigint                   NOT NULL DEFAULT nextval('public.ais_crossings_id_seq'::regclass),
  "gate"      text                     NOT NULL,
  "mmsi"      bigint                   NOT NULL,
  "dir"       smallint                 NOT NULL,
  "at"        timestamp with time zone NOT NULL DEFAULT now(),
  "ship_type" smallint,
  "name"      text,
  CONSTRAINT "ais_crossings_dir_check" CHECK ((dir = ANY (ARRAY['-1'::integer, 1]))),
  CONSTRAINT "ais_crossings_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ais_crossings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ais_gates" (
  "id"         text             NOT NULL,
  "chokepoint" text             NOT NULL,
  "a_lat"      double precision NOT NULL,
  "a_lng"      double precision NOT NULL,
  "b_lat"      double precision NOT NULL,
  "b_lng"      double precision NOT NULL,
  "pos_en"     text             NOT NULL,
  "neg_en"     text             NOT NULL,
  "pos_he"     text             NOT NULL,
  "neg_he"     text             NOT NULL,
  "wp_name_en" text,
  "wp_name_he" text,
  "wp_min_lat" double precision,
  "wp_min_lng" double precision,
  "wp_max_lat" double precision,
  "wp_max_lng" double precision,
  "wn_name_en" text,
  "wn_name_he" text,
  "wn_min_lat" double precision,
  "wn_min_lng" double precision,
  "wn_max_lat" double precision,
  "wn_max_lng" double precision,
  CONSTRAINT "ais_gates_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ais_gates"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ais_vessels" (
  "mmsi"        bigint                   NOT NULL,
  "name"        text,
  "callsign"    text,
  "imo"         bigint,
  "ship_type"   smallint,
  "destination" text,
  "eta"         text,
  "length_m"    smallint,
  "lat"         double precision         NOT NULL,
  "lng"         double precision         NOT NULL,
  "sog"         real,
  "cog"         real,
  "heading"     smallint,
  "nav_status"  smallint,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "static_at"   timestamp with time zone,
  CONSTRAINT "ais_vessels_pkey" PRIMARY KEY (mmsi)
);

ALTER TABLE "public"."ais_vessels"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."api_keys" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"         text                     NOT NULL,
  "owner_email"  text,
  "user_id"      uuid,
  "tier"         text                     NOT NULL,
  "key_hash"     text                     NOT NULL,
  "key_prefix"   text                     NOT NULL,
  "created_by"   uuid,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"   timestamp with time zone,
  "revoked_at"   timestamp with time zone,
  "last_used_at" timestamp with time zone,
  CONSTRAINT "api_keys_key_hash_key" UNIQUE (key_hash),
  CONSTRAINT "api_keys_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."api_keys"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."api_tiers" (
  "id"             text    NOT NULL,
  "name"           text    NOT NULL,
  "daily_limit"    integer NOT NULL,
  "per_minute"     integer NOT NULL,
  "redistribution" boolean NOT NULL DEFAULT false,
  "sort"           integer NOT NULL DEFAULT 0,
  CONSTRAINT "api_tiers_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."api_tiers"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."api_usage_minute" (
  "key_id" uuid                     NOT NULL,
  "minute" timestamp with time zone NOT NULL,
  "calls"  integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "api_usage_minute_pkey" PRIMARY KEY (key_id, minute)
);

ALTER TABLE "public"."api_usage_minute"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."api_usage" (
  "key_id" uuid    NOT NULL,
  "day"    date    NOT NULL,
  "calls"  integer NOT NULL DEFAULT 0,
  CONSTRAINT "api_usage_pkey" PRIMARY KEY (key_id, day)
);

ALTER TABLE "public"."api_usage"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."app_settings" (
  "key"        text                     NOT NULL,
  "value"      jsonb                    NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" uuid,
  CONSTRAINT "app_settings_key_check" CHECK ((key ~ '^[a-z_]{1,60}$'::text)),
  CONSTRAINT "app_settings_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."app_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."audit_logs" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     uuid,
  "action"      text                     NOT NULL,
  "entity_type" text                     NOT NULL,
  "entity_id"   uuid,
  "metadata"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "ip_address"  text,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_logs"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."audit_logs" FROM "anon";

CREATE TABLE "public"."category_corrections" (
  "id"         bigint                   NOT NULL DEFAULT nextval('public.category_corrections_id_seq'::regclass),
  "event_id"   uuid,
  "text"       text                     NOT NULL,
  "from_slug"  text                     NOT NULL,
  "to_slug"    text                     NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "category_corrections_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."category_corrections"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."category_corrections" FROM "anon";

CREATE TABLE "public"."control_areas" (
  "id"         text                     NOT NULL,
  "region"     text                     NOT NULL,
  "name"       text                     NOT NULL,
  "kind"       text                     NOT NULL,
  "color"      text                     NOT NULL,
  "geometry"   jsonb                    NOT NULL,
  "folder"     text,
  "first_seen" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "control_areas_kind_check" CHECK ((kind = ANY (ARRAY['polygon'::text, 'line'::text]))),
  CONSTRAINT "control_areas_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."control_areas"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."event_categories" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"         text                     NOT NULL,
  "slug"         text                     NOT NULL,
  "description"  text                     NOT NULL DEFAULT ''::text,
  "icon"         text                     NOT NULL DEFAULT 'CircleDot'::text,
  "color"        text                     NOT NULL,
  "marker_color" text                     NOT NULL,
  "is_active"    boolean                  NOT NULL DEFAULT true,
  "sort_order"   integer                  NOT NULL DEFAULT 100,
  "translations" jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "event_categories_color_check" CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text)),
  CONSTRAINT "event_categories_description_check" CHECK ((char_length(description) <= 500)),
  CONSTRAINT "event_categories_icon_check" CHECK ((icon ~ '^[A-Za-z0-9]{1,40}$'::text)),
  CONSTRAINT "event_categories_marker_color_check" CHECK ((marker_color ~ '^#[0-9a-fA-F]{6}$'::text)),
  CONSTRAINT "event_categories_name_check" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
  CONSTRAINT "event_categories_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_categories_slug_check" CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
  CONSTRAINT "event_categories_slug_key" UNIQUE (slug),
  CONSTRAINT "event_categories_translations_check" CHECK ((jsonb_typeof(translations) = 'object'::text))
);

ALTER TABLE "public"."event_categories"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_categories" FROM "anon";

CREATE TABLE "public"."event_history" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"        uuid                     NOT NULL,
  "action"          text                     NOT NULL,
  "previous_values" jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "new_values"      jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "changed_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "event_history_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."event_history"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_history" FROM "anon";

CREATE TABLE "public"."event_internal_notes" (
  "event_id"   uuid                     NOT NULL,
  "notes"      text                     NOT NULL DEFAULT ''::text,
  "updated_by" uuid,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "event_internal_notes_notes_check" CHECK ((char_length(notes) <= 5000)),
  CONSTRAINT "event_internal_notes_pkey" PRIMARY KEY (event_id)
);

ALTER TABLE "public"."event_internal_notes"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_internal_notes" FROM "anon";

CREATE TABLE "public"."event_media" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"       uuid                     NOT NULL,
  "kind"           text                     NOT NULL DEFAULT 'image'::text,
  "storage_path"   text                     NOT NULL,
  "public_url"     text                     NOT NULL,
  "width"          integer,
  "height"         integer,
  "bytes"          integer,
  "source_msg_key" text,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "ready"          boolean                  NOT NULL DEFAULT true,
  "mime"           text,
  "source_url"     text,
  "source_index"   integer,
  "video_state"    text,
  "video_state_at" timestamp with time zone,
  "video_bytes"    bigint,
  "thumb_id"       uuid,
  "sha256"         text,
  "phash"          text,
  "video_tries"    smallint                 NOT NULL DEFAULT 0,
  "video_why"      text,
  CONSTRAINT "event_media_kind_check" CHECK ((kind = ANY (ARRAY['image'::text, 'video_thumb'::text, 'video'::text]))),
  CONSTRAINT "event_media_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_media_storage_path_key" UNIQUE (storage_path),
  CONSTRAINT "event_media_video_state_check" CHECK ((video_state = ANY (ARRAY['loading'::text, 'ready'::text, 'too_big'::text, 'unavailable'::text])))
);

ALTER TABLE "public"."event_media"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."events_pulse" (
  "id"         integer                  NOT NULL,
  "changed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "events_pulse_id_check" CHECK ((id = 1)),
  CONSTRAINT "events_pulse_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."events_pulse"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."events" (
  "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
  "title"                 text NOT NULL DEFAULT ''::text,
  "description"           text NOT NULL DEFAULT ''::text,
  "original_report_text"  text NOT NULL DEFAULT ''::text,
  "category_id"           uuid,
  "suggested_category_id" uuid,
  CONSTRAINT "events_description_check" CHECK ((char_length(description) <= 5000)),
  CONSTRAINT "events_original_report_text_check" CHECK ((char_length(original_report_text) <= 10000)),
  CONSTRAINT "events_pkey" PRIMARY KEY (id),
  CONSTRAINT "events_title_check" CHECK ((char_length(title) <= 200))
);

ALTER TABLE "public"."events"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."events" FROM "anon";

CREATE TABLE "public"."feature_usage" (
  "user_id"     uuid    NOT NULL,
  "feature_key" text    NOT NULL,
  "day"         date    NOT NULL,
  "count"       integer NOT NULL DEFAULT 0,
  CONSTRAINT "feature_usage_pkey" PRIMARY KEY (user_id, feature_key, day)
);

ALTER TABLE "public"."feature_usage"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."geo_places" (
  "geonameid"     bigint                          NOT NULL,
  "name"          text                            NOT NULL,
  "name_he"       text,
  "name_ar"       text,
  "name_en"       text,
  "names"         text[]                          NOT NULL DEFAULT '{}'::text[],
  "country_code"  text                            NOT NULL,
  "feature_class" text,
  "feature_code"  text,
  "admin1"        text,
  "population"    bigint                          NOT NULL DEFAULT 0,
  "geom"          extensions.geometry(Point,4326) NOT NULL,
  "he_from_ai"    boolean                         NOT NULL DEFAULT false,
  CONSTRAINT "geo_places_country_code_check" CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT "geo_places_pkey" PRIMARY KEY (geonameid)
);

ALTER TABLE "public"."geo_places"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."geo_places" FROM "anon";

CREATE TABLE "public"."geo_staging" (
  "id"      bigint NOT NULL DEFAULT nextval('public.geo_staging_id_seq'::regclass),
  "country" text   NOT NULL,
  "kind"    text   NOT NULL,
  "content" text   NOT NULL,
  CONSTRAINT "geo_staging_kind_check" CHECK ((kind = ANY (ARRAY['dump'::text, 'alt'::text]))),
  CONSTRAINT "geo_staging_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."geo_staging"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."geo_staging" FROM "anon", "authenticated";

CREATE TABLE "public"."geoloc_jobs" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"        uuid                     NOT NULL,
  "media_id"        uuid,
  "status"          text                     NOT NULL DEFAULT 'queued'::text,
  "trigger"         text                     NOT NULL DEFAULT 'auto'::text,
  "requested_by"    uuid,
  "attempts"        smallint                 NOT NULL DEFAULT 0,
  "worker"          text,
  "claimed_at"      timestamp with time zone,
  "finished_at"     timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "error"           text,
  "target_lat"      double precision,
  "target_lng"      double precision,
  "target_label"    text,
  "camera_lat"      double precision,
  "camera_lng"      double precision,
  "camera_heading"  double precision,
  "hfov"            double precision,
  "fit_rms_px"      double precision,
  "holdout_rms_px"  double precision,
  "confidence"      text,
  "result"          jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "proof_target"    text,
  "proof_full"      text,
  "camera_released" boolean                  NOT NULL DEFAULT false,
  "released_by"     uuid,
  "released_at"     timestamp with time zone,
  CONSTRAINT "geoloc_jobs_camera_lat_check" CHECK (((camera_lat >= ('-90'::integer)::double precision) AND (camera_lat <= (90)::double precision))),
  CONSTRAINT "geoloc_jobs_camera_lng_check" CHECK (((camera_lng >= ('-180'::integer)::double precision) AND (camera_lng <= (180)::double precision))),
  CONSTRAINT "geoloc_jobs_confidence_check" CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
  CONSTRAINT "geoloc_jobs_error_check" CHECK ((char_length(error) <= 2000)),
  CONSTRAINT "geoloc_jobs_pkey" PRIMARY KEY (id),
  CONSTRAINT "geoloc_jobs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'needs_review'::text, 'failed'::text, 'skipped'::text]))),
  CONSTRAINT "geoloc_jobs_target_label_check" CHECK ((char_length(target_label) <= 300)),
  CONSTRAINT "geoloc_jobs_target_lat_check" CHECK (((target_lat >= ('-90'::integer)::double precision) AND (target_lat <= (90)::double precision))),
  CONSTRAINT "geoloc_jobs_target_lng_check" CHECK (((target_lng >= ('-180'::integer)::double precision) AND (target_lng <= (180)::double precision))),
  CONSTRAINT "geoloc_jobs_trigger_check" CHECK ((trigger = ANY (ARRAY['auto'::text, 'manual'::text])))
);

ALTER TABLE "public"."geoloc_jobs"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."geoloc_jobs" FROM "anon";

CREATE TABLE "public"."hfc_alerts" (
  "id"          bigint                   NOT NULL DEFAULT nextval('public.hfc_alerts_id_seq'::regclass),
  "alerted_at"  timestamp with time zone NOT NULL,
  "area_name"   text                     NOT NULL,
  "threat"      smallint                 NOT NULL,
  "is_drill"    boolean                  NOT NULL DEFAULT false,
  "source"      text                     NOT NULL,
  "cluster_id"  uuid,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "event_id"    uuid,
  CONSTRAINT "hfc_alerts_area_name_threat_alerted_at_key" UNIQUE (area_name, threat, alerted_at),
  CONSTRAINT "hfc_alerts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."hfc_alerts"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."hfc_alerts" FROM "anon";

CREATE TABLE "public"."hfc_areas" (
  "name"        text                                   NOT NULL,
  "name_en"     text,
  "name_ar"     text,
  "name_ru"     text,
  "tzofar_id"   integer,
  "zone_id"     integer,
  "zone_he"     text,
  "zone_en"     text,
  "countdown_s" integer,
  "latitude"    double precision,
  "longitude"   double precision,
  "has_polygon" boolean                                NOT NULL DEFAULT false,
  "geom"        extensions.geometry(MultiPolygon,4326),
  "updated_at"  timestamp with time zone               NOT NULL DEFAULT now(),
  CONSTRAINT "hfc_areas_pkey" PRIMARY KEY (name)
);

ALTER TABLE "public"."hfc_areas"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."hfc_areas" FROM "anon";

CREATE TABLE "public"."hfc_clusters" (
  "id"            uuid                                   NOT NULL DEFAULT gen_random_uuid(),
  "threat"        smallint                               NOT NULL,
  "started_at"    timestamp with time zone               NOT NULL,
  "last_alert_at" timestamp with time zone               NOT NULL,
  "expires_at"    timestamp with time zone               NOT NULL,
  "areas"         text[]                                 NOT NULL DEFAULT '{}'::text[],
  "areas_en"      text[]                                 NOT NULL DEFAULT '{}'::text[],
  "zones_he"      text[]                                 NOT NULL DEFAULT '{}'::text[],
  "zones_en"      text[]                                 NOT NULL DEFAULT '{}'::text[],
  "alert_count"   integer                                NOT NULL DEFAULT 0,
  "geom"          extensions.geometry(MultiPolygon,4326),
  "geojson"       jsonb,
  "center_lat"    double precision,
  "center_lng"    double precision,
  "merged_into"   uuid,
  "created_at"    timestamp with time zone               NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone               NOT NULL DEFAULT now(),
  "area_points"   jsonb                                  NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "hfc_clusters_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."hfc_clusters"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."hfc_ingest_status" (
  "source"        text                     NOT NULL,
  "last_ok_at"    timestamp with time zone,
  "last_error"    text,
  "last_error_at" timestamp with time zone,
  CONSTRAINT "hfc_ingest_status_pkey" PRIMARY KEY (source)
);

ALTER TABLE "public"."hfc_ingest_status"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."hfc_ingest_status" FROM "anon";

CREATE TABLE "public"."hfc_pulse" (
  "id"         integer                  NOT NULL,
  "changed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hfc_pulse_id_check" CHECK ((id = 1)),
  CONSTRAINT "hfc_pulse_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."hfc_pulse"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ingest_config" (
  "key"        text                     NOT NULL,
  "value"      text                     NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ingest_config_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."ingest_config"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."ingest_config" FROM "anon", "authenticated";

CREATE TABLE "public"."insight_alert_queue" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "alert_id"    uuid,
  "user_id"     uuid                     NOT NULL,
  "event_slug"  text                     NOT NULL,
  "title_he"    text                     NOT NULL,
  "title_en"    text                     NOT NULL,
  "kind"        text                     NOT NULL,
  "value"       numeric                  NOT NULL,
  "probability" numeric                  NOT NULL,
  "previous"    numeric,
  "webhook_url" text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at"     timestamp with time zone,
  "error"       text,
  CONSTRAINT "insight_alert_queue_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."insight_alert_queue"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_alert_queue" FROM "anon", "authenticated";

CREATE TABLE "public"."insight_alerts" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"      uuid                     NOT NULL,
  "kind"          text                     NOT NULL,
  "value"         numeric                  NOT NULL,
  "webhook_url"   text,
  "enabled"       boolean                  NOT NULL DEFAULT true,
  "last_fired_at" timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "insight_alerts_check"
    CHECK ((((kind = 'change'::text) AND ((value >= 0.5) AND (value <= (50)::numeric))) OR ((kind <> 'change'::text) AND ((value >= 0.01) AND (value <= 0.95))))),
  CONSTRAINT "insight_alerts_kind_check" CHECK ((kind = ANY (ARRAY['above'::text, 'below'::text, 'change'::text]))),
  CONSTRAINT "insight_alerts_pkey" PRIMARY KEY (id),
  CONSTRAINT "insight_alerts_webhook_url_check" CHECK (((webhook_url IS NULL) OR ((webhook_url ~ '^https://[^/\s]+\.[^/\s]+(/\S*)?$'::text) AND (length(webhook_url) <= 500)))),
  "user_id"       uuid                     NOT NULL DEFAULT auth.uid()
);

ALTER TABLE "public"."insight_alerts"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_alerts" FROM "anon";

CREATE TABLE "public"."insight_events" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "slug"                   text                     NOT NULL,
  "title_he"               text                     NOT NULL,
  "title_en"               text                     NOT NULL,
  "description_he"         text,
  "description_en"         text,
  "resolution_criteria_he" text                     NOT NULL,
  "resolution_criteria_en" text                     NOT NULL,
  "horizon_hours"          integer                  NOT NULL DEFAULT 24,
  "refresh_interval_hours" integer                  NOT NULL DEFAULT 24,
  "next_run_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "last_run_at"            timestamp with time zone,
  "status"                 text                     NOT NULL DEFAULT 'draft'::text,
  "base_rate"              numeric                  NOT NULL DEFAULT 0.02,
  "keywords"               text[]                   NOT NULL DEFAULT '{}'::text[],
  "min_tier"               smallint                 NOT NULL DEFAULT 1,
  "is_published"           boolean                  NOT NULL DEFAULT false,
  "sort"                   integer                  NOT NULL DEFAULT 0,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "insight_events_base_rate_check" CHECK (((base_rate > (0)::numeric) AND (base_rate < (1)::numeric))),
  CONSTRAINT "insight_events_horizon_hours_check" CHECK (((horizon_hours >= 1) AND (horizon_hours <= 720))),
  CONSTRAINT "insight_events_min_tier_check" CHECK (((min_tier >= 1) AND (min_tier <= 3))),
  CONSTRAINT "insight_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "insight_events_refresh_interval_hours_check" CHECK (((refresh_interval_hours >= 1) AND (refresh_interval_hours <= 168))),
  CONSTRAINT "insight_events_slug_check" CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'::text)),
  CONSTRAINT "insight_events_slug_key" UNIQUE (slug),
  CONSTRAINT "insight_events_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'resolved'::text]))),
  CONSTRAINT "insight_events_title_en_check" CHECK (((length(title_en) >= 3) AND (length(title_en) <= 200))),
  CONSTRAINT "insight_events_title_he_check" CHECK (((length(title_he) >= 3) AND (length(title_he) <= 200)))
);

ALTER TABLE "public"."insight_events"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_events" FROM "anon";

CREATE TABLE "public"."insight_forecasts" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "event_id"        uuid                     NOT NULL,
  "ts"              timestamp with time zone NOT NULL DEFAULT now(),
  "probability"     numeric                  NOT NULL,
  "confidence_low"  numeric,
  "confidence_high" numeric,
  "contributions"   jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "model_version"   text                     NOT NULL,
  "trigger"         text                     NOT NULL DEFAULT 'schedule'::text,
  "summary_he"      text,
  "summary_en"      text,
  CONSTRAINT "insight_forecasts_confidence_high_check" CHECK (((confidence_high >= (0)::numeric) AND (confidence_high <= (1)::numeric))),
  CONSTRAINT "insight_forecasts_confidence_low_check" CHECK (((confidence_low >= (0)::numeric) AND (confidence_low <= (1)::numeric))),
  CONSTRAINT "insight_forecasts_pkey" PRIMARY KEY (id),
  CONSTRAINT "insight_forecasts_probability_check" CHECK (((probability >= 0.01) AND (probability <= 0.95))),
  CONSTRAINT "insight_forecasts_trigger_check" CHECK ((trigger = ANY (ARRAY['schedule'::text, 'manual'::text, 'circuit_breaker'::text])))
);

ALTER TABLE "public"."insight_forecasts"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_forecasts" FROM "anon";

CREATE TABLE "public"."insight_lexicon" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "event_id"   uuid                     NOT NULL,
  "term"       text                     NOT NULL,
  "lang"       text                     NOT NULL DEFAULT 'any'::text,
  "category"   text                     NOT NULL,
  "weight"     numeric                  NOT NULL DEFAULT 1,
  "enabled"    boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "insight_lexicon_category_check"
    CHECK ((category = ANY (ARRAY['escalation'::text, 'de_escalation'::text, 'intercept'::text, 'proxy'::text, 'airspace'::text, 'threat'::text, 'evacuation'::text]))),
  CONSTRAINT "insight_lexicon_event_id_term_category_key" UNIQUE (event_id, term, category),
  CONSTRAINT "insight_lexicon_lang_check" CHECK ((lang = ANY (ARRAY['he'::text, 'en'::text, 'ar'::text, 'fa'::text, 'any'::text]))),
  CONSTRAINT "insight_lexicon_pkey" PRIMARY KEY (id),
  CONSTRAINT "insight_lexicon_term_check" CHECK (((length(term) >= 1) AND (length(term) <= 120))),
  CONSTRAINT "insight_lexicon_weight_check" CHECK (((weight > (0)::numeric) AND (weight <= (10)::numeric)))
);

ALTER TABLE "public"."insight_lexicon"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_lexicon" FROM "anon";

CREATE TABLE "public"."insight_resolutions" (
  "id"           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "event_id"     uuid                     NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end"   timestamp with time zone NOT NULL,
  "outcome"      boolean                  NOT NULL,
  "forecast_id"  bigint,
  "notes"        text,
  "resolved_by"  uuid,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "insight_resolutions_check" CHECK ((window_end > window_start)),
  CONSTRAINT "insight_resolutions_event_id_window_start_key" UNIQUE (event_id, window_start),
  CONSTRAINT "insight_resolutions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."insight_resolutions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_resolutions" FROM "anon";

CREATE TABLE "public"."insight_signal_readings" (
  "id"               bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "signal_id"        uuid                     NOT NULL,
  "ts"               timestamp with time zone NOT NULL DEFAULT now(),
  "raw_value"        numeric,
  "normalized_score" numeric                  NOT NULL,
  "metadata"         jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "insight_signal_readings_normalized_score_check" CHECK (((normalized_score >= (0)::numeric) AND (normalized_score <= (1)::numeric))),
  CONSTRAINT "insight_signal_readings_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."insight_signal_readings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_signal_readings" FROM "anon";

CREATE TABLE "public"."insight_signals" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"           uuid                     NOT NULL,
  "key"                text                     NOT NULL,
  "source_type"        text                     NOT NULL,
  "name_he"            text                     NOT NULL,
  "name_en"            text                     NOT NULL,
  "weight"             numeric                  NOT NULL DEFAULT 1,
  "direction"          smallint                 NOT NULL DEFAULT 1,
  "normalization"      jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "config"             jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "enabled"            boolean                  NOT NULL DEFAULT true,
  "is_circuit_breaker" boolean                  NOT NULL DEFAULT false,
  "stale_after_hours"  integer                  NOT NULL DEFAULT 48,
  "last_updated"       timestamp with time zone,
  "last_error"         text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "insight_signals_direction_check" CHECK ((direction = ANY (ARRAY['-1'::integer, 1]))),
  CONSTRAINT "insight_signals_event_id_key_key" UNIQUE (event_id, key),
  CONSTRAINT "insight_signals_key_check" CHECK ((key ~ '^[a-z0-9_]{2,60}$'::text)),
  CONSTRAINT "insight_signals_pkey" PRIMARY KEY (id),
  CONSTRAINT "insight_signals_source_type_check"
    CHECK
    ((source_type = ANY (ARRAY['internal_events'::text, 'hfc'::text, 'polymarket'::text, 'finance'::text, 'advisory'::text, 'notam'::text, 'gdelt'::text, 'trends'::text,
    'shipping'::text, 'rhetoric'::text, 'manual'::text]))),
  CONSTRAINT "insight_signals_stale_after_hours_check" CHECK (((stale_after_hours >= 1) AND (stale_after_hours <= 720))),
  CONSTRAINT "insight_signals_weight_check" CHECK (((weight >= (0)::numeric) AND (weight <= (10)::numeric)))
);

ALTER TABLE "public"."insight_signals"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_signals" FROM "anon";

CREATE TABLE "public"."insight_source_cache" (
  "key"          text                     NOT NULL,
  "fetched_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "content_hash" text,
  "status"       integer,
  "body"         jsonb,
  CONSTRAINT "insight_source_cache_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."insight_source_cache"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."insight_source_cache" FROM "anon";

CREATE TABLE "public"."intel_agents" (
  "agent"       text                     NOT NULL,
  "label_he"    text                     NOT NULL,
  "sort_order"  integer                  NOT NULL DEFAULT 0,
  "last_run_at" timestamp with time zone,
  "last_result" jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "intel_agents_agent_check" CHECK ((agent = ANY (ARRAY['lebanon'::text, 'yemen'::text, 'syria'::text, 'iran'::text, 'international'::text, 'research'::text]))),
  CONSTRAINT "intel_agents_pkey" PRIMARY KEY (agent)
);

ALTER TABLE "public"."intel_agents"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."intel_agents" FROM "anon";

CREATE TABLE "public"."intel_config" (
  "key"   text NOT NULL,
  "value" text NOT NULL,
  CONSTRAINT "intel_config_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."intel_config"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."intel_config" FROM "anon", "authenticated";

CREATE TABLE "public"."intel_items" (
  "id"           bigint                   NOT NULL DEFAULT nextval('public.intel_items_id_seq'::regclass),
  "source_id"    uuid,
  "agent"        text,
  "url"          text                     NOT NULL,
  "title"        text                     NOT NULL DEFAULT ''::text,
  "published_at" timestamp with time zone,
  "status"       text                     NOT NULL,
  "event_id"     uuid,
  "reason"       text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "intel_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "intel_items_status_check"
    CHECK ((status = ANY (ARRAY['baseline'::text, 'old'::text, 'irrelevant'::text, 'published'::text, 'duplicate'::text, 'error'::text, 'skipped'::text]))),
  CONSTRAINT "intel_items_url_key" UNIQUE (url)
);

ALTER TABLE "public"."intel_items"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."intel_items" FROM "anon";

CREATE TABLE "public"."intel_sources" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "agent"                text                     NOT NULL,
  "url"                  text                     NOT NULL,
  "name"                 text                     NOT NULL DEFAULT ''::text,
  "feed_url"             text,
  "feed_checked_at"      timestamp with time zone,
  "active"               boolean                  NOT NULL DEFAULT true,
  "baseline_done"        boolean                  NOT NULL DEFAULT false,
  "last_run_at"          timestamp with time zone,
  "last_ok_at"           timestamp with time zone,
  "last_error"           text,
  "consecutive_failures" integer                  NOT NULL DEFAULT 0,
  "items_found"          integer                  NOT NULL DEFAULT 0,
  "events_created"       integer                  NOT NULL DEFAULT 0,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "intel_sources_feed_url_check" CHECK (((feed_url IS NULL) OR (feed_url ~ '^https?://'::text))),
  CONSTRAINT "intel_sources_pkey" PRIMARY KEY (id),
  CONSTRAINT "intel_sources_url_check" CHECK ((url ~ '^https?://'::text)),
  CONSTRAINT "intel_sources_url_key" UNIQUE (url)
);

ALTER TABLE "public"."intel_sources"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."intel_sources" FROM "anon";

CREATE TABLE "public"."layer_sync" (
  "layer"      text                     NOT NULL,
  "synced_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "changed_at" timestamp with time zone,
  "items"      integer,
  "source"     text,
  "detail"     text,
  CONSTRAINT "layer_sync_pkey" PRIMARY KEY (layer)
);

ALTER TABLE "public"."layer_sync"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."learned_places" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name_norm"       text                     NOT NULL,
  "name"            text                     NOT NULL,
  "location_name"   text                     NOT NULL DEFAULT ''::text,
  "country"         text                     NOT NULL DEFAULT ''::text,
  "latitude"        numeric(9,6)             NOT NULL,
  "longitude"       numeric(9,6)             NOT NULL,
  "times_corrected" integer                  NOT NULL DEFAULT 1,
  "times_used"      integer                  NOT NULL DEFAULT 0,
  "last_used_at"    timestamp with time zone,
  "learned_from"    uuid,
  "learned_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "learned_places_latitude_check" CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
  CONSTRAINT "learned_places_longitude_check" CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
  CONSTRAINT "learned_places_name_norm_check" CHECK ((name_norm <> ''::text)),
  CONSTRAINT "learned_places_name_norm_key" UNIQUE (name_norm),
  CONSTRAINT "learned_places_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."learned_places"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."learned_places" FROM "anon";

CREATE TABLE "public"."learned_terms" (
  "id"           bigint                   NOT NULL DEFAULT nextval('public.learned_terms_id_seq'::regclass),
  "term"         text                     NOT NULL,
  "he"           text,
  "en"           text,
  "avoid"        text[]                   NOT NULL DEFAULT '{}'::text[],
  "note"         text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "learned_from" uuid,
  CONSTRAINT "learned_terms_check" CHECK (((he IS NOT NULL) OR (en IS NOT NULL))),
  CONSTRAINT "learned_terms_en_check" CHECK (((en IS NULL) OR (length(en) <= 120))),
  CONSTRAINT "learned_terms_he_check" CHECK (((he IS NULL) OR (length(he) <= 120))),
  CONSTRAINT "learned_terms_note_check" CHECK (((note IS NULL) OR (length(note) <= 300))),
  CONSTRAINT "learned_terms_pkey" PRIMARY KEY (id),
  CONSTRAINT "learned_terms_term_check" CHECK (((length(btrim(term)) >= 2) AND (length(btrim(term)) <= 120))),
  "created_by"   uuid                     DEFAULT auth.uid()
);

ALTER TABLE "public"."learned_terms"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."learned_terms" FROM "anon";

CREATE TABLE "public"."lebanon_sects" (
  "title"      text                     NOT NULL,
  "name_en"    text                     NOT NULL,
  "name_he"    text,
  "name_ar"    text,
  "lat"        double precision         NOT NULL,
  "lng"        double precision         NOT NULL,
  "sects"      text[]                   NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "lebanon_sects_pkey" PRIMARY KEY (title)
);

ALTER TABLE "public"."lebanon_sects"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."license_attempts" (
  "user_id" uuid                     NOT NULL,
  "at"      timestamp with time zone NOT NULL DEFAULT now(),
  "ok"      boolean                  NOT NULL
);

ALTER TABLE "public"."license_attempts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."license_keys" (
  "key"           text                     NOT NULL,
  "plan"          text                     NOT NULL,
  "duration_days" integer                  NOT NULL,
  "max_uses"      integer                  NOT NULL DEFAULT 1,
  "uses"          integer                  NOT NULL DEFAULT 0,
  "note"          text,
  "created_by"    uuid,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "redeem_by"     timestamp with time zone NOT NULL DEFAULT (now() + '30 days'::interval),
  "revoked"       boolean                  NOT NULL DEFAULT false,
  "revoked_at"    timestamp with time zone,
  "revoked_by"    uuid,
  CONSTRAINT "license_keys_duration_days_check" CHECK ((duration_days = ANY (ARRAY[7, 14, 30]))),
  CONSTRAINT "license_keys_max_uses_check" CHECK (((max_uses >= 1) AND (max_uses <= 1000))),
  CONSTRAINT "license_keys_pkey" PRIMARY KEY (key),
  CONSTRAINT "license_keys_plan_check" CHECK ((plan = ANY (ARRAY['pro'::text, 'max'::text])))
);

ALTER TABLE "public"."license_keys"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."license_redemptions" (
  "id"      bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "key"     text                     NOT NULL,
  "user_id" uuid                     NOT NULL,
  "at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "license_redemptions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."license_redemptions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."osm_places_stage" (
  "country" text,
  "content" text,
  "at"      timestamp with time zone DEFAULT now()
);

ALTER TABLE "public"."osm_places_stage"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."osm_places_stage" FROM "anon", "authenticated";

CREATE TABLE "public"."osm_waterways" (
  "way_id"    bigint                               NOT NULL,
  "kind"      text                                 NOT NULL,
  "name"      text                                 NOT NULL,
  "name_ar"   text,
  "name_en"   text,
  "name_he"   text,
  "geom"      extensions.geometry(LineString,4326) NOT NULL,
  "synced_at" timestamp with time zone             NOT NULL DEFAULT now(),
  CONSTRAINT "osm_waterways_pkey" PRIMARY KEY (way_id)
);

ALTER TABLE "public"."osm_waterways"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."osm_waterways" FROM "anon", "authenticated";

CREATE TABLE "public"."place_gazetteer" (
  "id"           uuid         NOT NULL DEFAULT gen_random_uuid(),
  "kind"         text         NOT NULL,
  "canonical"    text         NOT NULL,
  "country_code" text,
  "latitude"     numeric(9,6) NOT NULL,
  "longitude"    numeric(9,6) NOT NULL,
  "names"        text[]       NOT NULL,
  CONSTRAINT "place_gazetteer_country_code_check" CHECK ((country_code ~ '^[a-z]{2}$'::text)),
  CONSTRAINT "place_gazetteer_kind_check" CHECK ((kind = ANY (ARRAY['city'::text, 'region'::text, 'country'::text]))),
  CONSTRAINT "place_gazetteer_latitude_check" CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
  CONSTRAINT "place_gazetteer_longitude_check" CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
  CONSTRAINT "place_gazetteer_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."place_gazetteer"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."place_gazetteer" FROM "anon";

CREATE TABLE "public"."place_learn_queue" (
  "key"      text                     NOT NULL,
  "row"      jsonb                    NOT NULL,
  "country"  text                     NOT NULL DEFAULT 'LB'::text,
  "added_at" timestamp with time zone NOT NULL DEFAULT now(),
  "done_at"  timestamp with time zone,
  CONSTRAINT "place_learn_queue_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."place_learn_queue"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."place_learn_queue" FROM "anon", "authenticated";

CREATE TABLE "public"."plan_audit" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "at"          timestamp with time zone NOT NULL DEFAULT now(),
  "actor"       uuid,
  "target_user" uuid,
  "action"      text                     NOT NULL,
  "details"     jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "plan_audit_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."plan_audit"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."plan_features" (
  "feature_key" text    NOT NULL,
  "plan_id"     text    NOT NULL,
  "enabled"     boolean NOT NULL DEFAULT true,
  "limit_value" integer,
  "note"        text,
  CONSTRAINT "plan_features_pkey" PRIMARY KEY (feature_key, plan_id)
);

ALTER TABLE "public"."plan_features"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."plans" (
  "id"            text    NOT NULL,
  "name"          text    NOT NULL,
  "sort"          integer NOT NULL,
  "monthly_price" numeric,
  "yearly_price"  numeric,
  CONSTRAINT "plans_id_check" CHECK ((id = ANY (ARRAY['guest'::text, 'free'::text, 'pro'::text, 'max'::text, 'intel'::text]))),
  CONSTRAINT "plans_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."plans"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"        uuid NOT NULL,
  "full_name" text NOT NULL DEFAULT ''::text,
  "email"     text NOT NULL,
  CONSTRAINT "profiles_email_check" CHECK ((char_length(email) <= 254)),
  CONSTRAINT "profiles_full_name_check" CHECK ((char_length(full_name) <= 120)),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

CREATE TABLE "public"."push_config" (
  "key"        text                     NOT NULL,
  "value"      text                     NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "push_config_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."push_config"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."push_config" FROM "anon", "authenticated";

CREATE TABLE "public"."push_subscriptions" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "endpoint"     text                     NOT NULL,
  "p256dh"       text                     NOT NULL,
  "auth"         text                     NOT NULL,
  "filters"      jsonb,
  "muted"        text[]                   NOT NULL DEFAULT '{}'::text[],
  "lang"         text                     NOT NULL DEFAULT 'he'::text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "last_sent_at" timestamp with time zone,
  "min_severity" text                     NOT NULL DEFAULT 'high'::text,
  CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE (endpoint),
  CONSTRAINT "push_subscriptions_min_severity_check" CHECK ((min_severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id),
  "user_id"      uuid                     NOT NULL DEFAULT auth.uid()
);

ALTER TABLE "public"."push_subscriptions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."push_subscriptions" FROM "anon";

CREATE TABLE "public"."search_quota_log" (
  "id"      bigint                   NOT NULL DEFAULT nextval('public.search_quota_log_id_seq'::regclass),
  "user_id" uuid                     NOT NULL,
  "day"     date                     NOT NULL,
  "query"   text                     NOT NULL,
  "at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "search_quota_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."search_quota_log"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."search_quota_log" FROM "anon", "authenticated";

CREATE TABLE "public"."self_private_invitations" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "username"   text,
  "token"      text,
  "used"       boolean                  DEFAULT false,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "self_private_invitations_pkey" PRIMARY KEY (id),
  CONSTRAINT "self_private_invitations_token_key" UNIQUE (token)
);

ALTER TABLE "public"."self_private_invitations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."self_private_invitations" FROM "anon", "authenticated";

CREATE TABLE "public"."self_private_usage_logs" (
  "id"          bigint                   GENERATED BY DEFAULT AS IDENTITY (SEQUENCE NAME "public"."usage_logs_id_seq") NOT NULL,
  "username"    text,
  "event_type"  text,
  "tokens_used" integer                  DEFAULT 0,
  "api_calls"   integer                  DEFAULT 1,
  "created_at"  timestamp with time zone DEFAULT now(),
  CONSTRAINT "usage_logs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."self_private_usage_logs"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."self_private_usage_logs" FROM "anon", "authenticated";

CREATE TABLE "public"."self_private_users_profiles" (
  "id"       uuid NOT NULL DEFAULT gen_random_uuid(),
  "username" text NOT NULL,
  "phone"    text,
  CONSTRAINT "self_private_users_profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "self_private_users_profiles_username_key" UNIQUE (username)
);

ALTER TABLE "public"."self_private_users_profiles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."self_private_users_profiles" FROM "anon", "authenticated";

CREATE TABLE "public"."severity_corrections" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "event_id"      uuid,
  "text"          text                     NOT NULL,
  "from_severity" text,
  "to_severity"   text                     NOT NULL,
  "corrected_by"  uuid,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "severity_corrections_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."severity_corrections"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."social_results" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "search_id"  uuid                     NOT NULL,
  "platform"   text                     NOT NULL,
  "post_id"    text                     NOT NULL,
  "url"        text,
  "author"     text,
  "text"       text,
  "posted_at"  timestamp with time zone,
  "media"      jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "matched"    text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "social_results_pkey" PRIMARY KEY (id),
  CONSTRAINT "social_results_platform_check" CHECK ((platform = ANY (ARRAY['x'::text, 'facebook'::text, 'instagram'::text, 'tiktok'::text]))),
  CONSTRAINT "social_results_search_id_platform_post_id_key" UNIQUE (search_id, platform, post_id)
);

ALTER TABLE "public"."social_results"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."social_searches" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"        uuid,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "polygon"        jsonb                    NOT NULL,
  "places"         text[]                   NOT NULL DEFAULT '{}'::text[],
  "terms"          text[]                   NOT NULL DEFAULT '{}'::text[],
  "hours"          integer                  NOT NULL DEFAULT 24,
  "runs"           jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "cost_usd"       numeric                  NOT NULL DEFAULT 0,
  "results_count"  integer                  NOT NULL DEFAULT 0,
  "cache_key"      text,
  "scheduled_area" text,
  CONSTRAINT "social_searches_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."social_searches"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."telegram_agents" (
  "folder"          text                     NOT NULL,
  "channels"        jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "channel_count"   integer                  NOT NULL DEFAULT 0,
  "active"          boolean                  NOT NULL DEFAULT true,
  "messages"        integer                  NOT NULL DEFAULT 0,
  "last_sync_at"    timestamp with time zone,
  "last_message_at" timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "telegram_agents_pkey" PRIMARY KEY (folder)
);

ALTER TABLE "public"."telegram_agents"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."telegram_agents" FROM "anon", "authenticated";

CREATE TABLE "public"."telegram_channels" (
  "username"      text                     NOT NULL,
  "title"         text                     NOT NULL DEFAULT ''::text,
  "active"        boolean                  NOT NULL DEFAULT true,
  "baseline_done" boolean                  NOT NULL DEFAULT false,
  "last_post_id"  bigint                   NOT NULL DEFAULT 0,
  "posts_seen"    integer                  NOT NULL DEFAULT 0,
  "last_run_at"   timestamp with time zone,
  "last_ok_at"    timestamp with time zone,
  "last_error"    text,
  "locked_until"  timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "region"        text,
  "folder"        text,
  "origin"        text                     NOT NULL DEFAULT 'manual'::text,
  "pinned"        boolean                  NOT NULL DEFAULT false,
  CONSTRAINT "telegram_channels_pkey" PRIMARY KEY (username),
  CONSTRAINT "telegram_channels_username_check" CHECK ((username ~ '^[A-Za-z0-9_]{4,64}$'::text))
);

ALTER TABLE "public"."telegram_channels"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."telegram_channels" FROM "anon";

CREATE TABLE "public"."terms_acceptances" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id"         uuid                     NOT NULL,
  "terms_version"   text                     NOT NULL,
  "privacy_version" text                     NOT NULL,
  "accepted_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "ip"              inet,
  CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."terms_acceptances"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."translation_cache" (
  "hash"            text                     NOT NULL,
  "source_text"     text                     NOT NULL,
  "source_lang"     text,
  "target_lang"     text                     NOT NULL,
  "translated_text" text                     NOT NULL,
  "provider"        text                     NOT NULL,
  "model"           text,
  "paid"            boolean                  NOT NULL DEFAULT false,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "translation_cache_pkey" PRIMARY KEY (hash),
  CONSTRAINT "translation_cache_target_lang_check" CHECK ((target_lang = ANY (ARRAY['he'::text, 'en'::text])))
);

ALTER TABLE "public"."translation_cache"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."translation_cache" FROM "anon", "authenticated";

CREATE TABLE "public"."translation_log" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "at"          timestamp with time zone NOT NULL DEFAULT now(),
  "provider"    text                     NOT NULL,
  "model"       text,
  "target_lang" text,
  "chars"       integer,
  "paid"        boolean                  NOT NULL DEFAULT false,
  "ok"          boolean                  NOT NULL DEFAULT true,
  "duration_ms" integer,
  "detail"      text,
  CONSTRAINT "translation_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."translation_log"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."translation_log" FROM "anon", "authenticated";

CREATE TABLE "public"."user_sessions" (
  "session_id"   uuid                     NOT NULL,
  "user_id"      uuid                     NOT NULL,
  "device_type"  text,
  "browser"      text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen"    timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at"     timestamp with time zone,
  "ended_reason" text,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY (session_id)
);

ALTER TABLE "public"."user_sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."wadi_lines" (
  "id"         bigint                                    NOT NULL DEFAULT nextval('public.wadi_lines_id_seq'::regclass),
  "kind"       text                                      NOT NULL,
  "name"       text                                      NOT NULL,
  "name_ar"    text,
  "name_en"    text,
  "name_he"    text,
  "he_from_ai" boolean                                   NOT NULL DEFAULT false,
  "geom"       extensions.geometry(MultiLineString,4326) NOT NULL,
  "length_km"  numeric(8,2),
  "way_ids"    bigint[]                                  NOT NULL DEFAULT '{}'::bigint[],
  CONSTRAINT "wadi_lines_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."wadi_lines"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."wadi_lines" FROM "anon";

CREATE TABLE "public"."whatsapp_ingest_log" (
  "msg_key"      text                     NOT NULL,
  "chat_name"    text                     NOT NULL DEFAULT 'החזית הצפונית'::text,
  "sender"       text,
  "sent_at"      timestamp with time zone,
  "message_text" text,
  "decision"     text                     NOT NULL,
  "event_id"     uuid,
  "reason"       text,
  "processed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "tg_group"     text,
  CONSTRAINT "whatsapp_ingest_log_decision_check"
    CHECK
    ((decision = ANY (ARRAY['pending'::text, 'event_published'::text, 'event_draft'::text, 'merged_duplicate'::text, 'skipped_not_event'::text, 'skipped_off_topic'::text,
    'skipped_category'::text]))),
  CONSTRAINT "whatsapp_ingest_log_pkey" PRIMARY KEY (msg_key)
);

ALTER TABLE "public"."whatsapp_ingest_log"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."whatsapp_ingest_log" FROM "anon", "authenticated";

ALTER SEQUENCE "public"."ai_search_log_id_seq" OWNED BY "public"."ai_search_log"."id";

ALTER SEQUENCE "public"."ai_usage_id_seq" OWNED BY "public"."ai_usage"."id";

ALTER SEQUENCE "public"."ais_crossings_id_seq" OWNED BY "public"."ais_crossings"."id";

ALTER SEQUENCE "public"."category_corrections_id_seq" OWNED BY "public"."category_corrections"."id";

ALTER SEQUENCE "public"."geo_staging_id_seq" OWNED BY "public"."geo_staging"."id";

ALTER SEQUENCE "public"."hfc_alerts_id_seq" OWNED BY "public"."hfc_alerts"."id";

ALTER SEQUENCE "public"."intel_items_id_seq" OWNED BY "public"."intel_items"."id";

ALTER SEQUENCE "public"."learned_terms_id_seq" OWNED BY "public"."learned_terms"."id";

ALTER SEQUENCE "public"."search_quota_log_id_seq" OWNED BY "public"."search_quota_log"."id";

ALTER SEQUENCE "public"."wadi_lines_id_seq" OWNED BY "public"."wadi_lines"."id";

CREATE TYPE "public"."app_role" AS ENUM (
  'super_admin',
  'admin',
  'analyst',
  'viewer'
);

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "intended_role" public.app_role NOT NULL;

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "message" text;

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "invited_by" uuid;

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "token" text NOT NULL;

ALTER TABLE "public"."profiles"
  ADD COLUMN "role" public.app_role NOT NULL DEFAULT 'viewer'::public.app_role;

CREATE TYPE "public"."event_severity" AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TYPE "public"."event_source_type" AS ENUM (
  'manual_report',
  'news_website',
  'social_media',
  'official_statement',
  'emergency_service',
  'government_source',
  'military_source',
  'other'
);

CREATE TYPE "public"."event_status" AS ENUM (
  'draft',
  'pending_review',
  'published',
  'rejected',
  'archived'
);

ALTER TABLE "public"."events"
  ADD COLUMN "status" public.event_status NOT NULL DEFAULT 'draft'::public.event_status;

ALTER TABLE "public"."events"
  ADD COLUMN "severity" public.event_severity NOT NULL DEFAULT 'medium'::public.event_severity;

ALTER TABLE "public"."events"
  ADD COLUMN "latitude" numeric(9,6);

ALTER TABLE "public"."events"
  ADD COLUMN "longitude" numeric(9,6);

ALTER TABLE "public"."events"
  ADD COLUMN "location_name" text NOT NULL DEFAULT ''::text;

ALTER TABLE "public"."events"
  ADD COLUMN "country" text NOT NULL DEFAULT ''::text;

ALTER TABLE "public"."events"
  ADD COLUMN "region" text NOT NULL DEFAULT ''::text;

ALTER TABLE "public"."events"
  ADD COLUMN "city" text NOT NULL DEFAULT ''::text;

ALTER TABLE "public"."events"
  ADD COLUMN "address" text;

ALTER TABLE "public"."events"
  ADD COLUMN "source_name" text;

ALTER TABLE "public"."events"
  ADD COLUMN "source_url" text;

ALTER TABLE "public"."events"
  ADD COLUMN "source_type" public.event_source_type NOT NULL DEFAULT 'manual_report'::public.event_source_type;

ALTER TABLE "public"."events"
  ADD COLUMN "occurred_at" timestamp WITH time zone NOT NULL;

ALTER TABLE "public"."events"
  ADD COLUMN "published_at" timestamp WITH time zone;

ALTER TABLE "public"."events"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."events"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."events"
  ADD COLUMN "created_by" uuid NOT NULL;

ALTER TABLE "public"."events"
  ADD COLUMN "approved_by" uuid;

ALTER TABLE "public"."events"
  ADD COLUMN "is_breaking" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."events"
  ADD COLUMN "is_verified" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."events"
  ADD COLUMN "geocoding_confidence" numeric(4,3);

ALTER TABLE "public"."events"
  ADD COLUMN "classification_confidence" numeric(4,3);

ALTER TABLE "public"."events"
  ADD COLUMN "coordinates_manually_corrected" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."events"
  ADD COLUMN "ai_suggestions" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "public"."events"
  ADD COLUMN "rejection_reason" text;

ALTER TABLE "public"."events"
  ADD COLUMN "duplicate_of_event_id" uuid;

ALTER TABLE "public"."events"
  ADD COLUMN "translations" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "public"."events"
  ADD COLUMN "deleted_at" timestamp WITH time zone;

ALTER TABLE "public"."events"
  ADD COLUMN "location_precision" text;

ALTER TABLE "public"."events"
  ADD COLUMN "expired_at" timestamp WITH time zone;

ALTER TABLE "public"."events"
  ADD COLUMN "hfc_areas" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE "public"."events"
  ADD COLUMN "sources" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "public"."events"
  ADD COLUMN "whatsapp_text" text;

ALTER TABLE "public"."events"
  ADD COLUMN "locations" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "public"."events"
  ADD COLUMN "location_name_he" text;

ALTER TABLE "public"."events"
  ADD COLUMN "location_name_en" text;

ALTER TABLE "public"."events"
  ADD COLUMN "review_requested_at" timestamp WITH time zone;

ALTER TABLE "public"."events"
  ADD COLUMN "review_requested_by" uuid;

CREATE TYPE "public"."invitation_status" AS ENUM (
  'pending',
  'accepted',
  'expired',
  'revoked'
);

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "status" public.invitation_status NOT NULL DEFAULT 'pending'::public.invitation_status;

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "expires_at" timestamp WITH time zone NOT NULL DEFAULT (now() + '7 days'::interval);

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."administrator_invitations"
  ADD COLUMN "accepted_at" timestamp WITH time zone;

CREATE TYPE "public"."self_private_user_role" AS ENUM (
  'SuperAdmin',
  'Admin',
  'Editor',
  'User'
);

ALTER TABLE "public"."self_private_users_profiles"
  ADD COLUMN "role" public.self_private_user_role NOT NULL DEFAULT 'User'::public.self_private_user_role;

ALTER TABLE "public"."self_private_users_profiles"
  ADD COLUMN "enabled" boolean DEFAULT true;

ALTER TABLE "public"."self_private_users_profiles"
  ADD COLUMN "expires_at" timestamp WITH time zone;

ALTER TABLE "public"."self_private_users_profiles"
  ADD COLUMN "created_at" timestamp WITH time zone DEFAULT now();

ALTER TABLE "public"."self_private_users_profiles"
  ADD COLUMN "created_by" text;

CREATE TYPE "public"."user_status" AS ENUM (
  'active',
  'pending',
  'suspended'
);

ALTER TABLE "public"."profiles"
  ADD COLUMN "status" public.user_status NOT NULL DEFAULT 'pending'::public.user_status;

ALTER TABLE "public"."profiles"
  ADD COLUMN "can_publish" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."profiles"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."profiles"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."profiles"
  ADD COLUMN "last_login_at" timestamp WITH time zone;

ALTER TABLE "public"."profiles"
  ADD COLUMN "invited_by" uuid;

ALTER TABLE "public"."profiles"
  ADD COLUMN "plan" text NOT NULL DEFAULT 'free'::text;

ALTER TABLE "public"."profiles"
  ADD COLUMN "plan_source" text NOT NULL DEFAULT 'default'::text;

ALTER TABLE "public"."profiles"
  ADD COLUMN "plan_expires_at" timestamp WITH time zone;

ALTER TABLE "public"."profiles"
  ADD COLUMN "billing_period" text;

ALTER TABLE "public"."profiles"
  ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._plan_set (
  p_user    uuid,
  p_plan    text,
  p_source  text,
  p_expires timestamp with time zone,
  p_action  text,
  p_details jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform set_config('osf.plan_ok', '1', true);
  update public.profiles set plan = p_plan, plan_source = p_source, plan_expires_at = p_expires where id = p_user;
  perform set_config('osf.plan_ok', '', true);
  insert into public.plan_audit (actor, target_user, action, details)
  values (auth.uid(), p_user, p_action, coalesce(p_details, '{}') || jsonb_build_object('plan', p_plan, 'source', p_source, 'expires', p_expires));
end $function$;

REVOKE ALL ON FUNCTION "public"."_plan_set"(uuid, text, text, timestamp WITH time zone, text, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.accept_terms (
  p_terms   text,
  p_privacy text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ip text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  insert into public.terms_acceptances (user_id, terms_version, privacy_version, ip)
  values (auth.uid(), left(p_terms, 40), left(p_privacy, 40), nullif(trim(ip), '')::inet);
end $function$;

REVOKE ALL ON FUNCTION "public"."accept_terms"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.active_hfc_shapes()
  RETURNS TABLE (
    threat    smallint,
    geojson   jsonb,
    alert_ids uuid[]
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with a as (
    select c.id, c.threat, c.geom
    from public.hfc_clusters c
    where c.merged_into is null and c.expires_at > now() and c.geom is not null
  ),
  u as (
    select a.threat, (extensions.st_dump(extensions.st_union(a.geom))).geom as g
    from a
    group by a.threat
  )
  select u.threat,
         extensions.st_asgeojson(extensions.st_simplifypreservetopology(u.g, 0.0002), 5)::jsonb,
         (select array_agg(a.id order by a.id) from a
           where a.threat = u.threat and extensions.st_intersects(a.geom, u.g))
  from u;
$function$;

CREATE OR REPLACE FUNCTION public.add_event_place (
  p_id   uuid,
  p_lat  double precision,
  p_lng  double precision,
  p_from integer          DEFAULT NULL::integer
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_ev record; v_src jsonb; v_locs jsonb;
begin
  if auth.uid() is null or not (public.has_permission('event.edit.any') or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to edit events.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad coordinates.' using errcode = '22023';
  end if;
  select locations, location_name, location_name_en into v_ev from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  v_locs := case when jsonb_typeof(v_ev.locations) = 'array' then v_ev.locations else '[]'::jsonb end;
  v_src := case when p_from is not null and p_from >= 0 and p_from < jsonb_array_length(v_locs) then v_locs -> p_from
                else jsonb_build_object('name', coalesce(v_ev.location_name, ''), 'name_en', coalesce(v_ev.location_name_en, '')) end;
  update public.events
     set locations = v_locs || jsonb_build_array(jsonb_build_object(
           'name', coalesce(v_src ->> 'name', ''), 'name_en', coalesce(v_src ->> 'name_en', ''),
           'lat', p_lat, 'lng', p_lng, 'precision', 'exact', 'manual', true))
   where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."add_event_place"(uuid, double precision, double precision, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_create_license (
  p_plan     text,
  p_days     integer,
  p_note     text    DEFAULT NULL::text,
  p_max_uses integer DEFAULT 1
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  b bytea; part text := ''; k text; i int;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_plan not in ('pro', 'max') or p_days not in (7, 14, 30) then raise exception 'bad plan or days'; end if;
  loop
    b := extensions.gen_random_bytes(8); -- cryptographically secure
    part := '';
    for i in 0..7 loop part := part || substr(abc, (get_byte(b, i) % 32) + 1, 1); end loop;
    k := format('OSF-%s-%s-%s-%s', upper(p_plan), p_days, substr(part, 1, 4), substr(part, 5, 4));
    exit when not exists (select 1 from public.license_keys where key = k);
  end loop;
  insert into public.license_keys (key, plan, duration_days, max_uses, note, created_by)
  values (k, p_plan, p_days, greatest(1, least(coalesce(p_max_uses, 1), 1000)), nullif(left(trim(p_note), 200), ''), auth.uid());
  insert into public.plan_audit (actor, action, details) values (auth.uid(), 'license_created', jsonb_build_object('key', k, 'plan', p_plan, 'days', p_days, 'note', p_note, 'max_uses', p_max_uses));
  return k;
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_create_license"(text, integer, text, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_delete_license (
  p_key text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update public.license_keys set revoked = true, revoked_at = now(), revoked_by = auth.uid() where key = p_key;
  delete from public.license_redemptions where key = p_key;
  delete from public.license_keys where key = p_key;
  insert into public.plan_audit (actor, action, details) values (auth.uid(), 'license_deleted', jsonb_build_object('key', p_key));
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_delete_license"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_extend_eval (
  p_user uuid,
  p_days integer
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare p record;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_days not between 1 and 365 then raise exception 'bad days'; end if;
  select plan, plan_expires_at into p from public.profiles where id = p_user;
  if p.plan = 'free' then raise exception 'no plan to extend'; end if;
  perform public._plan_set(p_user, p.plan, 'eval', greatest(coalesce(p.plan_expires_at, now()), now()) + make_interval(days => p_days),
    'admin_extend_eval', jsonb_build_object('days', p_days));
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_extend_eval"(uuid, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_remove_plan (
  p_user uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  perform public._plan_set(p_user, 'free', 'default', null, 'admin_remove_plan', '{}');
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_remove_plan"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_revoke_license (
  p_key text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update public.license_keys set revoked = true, revoked_at = now(), revoked_by = auth.uid() where key = p_key and not revoked;
  insert into public.plan_audit (actor, action, details) values (auth.uid(), 'license_revoked', jsonb_build_object('key', p_key));
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_revoke_license"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_set_plan (
  p_user    uuid,
  p_plan    text,
  p_source  text                     DEFAULT 'paid'::text,
  p_expires timestamp with time zone DEFAULT NULL::timestamp WITH time zone
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_plan not in ('free', 'pro', 'max', 'intel') or p_source not in ('default', 'eval', 'paid') then raise exception 'bad plan'; end if;
  perform public._plan_set(p_user, p_plan, case when p_plan = 'free' then 'default' else p_source end,
    case when p_plan = 'free' then null else p_expires end, 'admin_set_plan', '{}');
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_set_plan"(uuid, text, text, timestamp WITH time zone) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.ai_quota (
  p_uid uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_enabled boolean := coalesce((select value from app_settings where key = 'ai_limits_enabled') = 'true'::jsonb, false);
  v_credit numeric := coalesce((select (value #>> '{}')::numeric from app_settings where key = 'ai_credit_usd'), 0.08);
  v_budget numeric := (select (value #>> '{}')::numeric from app_settings where key = 'ai_daily_budget_usd');
  v_day timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  p record; v_plan text; v_limit int; v_used numeric; v_spent numeric;
begin
  select role, plan, plan_expires_at into p from profiles where id = p_uid;
  v_plan := case when p.plan is distinct from 'free' and p.plan_expires_at is not null and p.plan_expires_at < now() then 'free' else coalesce(p.plan, 'free') end;
  select limit_value into v_limit from plan_features where feature_key = 'ai_expand_ask' and plan_id = v_plan;
  select coalesce(sum(cost_usd), 0) / nullif(v_credit, 0) into v_used from ai_usage where user_id = p_uid and at >= v_day;
  select coalesce(sum(cost_usd), 0) into v_spent from ai_usage where user_id is not null and at >= v_day;
  return jsonb_build_object('enabled', v_enabled, 'staff', coalesce(p.role <> 'viewer', false), 'plan', v_plan,
    'limit', v_limit, 'used', round(coalesce(v_used, 0), 2), 'budget_usd', v_budget, 'spent_today_usd', round(v_spent, 4));
end; $function$;

REVOKE ALL ON FUNCTION "public"."ai_quota"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ai_search_candidates (
  p_since      timestamp with time zone,
  p_until      timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_countries  text[]                   DEFAULT '{}'::text[],
  p_places     text[]                   DEFAULT '{}'::text[],
  p_categories text[]                   DEFAULT '{}'::text[],
  p_terms      text[]                   DEFAULT '{}'::text[],
  p_limit      integer                  DEFAULT 120
)
  RETURNS TABLE (
    id            uuid,
    occurred_at   timestamp with time zone,
    title         text,
    description   text,
    category_slug text,
    country       text,
    location_name text,
    latitude      double precision,
    longitude     double precision,
    locations     jsonb,
    title_en      text,
    score         integer
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with base as (
    select e.*, c.slug as cslug,
      lower(coalesce(e.title,'') || ' ' || coalesce(e.description,'') || ' ' || coalesce(e.original_report_text,'') || ' ' ||
            coalesce(e.translations::text,'') || ' ' || coalesce(e.location_name,'') || ' ' || coalesce(e.locations::text,'') || ' ' ||
            coalesce(e.city,'') || ' ' || coalesce(e.region,'')) as txt
    from public.events e
    left join public.event_categories c on c.id = e.category_id
    where e.deleted_at is null
      and e.status in ('published', 'archived')
      and e.occurred_at >= p_since
      and (p_until is null or e.occurred_at < p_until)
  ), scored as (
    select b.*,
      (case when b.cslug = any(p_categories) then 3 else 0 end)
      + (case when lower(coalesce(b.country,'')) = any(select lower(x) from unnest(p_countries) x) then 2 else 0 end)
      + (select count(*)::int from unnest(p_places) p where char_length(p) >= 2 and b.txt like '%' || lower(p) || '%')
      + (select count(*)::int from unnest(p_terms) t where char_length(t) >= 2 and b.txt like '%' || lower(t) || '%') as sc,
      (cardinality(p_countries) = 0 and cardinality(p_places) = 0)
        or lower(coalesce(b.country,'')) = any(select lower(x) from unnest(p_countries) x)
        or exists (select 1 from unnest(p_places) p where char_length(p) >= 2 and b.txt like '%' || lower(p) || '%') as place_ok,
      (cardinality(p_categories) = 0 and cardinality(p_terms) = 0)
        or b.cslug = any(p_categories)
        or exists (select 1 from unnest(p_terms) t where char_length(t) >= 2 and b.txt like '%' || lower(t) || '%') as topic_ok
    from base b
  )
  select s.id, s.occurred_at, s.title, left(s.description, 400), s.cslug, s.country, s.location_name,
         s.latitude, s.longitude, s.locations, s.translations->'en'->>'title', s.sc
  from scored s
  where s.place_ok and s.topic_ok
  order by s.sc desc, s.occurred_at desc
  limit least(greatest(p_limit, 1), 200);
$function$;

REVOKE ALL
  ON FUNCTION "public"."ai_search_candidates"(timestamp WITH time zone, timestamp WITH time zone, text[], text[], text[], text[], integer)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ais_gate_crossings (
  p0_lat double precision,
  p0_lng double precision,
  p1_lat double precision,
  p1_lng double precision
)
  RETURNS TABLE (
    gate text,
    dir  smallint
  )
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  AS $function$
  select g.id, (case when public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p1_lat, p1_lng) > 0 then 1 else -1 end)::smallint
  from public.ais_gates g
  where public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p0_lat, p0_lng)
      * public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p1_lat, p1_lng) < 0
    and public.ais_side(p0_lat, p0_lng, p1_lat, p1_lng, g.a_lat, g.a_lng)
      * public.ais_side(p0_lat, p0_lng, p1_lat, p1_lng, g.b_lat, g.b_lng) < 0;
$function$;

CREATE OR REPLACE FUNCTION public.ais_side (
  a_lat double precision,
  a_lng double precision,
  b_lat double precision,
  b_lng double precision,
  p_lat double precision,
  p_lng double precision
)
  RETURNS double precision
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  AS $function$
  select sign((b_lng - a_lng) * (p_lat - a_lat) - (b_lat - a_lat) * (p_lng - a_lng));
$function$;

CREATE OR REPLACE FUNCTION public.ais_upsert (
  p_rows jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_n integer := 0; v_m integer := 0;
begin
  insert into public.ais_crossings (gate, mmsi, dir, at, ship_type, name)
  select g.gate, r.mmsi, g.dir, coalesce(r.at, now()), coalesce(r.ship_type, v.ship_type), coalesce(nullif(r.name, ''), v.name)
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, lat float8, lng float8, sog real, at timestamptz, ship_type smallint, name text)
  join public.ais_vessels v on v.mmsi = r.mmsi
  cross join lateral public.ais_gate_crossings(v.lat, v.lng, r.lat, r.lng) g
  join public.ais_gates gg on gg.id = g.gate
  where r.lat is not null and r.lng is not null
    and coalesce(r.sog, v.sog, 0) >= 2
    and v.updated_at > coalesce(r.at, now()) - interval '6 hours'
    and not exists (select 1 from public.ais_crossings c join public.ais_gates cg on cg.id = c.gate
                    where c.mmsi = r.mmsi and cg.chokepoint = gg.chokepoint and c.dir = g.dir
                      and c.at > coalesce(r.at, now()) - interval '24 hours');

  insert into public.ais_vessels as v (mmsi, name, callsign, imo, ship_type, destination, eta, length_m, lat, lng, sog, cog, heading, nav_status, updated_at, static_at)
  select r.mmsi, nullif(r.name, ''), nullif(r.callsign, ''), r.imo, r.ship_type, nullif(r.destination, ''), nullif(r.eta, ''), r.length_m,
         r.lat, r.lng, r.sog, r.cog, r.heading, r.nav_status, coalesce(r.at, now()), case when r.ship_type is not null or r.name is not null then now() end
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, name text, callsign text, imo bigint, ship_type smallint, destination text, eta text,
                                       length_m smallint, lat float8, lng float8, sog real, cog real, heading smallint, nav_status smallint, at timestamptz)
  where r.lat is not null and r.lng is not null and r.lat between -90 and 90 and r.lng between -180 and 180 and r.mmsi > 0
  on conflict (mmsi) do update set
    name = coalesce(excluded.name, v.name), callsign = coalesce(excluded.callsign, v.callsign), imo = coalesce(excluded.imo, v.imo),
    ship_type = coalesce(excluded.ship_type, v.ship_type), destination = coalesce(excluded.destination, v.destination),
    eta = coalesce(excluded.eta, v.eta), length_m = coalesce(excluded.length_m, v.length_m),
    lat = excluded.lat, lng = excluded.lng, sog = excluded.sog, cog = excluded.cog,
    heading = coalesce(excluded.heading, v.heading), nav_status = coalesce(excluded.nav_status, v.nav_status),
    updated_at = greatest(excluded.updated_at, v.updated_at), static_at = coalesce(excluded.static_at, v.static_at);
  get diagnostics v_n = row_count;

  update public.ais_vessels v set
    name = coalesce(nullif(r.name, ''), v.name), callsign = coalesce(nullif(r.callsign, ''), v.callsign), imo = coalesce(r.imo, v.imo),
    ship_type = coalesce(r.ship_type, v.ship_type), destination = coalesce(nullif(r.destination, ''), v.destination),
    eta = coalesce(nullif(r.eta, ''), v.eta), length_m = coalesce(r.length_m, v.length_m), static_at = now()
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, name text, callsign text, imo bigint, ship_type smallint, destination text, eta text, length_m smallint, lat float8)
  where r.lat is null and v.mmsi = r.mmsi;
  get diagnostics v_m = row_count;

  if extract(minute from now()) < 1 then
    delete from public.ais_vessels where updated_at < now() - interval '72 hours';
    delete from public.ais_crossings where at < now() - interval '60 days';
  end if;
  return v_n + v_m;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."ais_upsert"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.api_create_key (
  p_name        text,
  p_tier        text,
  p_owner_email text    DEFAULT NULL::text,
  p_days        integer DEFAULT NULL::integer
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare
  k text := 'ofk_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from api_tiers where id = p_tier) then raise exception 'unknown tier'; end if;
  insert into api_keys (name, owner_email, tier, key_hash, key_prefix, created_by, expires_at)
  values (left(trim(p_name), 120), nullif(trim(p_owner_email), ''), p_tier,
          encode(extensions.digest(k, 'sha256'), 'hex'), left(k, 12), auth.uid(),
          case when p_days is null then null else now() + make_interval(days => p_days) end);
  return k;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."api_create_key"(text, text, text, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.api_events (
  p_key      text,
  p_since    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_until    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_category text                     DEFAULT NULL::text,
  p_country  text                     DEFAULT NULL::text,
  p_limit    integer                  DEFAULT 100
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare
  v_key api_keys;
  v_tier api_tiers;
  v_day int;
  v_min int;
  v_rows jsonb;
begin
  if coalesce((select value from app_settings where key = 'api_enabled') = 'true'::jsonb, false) is not true then
    return jsonb_build_object('error', 'api_not_available', 'status', 503);
  end if;
  select * into v_key from api_keys
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
     and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('error', 'invalid_key', 'status', 401); end if;
  select * into v_tier from api_tiers where id = v_key.tier;

  insert into api_usage_minute (key_id, minute, calls) values (v_key.id, date_trunc('minute', now()), 1)
  on conflict (key_id, minute) do update set calls = api_usage_minute.calls + 1 returning calls into v_min;
  if v_min > v_tier.per_minute then return jsonb_build_object('error', 'rate_limited', 'status', 429, 'retry_after', 60 - extract(second from now())::int); end if;
  insert into api_usage (key_id, day, calls) values (v_key.id, (now() at time zone 'UTC')::date, 1)
  on conflict (key_id, day) do update set calls = api_usage.calls + 1 returning calls into v_day;
  if v_day > v_tier.daily_limit then return jsonb_build_object('error', 'daily_limit_reached', 'status', 429); end if;
  update api_keys set last_used_at = now() where id = v_key.id;
  delete from api_usage_minute where minute < now() - interval '10 minutes';

  select coalesce(jsonb_agg(r order by r->>'occurred_at' desc), '[]'::jsonb) into v_rows from (
    select jsonb_strip_nulls(jsonb_build_object(
      'id', e.id,
      'occurred_at', e.occurred_at,
      'published_at', e.published_at,
      'updated_at', e.updated_at,
      'title_he', coalesce(e.translations #>> '{he,title}', e.title),
      'title_en', e.translations #>> '{en,title}',
      'summary_he', e.translations #>> '{he,summary}',
      'summary_en', e.translations #>> '{en,summary}',
      'category', c.slug,
      'severity', e.severity,
      'verified', e.is_verified,
      'breaking', e.is_breaking,
      'latitude', e.latitude,
      'longitude', e.longitude,
      'place_he', coalesce(e.location_name_he, e.location_name),
      'place_en', e.location_name_en,
      'country', e.country,
      'source_name', e.source_name,
      'source_url', e.source_url,
      'url', 'https://osintfront.com/?event=' || e.id
    )) r
    from events e
    left join event_categories c on c.id = e.category_id and c.is_active
    where e.status in ('published', 'archived') and e.deleted_at is null and cardinality(e.hfc_areas) = 0
      and (p_since is null or e.occurred_at >= p_since)
      and (p_until is null or e.occurred_at < p_until)
      and (p_category is null or c.slug = p_category)
      and (p_country is null or e.country ilike p_country)
    order by e.occurred_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) s;

  return jsonb_build_object(
    'data', v_rows,
    'usage', jsonb_build_object('tier', v_tier.id, 'today', v_day, 'daily_limit', v_tier.daily_limit),
    'attribution', 'Osintfront (osintfront.com)'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.api_insights (
  p_key text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare v_key api_keys; v_tier api_tiers; v_day int; v_min int;
begin
  if coalesce((select value from app_settings where key = 'api_enabled') = 'true'::jsonb, false) is not true then
    return jsonb_build_object('error', 'api_not_available', 'status', 503);
  end if;
  select * into v_key from api_keys
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
     and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('error', 'invalid_key', 'status', 401); end if;
  select * into v_tier from api_tiers where id = v_key.tier;
  insert into api_usage_minute (key_id, minute, calls) values (v_key.id, date_trunc('minute', now()), 1)
  on conflict (key_id, minute) do update set calls = api_usage_minute.calls + 1 returning calls into v_min;
  if v_min > v_tier.per_minute then return jsonb_build_object('error', 'rate_limited', 'status', 429, 'retry_after', 60 - extract(second from now())::int); end if;
  insert into api_usage (key_id, day, calls) values (v_key.id, (now() at time zone 'UTC')::date, 1)
  on conflict (key_id, day) do update set calls = api_usage.calls + 1 returning calls into v_day;
  if v_day > v_tier.daily_limit then return jsonb_build_object('error', 'daily_limit_reached', 'status', 429); end if;
  update api_keys set last_used_at = now() where id = v_key.id;

  return jsonb_build_object(
    'disclaimer', 'Experimental statistical estimate only — not an official alert, intelligence or advice. In an emergency follow the Home Front Command.',
    'insights', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', e.slug, 'title_en', e.title_en, 'title_he', e.title_he, 'horizon_hours', e.horizon_hours,
        'probability', f.probability, 'confidence_low', f.confidence_low, 'confidence_high', f.confidence_high,
        'updated_at', f.ts, 'next_update', e.next_run_at, 'model_version', f.model_version,
        'contributions', (select coalesce(jsonb_agg(jsonb_build_object('key', c->>'key', 'name', c->>'name_en', 'pp', (c->>'pp')::numeric)), '[]'::jsonb)
                          from jsonb_array_elements(f.contributions) c)
      ) order by e.sort)
      from insight_events e
      join lateral (select * from insight_forecasts x where x.event_id = e.id order by x.ts desc limit 1) f on true
      where e.is_published and e.status <> 'draft'), '[]'::jsonb),
    'usage', jsonb_build_object('tier', v_tier.id, 'today', v_day, 'daily_limit', v_tier.daily_limit));
end $function$;

CREATE OR REPLACE FUNCTION public.api_revoke_key (
  p_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update api_keys set revoked_at = now() where id = p_id and revoked_at is null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."api_revoke_key"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.app_settings_stamp()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  new.updated_at := now();
  new.updated_by := (select id from public.profiles where id = auth.uid());
  perform public.write_audit('settings.changed', 'settings', null,
    jsonb_build_object('key', new.key, 'from', old.value, 'to', new.value));
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."app_settings_stamp"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.approve_event_review (
  p_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not public.has_permission('event.review') then
    raise exception 'You do not have permission to approve changes.' using errcode = '42501';
  end if;
  update public.events set review_requested_at = null, review_requested_by = null where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."approve_event_review"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.arabic_place_variants (
  p_name text
)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select array_remove(array[
    nullif(btrim(p_name), ''),
    case when btrim(p_name) ~ '^(كفر|عين|بيت|دير|تل|بير|جبل)[^ ]{2,}$'
         then regexp_replace(btrim(p_name), '^(كفر|عين|بيت|دير|تل|بير|جبل)', '\1 ') end,
    case when btrim(p_name) ~ '^(وادي|سهل|أطراف|اطراف|خراج|محيط|تلة|جبل) .{2,}'
         then regexp_replace(btrim(p_name), '^(وادي|سهل|أطراف|اطراف|خراج|محيط|تلة|جبل) ', '') end
  ], null)
$function$;

CREATE OR REPLACE FUNCTION public.backfill_place_names (
  p_limit integer DEFAULT 5000
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_n integer;
begin
  with todo as (
    select e.id, e.location_name, e.country, e.latitude, e.longitude, e.ai_suggestions ->> 'place_en' as place_en
    from public.events e
    where e.deleted_at is null and (e.location_name_he is null or e.location_name_en is null)
      and coalesce(e.location_name, '') <> ''
    order by e.created_at desc
    limit p_limit
  ), hit as (
    select t.id, t.location_name, t.place_en,
           coalesce(public.geo_lookup(t.location_name, t.country, t.latitude::float8, t.longitude::float8),
                    public.geo_lookup(t.place_en, t.country, t.latitude::float8, t.longitude::float8)) g
    from todo t
  )
  update public.events e set
    location_name_he = coalesce(e.location_name_he, (h.g).name_he, case when public.has_hebrew(h.location_name) then left(h.location_name, 200) end),
    location_name_en = coalesce(e.location_name_en, (h.g).name_en, nullif(left(h.place_en, 200), ''),
                                case when not public.has_hebrew(h.location_name) then left(h.location_name, 200) end)
  from hit h where e.id = h.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."backfill_place_names"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.build_wadi_lines()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_n integer;
begin
  insert into public.wadi_lines (kind, name, name_ar, name_en, name_he, geom, length_km, way_ids)
  select kind, name, name_ar, name_en, name_he, geom, length_km, way_ids from (
    select (array_agg(kind order by extensions.st_length(geom) desc))[1] kind,
           name, max(name_ar) name_ar, max(name_en) name_en, max(name_he) name_he,
           extensions.st_multi(extensions.st_linemerge(extensions.st_collect(geom))) geom,
           round((sum(extensions.st_length(geom::extensions.geography)) / 1000)::numeric, 2) length_km,
           array_agg(way_id) way_ids
    from (
      select w.*, extensions.st_clusterdbscan(w.geom, 0.01, 1) over (partition by lower(w.name)) c
      from public.osm_waterways w
    ) x
    group by name, c
  ) n
  where not exists (select 1 from public.wadi_lines e where e.way_ids && n.way_ids);
  get diagnostics v_n = row_count;
  with m as (
    select l.id, (
      select array[p.name_he, coalesce(p.he_from_ai, false)::text] from public.geo_places p
      where p.country_code = 'LB' and p.feature_code in ('WAD', 'STM', 'VAL') and p.name_he is not null
        and extensions.st_dwithin(p.geom, l.geom, 0.03)
        and (public.normalize_place(p.name_ar) = public.normalize_place(l.name_ar)
             or public.normalize_place(p.name) = public.normalize_place(coalesce(l.name_en, l.name)))
      order by extensions.st_distance(p.geom, l.geom) limit 1) he
    from public.wadi_lines l where l.name_he is null
  )
  update public.wadi_lines l set name_he = m.he[1], he_from_ai = m.he[2]::boolean
    from m where m.id = l.id and m.he is not null;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."build_wadi_lines"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.can_geolocate()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce((
    select case
      when pr.role <> 'viewer' then true
      else coalesce((select f.enabled from public.plan_features f
                      where f.feature_key = 'geolocation'
                        and f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null
                                                  and pr.plan_expires_at < now() then 'free' else pr.plan end), false)
    end
    from public.profiles pr where pr.id = auth.uid()), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_publish_from (
  p_status public.event_status
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select public.has_permission('event.publish')
      or (p_status in ('draft', 'pending_review') and public.has_permission('event.publish.draft'));
$function$;

REVOKE ALL ON FUNCTION "public"."can_publish_from"(public.event_status) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.chokepoint_stats()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with cp(id, ord) as (values ('hormuz', 1), ('bab_el_mandeb', 2), ('suez', 3), ('tiran', 4), ('bosphorus', 5), ('dardanelles', 6)),
  -- When collection started: the first recorded crossing anywhere (crossings are kept 60 days).
  start as (select min(at) as t from public.ais_crossings),
  span as (
    select
      greatest(0, least(28, coalesce(extract(epoch from (now() - interval '24 hours') - s.t) / 86400.0, 0))) as base_days,
      greatest(0, least(7, coalesce(extract(epoch from now() - s.t) / 86400.0, 0))) as week_days
    from start s
  ),
  c as (
    select g.chokepoint, x.*, case when x.dir > 0 then g.pos_en else g.neg_en end as dir_en,
           case when x.dir > 0 then g.pos_he else g.neg_he end as dir_he
    from public.ais_crossings x join public.ais_gates g on g.id = x.gate
    where x.at > now() - interval '29 days' and x.ship_type between 70 and 89   -- commercial: cargo and tankers
  ),
  agg as (
    select cp.id,
      count(c.id) filter (where c.at > now() - interval '24 hours') as crossings_24h,
      count(c.id) filter (where c.at > now() - interval '24 hours' and c.ship_type between 80 and 89) as tankers_24h,
      count(c.id) filter (where c.at <= now() - interval '24 hours' and c.at > now() - interval '29 days') as past_n,
      count(c.id) filter (where c.at > now() - interval '7 days') as week_n
    from cp left join c on c.chokepoint = cp.id
    group by cp.id
  ),
  waits as (
    select g.chokepoint, jsonb_agg(jsonb_build_object('en', w.name_en, 'he', w.name_he, 'n', (
      select count(*) from public.ais_vessels v
      where v.updated_at > now() - interval '3 hours' and coalesce(v.sog, 0) < 1
        and v.lat between w.min_lat and w.max_lat and v.lng between w.min_lng and w.max_lng)) order by g.id, w.side) as waiting
    from public.ais_gates g
    cross join lateral (values
      (1, g.wp_name_en, g.wp_name_he, g.wp_min_lat, g.wp_min_lng, g.wp_max_lat, g.wp_max_lng),
      (2, g.wn_name_en, g.wn_name_he, g.wn_min_lat, g.wn_min_lng, g.wn_max_lat, g.wn_max_lng)
    ) as w(side, name_en, name_he, min_lat, min_lng, max_lat, max_lng)
    where w.name_en is not null
    group by g.chokepoint
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'crossings_24h', a.crossings_24h,
    'tankers_24h', a.tankers_24h,
    'avg_7d', case when coalesce(sp.week_days, 0) > 0 then round(a.week_n::numeric / greatest(sp.week_days, 1)::numeric, 1) else 0 end,
    'days', floor(coalesce(sp.base_days, 0))::int,
    'pct_normal', case when coalesce(sp.base_days, 0) >= 7 and a.past_n > 0
                       then round(100 * a.crossings_24h::numeric / (a.past_n::numeric / sp.base_days::numeric)) end,
    'waiting', coalesce(w.waiting, '[]'::jsonb),
    'last', (select jsonb_build_object('mmsi', l.mmsi, 'name', l.name, 'ship_type', l.ship_type, 'dir_en', l.dir_en, 'dir_he', l.dir_he, 'at', l.at)
             from c l where l.chokepoint = a.id order by l.at desc limit 1)
  ) order by cp.ord), '[]'::jsonb)
  from agg a join cp on cp.id = a.id left join waits w on w.chokepoint = a.id cross join span sp;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_auto_drafts()
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with gone as (
    update public.events e set deleted_at = now()
     where e.status = 'draft' and e.deleted_at is null
       and coalesce(e.ai_suggestions ->> 'source', '') <> ''
       and e.created_at < now() - interval '24 hours'
       and e.review_requested_at is null
       and not exists (select 1 from public.event_history h where h.event_id = e.id and h.changed_by is not null
                         and h.changed_by <> e.created_by)
    returning 1)
  select count(*)::integer from gone;
$function$;

REVOKE ALL ON FUNCTION "public"."cleanup_auto_drafts"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.consume_feature (
  p_uid uuid,
  p_key text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_prof public.profiles%rowtype;
  v_plan text;
  v_enforce boolean;
  v_enabled boolean;
  v_limit int;
  v_day date := (now() at time zone 'Asia/Jerusalem')::date;
  v_count int;
begin
  if p_uid is not null then
    select * into v_prof from public.profiles where id = p_uid;
  end if;
  if p_uid is null or v_prof.id is null or v_prof.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'signup_required', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = 'enforce_plans'), false) into v_enforce;

  if v_prof.role <> 'viewer' then
    v_enabled := true; v_limit := null;
  else
    v_plan := case when v_prof.plan <> 'free' and v_prof.plan_expires_at is not null and v_prof.plan_expires_at < now()
                   then 'free' else v_prof.plan end;
    select enabled, limit_value into v_enabled, v_limit
      from public.plan_features where feature_key = p_key and plan_id = v_plan;
    v_enabled := coalesce(v_enabled, false);
  end if;

  if not v_enabled and v_enforce then
    return jsonb_build_object('ok', false, 'reason', 'not_in_plan', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  insert into public.feature_usage as fu (user_id, feature_key, day, count)
  values (p_uid, p_key, v_day, 1)
  on conflict (user_id, feature_key, day) do update set count = fu.count + 1
    where v_limit is null or not v_enforce or fu.count < v_limit
  returning count into v_count;

  if v_count is null then
    select count into v_count from public.feature_usage where user_id = p_uid and feature_key = p_key and day = v_day;
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded', 'used', v_count, 'limit', v_limit, 'remaining', 0);
  end if;
  if v_enforce and v_limit is not null and v_count > v_limit then
    update public.feature_usage set count = count - 1 where user_id = p_uid and feature_key = p_key and day = v_day;
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded', 'used', v_count - 1, 'limit', v_limit, 'remaining', 0);
  end if;
  return jsonb_build_object('ok', true, 'reason', null, 'used', v_count, 'limit', v_limit,
    'remaining', case when v_limit is null then null else greatest(v_limit - v_count, 0) end);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."consume_feature"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.country_iso (
  p text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.edit_event_text (
  p_id         uuid,
  p_title_he   text,
  p_summary_he text,
  p_title_en   text,
  p_summary_en text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_owner uuid; v_tr jsonb; v_he jsonb; v_en jsonb;
  c_he_t text := nullif(btrim(p_title_he), '');
  c_he_s text := nullif(btrim(p_summary_he), '');
  c_en_t text := nullif(btrim(p_title_en), '');
  c_en_s text := nullif(btrim(p_summary_en), '');
begin
  select created_by, coalesce(translations, '{}'::jsonb) into v_owner, v_tr from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  if c_he_t is null then raise exception 'A Hebrew headline is required.' using errcode = '22023'; end if;
  if length(c_he_t) > 200 or length(coalesce(c_en_t, '')) > 200
     or length(coalesce(c_he_s, '')) > 400 or length(coalesce(c_en_s, '')) > 400 then
    raise exception 'Text too long.' using errcode = '22001';
  end if;
  v_he := coalesce(v_tr->'he', '{}'::jsonb) || jsonb_build_object('title', c_he_t);
  v_he := case when c_he_s is null then v_he - 'summary' else v_he || jsonb_build_object('summary', c_he_s) end;
  v_en := coalesce(v_tr->'en', '{}'::jsonb);
  v_en := case when c_en_t is null then v_en - 'title' else v_en || jsonb_build_object('title', c_en_t) end;
  v_en := case when c_en_s is null then v_en - 'summary' - 'description'
               else v_en || jsonb_build_object('summary', c_en_s, 'description', c_en_s) end;
  update public.events
     set title = c_he_t,
         description = coalesce(c_he_s, description),
         translations = v_tr || jsonb_build_object('he', v_he, 'en', v_en),
         ai_suggestions = coalesce(ai_suggestions, '{}'::jsonb) || jsonb_build_object('manual_text', now())
   where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."edit_event_text"(uuid, text, text, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.event_internal_notes_stamp()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."event_internal_notes_stamp"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.event_is_public (
  p_event uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (select 1 from public.events e where e.id = p_event and e.status = 'published' and e.deleted_at is null);
$function$;

CREATE OR REPLACE FUNCTION public.event_is_recent (
  p_event uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (select 1 from public.events e where e.id = p_event and e.status = 'published'
                 and e.deleted_at is null and e.occurred_at > now() - interval '24 hours');
$function$;

CREATE OR REPLACE FUNCTION public.event_media_kinds (
  p_event uuid
)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(array_agg(distinct case
           when m.kind in ('video', 'video_thumb') then 'video'
           when m.kind = 'image' then 'image'
           else 'document' end), '{}')
  from public.event_media m where m.event_id = p_event;
$function$;

CREATE OR REPLACE FUNCTION public.event_source_text (
  p_id uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select left(coalesce(nullif(e.original_report_text, ''), e.description), 10000)
  from public.events e
  where e.id = p_id and e.deleted_at is null and e.status in ('published', 'archived');
$function$;

REVOKE ALL ON FUNCTION "public"."event_source_text"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.events_after_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_prev     jsonb;
  v_next     jsonb;
  v_action   text;
  v_changed  text[];
begin
  if tg_op = 'INSERT' then
    insert into public.event_history (event_id, action, previous_values, new_values, changed_by)
    values (new.id, 'created', '{}'::jsonb, to_jsonb(new), (select id from public.profiles where id = v_actor));
    perform public.write_audit('event.created', 'event', new.id,
      jsonb_build_object('title', new.title, 'status', new.status));
    if new.status = 'published' then
      perform public.write_audit('event.published', 'event', new.id, jsonb_build_object('title', new.title));
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.write_audit('event.deleted_permanently', 'event', old.id,
      jsonb_build_object('title', old.title, 'status', old.status, 'snapshot', to_jsonb(old)));
    return old;
  end if;
  select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb),
         coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb),
         coalesce(array_agg(n.key order by n.key), array[]::text[])
    into v_prev, v_next, v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at');
  if v_changed = array[]::text[] then
    return new;
  end if;
  v_action := case
    when new.deleted_at is not null and old.deleted_at is null then 'deleted'
    when new.deleted_at is null and old.deleted_at is not null then 'restored'
    when new.status <> old.status then case new.status
      when 'published'      then case when old.status = 'pending_review' then 'approved_and_published' else 'published' end
      when 'pending_review' then 'submitted_for_review'
      when 'rejected'       then 'rejected'
      when 'archived'       then 'archived'
      when 'draft'          then 'returned_to_draft'
    end
    when new.coordinates_manually_corrected and not old.coordinates_manually_corrected then 'coordinates_corrected'
    else 'edited'
  end;
  insert into public.event_history (event_id, action, previous_values, new_values, changed_by)
  values (new.id, v_action, v_prev, v_next, (select id from public.profiles where id = v_actor));
  perform public.write_audit('event.' || v_action, 'event', new.id,
    jsonb_build_object('title', new.title, 'from_status', old.status, 'to_status', new.status,
                       'changed_fields', to_jsonb(v_changed))
    || case when new.status = 'rejected' and old.status <> 'rejected'
            then jsonb_build_object('rejection_reason', new.rejection_reason) else '{}'::jsonb end);
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_after_change"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_apply_learned_place()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_hit   public.learned_places;
  v_geo   public.geo_places;
  v_ids   uuid[] := '{}';
  v_items jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_lp    public.learned_places;
  v_g     public.geo_places;
begin
  if auth.uid() is not null then
    -- A person's edit: places still without coordinates never stay in the list.
    if jsonb_typeof(new.locations) = 'array' then
      new.locations := (select coalesce(jsonb_agg(x order by i), '[]'::jsonb)
                        from jsonb_array_elements(new.locations) with ordinality as t(x, i)
                        where jsonb_typeof(x -> 'lat') = 'number' and jsonb_typeof(x -> 'lng') = 'number');
    end if;
    return new;
  end if;
  if cardinality(coalesce(new.hfc_areas, '{}')) > 0 then return new; end if;
  if tg_op = 'UPDATE'
     and new.location_name is not distinct from old.location_name
     and new.locations is not distinct from old.locations
     and (new.latitude, new.longitude) is not distinct from (old.latitude, old.longitude) then
    return new;
  end if;

  if jsonb_typeof(new.locations) = 'array' and jsonb_array_length(new.locations) > 0 then
    for v_item in select value from jsonb_array_elements(new.locations) loop
      v_lp := public.learned_place(v_item ->> 'name', v_item ->> 'name_en');
      if v_lp.id is not null then
        v_item := v_item || jsonb_build_object('lat', v_lp.latitude, 'lng', v_lp.longitude, 'precision', 'exact', 'learned', true);
        v_ids := v_ids || v_lp.id;
      else
        v_g := public.geo_lookup(v_item ->> 'name', new.country,
                                 case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::float8 end,
                                 case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::float8 end);
        if v_g.geonameid is null and coalesce(v_item ->> 'name_en', '') <> '' then
          v_g := public.geo_lookup(v_item ->> 'name_en', new.country,
                                   case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::float8 end,
                                   case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::float8 end);
          if v_g.geonameid is not null and v_g.name_he is null and public.has_hebrew(v_item ->> 'name') then
            update public.geo_places set name_he = left(v_item ->> 'name', 120), he_from_ai = true,
                   names = (select array_agg(distinct x) from unnest(names || public.normalize_place(v_item ->> 'name')) x)
            where geonameid = v_g.geonameid;
            v_g.name_he := v_item ->> 'name';
          end if;
        end if;
        if v_g.geonameid is null and coalesce(v_item ->> 'name_ar', '') <> '' then
          select g.* into v_g from unnest(public.arabic_place_variants(v_item ->> 'name_ar')) as v(n)
            cross join lateral public.geo_lookup(v.n, new.country) g
          where g.geonameid is not null limit 1;
        end if;
        if v_g.geonameid is not null then
          v_item := (v_item - 'name_ar') || jsonb_build_object(
            'lat', round(extensions.st_y(v_g.geom)::numeric, 6), 'lng', round(extensions.st_x(v_g.geom)::numeric, 6),
            'precision', case when v_g.feature_class = 'A' then 'region' else 'exact' end,
            'geonameid', v_g.geonameid,
            'name', coalesce(v_g.name_he, v_item ->> 'name'),
            'name_en', coalesce(nullif(v_item ->> 'name_en', ''), v_g.name_en, v_g.name));
        end if;
      end if;
      -- Still not found anywhere: left out (no pin can be shown for it).
      continue when jsonb_typeof(v_item -> 'lat') <> 'number' or jsonb_typeof(v_item -> 'lng') <> 'number';
      v_items := v_items || jsonb_build_array(v_item);
    end loop;
    new.locations := v_items;
    -- No main pin yet, or only the country's: the first place that was found.
    if (new.latitude is null or new.location_precision = 'country') and jsonb_array_length(v_items) > 0 then
      new.latitude := (v_items -> 0 ->> 'lat')::numeric;
      new.longitude := (v_items -> 0 ->> 'lng')::numeric;
      new.location_precision := coalesce(nullif(v_items -> 0 ->> 'precision', ''), 'exact');
      if coalesce(new.location_name, '') = '' then new.location_name := left(v_items -> 0 ->> 'name', 200); end if;
      new.geocoding_confidence := 0.7;
    end if;
  end if;

  v_hit := public.learned_place(new.location_name, new.ai_suggestions ->> 'place_en');
  if v_hit.id is not null then
    new.latitude := v_hit.latitude;
    new.longitude := v_hit.longitude;
    new.location_precision := 'exact';
    new.geocoding_confidence := 0.95;
    if coalesce(new.country, '') = '' and v_hit.country <> '' then new.country := v_hit.country; end if;
    new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
      'location_resolution', jsonb_build_object('method', 'learned', 'matched_on', new.location_name,
                                                 'place', v_hit.location_name, 'resolved_at', now()));
    v_ids := v_ids || v_hit.id;
  elsif coalesce(new.location_name, '') <> '' or coalesce(new.ai_suggestions ->> 'place_en', '') <> '' then
    v_geo := public.geo_lookup(new.location_name, new.country, new.latitude::float8, new.longitude::float8);
    if v_geo.geonameid is null and coalesce(new.ai_suggestions ->> 'place_en', '') <> '' then
      v_geo := public.geo_lookup(new.ai_suggestions ->> 'place_en', new.country, new.latitude::float8, new.longitude::float8);
      if v_geo.geonameid is not null and v_geo.name_he is null and public.has_hebrew(new.location_name) then
        update public.geo_places set name_he = left(new.location_name, 120), he_from_ai = true,
               names = (select array_agg(distinct x) from unnest(names || public.normalize_place(new.location_name)) x)
        where geonameid = v_geo.geonameid;
        v_geo.name_he := new.location_name;
      end if;
    end if;
    if v_geo.geonameid is not null then
      new.latitude := round(extensions.st_y(v_geo.geom)::numeric, 6);
      new.longitude := round(extensions.st_x(v_geo.geom)::numeric, 6);
      new.location_precision := case when v_geo.feature_class = 'A' then 'region' else 'exact' end;
      new.geocoding_confidence := 0.9;
      new.location_name_he := coalesce(v_geo.name_he, case when public.has_hebrew(new.location_name) then new.location_name end);
      new.location_name_en := coalesce(nullif(new.ai_suggestions ->> 'place_en', ''),
        case when tg_op = 'UPDATE' and new.location_name is not distinct from old.location_name then new.location_name_en end,
        v_geo.name_en, v_geo.name);
      if coalesce(new.country, '') = '' then
        new.country := case v_geo.country_code when 'IL' then 'Israel' when 'SY' then 'Syria' when 'LB' then 'Lebanon'
          when 'IQ' then 'Iraq' when 'YE' then 'Yemen' when 'SA' then 'Saudi Arabia' when 'IR' then 'Iran' end;
      end if;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'geonames', 'geonameid', v_geo.geonameid,
                                                   'matched_on', new.location_name, 'place', v_geo.name_en, 'resolved_at', now()));
    end if;
  end if;

  if new.location_name_he is null and public.has_hebrew(new.location_name) then
    new.location_name_he := left(new.location_name, 200);
  end if;
  if new.location_name_en is null and coalesce(new.ai_suggestions ->> 'place_en', '') <> '' then
    new.location_name_en := left(new.ai_suggestions ->> 'place_en', 200);
  end if;

  if cardinality(v_ids) > 0 then
    update public.learned_places set times_used = times_used + 1, last_used_at = now() where id = any (v_ids);
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_apply_learned_place"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_auto_verify()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_n integer;
begin
  if new.is_verified then return new; end if;
  select count(distinct o) into v_n from (
    select public.mainstream_outlet(new.source_name, new.source_url) o
    union all
    select public.mainstream_outlet(s ->> 'name', s ->> 'url')
    from jsonb_array_elements(case when jsonb_typeof(new.sources) = 'array' then new.sources else '[]'::jsonb end) s
    where coalesce(s ->> 'kind', '') <> 'context'
  ) q where o is not null;
  if v_n >= 2 then
    new.is_verified := true;
    new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object('verified_by', 'two mainstream outlets');
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_auto_verify"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_before_insert()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null then
    new.created_by  := v_actor;
    new.created_at  := now();
    new.approved_by := null;
    new.deleted_at  := null;
    if new.status not in ('draft', 'pending_review', 'published') then
      raise exception 'New events must start as draft, pending review or published (got %).', new.status
        using errcode = '22023';
    end if;
    if new.status = 'published' and not public.can_publish_from('draft') then
      raise exception 'You do not have permission to publish events.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  if new.status = 'published' then
    new.published_at := case when v_actor is null then coalesce(new.published_at, now()) else now() end;
    new.approved_by  := coalesce(new.approved_by, v_actor);
  elsif v_actor is not null then
    new.published_at := null;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_before_insert"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_before_update()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  new.updated_at := now();
  if v_actor is not null then
    if new.created_by is distinct from old.created_by then
      raise exception 'Event ownership cannot be changed.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    if new.status <> old.status then
      if not public.is_valid_event_transition(old.status, new.status) then
        raise exception 'An event cannot move from % to %.', old.status, new.status using errcode = '22023';
      end if;
      if new.status = 'published' and not public.can_publish_from(old.status) then
        raise exception 'You do not have permission to publish events.' using errcode = '42501';
      end if;
      if new.status = 'rejected' and not public.has_permission('event.review') then
        raise exception 'You do not have permission to reject events.' using errcode = '42501';
      end if;
      if new.status = 'archived' and not public.has_permission('event.archive') then
        raise exception 'You do not have permission to archive events.' using errcode = '42501';
      end if;
    end if;
    if new.deleted_at is distinct from old.deleted_at and not public.has_permission('event.delete') then
      raise exception 'You do not have permission to delete or restore events.' using errcode = '42501';
    end if;
    if new.status = 'published' and old.status <> 'published' then
      new.published_at := now();
      new.approved_by  := v_actor;
    else
      new.published_at := old.published_at;
      new.approved_by  := old.approved_by;
    end if;
  elsif new.status = 'published' and old.status <> 'published' then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_before_update"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_bump_pulse()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if (tg_op = 'INSERT' and new.status = 'published')
     or (tg_op = 'UPDATE' and (old.status = 'published' or new.status = 'published'
                               or (old.status = 'archived') <> (new.status = 'archived')))
     or (tg_op = 'DELETE' and old.status in ('published', 'archived')) then
    update public.events_pulse set changed_at = now() where id = 1;
  end if;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_bump_pulse"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_editor_review()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null then return new; end if;
  if public.has_permission('event.publish')
     or (new.status = 'published' and old.status in ('draft', 'pending_review') and public.has_permission('event.publish.draft')) then
    if new.status is distinct from old.status then
      new.review_requested_at := null;
      new.review_requested_by := null;
    end if;
    return new;
  end if;
  if not public.has_permission('event.edit.any') then return new; end if;
  if (new.title, new.description, new.category_id, new.severity, new.latitude, new.longitude, new.location_name,
      new.country, new.region, new.city, new.locations, new.location_precision, new.source_name, new.source_url,
      new.occurred_at, new.is_breaking, new.is_verified, new.original_report_text)
     is not distinct from
     (old.title, old.description, old.category_id, old.severity, old.latitude, old.longitude, old.location_name,
      old.country, old.region, old.city, old.locations, old.location_precision, old.source_name, old.source_url,
      old.occurred_at, old.is_breaking, old.is_verified, old.original_report_text) then
    return new;
  end if;
  if old.status in ('draft', 'rejected') and new.status = old.status then
    new.status := 'pending_review';
  end if;
  new.review_requested_at := now();
  new.review_requested_by := auth.uid();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_editor_review"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_hfc_alert()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_threat integer;
  v_area   text;
begin
  if coalesce(new.ai_suggestions ->> 'hfc_auto', '') = 'true' then
    return null;
  end if;
  if new.status <> 'published' or new.deleted_at is not null or cardinality(new.hfc_areas) = 0 then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' and old.deleted_at is null
     and old.hfc_areas is not distinct from new.hfc_areas then
    return null;
  end if;

  v_threat := public.hfc_guess_threat(concat_ws(' ', new.title, new.description, new.original_report_text));
  foreach v_area in array new.hfc_areas loop
    if tg_op = 'UPDATE' and old.status = 'published' and old.deleted_at is null and v_area = any (old.hfc_areas) then
      continue;
    end if;
    perform public.hfc_record_alert(v_area, v_threat, now(), false, 'event:' || new.id);
  end loop;
  update public.hfc_alerts set event_id = new.id where source = 'event:' || new.id and event_id is null;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_hfc_alert"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_learn_from_correction()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_uid   uuid := auth.uid();
  v_key   text;
  v_from  text;
  v_to    text;
  v_gid   bigint;
begin
  if v_uid is null or new.deleted_at is not null then return null; end if;

  if new.latitude is not null
     and (old.latitude is null or abs(new.latitude - old.latitude) > 0.003 or abs(new.longitude - old.longitude) > 0.003) then
    -- Pin moved on a specific place with the same name → that name lives here.
    -- Otherwise (renamed, or the event had no specific pin) → learn the names it has now.
    foreach v_key in array case
        when old.latitude is not null and coalesce(old.location_precision, 'exact') in ('exact', 'city')
             and public.normalize_place(new.location_name) = public.normalize_place(old.location_name)
          then array[old.location_name, old.ai_suggestions ->> 'place_en']
        else array[new.location_name, new.location_name_he, new.location_name_en]
      end loop
      continue when v_key is null or btrim(v_key) = '' or not public.is_specific_place(v_key);
      insert into public.learned_places as lp (name_norm, name, location_name, country, latitude, longitude, learned_from, learned_by)
      values (public.normalize_place(v_key), left(v_key, 200), left(coalesce(new.location_name, ''), 200),
              left(coalesce(new.country, ''), 100), new.latitude, new.longitude, new.id, v_uid)
      on conflict (name_norm) do update
        set latitude = excluded.latitude, longitude = excluded.longitude,
            location_name = excluded.location_name, country = excluded.country,
            times_corrected = lp.times_corrected + 1, learned_from = excluded.learned_from,
            learned_by = excluded.learned_by, updated_at = now();
    end loop;
  end if;

  -- Names typed by an editor for a place the database matched: keep them for next time.
  v_gid := nullif(new.ai_suggestions -> 'location_resolution' ->> 'geonameid', '')::bigint;
  if v_gid is not null and new.location_name_he is distinct from old.location_name_he
     and public.has_hebrew(new.location_name_he) then
    update public.geo_places set name_he = left(new.location_name_he, 120), he_from_ai = false,
           names = (select array_agg(distinct x) from unnest(names || public.normalize_place(new.location_name_he)) x)
     where geonameid = v_gid;
  end if;
  if v_gid is not null and new.location_name_en is distinct from old.location_name_en
     and coalesce(new.location_name_en, '') ~ '^[\x20-\x7E]+$' then
    update public.geo_places set name_en = left(new.location_name_en, 120),
           names = (select array_agg(distinct x) from unnest(names || public.normalize_place(new.location_name_en)) x)
     where geonameid = v_gid;
  end if;

  -- Category: changed away from what the AI chose.
  if new.category_id is distinct from old.category_id and old.category_id is not null and new.category_id is not null
     and coalesce(old.ai_suggestions ->> 'source', '') <> '' then
    select slug into v_from from public.event_categories where id = old.category_id;
    select slug into v_to from public.event_categories where id = new.category_id;
    if v_from is not null and v_to is not null and v_from <> v_to then
      insert into public.category_corrections (event_id, text, from_slug, to_slug, created_by)
      values (new.id, left(regexp_replace(coalesce(nullif(old.original_report_text, ''), old.title), '\s+', ' ', 'g'), 400),
              v_from, v_to, v_uid);
      delete from public.category_corrections
      where id in (select id from public.category_corrections order by created_at desc offset 300);
    end if;
  end if;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_learn_from_correction"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_lifecycle()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_hfc boolean;
  v_lat double precision;
  v_lng double precision;
begin
  new.description := public.normalize_report_text(new.description);

  if auth.uid() is not null then
    new.expired_at := case when tg_op = 'UPDATE' then old.expired_at else null end;
  end if;
  if new.status <> 'archived' then
    new.expired_at := null;
  end if;

  select c.slug = 'home-front-alerts' into v_hfc from public.event_categories c where c.id = new.category_id;
  if coalesce(v_hfc, false) then
    new.is_breaking := true;
    if tg_op = 'INSERT'
       or (new.location_name, new.city, new.latitude, new.longitude, new.category_id)
          is distinct from (old.location_name, old.city, old.latitude, old.longitude, old.category_id) then
      new.hfc_areas := public.hfc_match_areas(new.location_name, new.city, new.latitude, new.longitude, new.location_precision);
    elsif auth.uid() is not null then
      new.hfc_areas := old.hfc_areas;
    end if;
    if cardinality(new.hfc_areas) > 0
       and (new.latitude is null or new.longitude is null or coalesce(new.location_precision, 'country') in ('region', 'country')) then
      select coalesce(a.latitude, extensions.st_y(extensions.st_pointonsurface(a.geom))),
             coalesce(a.longitude, extensions.st_x(extensions.st_pointonsurface(a.geom)))
        into v_lat, v_lng
      from public.hfc_areas a where a.name = new.hfc_areas[1];
      if v_lat is not null then
        new.latitude := round(v_lat::numeric, 6);
        new.longitude := round(v_lng::numeric, 6);
        new.location_precision := 'city';
      end if;
    end if;
  else
    new.hfc_areas := '{}';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_lifecycle"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_no_map()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if coalesce(new.ai_suggestions ->> 'no_map', '') = 'true' then
    new.latitude := null;
    new.longitude := null;
    new.location_precision := null;
    new.geocoding_confidence := null;
    new.locations := '[]'::jsonb;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.events_resolve_location()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_place     public.place_gazetteer;
  v_place_id  uuid;
  v_matched   text;
  v_settings  jsonb;
  v_prefix    text;
  v_imported  boolean := false;
  v_country   text;
  v_first     jsonb;
begin
  -- Early exit: nothing location-related changed (e.g. archiving, status edits),
  -- so skip re-resolution and the geo_lookup chain it triggers downstream.
  if tg_op = 'UPDATE'
     and new.location_name      is not distinct from old.location_name
     and new.city               is not distinct from old.city
     and new.region             is not distinct from old.region
     and new.country            is not distinct from old.country
     and new.locations          is not distinct from old.locations
     and new.latitude           is not distinct from old.latitude
     and new.longitude          is not distinct from old.longitude
     and new.location_precision is not distinct from old.location_precision
     and (new.ai_suggestions -> 'countries') is not distinct from (old.ai_suggestions -> 'countries')
  then
    return new;
  end if;

  if tg_op = 'INSERT' or new.locations is distinct from old.locations then
    new.locations := public.resolve_event_locations(new.locations, new.id);
  end if;

  if new.latitude is not null and new.longitude is not null then
    if new.location_precision is null then
      new.location_precision := 'exact';
    elsif tg_op = 'UPDATE'
          and (new.latitude, new.longitude) is distinct from (old.latitude, old.longitude)
          and new.location_precision is not distinct from old.location_precision
          and old.location_precision <> 'exact' then
      new.location_precision := 'exact';
    end if;
  elsif new.latitude is null and new.longitude is null then
    select r.place_id, r.matched_on into v_place_id, v_matched
    from public.resolve_event_place(new.location_name, new.city, new.region, new.country) r;

    -- The first listed place that already has coordinates (others wait for the GeoNames lookup).
    select x into v_first from jsonb_array_elements(new.locations) with ordinality as t(x, i)
    where jsonb_typeof(x -> 'lat') = 'number' and jsonb_typeof(x -> 'lng') = 'number' order by i limit 1;

    if v_place_id is not null and jsonb_array_length(new.locations) > 0
       and (select g.kind from public.place_gazetteer g where g.id = v_place_id) = 'country' then
      v_place_id := null;
    end if;

    if v_place_id is null and v_first is not null then
      new.latitude  := (v_first ->> 'lat')::numeric;
      new.longitude := (v_first ->> 'lng')::numeric;
      new.location_precision := coalesce(v_first ->> 'precision', 'exact');
      if coalesce(new.location_name, '') = '' then new.location_name := left(v_first ->> 'name', 200); end if;
      new.geocoding_confidence := 0.7;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'locations_list', 'place', v_first ->> 'name', 'resolved_at', now()));
    end if;

    -- Only the country is known: its pin (a listed place found later by GeoNames replaces it).
    if v_place_id is null and new.latitude is null
       and jsonb_typeof(new.ai_suggestions -> 'countries') = 'array' then
      for v_country in select jsonb_array_elements_text(new.ai_suggestions -> 'countries') loop
        v_place := public.lookup_place(v_country);
        if v_place.id is not null then v_place_id := v_place.id; v_matched := v_country; exit; end if;
      end loop;
    end if;

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

  if tg_op = 'INSERT' and new.status = 'draft' then
    select value into v_settings from public.app_settings where key = 'auto_publish';
    if coalesce((v_settings ->> 'enabled')::boolean, false) then
      for v_prefix in select jsonb_array_elements_text(coalesce(v_settings -> 'source_prefixes', '[]'::jsonb)) loop
        if coalesce(new.source_name, '') ilike v_prefix || '%' then v_imported := true; end if;
      end loop;
      if v_imported and new.latitude is not null and new.category_id is not null and btrim(new.title) <> ''
         and not exists (select 1 from public.event_categories c where c.id = new.category_id and c.slug = 'uncategorized') then
        new.status := 'published';
        new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object('auto_published', true);
      end if;
    end if;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_resolve_location"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.events_send_to_editor()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_secret text;
begin
  if auth.uid() is not null and new.status = 'published' and old.status is distinct from 'published'
     and coalesce(new.ai_suggestions ->> 'editor_model', '') = ''
     and coalesce(new.ai_suggestions ->> 'sent_to_editor', '') = ''
     and public.foreign_share(coalesce(new.title, '') || ' ' || coalesce(new.description, '')) > 0.4 then
    select value into v_secret from public.intel_config where key = 'cron_secret';
    if v_secret is null then return null; end if;
    perform net.http_post(
      url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('action', 'edit', 'id', new.id),
      timeout_milliseconds := 5000);
  end if;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."events_send_to_editor"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.expire_events()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_cfg   jsonb;
  v_hours integer;
  v_ttl   interval;
  v_n     integer;
begin
  select value into v_cfg from public.app_settings where key = 'event_lifetime';
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then return 0; end if;
  v_hours := greatest(1, coalesce((v_cfg ->> 'hours')::integer, 24));
  select make_interval(mins => greatest(1, coalesce((value ->> 'ttl_minutes')::integer, 10)))
    into v_ttl from public.app_settings where key = 'hfc_alerts';
  v_ttl := coalesce(v_ttl, interval '10 minutes');

  update public.events e
     set status = 'archived', expired_at = now()
    from (
      select e2.id
      from public.events e2
      left join public.event_categories c on c.id = e2.category_id
      where e2.status = 'published' and e2.deleted_at is null
        and case when c.slug = 'home-front-alerts' and coalesce(e2.ai_suggestions ->> 'hfc_auto', '') <> 'true'
                 then greatest(e2.occurred_at, coalesce(e2.published_at, e2.occurred_at)) + v_ttl
                 else e2.occurred_at + make_interval(hours => v_hours)
            end < now()
      order by e2.occurred_at
      limit 50
    ) x
   where e.id = x.id;
  get diagnostics v_n = row_count;

  update public.events e
     set ai_suggestions = e.ai_suggestions || '{"no_map": true}'::jsonb
   where e.ai_suggestions ->> 'hfc_auto' = 'true'
     and coalesce(e.ai_suggestions ->> 'no_map', '') <> 'true'
     and e.deleted_at is null
     and (e.ai_suggestions ->> 'hfc_last')::timestamptz + v_ttl < now();

  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."expire_events"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.expire_plans()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r record; n int := 0;
begin
  for r in select id, plan from public.profiles where plan <> 'free' and plan_expires_at is not null and plan_expires_at < now() loop
    perform public._plan_set(r.id, 'free', 'default', null, 'expired', jsonb_build_object('was', r.plan));
    n := n + 1;
  end loop;
  return n;
end $function$;

REVOKE ALL ON FUNCTION "public"."expire_plans"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.foreign_share (
  p text
)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case when he + other = 0 then 0 else round(other::numeric / (he + other), 3) end
  from (select length(regexp_replace(coalesce(p, ''), '[^א-ת]', '', 'g')) he,
               length(regexp_replace(coalesce(p, ''), '[^A-Za-z؀-ۿ]', '', 'g')) other) s;
$function$;

CREATE OR REPLACE FUNCTION public.gaza_strip()
  RETURNS extensions.geometry
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select extensions.st_geomfromtext('POLYGON((34.2166 31.3236,34.267 31.22,34.356 31.289,34.382 31.356,34.44 31.43,34.472 31.468,34.505 31.5,34.545 31.53,34.5664 31.5586,34.53 31.564,34.49 31.596,34.2166 31.3236))', 4326);
$function$;

CREATE OR REPLACE FUNCTION public.generate_invite_token()
  RETURNS text
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$function$;

REVOKE ALL ON FUNCTION "public"."generate_invite_token"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.geo_lookup (
  p_name    text,
  p_country text             DEFAULT NULL::text,
  p_lat     double precision DEFAULT NULL::double precision,
  p_lng     double precision DEFAULT NULL::double precision
)
  RETURNS public.geo_places
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_norm  text := public.normalize_place(p_name);
  v_cc    text := public.country_iso(p_country);
  v_pt    extensions.geography;
  v_try   text;
  v_row   public.geo_places;
begin
  if char_length(v_norm) < 2 then return null; end if;
  if p_lat is not null and p_lng is not null then
    v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  end if;
  foreach v_try in array array[
    v_norm,
    case when v_norm ~ '^[הבלמו][א-ת]{2}' then substr(v_norm, 2) end,
    case when v_norm ~ '^(al|el|an|ad|ar|as|at|az) ' then regexp_replace(v_norm, '^(al|el|an|ad|ar|as|at|az) ', '') end
  ] loop
    continue when v_try is null or v_try = '';
    -- Dynamic SQL: planned with the actual name each time, so the GIN index is always used.
    execute $q$
      with c as materialized (
        select g.* from public.geo_places g where g.names @> array[$1]
      )
      select c.* from c
      where coalesce(c.feature_code, '') not in ('PCL', 'PCLI', 'PCLD', 'PCLF', 'PCLS', 'TERR', 'CONT')
        and ($2::text is null or c.country_code = $2)
        and ($3::extensions.geography is null or extensions.st_dwithin(c.geom::extensions.geography, $3, 150000))
      order by
        case when $3::extensions.geography is null then 0 else extensions.st_distance(c.geom::extensions.geography, $3) end,
        case c.feature_class when 'P' then 1 when 'S' then 2 when 'A' then 3 else 4 end,
        c.population desc
      limit 1
    $q$ into v_row using v_try, v_cc, v_pt;
    if v_row.geonameid is not null then return v_row; end if;
  end loop;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."geo_lookup"(text, text, double precision, double precision) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.geo_nearest_place (
  p_lat double precision,
  p_lng double precision
)
  RETURNS TABLE (
    name         text,
    name_he      text,
    name_en      text,
    country_code text,
    km           double precision
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with pt as (select extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326) as g)
  select g.name, g.name_he, g.name_en, g.country_code,
         round((extensions.ST_Distance(g.geom::extensions.geography, pt.g::extensions.geography) / 1000)::numeric, 1)::double precision
  from public.geo_places g, pt
  where g.geom operator(extensions.&&) extensions.ST_Expand(pt.g, 0.2)
    and extensions.ST_DWithin(g.geom::extensions.geography, pt.g::extensions.geography, 15000)
  order by (g.feature_class is distinct from 'P'), g.geom operator(extensions.<->) pt.g
  limit 1;
$function$;

REVOKE ALL ON FUNCTION "public"."geo_nearest_place"(double precision, double precision) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.geoloc_claim (
  p_worker text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j public.geoloc_jobs%rowtype; e public.events%rowtype; v_media jsonb; v_video jsonb;
begin
  select * into j from public.geoloc_jobs
   where (status = 'queued' or (status = 'running' and claimed_at < now() - interval '45 minutes'))
     and attempts < 3
   order by (trigger = 'manual') desc, created_at
   limit 1 for update skip locked;
  if not found then return null; end if;
  update public.geoloc_jobs set status = 'running', worker = left(p_worker, 100), claimed_at = now(), attempts = attempts + 1
   where id = j.id;
  select * into e from public.events where id = j.event_id;
  select to_jsonb(m) - 'phash' - 'sha256' into v_media from public.event_media m where m.id = j.media_id;
  select to_jsonb(m) into v_video from public.event_media m
   where m.thumb_id = j.media_id and m.kind = 'video' and m.ready limit 1;
  return jsonb_build_object(
    'job_id', j.id, 'trigger', j.trigger, 'attempt', j.attempts + 1,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description,
                                'original_report_text', left(e.original_report_text, 3000),
                                'latitude', e.latitude, 'longitude', e.longitude, 'location_name', e.location_name,
                                'location_precision', e.location_precision,
                                'city', e.city, 'region', e.region, 'country', e.country,
                                'locations', e.locations, 'occurred_at', e.occurred_at),
    'media', v_media, 'video', v_video);
end $function$;

REVOKE ALL ON FUNCTION "public"."geoloc_claim"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.geoloc_enqueue_media()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.kind not in ('image', 'video_thumb') then return new; end if;
  if not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'geoloc_auto'), false) then
    return new;
  end if;
  if not exists (select 1 from public.events e where e.id = new.event_id and e.deleted_at is null
                   and e.latitude is not null
                   and coalesce(e.location_precision, '') in ('exact', 'city')) then
    return new;
  end if;
  insert into public.geoloc_jobs (event_id, media_id, trigger) values (new.event_id, new.id, 'auto')
  on conflict do nothing;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.geoloc_finish (
  p_id     uuid,
  p_status text,
  p_result jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_status not in ('done', 'needs_review', 'failed', 'skipped', 'queued') then
    raise exception 'bad status';
  end if;
  update public.geoloc_jobs set
    status = p_status,
    finished_at = case when p_status = 'queued' then null else now() end,
    error = left(p_result ->> 'error', 2000),
    target_lat = (p_result ->> 'target_lat')::double precision,
    target_lng = (p_result ->> 'target_lng')::double precision,
    target_label = left(p_result ->> 'target_label', 300),
    camera_lat = (p_result ->> 'camera_lat')::double precision,
    camera_lng = (p_result ->> 'camera_lng')::double precision,
    camera_heading = (p_result ->> 'camera_heading')::double precision,
    hfov = (p_result ->> 'hfov')::double precision,
    fit_rms_px = (p_result ->> 'fit_rms_px')::double precision,
    holdout_rms_px = (p_result ->> 'holdout_rms_px')::double precision,
    confidence = p_result ->> 'confidence',
    proof_target = p_result ->> 'proof_target',
    proof_full = p_result ->> 'proof_full',
    result = coalesce(p_result -> 'details', '{}'::jsonb)
  where id = p_id;
end $function$;

REVOKE ALL ON FUNCTION "public"."geoloc_finish"(uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.geoloc_for_event (
  p_event uuid
)
  RETURNS TABLE (
    id              uuid,
    status          text,
    confidence      text,
    target_lat      double precision,
    target_lng      double precision,
    target_label    text,
    camera_lat      double precision,
    camera_lng      double precision,
    camera_heading  double precision,
    hfov            double precision,
    fit_rms_px      double precision,
    holdout_rms_px  double precision,
    notes           jsonb,
    proof_target    text,
    proof_full      text,
    camera_released boolean,
    finished_at     timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with me as (select public.can_geolocate() as ok, public.has_permission('event.edit.any') as staff)
  select j.id, j.status, j.confidence, j.target_lat, j.target_lng, j.target_label,
         case when me.staff or j.camera_released then j.camera_lat end,
         case when me.staff or j.camera_released then j.camera_lng end,
         case when me.staff or j.camera_released then j.camera_heading end,
         j.hfov, j.fit_rms_px, j.holdout_rms_px, coalesce(j.result -> 'notes', '[]'::jsonb),
         j.proof_target,
         case when me.staff or j.camera_released then j.proof_full end,
         j.camera_released, j.finished_at
  from public.geoloc_jobs j, me
  where j.event_id = p_event and me.ok
    and (me.staff or (j.status = 'done' and j.confidence in ('high', 'medium')))
  order by j.finished_at desc nulls last, j.created_at desc;
$function$;

REVOKE ALL ON FUNCTION "public"."geoloc_for_event"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.geoloc_proof_allowed (
  p_name text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1 from public.geoloc_jobs j
     where (j.proof_target = p_name and public.can_geolocate()
            and (public.has_permission('event.edit.any') or (j.status = 'done' and j.confidence in ('high', 'medium'))))
        or (j.proof_full = p_name and (public.has_permission('event.edit.any')
            or (j.camera_released and public.can_geolocate()))));
$function$;

REVOKE ALL ON FUNCTION "public"."geoloc_proof_allowed"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.geoloc_review (
  p_id             uuid,
  p_release_camera boolean DEFAULT NULL::boolean,
  p_status         text    DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not public.has_permission('event.edit.any') then
    raise exception 'You do not have permission.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('done', 'needs_review', 'failed', 'skipped', 'queued') then
    raise exception 'Bad status.' using errcode = '22023';
  end if;
  update public.geoloc_jobs
     set camera_released = coalesce(p_release_camera, camera_released),
         released_by = case when p_release_camera then auth.uid() else released_by end,
         released_at = case when p_release_camera then now() else released_at end,
         status = coalesce(p_status, status),
         attempts = case when p_status = 'queued' then 0 else attempts end
   where id = p_id;
  if not found then raise exception 'Job not found.' using errcode = 'P0002'; end if;
end $function$;

REVOKE ALL ON FUNCTION "public"."geoloc_review"(uuid, boolean, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles set status = 'active' where id = new.id and status = 'pending';
  end if;
  if lower(new.email) is distinct from lower(old.email) then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."handle_auth_user_updated"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_inv public.administrator_invitations%rowtype;
begin
  select * into v_inv
  from public.administrator_invitations
  where lower(email) = lower(new.email) and status = 'pending' and expires_at > now()
  order by created_at desc
  limit 1
  for update;
  if not found then
    insert into public.profiles (id, full_name, email, role, status, plan)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), ''),
      lower(new.email),
      'viewer',
      case when new.email_confirmed_at is not null then 'active'::public.user_status else 'pending'::public.user_status end,
      'free'
    )
    on conflict (id) do nothing;
    return new;
  end if;
  insert into public.profiles (id, full_name, email, role, status, invited_by)
  values (
    new.id,
    coalesce(nullif(v_inv.full_name, ''), new.raw_user_meta_data ->> 'full_name', ''),
    lower(new.email),
    v_inv.intended_role,
    case when new.email_confirmed_at is not null then 'active'::public.user_status else 'pending'::public.user_status end,
    v_inv.invited_by
  );
  update public.administrator_invitations
     set status = 'accepted', accepted_at = now()
   where id = v_inv.id;
  perform public.write_audit('user.invitation_accepted', 'user', new.id,
    jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.intended_role, 'email', lower(new.email)));
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."handle_new_auth_user"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.has_hebrew (
  p text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$ select coalesce(p, '') ~ '[א-ת]'; $function$;

CREATE OR REPLACE FUNCTION public.has_permission (
  p_permission text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.status = 'active'
      and (
        p_permission = any (public.role_permissions(pr.role))
        or (p_permission = 'event.publish' and pr.can_publish and pr.role = 'analyst')
      )
  );
$function$;

REVOKE ALL ON FUNCTION "public"."has_permission"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.hfc_alert_to_event (
  p_alert bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  a public.hfc_alerts%rowtype;
  v_event uuid;
  v_cat uuid;
  v_area public.hfc_areas%rowtype;
begin
  select * into a from public.hfc_alerts where id = p_alert;
  if not found or a.is_drill or a.source like 'event:%' or a.event_id is not null then
    return a.event_id;
  end if;

  select e.id into v_event
  from public.events e
  where e.deleted_at is null
    and e.ai_suggestions ->> 'hfc_auto' = 'true'
    and (e.ai_suggestions ->> 'hfc_threat')::integer = a.threat
    and e.occurred_at > a.alerted_at - interval '1 day'
    and a.alerted_at between (e.ai_suggestions ->> 'hfc_first')::timestamptz - interval '5 minutes'
                         and (e.ai_suggestions ->> 'hfc_last')::timestamptz + interval '5 minutes'
  order by e.occurred_at desc
  limit 1;

  if v_event is null then
    select id into v_cat from public.event_categories where slug = 'home-front-alerts';
    select * into v_area from public.hfc_areas where name = a.area_name;
    insert into public.events (
      title, description, original_report_text, category_id, status, severity,
      location_name, location_name_he, location_name_en, country, location_precision,
      latitude, longitude,
      source_name, source_url, source_type, occurred_at, published_at, created_by,
      is_breaking, is_verified, ai_suggestions)
    values (
      'התרעת פיקוד העורף – ' || public.hfc_threat_label(a.threat, 'he') || ': ' || a.area_name,
      public.hfc_threat_label(a.threat, 'he') || ': ' || a.area_name,
      public.hfc_threat_label(a.threat, 'he') || ': ' || a.area_name,
      v_cat, 'published',
      (case when a.threat in (0, 2, 5, 6, 7) then 'high' else 'medium' end)::public.event_severity,
      a.area_name, a.area_name, v_area.name_en, 'Israel', 'city',
      v_area.latitude, v_area.longitude,
      'פיקוד העורף', 'https://www.oref.org.il/', 'emergency_service', a.alerted_at, a.alerted_at,
      'd8d87c3a-1739-4c8a-8617-9a3d157fdc68',
      true, true,
      jsonb_build_object('hfc_auto', true, 'hfc_threat', a.threat, 'hfc_first', a.alerted_at, 'hfc_last', a.alerted_at))
    returning id into v_event;
  end if;

  update public.hfc_alerts set event_id = v_event where id = p_alert;
  perform public.hfc_wave_refresh(v_event);
  return v_event;
end $function$;

REVOKE ALL ON FUNCTION "public"."hfc_alert_to_event"(bigint) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_alerts_to_event_trg()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not new.is_drill and new.source not like 'event:%' and new.event_id is null then
    begin
      perform public.hfc_alert_to_event(new.id);
    exception when others then
      raise warning 'hfc_alert_to_event(%): %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.hfc_guess_threat (
  p_text text
)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case
    when t ~* '(כטב["״'']?ם|כלי טיס|רחפן|drone|uav|hostile aircraft)' then 5
    when t ~* '(מחבלים|חדירת|infiltrat)'                               then 2
    when t ~* '(רעידת אדמה|earthquake)'                                then 3
    when t ~* '(צונאמי|tsunami)'                                       then 4
    when t ~* '(חומרים מסוכנים|חומ["״]ס|hazardous)'                    then 1
    when t ~* '(רדיולוג|radiolog)'                                     then 6
    when t ~* '(בלתי קונבנציונ|non.?conventional|unconventional)'      then 7
    else 0
  end
  from (select coalesce(p_text, '') as t) x;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_guess_threat"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_ingest_batch (
  p_mode  text,
  p_items jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_settings jsonb;
  v_n        integer := 0;
  r          record;
begin
  if p_mode not in ('live', 'history') then
    raise exception 'hfc_ingest_batch: bad mode %', p_mode;
  end if;
  select value into v_settings from public.app_settings where key = 'hfc_alerts';
  if not coalesce((v_settings ->> 'enabled')::boolean, false) then return 0; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then return 0; end if;

  -- Same lock key as the legacy hfc_ingest (it uses try-lock and skips while we hold this).
  perform set_config('lock_timeout', '10s', true);
  perform pg_advisory_xact_lock(hashtext('osintfront.hfc_ingest'));

  for r in
    select to_timestamp((a ->> 'time')::double precision) as t,
           coalesce(nullif(a ->> 'threat', '')::integer, 8) as threat,
           coalesce((a ->> 'isDrill')::boolean, false) as drill,
           city
    from jsonb_array_elements(p_items) a,
         jsonb_array_elements_text(case when jsonb_typeof(a -> 'cities') = 'array' then a -> 'cities' else '[]'::jsonb end) city
    where (a ->> 'time') ~ '^\d{9,11}(\.\d+)?$'
      and to_timestamp((a ->> 'time')::double precision) > now() - interval '30 minutes'
      and to_timestamp((a ->> 'time')::double precision) < now() + interval '5 minutes'
    order by 1, 4
  loop
    if public.hfc_record_alert(r.city, r.threat, r.t, r.drill, 'tzofar:' || p_mode, false) then
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n > 0 then
    update public.hfc_pulse set changed_at = now() where id = 1;
  end if;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_ingest_batch"(text, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_ingest_report (
  p_source text,
  p_ok     boolean,
  p_error  text    DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_source not in ('live', 'history') then return; end if;
  if p_ok then
    insert into public.hfc_ingest_status as s (source, last_ok_at) values (p_source, now())
    on conflict (source) do update set last_ok_at = excluded.last_ok_at;
  else
    insert into public.hfc_ingest_status as s (source, last_error, last_error_at)
    values (p_source, left(coalesce(p_error, 'unknown'), 300), now())
    on conflict (source) do update set last_error = excluded.last_error, last_error_at = excluded.last_error_at;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_ingest_report"(text, boolean, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_match_areas (
  p_location  text,
  p_city      text,
  p_lat       numeric,
  p_lng       numeric,
  p_precision text
)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_cands text[];
  v_c     text;
  v_n     text;
  v_try   text;
  v_hit   text[];
  v_found text[] := '{}';
  v_place public.place_gazetteer;
  v_pt    extensions.geometry;
begin
  v_cands := array[p_location, p_city]
    || coalesce((select array_agg(x) from regexp_split_to_table(coalesce(p_location, ''), '\s*[,،;|/]\s*') x), '{}');

  foreach v_c in array v_cands loop
    v_n := public.normalize_place(coalesce(v_c, ''));
    continue when char_length(v_n) < 2;
    foreach v_try in array array[v_n, case when v_n ~ '^[הבלמו][א-ת]{2}' then substr(v_n, 2) end] loop
      continue when v_try is null;
      select coalesce(array_agg(a.name), '{}') into v_hit from public.hfc_areas a where a.names_norm @> array[v_try];
      if cardinality(v_hit) = 0 then
        select coalesce(array_agg(a.name), '{}') into v_hit from public.hfc_areas a where a.base_norm @> array[v_try];
      end if;
      if cardinality(v_hit) = 0 then
        v_place := public.lookup_place(v_try);
        if v_place.id is not null then
          select coalesce(array_agg(a.name), '{}') into v_hit
          from public.hfc_areas a
          where a.names_norm && (v_place.names_norm || public.normalize_place(v_place.canonical));
        end if;
      end if;
      if cardinality(v_hit) > 0 then
        v_found := v_found || v_hit;
        exit;
      end if;
    end loop;
  end loop;

  if cardinality(v_found) = 0 and p_lat is not null and p_lng is not null
     and coalesce(p_precision, 'exact') in ('exact', 'city') then
    v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lng::float8, p_lat::float8), 4326);
    select coalesce(array_agg(n), '{}') into v_found from (
      select a.name as n
      from public.hfc_areas a
      where extensions.st_dwithin(a.geom::extensions.geography, v_pt::extensions.geography, 1000)
      order by extensions.st_distance(a.geom::extensions.geography, v_pt::extensions.geography)
      limit 1
    ) s;
  end if;

  return array(select distinct x from unnest(v_found) x order by 1);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_match_areas"(text, text, numeric, numeric, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_record_alert (
  p_area   text,
  p_threat integer,
  p_at     timestamp with time zone,
  p_drill  boolean,
  p_source text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return public.hfc_record_alert(p_area, p_threat, p_at, p_drill, p_source, true);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_record_alert (
  p_area   text,
  p_threat integer,
  p_at     timestamp with time zone,
  p_drill  boolean,
  p_source text,
  p_bump   boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_settings       jsonb;
  v_ttl            interval;
  v_merge_m        double precision;
  v_include_drills boolean;
  v_area           text := btrim(coalesce(p_area, ''));
  v_alert_id       bigint;
  v_geom           extensions.geometry;
  v_ids            uuid[];
  v_target         uuid;
begin
  if v_area = '' or p_at is null then return false; end if;

  select value into v_settings from public.app_settings where key = 'hfc_alerts';
  v_ttl := make_interval(mins => greatest(1, coalesce((v_settings ->> 'ttl_minutes')::integer, 10)));
  v_merge_m := greatest(0, coalesce((v_settings ->> 'merge_km')::numeric, 0)) * 1000;
  v_include_drills := coalesce((v_settings ->> 'include_drills')::boolean, false);

  insert into public.hfc_alerts (alerted_at, area_name, threat, is_drill, source)
  values (p_at, v_area, coalesce(p_threat, 8), coalesce(p_drill, false), p_source)
  on conflict (area_name, threat, alerted_at) do nothing
  returning id into v_alert_id;
  if v_alert_id is null then return false; end if;
  if coalesce(p_drill, false) and not v_include_drills then return true; end if;

  select geom into v_geom from public.hfc_areas where name = v_area;

  select array_agg(c.id order by c.started_at, c.id) into v_ids
  from public.hfc_clusters c
  where c.threat = coalesce(p_threat, 8)
    and c.merged_into is null
    and p_at between c.started_at - v_ttl and c.last_alert_at + v_ttl
    and (case when v_merge_m > 0
              then v_area = any (c.areas)
                   or (v_geom is not null and c.geom is not null
                       and extensions.st_dwithin(c.geom::extensions.geography, v_geom::extensions.geography, v_merge_m))
              else c.areas = array[v_area]
         end);

  if v_ids is null then
    insert into public.hfc_clusters (threat, started_at, last_alert_at, expires_at, areas, alert_count)
    values (coalesce(p_threat, 8), p_at, p_at, p_at + v_ttl, array[v_area], 1)
    returning id into v_target;
  else
    v_target := v_ids[1];
    if array_length(v_ids, 1) > 1 then
      update public.hfc_clusters t set
        areas         = (select array_agg(distinct x) from public.hfc_clusters c, unnest(c.areas) x where c.id = any (v_ids)),
        alert_count   = (select sum(c.alert_count) from public.hfc_clusters c where c.id = any (v_ids)),
        started_at    = (select min(c.started_at) from public.hfc_clusters c where c.id = any (v_ids)),
        last_alert_at = (select max(c.last_alert_at) from public.hfc_clusters c where c.id = any (v_ids))
      where t.id = v_target;
      update public.hfc_clusters set merged_into = v_target, updated_at = now() where id = any (v_ids[2:]);
      update public.hfc_alerts set cluster_id = v_target where cluster_id = any (v_ids[2:]);
    end if;
    update public.hfc_clusters set
      areas         = case when v_area = any (areas) then areas else areas || v_area end,
      alert_count   = alert_count + 1,
      started_at    = least(started_at, p_at),
      last_alert_at = greatest(last_alert_at, p_at)
    where id = v_target;
  end if;

  update public.hfc_clusters set expires_at = last_alert_at + v_ttl where id = v_target;
  update public.hfc_alerts set cluster_id = v_target where id = v_alert_id;
  perform public.hfc_refresh_cluster(v_target);
  if p_bump then
    update public.hfc_pulse set changed_at = now() where id = 1;
  end if;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text, boolean) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_refresh_cluster (
  p_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_areas    text[];
  v_geom     extensions.geometry;
  v_names_en text[];
  v_zones_he text[];
  v_zones_en text[];
  v_points   jsonb;
  v_pt       extensions.geometry;
begin
  select areas into v_areas from public.hfc_clusters where id = p_id;
  if v_areas is null then return; end if;

  select extensions.st_multi(extensions.st_collectionextract(
           extensions.st_union(extensions.st_buffer(a.geom, 0.0004)), 3))
    into v_geom
  from public.hfc_areas a
  where a.name = any (v_areas) and a.geom is not null;

  select array_agg(coalesce(a.name_en, u.n) order by u.o) into v_names_en
  from unnest(v_areas) with ordinality u(n, o)
  left join public.hfc_areas a on a.name = u.n;

  select coalesce(array_agg(z.zone_he order by z.first_o), '{}'), coalesce(array_agg(z.zone_en order by z.first_o), '{}')
    into v_zones_he, v_zones_en
  from (
    select a.zone_he, max(a.zone_en) as zone_en, min(u.o) as first_o
    from unnest(v_areas) with ordinality u(n, o)
    join public.hfc_areas a on a.name = u.n
    where a.zone_he is not null
    group by a.zone_he
  ) z;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', a.name,
           'name_en', a.name_en,
           'lat', round(coalesce(a.latitude, extensions.st_y(extensions.st_pointonsurface(a.geom)))::numeric, 5),
           'lng', round(coalesce(a.longitude, extensions.st_x(extensions.st_pointonsurface(a.geom)))::numeric, 5))
         order by u.o), '[]'::jsonb)
    into v_points
  from unnest(v_areas) with ordinality u(n, o)
  join public.hfc_areas a on a.name = u.n
  where a.latitude is not null or a.geom is not null;

  if v_geom is not null and not extensions.st_isempty(v_geom) then
    v_pt := extensions.st_pointonsurface(v_geom);
  else
    v_geom := null;
  end if;

  update public.hfc_clusters set
    geom        = v_geom,
    geojson     = case when v_geom is null then null
                       else extensions.st_asgeojson(extensions.st_simplifypreservetopology(v_geom, 0.0002), 5)::jsonb end,
    center_lat  = extensions.st_y(v_pt),
    center_lng  = extensions.st_x(v_pt),
    areas_en    = coalesce(v_names_en, '{}'),
    zones_he    = v_zones_he,
    zones_en    = v_zones_en,
    area_points = v_points,
    updated_at  = now()
  where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_refresh_cluster"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_ring_to_geom (
  p jsonb
)
  RETURNS extensions.geometry
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_wkt text;
  v_g   extensions.geometry;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) < 3
     or jsonb_typeof(p -> 0) is distinct from 'array' or jsonb_typeof(p -> 0 -> 0) is distinct from 'number' then
    return null;
  end if;
  select string_agg((pt ->> 1) || ' ' || (pt ->> 0), ',' order by ord) into v_wkt
  from jsonb_array_elements(p) with ordinality x(pt, ord);
  v_wkt := 'POLYGON((' || v_wkt || ',' || (p -> 0 ->> 1) || ' ' || (p -> 0 ->> 0) || '))';
  v_g := extensions.st_collectionextract(extensions.st_makevalid(extensions.st_geomfromtext(v_wkt, 4326)), 3);
  if v_g is null or extensions.st_isempty(v_g) then return null; end if;
  return extensions.st_multi(v_g);
exception when others then
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_ring_to_geom"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_split_cluster (
  p_id uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_c     public.hfc_clusters;
  v_ttl   interval;
  r       record;
  v_new   uuid;
  v_first uuid;
  v_n     integer := 0;
begin
  select * into v_c from public.hfc_clusters where id = p_id;
  if v_c.id is null or cardinality(v_c.areas) < 2 then return 0; end if;
  select make_interval(mins => greatest(1, coalesce((value ->> 'ttl_minutes')::integer, 10)))
    into v_ttl from public.app_settings where key = 'hfc_alerts';
  v_ttl := coalesce(v_ttl, interval '10 minutes');

  for r in
    select a.area_name, min(a.alerted_at) as first_at, max(a.alerted_at) as last_at, count(*) as n
    from public.hfc_alerts a where a.cluster_id = p_id
    group by a.area_name order by min(a.alerted_at)
  loop
    insert into public.hfc_clusters (threat, started_at, last_alert_at, expires_at, areas, alert_count)
    values (v_c.threat, r.first_at, r.last_at, r.last_at + v_ttl, array[r.area_name], r.n)
    returning id into v_new;
    update public.hfc_alerts set cluster_id = v_new where cluster_id = p_id and area_name = r.area_name;
    perform public.hfc_refresh_cluster(v_new);
    v_first := coalesce(v_first, v_new);
    v_n := v_n + 1;
  end loop;
  update public.hfc_clusters set merged_into = v_first, updated_at = now() where id = p_id;
  update public.hfc_pulse set changed_at = now() where id = 1;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_split_cluster"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_sync_areas()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_resp   extensions.http_response;
  v_cities jsonb;
  v_polys  jsonb;
  v_n      integer;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  select * into v_resp from extensions.http_get('https://www.tzevaadom.co.il/static/cities.json');
  if v_resp.status <> 200 then raise exception 'cities.json returned HTTP %', v_resp.status; end if;
  v_cities := v_resp.content::jsonb;
  select * into v_resp from extensions.http_get('https://www.tzevaadom.co.il/static/polygons.json');
  if v_resp.status <> 200 then raise exception 'polygons.json returned HTTP %', v_resp.status; end if;
  v_polys := v_resp.content::jsonb;

  with src as (
    select e.key as name, e.value as v,
           public.hfc_ring_to_geom(v_polys -> (e.value ->> 'id')) as poly
    from jsonb_each(v_cities -> 'cities') e
    where btrim(e.key) <> ''
  )
  insert into public.hfc_areas as a
    (name, name_en, name_ar, name_ru, tzofar_id, zone_id, zone_he, zone_en, countdown_s,
     latitude, longitude, has_polygon, geom, updated_at)
  select s.name, s.v ->> 'en', s.v ->> 'ar', s.v ->> 'ru',
         nullif(s.v ->> 'id', '')::integer, nullif(s.v ->> 'area', '')::integer,
         v_cities -> 'areas' -> (s.v ->> 'area') ->> 'he',
         v_cities -> 'areas' -> (s.v ->> 'area') ->> 'en',
         nullif(s.v ->> 'countdown', '')::integer,
         nullif(s.v ->> 'lat', '')::double precision, nullif(s.v ->> 'lng', '')::double precision,
         s.poly is not null,
         coalesce(s.poly,
           case when s.v ->> 'lat' is not null and s.v ->> 'lng' is not null then
             extensions.st_multi(extensions.st_buffer(
               extensions.st_setsrid(extensions.st_makepoint((s.v ->> 'lng')::float8, (s.v ->> 'lat')::float8), 4326)::extensions.geography,
               1500)::extensions.geometry)
           end),
         now()
  from src s
  on conflict (name) do update set
    name_en = excluded.name_en, name_ar = excluded.name_ar, name_ru = excluded.name_ru,
    tzofar_id = excluded.tzofar_id, zone_id = excluded.zone_id, zone_he = excluded.zone_he,
    zone_en = excluded.zone_en, countdown_s = excluded.countdown_s,
    latitude = excluded.latitude, longitude = excluded.longitude,
    has_polygon = excluded.has_polygon, geom = excluded.geom, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_sync_areas"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_threat_label (
  p_threat integer,
  p_lang   text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case when p_lang = 'en' then
    case p_threat when 0 then 'Rockets and missiles' when 1 then 'Hazardous materials' when 2 then 'Terrorist infiltration'
      when 3 then 'Earthquake' when 4 then 'Tsunami' when 5 then 'Hostile aircraft intrusion' when 6 then 'Radiological event'
      when 7 then 'Non-conventional weapons' else 'Alert' end
  else
    case p_threat when 0 then 'ירי רקטות וטילים' when 1 then 'חומרים מסוכנים' when 2 then 'חדירת מחבלים'
      when 3 then 'רעידת אדמה' when 4 then 'צונאמי' when 5 then 'חדירת כלי טיס עוין' when 6 then 'אירוע רדיולוגי'
      when 7 then 'נשק לא קונבנציונלי' else 'התרעה' end
  end
$function$;

REVOKE ALL ON FUNCTION "public"."hfc_threat_label"(integer, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.hfc_wave_events_no_areas()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if coalesce(new.ai_suggestions ->> 'hfc_auto', '') = 'true' then
    new.hfc_areas := '{}';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.hfc_wave_refresh (
  p_event uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_threat integer;
  v_first timestamptz;
  v_last timestamptz;
  v_he text[];
  v_en text[];
  v_locs jsonb;
  n integer;
  t_he text;
  t_en text;
  list_he text;
  list_en text;
  when_he text;
  when_en text;
  title_he text;
  title_en text;
  desc_he text;
  desc_en text;
begin
  select min(a.threat), min(a.alerted_at), max(a.alerted_at) into v_threat, v_first, v_last
  from public.hfc_alerts a where a.event_id = p_event;
  if v_first is null then return; end if;

  select array_agg(x.area_name order by x.at), array_agg(coalesce(nullif(x.name_en, ''), x.area_name) order by x.at),
         coalesce(jsonb_agg(jsonb_build_object(
           'name', x.area_name, 'name_en', coalesce(nullif(x.name_en, ''), x.area_name),
           'lat', round(x.lat::numeric, 5), 'lng', round(x.lng::numeric, 5),
           'precision', 'city', 'category_slug', 'home-front-alerts') order by x.at) filter (where x.lat is not null), '[]'::jsonb)
    into v_he, v_en, v_locs
  from (
    select a.area_name, min(a.alerted_at) at, max(h.name_en) name_en,
           max(coalesce(h.latitude, extensions.st_y(extensions.st_pointonsurface(h.geom)))) lat,
           max(coalesce(h.longitude, extensions.st_x(extensions.st_pointonsurface(h.geom)))) lng
    from public.hfc_alerts a left join public.hfc_areas h on h.name = a.area_name
    where a.event_id = p_event
    group by a.area_name
  ) x;

  n := cardinality(v_he);
  t_he := public.hfc_threat_label(v_threat, 'he');
  t_en := public.hfc_threat_label(v_threat, 'en');
  list_he := array_to_string(v_he[1:5], ', ') || case when n > 5 then format(' ועוד %s', n - 5) else '' end;
  list_en := array_to_string(v_en[1:5], ', ') || case when n > 5 then format(' and %s more', n - 5) else '' end;
  when_he := case when v_last - v_first < interval '1 minute'
    then 'ב-' || to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI')
    else format('בין %s ל-%s', to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI'), to_char(v_last at time zone 'Asia/Jerusalem', 'HH24:MI')) end;
  when_en := case when v_last - v_first < interval '1 minute'
    then 'at ' || to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI')
    else format('between %s and %s', to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI'), to_char(v_last at time zone 'Asia/Jerusalem', 'HH24:MI')) end;
  title_he := format('התרעת פיקוד העורף – %s: %s', t_he, list_he);
  title_en := format('Home Front Command alert – %s: %s', t_en, list_en);
  desc_he := format('%s %s (שעון ישראל) ב%s: %s.', t_he, when_he,
    case when n = 1 then 'אזור אחד' else format('-%s אזורים', n) end, array_to_string(v_he, ', '));
  desc_en := format('%s %s (Israel time) in %s: %s.', t_en, when_en,
    case when n = 1 then '1 area' else format('%s areas', n) end, array_to_string(v_en, ', '));

  update public.events e set
    title = title_he,
    description = desc_he,
    original_report_text = desc_he,
    hfc_areas = v_he,
    locations = v_locs,
    location_name_en = v_en[1],
    translations = jsonb_build_object(
      'he', jsonb_build_object('title', title_he, 'summary', desc_he),
      'en', jsonb_build_object('title', title_en, 'summary', desc_en, 'description', desc_en)),
    ai_suggestions = coalesce(e.ai_suggestions, '{}'::jsonb)
      || jsonb_build_object('hfc_auto', true, 'hfc_threat', v_threat, 'hfc_first', v_first, 'hfc_last', v_last)
  where e.id = p_event;
end $function$;

REVOKE ALL ON FUNCTION "public"."hfc_wave_refresh"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.import_staged_geonames (
  p_cc     text,
  p_chunks integer DEFAULT 4
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_rows integer; v_ids bigint[];
begin
  select array_agg(id) into v_ids
  from (select id from public.geo_staging where country = p_cc and kind = 'dump' order by id limit p_chunks) x;
  if v_ids is null then
    delete from public.geo_staging where country = p_cc;
    return 0;
  end if;
  with d as (
    select string_to_array(l, E'\t') f
    from public.geo_staging s, string_to_table(s.content, E'\n') l
    where s.id = any(v_ids) and l <> ''
  ), p as (
    select f[1]::bigint gid, f[2] nm, f[3] ascii, f[5]::float8 lat, f[6]::float8 lng, f[7] fc, f[8] fcode,
           f[11] admin1, coalesce(nullif(f[15], '')::bigint, 0) pop
    from d
    where coalesce(array_length(f, 1), 0) >= 19 and f[9] = p_cc
      and (f[7] in ('P', 'A', 'T', 'L') or f[8] in (
        'AIRB','AIRF','AIRH','AIRP','AIRQ','MILB','INSM','NVB','PRT','PS','PSH','PSN','PO',
        'DAM','BDG','CRSSNG','HSP','HSPC','CMP','CMPRF','CMPQ','TOWR','RSTN','OILR','OILT',
        'PRN','CSTL','FRT','MSQE','SHRN','UNIV','STDM','BRKS','ITTR','RESV',
        'WAD','STM','LK','RSV','BAY','GULF','STRT','SEA','CHN'))
  ), a as (
    select string_to_array(l, E'\t') f
    from public.geo_staging s, string_to_table(s.content, E'\n') l
    where s.country = p_cc and s.kind = 'alt' and split_part(l, E'\t', 3) in ('he', 'ar', 'en')
  ), an as (
    select f[2]::bigint gid, f[3] lang, btrim(f[4]) nm,
           case when f[5] = '1' then 0 when f[6] = '1' then 1 else 2 end rk
    from a
    where coalesce(f[7], '') <> '1' and coalesce(f[8], '') <> '1' and btrim(coalesce(f[4], '')) <> ''
      and f[2] ~ '^[0-9]+$'
  ), an2 as (
    select an.* from an join p using (gid)
  ), best as (
    select distinct on (gid, lang) gid, lang, nm from an2 order by gid, lang, rk, length(nm)
  ), allnames as (
    select gid, array_agg(nm) nms from an2 group by gid
  ), merged as (
    select p.gid,
           btrim(regexp_replace(p.nm, E'[֑-ׇ]', '', 'g')) nm,
           nullif(btrim(regexp_replace(he.nm, E'[֑-ׇ]', '', 'g')), '') he,
           nullif(btrim(ar.nm), '') ar,
           coalesce(nullif(btrim(en.nm), ''), p.nm) en,
           public.normalize_places(array[p.nm, p.ascii] || coalesce(x.nms, '{}')) names,
           p.fc, p.fcode, p.admin1, p.pop, p.lat, p.lng
    from p
    left join best he on he.gid = p.gid and he.lang = 'he'
    left join best ar on ar.gid = p.gid and ar.lang = 'ar'
    left join best en on en.gid = p.gid and en.lang = 'en'
    left join allnames x on x.gid = p.gid
  )
  insert into public.geo_places as g (geonameid, name, name_he, name_ar, name_en, names, country_code,
                                      feature_class, feature_code, admin1, population, geom)
  select gid, nm, he, ar, en, names, p_cc, nullif(fc, ''), nullif(fcode, ''), nullif(admin1, ''), pop,
         extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)
  from merged
  on conflict (geonameid) do update set
    name = excluded.name,
    name_he = coalesce(excluded.name_he, g.name_he),       -- keep a Hebrew name learned from the editor
    he_from_ai = g.he_from_ai and excluded.name_he is null,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    names = (select array_agg(distinct x) from unnest(excluded.names || g.names) x),
    country_code = excluded.country_code, feature_class = excluded.feature_class,
    feature_code = excluded.feature_code, admin1 = excluded.admin1,
    population = excluded.population, geom = excluded.geom;
  get diagnostics v_rows = row_count;
  delete from public.geo_staging where id = any(v_ids);
  return v_rows;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."import_staged_geonames"(text, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ingest_cached_decision (
  p_text text
)
  RETURNS TABLE (
    decision text,
    event_id uuid
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select l.decision, case when e.id is not null and e.deleted_at is null then l.event_id end
  from public.whatsapp_ingest_log l
  left join public.events e on e.id = l.event_id
  where md5(l.message_text) = md5(p_text) and l.message_text = p_text
    and l.sent_at > now() - interval '7 days'
    and l.decision not in ('pending')
  order by (e.id is not null and e.deleted_at is null) desc, l.sent_at desc
  limit 1
$function$;

REVOKE ALL ON FUNCTION "public"."ingest_cached_decision"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.insight_alerts_guard()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare t smallint := public.ofi_tier_of(new.user_id); n int;
begin
  if t < 2 then raise exception 'plan: alerts need the Pro plan'; end if;
  if new.webhook_url is not null and t < 3 then raise exception 'plan: webhooks need the Max plan'; end if;
  if tg_op = 'INSERT' and t < 3 then
    select count(*) into n from public.insight_alerts where user_id = new.user_id;
    if n >= 3 then raise exception 'plan: the Pro plan allows 3 alerts'; end if;
  end if;
  if not exists (select 1 from public.insight_events e where e.id = new.event_id and e.is_published and e.status <> 'draft') then
    raise exception 'unknown insight';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION "public"."insight_alerts_guard"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.insight_events_add_manual()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into public.insight_signals (event_id, key, source_type, name_he, name_en, weight, direction, normalization, config, enabled, stale_after_hours)
  values (new.id, 'manual_admin', 'manual', 'הערכה ידנית (מנהל)', 'Manual assessment (admin)', 2.0, 1, '{"method":"manual"}'::jsonb, '{}'::jsonb, true, 24)
  on conflict (event_id, key) do nothing;
  return new;
end $function$;

REVOKE ALL ON FUNCTION "public"."insight_events_add_manual"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.intel_crawler_tick()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_secret text;
begin
  if not coalesce((select (value->>'enabled')::boolean from public.app_settings where key = 'intel_crawler'), false) then
    return;
  end if;
  select value into v_secret from public.intel_config where key = 'cron_secret';
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/intel-crawler',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000);
end $function$;

REVOKE ALL ON FUNCTION "public"."intel_crawler_tick"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.invitations_after_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('user.invited', 'invitation', new.id,
      jsonb_build_object('email', new.email, 'role', new.intended_role));
  elsif new.status <> old.status and new.status = 'revoked' then
    perform public.write_audit('user.invitation_revoked', 'invitation', new.id,
      jsonb_build_object('email', new.email, 'role', new.intended_role));
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."invitations_after_change"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.invitations_before_insert()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  new.email := lower(btrim(new.email));
  if v_actor is not null then
    if not public.has_permission('user.invite') then
      raise exception 'You do not have permission to invite users.' using errcode = '42501';
    end if;
    if new.intended_role = 'super_admin' and not public.has_permission('role.manage') then
      raise exception 'Only a super admin can invite another super admin.' using errcode = '42501';
    end if;
    if new.intended_role = 'admin' and not public.has_permission('user.manage.admins') then
      raise exception 'Only a super admin can invite administrators.' using errcode = '42501';
    end if;
    new.invited_by  := v_actor;
    new.status      := 'pending';
    new.created_at  := now();
    new.accepted_at := null;
    new.expires_at  := least(coalesce(new.expires_at, now() + interval '7 days'), now() + interval '14 days');
  end if;
  new.token := public.generate_invite_token();
  if exists (select 1 from public.profiles where lower(email) = new.email) then
    raise exception 'A user with the email % is already registered.', new.email using errcode = '23505';
  end if;
  update public.administrator_invitations
     set status = 'expired'
   where lower(email) = new.email and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.administrator_invitations where lower(email) = new.email and status = 'pending') then
    raise exception 'A pending invitation already exists for %.', new.email using errcode = '23505';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."invitations_before_insert"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.invitations_before_update()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return new;
  end if;
  if new.email <> old.email or new.intended_role <> old.intended_role or new.invited_by is distinct from old.invited_by
     or new.token <> old.token or new.created_at <> old.created_at or new.full_name <> old.full_name then
    raise exception 'Invitation details cannot be edited. Revoke it and send a new one.' using errcode = '42501';
  end if;
  if new.status <> old.status and not (old.status = 'pending' and new.status = 'revoked') then
    raise exception 'Only pending invitations can be revoked.' using errcode = '22023';
  end if;
  if old.intended_role in ('super_admin', 'admin') and not public.has_permission('user.manage.admins') then
    raise exception 'Only a super admin can manage administrator invitations.' using errcode = '42501';
  end if;
  new.accepted_at := old.accepted_at;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."invitations_before_update"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.is_member()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(auth.role() = 'service_role', false)
      or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.status = 'active');
$function$;

CREATE OR REPLACE FUNCTION public.is_specific_place (
  p_name text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select public.normalize_place(p_name) <> ''
     and coalesce((public.lookup_place(p_name)).kind, 'city') = 'city';
$function$;

REVOKE ALL ON FUNCTION "public"."is_specific_place"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_super_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin' and p.status = 'active');
$function$;

REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_valid_event_transition (
  p_from public.event_status,
  p_to   public.event_status
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select p_from = p_to or (p_from, p_to) in (
    ('draft'::public.event_status, 'pending_review'::public.event_status),
    ('draft', 'published'),
    ('draft', 'archived'),
    ('pending_review', 'draft'),
    ('pending_review', 'published'),
    ('pending_review', 'rejected'),
    ('pending_review', 'archived'),
    ('rejected', 'draft'),
    ('rejected', 'pending_review'),
    ('rejected', 'archived'),
    ('published', 'archived'),
    ('archived', 'draft'),
    ('archived', 'published')
  );
$function$;

CREATE OR REPLACE FUNCTION public.learn_places (
  p_rows    jsonb,
  p_country text  DEFAULT 'LB'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  r        record;
  v_pt     extensions.geography;
  v_geom   extensions.geometry;
  v_id     bigint;
  v_names  text[];
  v_new    integer := 0;
  v_known  integer := 0;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(name_ar text, name_en text, name_he text, lat float8, lng float8, source text) loop
    continue when r.lat is null or r.lng is null;
    v_geom := extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326);
    v_pt := v_geom::extensions.geography;
    v_names := array(select distinct n from unnest(array[
      public.normalize_place(r.name_ar), public.normalize_place(r.name_en), public.normalize_place(r.name_he),
      public.normalize_place(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''))]) n where coalesce(n, '') <> '' and char_length(n) >= 2);
    continue when cardinality(v_names) = 0;
    -- The place itself: a GeoNames place with one of these names within 3 km, else the nearest
    -- town / village within 1.5 km.
    select g.geonameid into v_id from public.geo_places g
    where g.geom operator(extensions.&&) extensions.st_expand(v_geom, 0.03)
      and g.country_code = p_country and g.names && v_names
      and extensions.st_dwithin(g.geom::extensions.geography, v_pt, 3000)
    order by extensions.st_distance(g.geom::extensions.geography, v_pt) limit 1;
    if v_id is null then
      select g.geonameid into v_id from public.geo_places g
      where g.geom operator(extensions.&&) extensions.st_expand(v_geom, 0.015)
        and g.country_code = p_country and g.feature_class = 'P'
        and extensions.st_dwithin(g.geom::extensions.geography, v_pt, 1500)
      order by extensions.st_distance(g.geom::extensions.geography, v_pt) limit 1;
    end if;
    if v_id is not null then
      update public.geo_places g set
        names = (select array_agg(distinct n) from unnest(g.names || v_names) n),
        name_he = coalesce(g.name_he, nullif(r.name_he, '')),
        he_from_ai = case when g.name_he is null and coalesce(r.name_he, '') <> '' then false else g.he_from_ai end,
        name_ar = coalesce(g.name_ar, nullif(r.name_ar, '')),
        name_en = coalesce(g.name_en, nullif(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''), ''))
      where g.geonameid = v_id;
      v_known := v_known + 1;
    else
      insert into public.geo_places (geonameid, name, name_he, name_ar, name_en, names, country_code, feature_class, feature_code, population, geom)
      values ((select least(-1, coalesce(min(geonameid), 0)) - 1 from public.geo_places),
              coalesce(nullif(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''), ''), r.name_ar, r.name_he),
              nullif(r.name_he, ''), nullif(r.name_ar, ''), nullif(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''), ''),
              v_names, p_country, 'P', 'PPL', 0, v_geom);
      v_new := v_new + 1;
    end if;
  end loop;
  return jsonb_build_object('matched', v_known, 'added', v_new);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."learn_places"(jsonb, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.learn_places_queue (
  p_limit integer DEFAULT 1000
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_rows jsonb; v_keys text[]; v_out jsonb;
begin
  select jsonb_agg(row), array_agg(key) into v_rows, v_keys
  from (select key, row from public.place_learn_queue where done_at is null order by added_at limit p_limit) q;
  if v_rows is null then return jsonb_build_object('matched', 0, 'added', 0, 'left', 0); end if;
  v_out := public.learn_places(v_rows, 'LB');
  update public.place_learn_queue set done_at = now() where key = any (v_keys);
  return v_out || jsonb_build_object('left', (select count(*) from public.place_learn_queue where done_at is null));
end;
$function$;

REVOKE ALL ON FUNCTION "public"."learn_places_queue"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.learn_term (
  p_term  text,
  p_he    text,
  p_en    text,
  p_avoid text[],
  p_event uuid   DEFAULT NULL::uuid
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_id bigint;
  c_term text := nullif(btrim(p_term), '');
  c_he text := nullif(btrim(p_he), '');
  c_en text := nullif(btrim(p_en), '');
  c_avoid text[] := array(select distinct btrim(a) from unnest(coalesce(p_avoid, '{}')) a
                          where length(btrim(a)) between 2 and 120 and btrim(a) is distinct from c_he and btrim(a) is distinct from c_en);
begin
  if auth.uid() is null or not (public.has_permission('settings.manage') or public.has_permission('event.edit.any')
       or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to teach terms.' using errcode = '42501';
  end if;
  if c_term is null or length(c_term) > 120 then raise exception 'Term required.' using errcode = '22023'; end if;
  if c_he is null and c_en is null then raise exception 'Hebrew or English required.' using errcode = '22023'; end if;
  select id into v_id from public.learned_terms where lower(btrim(term)) = lower(c_term);
  if v_id is null then
    insert into public.learned_terms (term, he, en, avoid, learned_from, created_by)
    values (c_term, c_he, c_en, c_avoid, p_event, auth.uid()) returning id into v_id;
  else
    update public.learned_terms
       set he = coalesce(c_he, he), en = coalesce(c_en, en),
           avoid = array(select distinct x from unnest(avoid || c_avoid) x where x is distinct from coalesce(c_he, he) and x is distinct from coalesce(c_en, en))
     where id = v_id;
  end if;
  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."learn_term"(text, text, text, text[], uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.learned_place (
  p_name    text,
  p_name_en text DEFAULT NULL::text
)
  RETURNS public.learned_places
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_try text;
  v_row public.learned_places;
begin
  foreach v_try in array array[
    public.normalize_place(p_name),
    case when public.normalize_place(p_name) ~ '^[הבלמו][א-ת]{2}' then substr(public.normalize_place(p_name), 2) end,
    public.normalize_place(p_name_en)
  ] loop
    continue when v_try is null or v_try = '';
    select * into v_row from public.learned_places where name_norm = v_try;
    if found then return v_row; end if;
  end loop;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."learned_place"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.lebanon_missing_hebrew (
  p_kind  text,
  p_limit integer DEFAULT 120,
  p_part  integer DEFAULT 0,
  p_parts integer DEFAULT 1
)
  RETURNS TABLE (
    geonameid bigint,
    name_ar   text,
    name      text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select g.geonameid, g.name_ar, g.name from public.geo_places g
  where g.country_code = 'LB' and g.name_he is null
    and case p_kind when 'village' then g.feature_class = 'P'
                    when 'wadi' then g.feature_code in ('WAD', 'STM', 'VAL')
                    else false end
    and g.geonameid % greatest(p_parts, 1) = p_part
  order by (extensions.st_y(g.geom) < 33.62) desc, g.population desc, g.geonameid
  limit p_limit
$function$;

REVOKE ALL ON FUNCTION "public"."lebanon_missing_hebrew"(text, integer, integer, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.load_geo_places (
  p_ref text DEFAULT 'main'::text
)
  RETURNS TABLE (
    file   text,
    loaded integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_base     text := 'https://raw.githubusercontent.com/osintfront/main/' || p_ref || '/data/geonames/';
  v_status   integer;
  v_manifest jsonb;
  v_file     jsonb;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  select status, content::jsonb into v_status, v_manifest from extensions.http_get(v_base || 'manifest.json');
  if v_status <> 200 then raise exception 'manifest: HTTP %', v_status; end if;
  for v_file in select value from jsonb_array_elements(v_manifest -> 'files') loop
    file := v_file ->> 'file';
    loaded := public.load_geo_places_file(v_base || file);
    return next;
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."load_geo_places"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.load_geo_places_file (
  p_url text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_status  integer;
  v_content text;
  v_rows    integer;
begin
  if p_url !~ '^https://raw\.githubusercontent\.com/osintfront/main/' then
    raise exception 'only files from the osintfront/main repository can be loaded';
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '120');
  select status, content into v_status, v_content from extensions.http_get(p_url);
  if v_status <> 200 then raise exception 'HTTP % for %', v_status, p_url; end if;

  insert into public.geo_places as g (geonameid, name, name_he, name_ar, name_en, names, country_code,
                                      feature_class, feature_code, admin1, population, geom)
  select f[1]::bigint, f[2], nullif(f[3], ''), nullif(f[4], ''), nullif(f[5], ''),
         array_remove(string_to_array(f[6], '|'), ''), f[7], nullif(f[8], ''), nullif(f[9], ''), nullif(f[10], ''),
         coalesce(nullif(f[11], '')::bigint, 0),
         extensions.st_setsrid(extensions.st_makepoint(f[13]::float8, f[12]::float8), 4326)
  from (select string_to_array(l, E'\t') f from regexp_split_to_table(v_content, E'\n') l where l <> '') s
  where coalesce(array_length(f, 1), 0) >= 13
  on conflict (geonameid) do update set
    name = excluded.name,
    name_he = coalesce(excluded.name_he, g.name_he),
    he_from_ai = g.he_from_ai and excluded.name_he is null,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    names = (select array_agg(distinct x) from unnest(excluded.names || g.names) x),
    country_code = excluded.country_code, feature_class = excluded.feature_class,
    feature_code = excluded.feature_code, admin1 = excluded.admin1,
    population = excluded.population, geom = excluded.geom;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."load_geo_places_file"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.load_geo_places_tsv (
  p_content text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_rows integer;
begin
  insert into public.geo_places as g (geonameid, name, name_he, name_ar, name_en, names, country_code,
                                      feature_class, feature_code, admin1, population, geom)
  select f[1]::bigint, f[2], nullif(f[3], ''), nullif(f[4], ''), nullif(f[5], ''),
         array_remove(string_to_array(f[6], '|'), ''), f[7], nullif(f[8], ''), nullif(f[9], ''), nullif(f[10], ''),
         coalesce(nullif(f[11], '')::bigint, 0),
         extensions.st_setsrid(extensions.st_makepoint(f[13]::float8, f[12]::float8), 4326)
  from (select string_to_array(l, E'\t') f from regexp_split_to_table(p_content, E'\n') l where l <> '') s
  where coalesce(array_length(f, 1), 0) >= 13
  on conflict (geonameid) do update set
    name = excluded.name,
    name_he = coalesce(excluded.name_he, g.name_he),
    he_from_ai = g.he_from_ai and excluded.name_he is null,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    names = (select array_agg(distinct x) from unnest(excluded.names || g.names) x),
    country_code = excluded.country_code, feature_class = excluded.feature_class,
    feature_code = excluded.feature_code, admin1 = excluded.admin1,
    population = excluded.population, geom = excluded.geom;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."load_geo_places_tsv"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.lookup_place (
  p_name text
)
  RETURNS public.place_gazetteer
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_norm text := public.normalize_place(p_name);
  v_try  text;
  v_row  public.place_gazetteer;
begin
  if v_norm = '' then return null; end if;
  foreach v_try in array array[v_norm, case when v_norm ~ '^[הבלמו][א-ת]{2}' then substr(v_norm, 2) end] loop
    continue when v_try is null;
    select * into v_row from public.place_gazetteer g
    where g.names_norm @> array[v_try]
    order by case g.kind when 'city' then 1 when 'region' then 2 else 3 end
    limit 1;
    if found then return v_row; end if;
  end loop;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mainstream_outlet (
  p_name text,
  p_url  text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case
    when x ~ '(reuters)' then 'reuters'
    when x ~ '(apnews|associated press|\map\M)' then 'ap'
    when x ~ '(afp\.com|\mafp\M|france24|france 24)' then 'afp'
    when x ~ '(bbc)' then 'bbc'
    when x ~ '(cnn)' then 'cnn'
    when x ~ '(aljazeera|al jazeera|al-jazeera|الجزيرة)' then 'aljazeera'
    when x ~ '(alarabiya|al arabiya|al-arabiya|العربية)' then 'alarabiya'
    when x ~ '(alhadath|al hadath|الحدث)' then 'alhadath'
    when x ~ '(skynews|sky news|سكاي نيوز)' then 'skynews'
    when x ~ '(bloomberg)' then 'bloomberg'
    when x ~ '(wsj\.com|wall street journal)' then 'wsj'
    when x ~ '(nytimes|new york times)' then 'nyt'
    when x ~ '(washingtonpost|washington post)' then 'wapo'
    when x ~ '(theguardian|the guardian)' then 'guardian'
    when x ~ '(telegraph)' then 'telegraph'
    when x ~ '(axios)' then 'axios'
    when x ~ '(dw\.com|deutsche welle)' then 'dw'
    when x ~ '(aawsat|asharq al-awsat|الشرق الأوسط)' then 'aawsat'
    when x ~ '(ynet|ידיעות)' then 'ynet'
    when x ~ '(haaretz|הארץ)' then 'haaretz'
    when x ~ '(timesofisrael|times of israel)' then 'toi'
    when x ~ '(jpost|jerusalem post)' then 'jpost'
    when x ~ '(kan\.org\.il|כאן חדשות|\mכאן 11)' then 'kan'
    when x ~ '(mako\.co\.il|n12|חדשות 12|ערוץ 12)' then 'n12'
    when x ~ '(13tv|reshet|חדשות 13|ערוץ 13)' then 'c13'
    when x ~ '(i24)' then 'i24'
    when x ~ '(walla|וואלה)' then 'walla'
    when x ~ '(maariv|מעריב)' then 'maariv'
    when x ~ '(israelhayom|ישראל היום)' then 'israelhayom'
  end
  from (select lower(coalesce(p_name, '') || ' ' || coalesce(p_url, '')) as x) s;
$function$;

CREATE OR REPLACE FUNCTION public.media_storage_usage()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint from storage.objects o where o.bucket_id = 'event-media';
$function$;

REVOKE ALL ON FUNCTION "public"."media_storage_usage"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.move_event_pin (
  p_id            uuid,
  p_lat           double precision,
  p_lng           double precision,
  p_location_name text             DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_old record; v_locs jsonb;
begin
  if auth.uid() is null or not (public.has_permission('event.edit.any') or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to move events.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad coordinates.' using errcode = '22023';
  end if;
  select latitude, longitude, locations into v_old from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  v_locs := v_old.locations;
  if jsonb_typeof(v_locs) = 'array' and v_old.latitude is not null then
    select coalesce(jsonb_agg(case
             when jsonb_typeof(x -> 'lat') in ('number', 'string') and jsonb_typeof(x -> 'lng') in ('number', 'string')
                  and abs((x ->> 'lat')::float8 - v_old.latitude) < 0.003 and abs((x ->> 'lng')::float8 - v_old.longitude) < 0.003
             then x || jsonb_build_object('lat', p_lat, 'lng', p_lng, 'precision', 'exact', 'manual', true)
             else x end order by o), '[]'::jsonb)
      into v_locs
      from jsonb_array_elements(v_old.locations) with ordinality as e(x, o);
  end if;
  update public.events
     set latitude = p_lat, longitude = p_lng, location_precision = 'exact', geocoding_confidence = 1,
         location_name = coalesce(nullif(btrim(p_location_name), ''), location_name),
         locations = v_locs
   where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."move_event_pin"(uuid, double precision, double precision, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.move_event_place (
  p_id    uuid,
  p_index integer,
  p_lat   double precision,
  p_lng   double precision
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_locs jsonb; v_item jsonb; v_key text; v_country text; v_name text;
begin
  if auth.uid() is null or not (public.has_permission('event.edit.any') or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to move events.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad coordinates.' using errcode = '22023';
  end if;
  select locations, country into v_locs, v_country from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if jsonb_typeof(v_locs) <> 'array' or p_index < 0 or p_index >= jsonb_array_length(v_locs) then
    raise exception 'Place not found.' using errcode = 'P0002';
  end if;
  v_item := (v_locs -> p_index) || jsonb_build_object('lat', p_lat, 'lng', p_lng, 'precision', 'exact', 'manual', true);
  update public.events set locations = jsonb_set(v_locs, array[p_index::text], v_item) where id = p_id;

  v_name := coalesce(nullif(v_item ->> 'name', ''), v_item ->> 'name_en');
  foreach v_key in array array[v_item ->> 'name', v_item ->> 'name_en'] loop
    continue when v_key is null or btrim(v_key) = '' or not public.is_specific_place(v_key);
    insert into public.learned_places as lp (name_norm, name, location_name, country, latitude, longitude, learned_from, learned_by)
    values (public.normalize_place(v_key), left(v_key, 200), left(coalesce(v_name, ''), 200), left(coalesce(v_country, ''), 100),
            p_lat, p_lng, p_id, auth.uid())
    on conflict (name_norm) do update
      set latitude = excluded.latitude, longitude = excluded.longitude, location_name = excluded.location_name,
          country = excluded.country, times_corrected = lp.times_corrected + 1, learned_from = excluded.learned_from,
          learned_by = excluded.learned_by, updated_at = now();
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."move_event_place"(uuid, integer, double precision, double precision) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.my_ai_quota()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$ select public.ai_quota(auth.uid()) - 'spent_today_usd' - 'budget_usd' $function$;

CREATE OR REPLACE FUNCTION public.my_archive_days()
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select case
    when not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_plans'), false) then null
    when pr.id is null then 0
    when pr.role <> 'viewer' then null
    else (select f.limit_value from public.plan_features f
           where f.feature_key = 'archive_days'
             and f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now()
                                  then 'free' else pr.plan end)
  end
  from (select 1) one left join public.profiles pr on pr.id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.my_feature_usage()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(jsonb_object_agg(f.feature_key, jsonb_build_object('used', coalesce(u.count, 0), 'limit', f.limit_value)), '{}'::jsonb)
  from public.profiles pr
  join public.plan_features f
    on f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now() then 'free' else pr.plan end
   and f.feature_key in ('expand_daily', 'satellite')
  left join public.feature_usage u
    on u.user_id = pr.id and u.feature_key = f.feature_key and u.day = (now() at time zone 'Asia/Jerusalem')::date
  where pr.id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION "public"."my_feature_usage"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.my_permissions()
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce((
    select public.role_permissions(pr.role)
           || case when pr.can_publish and pr.role = 'analyst' then array['event.publish'] else array[]::text[] end
    from public.profiles pr
    where pr.id = auth.uid() and pr.status = 'active'
  ), array[]::text[]);
$function$;

REVOKE ALL ON FUNCTION "public"."my_permissions"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.normalize_place (
  p text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO ''
  AS $function$
  select btrim(regexp_replace(
    regexp_replace(lower(coalesce(p, '')), '[֑-ׇ]', '', 'g'),
    '[^a-z0-9א-ת؀-ۿ]+', ' ', 'g'));
$function$;

CREATE OR REPLACE FUNCTION public.normalize_places (
  p text[]
)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO ''
  AS $function$
  select coalesce(array_agg(distinct public.normalize_place(x)) filter (where public.normalize_place(x) <> ''), '{}')
  from unnest(p) x;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_report_text (
  p text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO ''
  AS $function$
  select btrim(
           regexp_replace(
             regexp_replace(coalesce(p, ''), '[ \t\r ​‎‏‪-‮⁦-⁩]+(\n|$)', '\1', 'g'),
             '\n{3,}', E'\n\n', 'g'),
           E' \n\t');
$function$;

CREATE OR REPLACE FUNCTION public.notify_signup()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_secret text;
  v_total int;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  select value into v_secret from public.intel_config where key = 'notify_secret';
  select count(*) into v_total from public.profiles;
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/notify-signup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object(
      'full_name', new.full_name, 'email', new.email, 'role', new.role,
      'plan', new.plan, 'created_at', new.created_at, 'total_users', v_total),
    timeout_milliseconds := 5000);
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."notify_signup"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ofi_admin_manual (
  p_slug  text,
  p_level integer,
  p_note  text,
  p_hours integer DEFAULT 24
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare sid uuid; score numeric;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_level is null or p_level < -100 or p_level > 100 then raise exception 'level must be between -100 and 100'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'hours must be between 1 and 720'; end if;
  select s.id into sid from public.insight_signals s join public.insight_events e on e.id = s.event_id
  where e.slug = p_slug and s.key = 'manual_admin';
  if sid is null then raise exception 'unknown event'; end if;
  score := 0.5 + p_level::numeric / 200;
  insert into public.insight_signal_readings (signal_id, raw_value, normalized_score, metadata)
  values (sid, p_level, score, jsonb_build_object('note', left(coalesce(p_note, ''), 500), 'by', auth.uid(), 'hours', p_hours));
  update public.insight_signals set last_updated = now(), last_error = null, stale_after_hours = p_hours, enabled = true where id = sid;
  return jsonb_build_object('ok', true, 'score', score, 'until', now() + make_interval(hours => p_hours));
end $function$;

REVOKE ALL ON FUNCTION "public"."ofi_admin_manual"(text, integer, text, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.ofi_admin_resolve (
  p_slug    text,
  p_start   timestamp with time zone,
  p_outcome boolean,
  p_notes   text                     DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare e public.insight_events%rowtype; fid bigint;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  select * into e from public.insight_events where slug = p_slug;
  if not found then raise exception 'unknown event'; end if;
  select id into fid from public.insight_forecasts where event_id = e.id and ts <= p_start order by ts desc limit 1;
  insert into public.insight_resolutions (event_id, window_start, window_end, outcome, forecast_id, notes, resolved_by)
  values (e.id, p_start, p_start + make_interval(hours => e.horizon_hours), p_outcome, fid, left(p_notes, 500), auth.uid())
  on conflict (event_id, window_start) do update set outcome = excluded.outcome, forecast_id = excluded.forecast_id, notes = excluded.notes;
  return jsonb_build_object('ok', true, 'forecast_id', fid);
end $function$;

REVOKE ALL ON FUNCTION "public"."ofi_admin_resolve"(text, timestamp WITH time zone, boolean, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.ofi_detail (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  t smallint := public.ofi_tier();
  e public.insight_events%rowtype;
  f public.insight_forecasts%rowtype;
  prev numeric;
  sees boolean;
  pro boolean;
  contribs jsonb;
begin
  if t = 0 then return null; end if;
  select * into e from public.insight_events where slug = p_slug;
  if not found or ((not e.is_published or e.status = 'draft') and not public.is_super_admin()) then
    return null;
  end if;
  sees := t >= e.min_tier;
  pro := t >= greatest(e.min_tier, 2);
  select * into f from public.insight_forecasts where event_id = e.id order by ts desc limit 1;
  select x.probability into prev from public.insight_forecasts x where x.event_id = e.id order by x.ts desc offset 1 limit 1;
  contribs := coalesce(f.contributions, '[]'::jsonb);

  return jsonb_build_object(
    'slug', e.slug,
    'title_he', e.title_he, 'title_en', e.title_en,
    'description_he', e.description_he, 'description_en', e.description_en,
    'resolution_criteria_he', e.resolution_criteria_he, 'resolution_criteria_en', e.resolution_criteria_en,
    'horizon_hours', e.horizon_hours,
    'status', e.status,
    'tier', t,
    'min_tier', e.min_tier,
    'locked', not sees,
    'last_update', f.ts,
    'next_update', case when e.status = 'active' then e.next_run_at end,
    'model_version', case when sees then f.model_version end,
    'probability', case when sees then f.probability end,
    'previous_probability', case when sees then prev end,
    'confidence_low', case when pro then f.confidence_low end,
    'confidence_high', case when pro then f.confidence_high end,
    'base_rate', case when sees then e.base_rate end,
    'summary_he', case when pro then f.summary_he end,
    'summary_en', case when pro then f.summary_en end,
    'signal_count', jsonb_array_length(contribs),
    'contributions', case
      when pro then contribs
      when sees then coalesce((select jsonb_build_array(c) from jsonb_array_elements(contribs) c
                               order by abs(coalesce((c->>'pp')::numeric, 0)) desc limit 1), '[]'::jsonb)
      else '[]'::jsonb end,
    'signals', case when pro then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', s.key, 'source_type', s.source_type, 'name_he', s.name_he, 'name_en', s.name_en,
        'weight', s.weight, 'direction', s.direction, 'is_circuit_breaker', s.is_circuit_breaker,
        'last_updated', s.last_updated,
        'stale', s.last_updated is null or s.last_updated < now() - make_interval(hours => s.stale_after_hours),
        'readings', (select coalesce(jsonb_agg(jsonb_build_array(r.ts, r.normalized_score) order by r.ts), '[]'::jsonb)
                     from public.insight_signal_readings r
                     where r.signal_id = s.id and r.ts > now() - interval '30 days')
      ) order by s.weight desc, s.key), '[]'::jsonb)
      from public.insight_signals s where s.event_id = e.id and s.enabled) end,
    'history', case when pro then (
      select coalesce(jsonb_agg(jsonb_build_object('ts', h.ts, 'p', h.probability, 'trigger', h.trigger) order by h.ts), '[]'::jsonb)
      from public.insight_forecasts h
      where h.event_id = e.id and (t >= 3 or h.ts > now() - interval '30 days')) end
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."ofi_detail"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.ofi_event_id (
  p_slug text
)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select e.id from public.insight_events e
  where e.slug = p_slug and e.is_published and e.status <> 'draft' and public.ofi_tier() >= 2;
$function$;

REVOKE ALL ON FUNCTION "public"."ofi_event_id"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.ofi_internal_stats (
  p_event uuid,
  p_at    timestamp with time zone DEFAULT now()
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  kw text[];
  base jsonb;
  cats jsonb;
  hfc jsonb;
begin
  select array(select lower(k) from unnest(e.keywords) k where length(k) > 1) into kw
  from public.insight_events e where e.id = p_event;
  if kw is null then return null; end if;

  create temporary table if not exists _ofi_ev (
    id uuid, occurred_at timestamptz, severity text, hay text, recent boolean, about boolean
  ) on commit drop;
  truncate _ofi_ev;
  insert into _ofi_ev
  select x.id, x.occurred_at, x.severity::text,
         lower(concat_ws(' ', x.title, x.description, x.original_report_text, x.translations::text)),
         x.occurred_at > p_at - interval '24 hours', false
  from public.events x
  where x.deleted_at is null and x.status::text in ('published', 'archived')
    and x.occurred_at > p_at - interval '8 days' and x.occurred_at <= p_at;
  update _ofi_ev v set about = true where exists (select 1 from unnest(kw) k where v.hay like '%' || k || '%');

  select jsonb_build_object(
    'events_24h', count(*) filter (where recent),
    'matched_24h', count(*) filter (where recent and about),
    'baseline_daily', round(count(*) filter (where not recent and about)::numeric / 7, 3),
    'high_24h', count(*) filter (where recent and about and severity in ('high', 'critical')),
    'base_high_share', round(coalesce(
       (count(*) filter (where not recent and about and severity in ('high', 'critical')))::numeric
       / nullif(count(*) filter (where not recent and about), 0), 0), 4)
  ) into base from _ofi_ev;

  with lex as (
    select lower(l.term) term, l.category, l.weight
    from public.insight_lexicon l where l.event_id = p_event and l.enabled
  ), per as (
    select v.id, v.about, v.recent, l.category, least(sum(l.weight), 3) w
    from _ofi_ev v join lex l on v.hay like '%' || l.term || '%'
    group by v.id, v.about, v.recent, l.category
  ), agg as (
    select category,
           jsonb_build_object(
             'w_about', round(coalesce(sum(w) filter (where recent and about), 0), 3),
             'n_about', count(*) filter (where recent and about),
             'w_any', round(coalesce(sum(w) filter (where recent), 0), 3),
             'n_any', count(*) filter (where recent),
             'b_w_about', round(coalesce(sum(w) filter (where not recent and about), 0) / 7, 3),
             'b_n_about', round((count(*) filter (where not recent and about))::numeric / 7, 3),
             'b_w_any', round(coalesce(sum(w) filter (where not recent), 0) / 7, 3),
             'b_n_any', round((count(*) filter (where not recent))::numeric / 7, 3)) j
    from per group by category
  )
  select coalesce(jsonb_object_agg(category, j), '{}'::jsonb) into cats from agg;

  select jsonb_build_object(
    'waves_24h', count(distinct coalesce(a.cluster_id::text, to_char(date_trunc('minute', a.alerted_at), 'YYYYMMDDHH24MI')))
                   filter (where a.alerted_at > p_at - interval '24 hours'),
    'baseline_daily', round(count(distinct coalesce(a.cluster_id::text, to_char(date_trunc('minute', a.alerted_at), 'YYYYMMDDHH24MI')))
                   filter (where a.alerted_at <= p_at - interval '24 hours')::numeric / 7, 3),
    'last_alert', max(a.alerted_at)
  ) into hfc
  from public.hfc_alerts a
  where not a.is_drill and a.alerted_at > p_at - interval '8 days' and a.alerted_at <= p_at;

  return base || jsonb_build_object('categories', cats, 'hfc', hfc, 'at', p_at);
end $function$;

REVOKE ALL ON FUNCTION "public"."ofi_internal_stats"(uuid, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ofi_list()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare t smallint := public.ofi_tier();
begin
  if t = 0 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug', e.slug,
      'title_he', e.title_he,
      'title_en', e.title_en,
      'horizon_hours', e.horizon_hours,
      'status', e.status,
      'min_tier', e.min_tier,
      'tier', t,
      'locked', t < e.min_tier,
      'last_update', f.ts,
      'next_update', case when e.status = 'active' then e.next_run_at end,
      'probability', case when t >= e.min_tier then f.probability end,
      'previous_probability', case when t >= e.min_tier then fp.probability end,
      'base_rate', case when t >= e.min_tier then e.base_rate end,
      'spark', case when t >= greatest(e.min_tier, 2) then (
        select jsonb_agg(jsonb_build_array(h.ts, h.probability) order by h.ts)
        from public.insight_forecasts h where h.event_id = e.id and h.ts > now() - interval '30 days') end
    ) order by e.sort, e.created_at)
    from public.insight_events e
    left join lateral (select x.ts, x.probability from public.insight_forecasts x
                       where x.event_id = e.id order by x.ts desc limit 1) f on true
    left join lateral (select x.probability from public.insight_forecasts x
                       where x.event_id = e.id order by x.ts desc offset 1 limit 1) fp on true
    where e.is_published and e.status <> 'draft'
  ), '[]'::jsonb);
end $function$;

REVOKE ALL ON FUNCTION "public"."ofi_list"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.ofi_queue_alerts (
  p_forecast bigint
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare f public.insight_forecasts%rowtype; e public.insight_events%rowtype; prev numeric; n int := 0;
begin
  select * into f from public.insight_forecasts where id = p_forecast;
  if not found then return 0; end if;
  select * into e from public.insight_events where id = f.event_id;
  if not e.is_published then return 0; end if;
  select x.probability into prev from public.insight_forecasts x
   where x.event_id = f.event_id and x.ts < f.ts order by x.ts desc limit 1;
  if prev is null then return 0; end if;

  insert into public.insight_alert_queue (alert_id, user_id, event_slug, title_he, title_en, kind, value, probability, previous, webhook_url)
  select a.id, a.user_id, e.slug, e.title_he, e.title_en, a.kind, a.value, f.probability, prev, a.webhook_url
  from public.insight_alerts a
  where a.event_id = f.event_id and a.enabled
    and public.ofi_tier_of(a.user_id) >= 2
    and ((a.kind = 'above' and prev < a.value and f.probability >= a.value)
      or (a.kind = 'below' and prev > a.value and f.probability <= a.value)
      or (a.kind = 'change' and abs(f.probability - prev) * 100 >= a.value));
  get diagnostics n = row_count;
  if n > 0 then
    update public.insight_alerts a set last_fired_at = now()
    where a.id in (select q.alert_id from public.insight_alert_queue q where q.sent_at is null);
    perform net.http_post(
      url := 'https://osintfront.com/api/ofi-alerts',
      headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', (select value from public.push_config where key = 'secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  return n;
end $function$;

REVOKE ALL ON FUNCTION "public"."ofi_queue_alerts"(bigint) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ofi_tick()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_secret text;
begin
  if not exists (select 1 from public.insight_events where status = 'active') then return; end if;
  select value into v_secret from public.intel_config where key = 'cron_secret';
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/ofi-runner',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 5000);
end $function$;

REVOKE ALL ON FUNCTION "public"."ofi_tick"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ofi_tier()
  RETURNS smallint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select public.ofi_tier_of(auth.uid());
$function$;

REVOKE ALL ON FUNCTION "public"."ofi_tier"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.ofi_tier_of (
  p_uid uuid
)
  RETURNS smallint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select (case
    when pr.id is null or pr.status <> 'active' then 0
    when pr.role <> 'viewer' then 3
    when not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_plans'), false) then 3
    else coalesce((
      select max(case f.feature_key when 'insights_max' then 3 when 'insights_pro' then 2 else 1 end)
      from public.plan_features f
      where f.enabled and f.feature_key in ('insights_basic', 'insights_pro', 'insights_max')
        and f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now()
                             then 'free' else pr.plan end), 0)
  end)::smallint
  from (select 1) one left join public.profiles pr on pr.id = p_uid;
$function$;

REVOKE ALL ON FUNCTION "public"."ofi_tier_of"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.ofi_track_record (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with ev as (
    select id from public.insight_events
    where slug = p_slug and is_published and status <> 'draft' and public.ofi_tier() >= 1
  ), rows as (
    select r.window_start, r.window_end, r.outcome, f.probability
    from public.insight_resolutions r
    join ev on ev.id = r.event_id
    left join public.insight_forecasts f on f.id = r.forecast_id
    where r.window_end < now()
  )
  select case when not exists (select 1 from ev) then null else jsonb_build_object(
    'n', (select count(*) from rows where probability is not null),
    'brier', (select round(avg(power(probability - case when outcome then 1 else 0 end, 2)), 4)
              from rows where probability is not null),
    'windows', (select coalesce(jsonb_agg(jsonb_build_object('start', window_start, 'end', window_end,
                                                             'p', probability, 'outcome', outcome)
                                          order by window_start desc), '[]'::jsonb) from rows)
  ) end;
$function$;

REVOKE ALL ON FUNCTION "public"."ofi_track_record"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.password_changed()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  update public.profiles set must_change_password = false where id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION "public"."password_changed"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.place_jitter (
  p_seed uuid,
  p_kind text,
  p_axis integer
)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select ((abs(hashtext(p_seed::text || p_axis::text)::bigint) % 1000) / 1000.0 - 0.5)
         * case p_kind when 'country' then 0.30 when 'region' then 0.12 else 0.01 end;
$function$;

CREATE OR REPLACE FUNCTION public.places_in_polygon (
  p_polygon jsonb,
  p_limit   integer DEFAULT 6
)
  RETURNS TABLE (
    name_he    text,
    name_ar    text,
    name_en    text,
    population bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
  select g.name_he, g.name_ar, coalesce(g.name_en, g.name), g.population
  from geo_places g
  where g.feature_class = 'P'
    and st_within(g.geom::geometry, st_setsrid(st_geomfromgeojson(p_polygon::text), 4326))
  order by g.population desc nulls last
  limit least(greatest(p_limit, 1), 20)
$function$;

REVOKE ALL ON FUNCTION "public"."places_in_polygon"(jsonb, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.profiles_after_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'DELETE' then
    perform public.write_audit('user.removed', 'user', old.id,
      jsonb_build_object('email', old.email, 'role', old.role));
    return old;
  end if;
  if new.role <> old.role then
    perform public.write_audit('user.role_changed', 'user', new.id,
      jsonb_build_object('email', new.email, 'from', old.role, 'to', new.role));
  end if;
  if new.status <> old.status then
    perform public.write_audit(
      case new.status when 'suspended' then 'user.suspended'
                      when 'active' then case when old.status = 'suspended' then 'user.reactivated' else 'user.activated' end
                      else 'user.status_changed' end,
      'user', new.id, jsonb_build_object('email', new.email, 'from', old.status, 'to', new.status));
  end if;
  if new.can_publish <> old.can_publish then
    perform public.write_audit('user.publish_permission_changed', 'user', new.id,
      jsonb_build_object('email', new.email, 'can_publish', new.can_publish));
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."profiles_after_change"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.profiles_before_delete()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_other_active_supers integer;
begin
  if old.role = 'super_admin' and old.status = 'active' then
    perform pg_advisory_xact_lock(hashtext('osintfront.super_admins'));
    select count(*) into v_other_active_supers
    from public.profiles where role = 'super_admin' and status = 'active' and id <> old.id;
    if v_other_active_supers = 0 then
      raise exception 'The last active super admin cannot be removed.' using errcode = '42501';
    end if;
  end if;
  if v_actor is null then
    return old;
  end if;
  if v_actor = old.id then
    raise exception 'You cannot remove your own account.' using errcode = '42501';
  end if;
  if not public.has_permission('user.manage') then
    raise exception 'You do not have permission to remove users.' using errcode = '42501';
  end if;
  if old.role in ('super_admin', 'admin') and not public.has_permission('user.manage.admins') then
    raise exception 'Only a super admin can remove administrator accounts.' using errcode = '42501';
  end if;
  return old;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."profiles_before_delete"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.profiles_before_update()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_other_active_supers integer;
begin
  new.updated_at := now();
  if v_actor is null then
    return new;
  end if;
  if new.id <> old.id or lower(new.email) <> lower(old.email) or new.created_at <> old.created_at
     or new.invited_by is distinct from old.invited_by then
    raise exception 'Identity fields of a profile cannot be edited.' using errcode = '42501';
  end if;
  if new.last_login_at is distinct from old.last_login_at
     and (v_actor <> old.id or new.last_login_at is distinct from now()) then
    raise exception 'last_login_at is maintained by the server.' using errcode = '42501';
  end if;
  if v_actor = old.id then
    if new.role <> old.role or new.can_publish <> old.can_publish then
      raise exception 'You cannot change your own role, status or publishing permission.' using errcode = '42501';
    end if;
    if new.status <> old.status and not (
      old.status = 'pending' and new.status = 'active'
      and exists (select 1 from auth.users u where u.id = old.id and u.email_confirmed_at is not null)
    ) then
      raise exception 'You cannot change your own role, status or publishing permission.' using errcode = '42501';
    end if;
    return new;
  end if;
  if not public.has_permission('user.manage') then
    raise exception 'You do not have permission to manage users.' using errcode = '42501';
  end if;
  if (old.role in ('super_admin', 'admin') or new.role in ('super_admin', 'admin'))
     and not public.has_permission('user.manage.admins') then
    raise exception 'Only a super admin can manage administrator accounts.' using errcode = '42501';
  end if;
  if new.role = 'super_admin' and old.role <> 'super_admin' and not public.has_permission('role.manage') then
    raise exception 'Only a super admin can create another super admin.' using errcode = '42501';
  end if;
  if old.role = 'super_admin' and old.status = 'active'
     and (new.role <> 'super_admin' or new.status <> 'active') then
    perform pg_advisory_xact_lock(hashtext('osintfront.super_admins'));
    select count(*) into v_other_active_supers
    from public.profiles
    where role = 'super_admin' and status = 'active' and id <> old.id;
    if v_other_active_supers = 0 then
      raise exception 'The last active super admin cannot be demoted or suspended.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."profiles_before_update"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.profiles_plan_guard()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if (new.plan, new.plan_source, new.plan_expires_at, new.billing_period) is distinct from
     (old.plan, old.plan_source, old.plan_expires_at, old.billing_period)
     and coalesce(current_setting('osf.plan_ok', true), '') <> '1'
     and coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is not null
     and not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.promote_listed_place()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_first jsonb;
begin
  if new.location_precision = 'country'
     and jsonb_typeof(new.locations) = 'array' and jsonb_array_length(new.locations) > 0 then
    v_first := new.locations -> 0;
    if jsonb_typeof(v_first -> 'lat') = 'number' and jsonb_typeof(v_first -> 'lng') = 'number' then
      new.latitude := (v_first ->> 'lat')::numeric;
      new.longitude := (v_first ->> 'lng')::numeric;
      new.location_precision := coalesce(nullif(v_first ->> 'precision', ''), 'exact');
      if coalesce(new.location_name, '') = '' then new.location_name := left(v_first ->> 'name', 200); end if;
      new.geocoding_confidence := 0.7;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'locations_list', 'place', v_first ->> 'name', 'resolved_at', now()));
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.push_set_min_severity (
  p_endpoint text,
  p_min      text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int; pr public.profiles%rowtype; v_enforce boolean;
begin
  if p_min not in ('low', 'medium', 'high', 'critical') then raise exception 'bad severity'; end if;
  select * into pr from public.profiles where id = auth.uid();
  v_enforce := coalesce((select value = 'true'::jsonb from public.app_settings where key = 'enforce_plans'), false);
  if v_enforce and pr.role = 'viewer' and p_min in ('low', 'medium')
     and (pr.plan = 'free' or (pr.plan_expires_at is not null and pr.plan_expires_at < now())) then
    raise exception 'plan: the free plan gets high and critical alerts only';
  end if;
  update public.push_subscriptions set min_severity = p_min, updated_at = now()
   where endpoint = p_endpoint and user_id = auth.uid();
  get diagnostics n = row_count;
  return n > 0;
end $function$;

REVOKE ALL ON FUNCTION "public"."push_set_min_severity"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.push_subscribe (
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_filters  jsonb,
  p_muted    text[],
  p_lang     text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null or not public.is_member() then raise exception 'not allowed'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'bad endpoint'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, filters, muted, lang)
  values (auth.uid(), p_endpoint, left(p_p256dh, 200), left(p_auth, 100), p_filters, coalesce(p_muted, '{}'), case when p_lang = 'en' then 'en' else 'he' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    filters = excluded.filters, muted = excluded.muted, lang = excluded.lang, updated_at = now();
end $function$;

REVOKE ALL ON FUNCTION "public"."push_subscribe"(text, text, text, jsonb, text[], text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.record_login()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_rows  integer;
begin
  if v_actor is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  update public.profiles
     set last_login_at = now(),
         status = case
           when status = 'pending'
                and exists (select 1 from auth.users u where u.id = v_actor and u.email_confirmed_at is not null)
           then 'active'::public.user_status
           else status
         end
   where id = v_actor and status <> 'suspended';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.write_audit('user.login', 'user', v_actor, '{}'::jsonb);
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."record_login"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.redeem_license (
  p_key text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare k record; me record; v text := upper(trim(p_key)); until_at timestamptz;
begin
  if auth.uid() is null or not public.is_member() then raise exception 'not allowed'; end if;
  if (select count(*) from public.license_attempts where user_id = auth.uid() and at > now() - interval '15 minutes' and not ok) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into k from public.license_keys where key = v for update;
  if k is null or k.revoked or k.uses >= k.max_uses or k.redeem_by < now()
     or exists (select 1 from public.license_redemptions r where r.key = v and r.user_id = auth.uid()) then
    insert into public.license_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select plan, plan_expires_at into me from public.profiles where id = auth.uid();
  until_at := (case when me.plan = k.plan then greatest(coalesce(me.plan_expires_at, now()), now()) else now() end) + make_interval(days => k.duration_days);
  update public.license_keys set uses = uses + 1 where key = v;
  insert into public.license_redemptions (key, user_id) values (v, auth.uid());
  insert into public.license_attempts (user_id, ok) values (auth.uid(), true);
  perform public._plan_set(auth.uid(), k.plan, 'eval', until_at, 'license_redeemed', jsonb_build_object('key', v));
  return jsonb_build_object('ok', true, 'plan', k.plan, 'expires_at', until_at);
end $function$;

REVOKE ALL ON FUNCTION "public"."redeem_license"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.refine_apply (
  p_id    uuid,
  p_hit   jsonb,
  p_query text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  r          record;
  v_expected text;
  v_cc       text;
  v_type     text;
  v_lat      numeric;
  v_lng      numeric;
  v_hit      jsonb := case when p_hit is null or jsonb_typeof(p_hit) <> 'object' then null else p_hit end;
begin
  -- Lock the row and skip it if someone else already handled it (idempotent under overlapping runs).
  select e.id, e.country, e.ai_suggestions into r
  from public.events e
  where e.id = p_id and e.deleted_at is null and not (e.ai_suggestions ? 'osm_checked')
  for update;
  if not found then return false; end if;

  v_expected := nullif(r.ai_suggestions -> 'location_resolution' ->> 'country_code', '');
  if v_expected is null and coalesce(r.country, '') <> '' then
    v_expected := nullif((public.lookup_place(split_part(r.country, '/', 1))).country_code, '');
  end if;

  v_cc   := lower(v_hit -> 'address' ->> 'country_code');
  v_type := coalesce(v_hit ->> 'addresstype', v_hit ->> 'type');
  v_lat  := (v_hit ->> 'lat')::numeric;
  v_lng  := (v_hit ->> 'lon')::numeric;

  if v_hit is not null
     and (v_expected is null or v_cc = lower(v_expected))
     and v_lat between 10 and 43 and v_lng between 25 and 63 then
    update public.events
       set latitude = round(v_lat, 6),
           longitude = round(v_lng, 6),
           location_precision = case
             when v_type in ('state', 'province', 'region', 'county', 'state_district', 'district', 'governorate',
                             'sea', 'strait', 'bay', 'mountain_range', 'island', 'archipelago') then 'region'
             when v_type in ('city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter',
                             'municipality', 'locality', 'isolated_dwelling') then 'city'
             else 'exact' end,
           geocoding_confidence = 0.7,
           ai_suggestions = ai_suggestions
             || jsonb_build_object('osm_checked', true)
             || jsonb_build_object('location_resolution', jsonb_build_object(
                  'method', 'nominatim', 'query', p_query, 'place', v_hit ->> 'display_name',
                  'type', v_type, 'country_code', v_cc, 'resolved_at', now()))
     where id = p_id;
    return true;
  end if;

  update public.events
     set ai_suggestions = ai_suggestions || jsonb_build_object('osm_checked', true)
   where id = p_id;
  return false;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."refine_apply"(uuid, jsonb, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.refine_event_candidates (
  p_limit integer DEFAULT 8
)
  RETURNS TABLE (
    id          uuid,
    expected_cc text,
    queries     text[]
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  r         record;
  v_expected text;
  v_paren    text;
begin
  for r in
    select e.id, e.location_name, e.country, e.ai_suggestions
    from public.events e
    where e.deleted_at is null
      and e.status in ('published', 'draft')
      and e.created_at > now() - interval '3 days'
      and e.location_precision in ('country', 'region')
      and not (e.ai_suggestions ? 'osm_checked')
      and (btrim(coalesce(e.location_name, '')) <> '' or coalesce(e.ai_suggestions ->> 'place_en', '') <> '')
      and (coalesce(e.ai_suggestions -> 'location_resolution' ->> 'method', '') <> 'gazetteer'
           or public.normalize_place(coalesce(e.location_name, ''))
              <> public.normalize_place(coalesce(e.ai_suggestions -> 'location_resolution' ->> 'matched_on', '')))
    order by e.created_at desc
    limit greatest(1, least(p_limit, 20))
  loop
    v_expected := nullif(r.ai_suggestions -> 'location_resolution' ->> 'country_code', '');
    if v_expected is null and coalesce(r.country, '') <> '' then
      v_expected := nullif((public.lookup_place(split_part(r.country, '/', 1))).country_code, '');
    end if;
    v_paren := btrim(split_part(substring(coalesce(r.location_name, '') from '\(([^)]+)\)'), '/', 1));

    id := r.id;
    expected_cc := v_expected;
    queries := array_remove(array[
      nullif(btrim(coalesce(r.ai_suggestions ->> 'place_en', '')), ''),
      nullif(v_paren, ''),
      nullif(btrim(split_part(regexp_replace(coalesce(r.location_name, ''), '\([^)]*\)', '', 'g'), ',', 1)), '')
    ], null);
    return next;
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."refine_event_candidates"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.refine_event_locations (
  p_limit integer DEFAULT 5
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  r          record;
  v_queries  text[];
  v_query    text;
  v_resp     extensions.http_response;
  v_hit      jsonb;
  v_expected text;
  v_cc       text;
  v_type     text;
  v_lat      numeric;
  v_lng      numeric;
  v_done     int := 0;
  v_paren    text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '8');
  for r in
    select e.id, e.location_name, e.country, e.ai_suggestions
    from public.events e
    where e.deleted_at is null
      and e.status in ('published', 'draft')
      and e.created_at > now() - interval '3 days'
      and e.location_precision in ('country', 'region')
      and not (e.ai_suggestions ? 'osm_checked')
      and (btrim(coalesce(e.location_name, '')) <> '' or coalesce(e.ai_suggestions ->> 'place_en', '') <> '')
      and (coalesce(e.ai_suggestions -> 'location_resolution' ->> 'method', '') <> 'gazetteer'
           or public.normalize_place(coalesce(e.location_name, ''))
              <> public.normalize_place(coalesce(e.ai_suggestions -> 'location_resolution' ->> 'matched_on', '')))
    order by e.created_at desc
    limit greatest(1, least(p_limit, 20))
  loop
    v_expected := nullif(r.ai_suggestions -> 'location_resolution' ->> 'country_code', '');
    if v_expected is null and coalesce(r.country, '') <> '' then
      v_expected := nullif((public.lookup_place(split_part(r.country, '/', 1))).country_code, '');
    end if;
    v_paren := btrim(split_part(substring(coalesce(r.location_name, '') from '\(([^)]+)\)'), '/', 1));
    v_queries := array_remove(array[
      nullif(btrim(coalesce(r.ai_suggestions ->> 'place_en', '')), ''),
      nullif(v_paren, ''),
      nullif(btrim(split_part(regexp_replace(coalesce(r.location_name, ''), '\([^)]*\)', '', 'g'), ',', 1)), '')
    ], null);
    v_hit := null;
    foreach v_query in array v_queries loop
      begin
        select * into v_resp from extensions.http((
          'GET',
          'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=3&accept-language=en,he,ar'
            || coalesce('&countrycodes=' || lower(v_expected), '')
            || '&q=' || extensions.urlencode(v_query),
          array[extensions.http_header('User-Agent', 'Osintfront/1.0 (+https://main-drab-chi.vercel.app)')],
          null, null)::extensions.http_request);
        if v_resp.status = 200 then
          select h into v_hit
          from jsonb_array_elements(v_resp.content::jsonb) h
          where coalesce(h ->> 'addresstype', h ->> 'type') not in ('country', 'continent')
          limit 1;
        end if;
      exception when others then
        v_hit := null;
      end;
      perform pg_sleep(1.1);
      exit when v_hit is not null;
    end loop;
    v_cc := lower(v_hit -> 'address' ->> 'country_code');
    v_type := coalesce(v_hit ->> 'addresstype', v_hit ->> 'type');
    v_lat := (v_hit ->> 'lat')::numeric;
    v_lng := (v_hit ->> 'lon')::numeric;
    if v_hit is not null
       and (v_expected is null or v_cc = lower(v_expected))
       and v_lat between 10 and 43 and v_lng between 25 and 63 then
      update public.events
         set latitude = round(v_lat, 6),
             longitude = round(v_lng, 6),
             location_precision = case
               when v_type in ('state', 'province', 'region', 'county', 'state_district', 'district', 'governorate',
                               'sea', 'strait', 'bay', 'mountain_range', 'island', 'archipelago') then 'region'
               when v_type in ('city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter',
                               'municipality', 'locality', 'isolated_dwelling') then 'city'
               else 'exact' end,
             geocoding_confidence = 0.7,
             ai_suggestions = ai_suggestions
               || jsonb_build_object('osm_checked', true)
               || jsonb_build_object('location_resolution', jsonb_build_object(
                    'method', 'nominatim', 'query', v_query, 'place', v_hit ->> 'display_name',
                    'type', v_type, 'country_code', v_cc, 'resolved_at', now()))
       where id = r.id;
      v_done := v_done + 1;
    else
      update public.events
         set ai_suggestions = ai_suggestions || jsonb_build_object('osm_checked', true)
       where id = r.id;
    end if;
  end loop;
  return v_done;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."refine_event_locations"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.refund_feature (
  p_uid uuid,
  p_key text
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  update public.feature_usage set count = count - 1
   where user_id = p_uid and feature_key = p_key
     and day = (now() at time zone 'Asia/Jerusalem')::date and count > 0;
$function$;

REVOKE ALL ON FUNCTION "public"."refund_feature"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.register_session (
  p_device  text,
  p_browser text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; ended int := 0;
begin
  if auth.uid() is null or sid is null then raise exception 'not allowed'; end if;
  insert into public.user_sessions (session_id, user_id, device_type, browser)
  values (sid, auth.uid(), left(p_device, 40), left(p_browser, 60))
  on conflict (session_id) do update set last_seen = now(), device_type = excluded.device_type, browser = excluded.browser;
  if not public.is_super_admin() then
    update public.user_sessions set ended_at = now(), ended_reason = 'signed_in_elsewhere'
      where user_id = auth.uid() and session_id <> sid and ended_at is null;
    delete from auth.sessions where user_id = auth.uid() and id <> sid;
    get diagnostics ended = row_count;
  end if;
  return jsonb_build_object('ok', true, 'ended', ended);
end $function$;

REVOKE ALL ON FUNCTION "public"."register_session"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.remove_event_pin (
  p_id    uuid,
  p_index integer DEFAULT NULL::integer
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_ev record; v_rest jsonb; v_first jsonb; v_name text;
begin
  if auth.uid() is null or not public.has_permission('event.edit.any') then
    raise exception 'You do not have permission to remove pins.' using errcode = '42501';
  end if;
  select latitude, longitude, coalesce(locations, '[]'::jsonb) as locations into v_ev
  from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if jsonb_typeof(v_ev.locations) <> 'array' then v_ev.locations := '[]'::jsonb; end if;

  if p_index is not null then
    if p_index < 0 or p_index >= jsonb_array_length(v_ev.locations) then
      raise exception 'Place not found.' using errcode = 'P0002';
    end if;
    update public.events set locations = v_ev.locations - p_index where id = p_id;
    return;
  end if;

  select coalesce(jsonb_agg(x.value order by x.ord), '[]'::jsonb) into v_rest
  from jsonb_array_elements(v_ev.locations) with ordinality x(value, ord)
  where not (jsonb_typeof(x.value -> 'lat') = 'number' and jsonb_typeof(x.value -> 'lng') = 'number'
             and v_ev.latitude is not null
             and abs((x.value ->> 'lat')::float8 - v_ev.latitude) < 0.003
             and abs((x.value ->> 'lng')::float8 - v_ev.longitude) < 0.003);
  select x.value into v_first from jsonb_array_elements(v_rest) x
  where jsonb_typeof(x.value -> 'lat') = 'number' and jsonb_typeof(x.value -> 'lng') = 'number' limit 1;

  if v_first is null then
    update public.events
       set location_precision = 'country', locations = v_rest
     where id = p_id;
  else
    v_name := coalesce(nullif(v_first ->> 'name', ''), v_first ->> 'name_en');
    update public.events
       set latitude = (v_first ->> 'lat')::numeric, longitude = (v_first ->> 'lng')::numeric,
           location_precision = coalesce(nullif(v_first ->> 'precision', ''), 'exact'),
           location_name = left(coalesce(v_name, ''), 200),
           location_name_he = case when public.has_hebrew(v_first ->> 'name') then left(v_first ->> 'name', 200) end,
           location_name_en = nullif(left(coalesce(v_first ->> 'name_en', ''), 200), ''),
           locations = v_rest,
           coordinates_manually_corrected = true
     where id = p_id;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."remove_event_pin"(uuid, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.request_geolocation (
  p_event uuid,
  p_media uuid DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_id uuid; v_limit int; v_used int; pr public.profiles%rowtype;
begin
  if not public.can_geolocate() then
    raise exception 'plan: geolocation is available on the Max plan' using errcode = '42501';
  end if;
  select * into pr from public.profiles where id = auth.uid();
  if not exists (select 1 from public.events where id = p_event and deleted_at is null) then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;
  if p_media is null then
    select m.id into p_media from public.event_media m
     where m.event_id = p_event and m.kind in ('image', 'video_thumb') order by m.created_at limit 1;
  elsif not exists (select 1 from public.event_media where id = p_media and event_id = p_event) then
    raise exception 'Media not found on this event.' using errcode = 'P0002';
  end if;
  if p_media is null then
    raise exception 'This event has no photo or video to geolocate.' using errcode = '22023';
  end if;
  select id into v_id from public.geoloc_jobs where event_id = p_event and media_id = p_media
   order by created_at desc limit 1;
  if v_id is not null then
    update public.geoloc_jobs set status = 'queued', trigger = 'manual', requested_by = auth.uid(), attempts = 0, error = null
     where id = v_id and status in ('failed', 'skipped');
    return v_id;
  end if;
  if pr.role = 'viewer' then
    select f.limit_value into v_limit from public.plan_features f where f.feature_key = 'geolocation' and f.plan_id = pr.plan;
    select count(*) into v_used from public.geoloc_jobs
     where requested_by = auth.uid() and trigger = 'manual' and created_at > now() - interval '1 day';
    if v_limit is not null and v_used >= v_limit then
      raise exception 'plan: daily geolocation limit reached' using errcode = '42501';
    end if;
  end if;
  insert into public.geoloc_jobs (event_id, media_id, trigger, requested_by)
  values (p_event, p_media, 'manual', auth.uid()) returning id into v_id;
  return v_id;
end $function$;

REVOKE ALL ON FUNCTION "public"."request_geolocation"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.request_ip()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select nullif(btrim(split_part(
    coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
    ',', 1)), '');
$function$;

CREATE OR REPLACE FUNCTION public.resolve_event_locations (
  p_locations jsonb,
  p_seed      uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_out   jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_lat   numeric;
  v_lng   numeric;
  v_hit   public.place_gazetteer;
  v_name  text;
  v_en    text;
  v_cat   jsonb;
  v_i     int := 0;
begin
  if p_locations is null or jsonb_typeof(p_locations) <> 'array' then return '[]'::jsonb; end if;
  for v_item in select value from jsonb_array_elements(p_locations) loop
    exit when jsonb_array_length(v_out) >= 30;
    continue when jsonb_typeof(v_item) <> 'object';
    v_i := v_i + 1;
    v_name := left(btrim(coalesce(v_item ->> 'name', '')), 120);
    v_en   := left(btrim(coalesce(v_item ->> 'name_en', '')), 120);
    v_cat  := case when coalesce(v_item ->> 'category_slug', '') ~ '^[a-z0-9-]{1,60}$'
                   then jsonb_build_object('category_slug', v_item ->> 'category_slug') else '{}'::jsonb end;
    v_lat := case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::numeric end;
    v_lng := case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::numeric end;
    if v_lat between -90 and 90 and v_lng between -180 and 180 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'name', v_name, 'name_en', v_en, 'lat', round(v_lat, 6), 'lng', round(v_lng, 6),
        'precision', coalesce(nullif(v_item ->> 'precision', ''), 'exact')) || v_cat);
      continue;
    end if;
    v_hit := public.lookup_place(v_name);
    if v_hit.id is null and v_en <> '' then v_hit := public.lookup_place(v_en); end if;
    continue when v_hit.kind = 'country';
    if v_hit.id is null then
      -- Unknown here: kept for the GeoNames lookup (events_apply_learned_place).
      continue when v_name = '' and v_en = '';
      v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'name_en', v_en, 'lat', null, 'lng', null) || v_cat
        || case when coalesce(v_item ->> 'name_ar', '') <> '' then jsonb_build_object('name_ar', left(v_item ->> 'name_ar', 120)) else '{}'::jsonb end);
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', coalesce(nullif(v_name, ''), v_hit.canonical), 'name_en', coalesce(nullif(v_en, ''), v_hit.canonical),
      'lat', round(v_hit.latitude + public.place_jitter(p_seed, v_hit.kind, 10 + v_i), 6),
      'lng', round(v_hit.longitude + public.place_jitter(p_seed, v_hit.kind, 20 + v_i), 6),
      'precision', v_hit.kind) || v_cat);
  end loop;
  return v_out;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."resolve_event_locations"(jsonb, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.resolve_event_place (
  p_location_name text,
  p_city          text,
  p_region        text,
  p_country       text
)
  RETURNS TABLE (
    place_id   uuid,
    matched_on text
  )
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_candidates text[] := '{}';
  v_part text;
  v_hit public.place_gazetteer;
  v_broad_id uuid;
  v_broad_on text;
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
    continue when v_hit.id is null;
    if v_hit.canonical in ('Middle East') then
      if v_broad_id is null then v_broad_id := v_hit.id; v_broad_on := v_part; end if;
      continue;
    end if;
    place_id := v_hit.id;
    matched_on := v_part;
    return next;
    return;
  end loop;
  if v_broad_id is not null then
    place_id := v_broad_id;
    matched_on := v_broad_on;
    return next;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.role_permissions (
  p_role public.app_role
)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case p_role
    when 'super_admin' then array[
      'admin.access', 'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish', 'event.publish.draft',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'user.manage.admins', 'role.manage',
      'audit.view', 'settings.manage', 'ai.usage.view']
    when 'admin' then array[
      'admin.access', 'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish', 'event.publish.draft',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'audit.view']
    when 'analyst' then array['admin.access', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.publish.draft']
    when 'viewer' then array[]::text[]
    else array[]::text[]
  end;
$function$;

CREATE OR REPLACE FUNCTION public.run_osm_merge (
  p_cc text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r record; begin
  if not exists (select 1 from public.osm_places_stage where country = p_cc) then return; end if;
  set local statement_timeout = 0;
  select status, content into r from extensions.http_get('https://raw.githubusercontent.com/osintfront/main/d4025e52b1bdc4d76423bf62996c176c4015840d/tools/osm/merge_osm_places.sql');
  if r.status <> 200 then raise exception 'http %', r.status; end if;
  execute replace(r.content, $q$v_cc text := 'SY'$q$, format('v_cc text := %L', p_cc));
end $function$;

REVOKE ALL ON FUNCTION "public"."run_osm_merge"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.session_active()
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or sid is null then return true; end if;
  update public.user_sessions set last_seen = now() where session_id = sid and ended_at is null;
  return not exists (select 1 from public.user_sessions where session_id = sid and ended_at is not null)
     and exists (select 1 from auth.sessions where id = sid);
end $function$;

REVOKE ALL ON FUNCTION "public"."session_active"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_event_category (
  p_id   uuid,
  p_slug text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_cat uuid; v_owner uuid; v_old text;
begin
  select e.created_by, c.slug into v_owner, v_old from public.events e left join public.event_categories c on c.id = e.category_id
   where e.id = p_id and e.deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  select id into v_cat from public.event_categories where slug = p_slug and is_active;
  if v_cat is null then raise exception 'Unknown category.' using errcode = '22023'; end if;
  update public.events
     set category_id = v_cat,
         locations = case when jsonb_typeof(locations) = 'array' then (
           select coalesce(jsonb_agg(case when l->>'category_slug' = v_old then l || jsonb_build_object('category_slug', p_slug) else l end order by o), '[]'::jsonb)
             from jsonb_array_elements(locations) with ordinality as t(l, o)) else locations end
   where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_event_category"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_event_severity (
  p_id       uuid,
  p_severity text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_owner uuid; v_old text; v_text text;
begin
  if p_severity not in ('low', 'medium', 'high', 'critical') then raise exception 'bad severity' using errcode = '22023'; end if;
  select created_by, severity::text, coalesce(nullif(original_report_text, ''), title) into v_owner, v_old, v_text
    from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  if v_old is distinct from p_severity then
    update public.events set severity = p_severity::public.event_severity where id = p_id;
    insert into public.severity_corrections (event_id, text, from_severity, to_severity, corrected_by)
    values (p_id, left(v_text, 400), v_old, p_severity, auth.uid());
  end if;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_event_severity"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_hebrew_place_names (
  p_rows jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_n integer;
begin
  update public.geo_places g set name_he = r.name_he, he_from_ai = true,
    names = (select array_agg(distinct n) from unnest(g.names || public.normalize_place(r.name_he)) n)
  from jsonb_to_recordset(p_rows) as r(geonameid bigint, name_he text)
  where g.geonameid = r.geonameid and g.name_he is null and coalesce(r.name_he, '') <> '';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_hebrew_place_names"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.set_hebrew_wadi_names (
  p_rows jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_n integer;
begin
  update public.wadi_lines l set name_he = r.name_he, he_from_ai = true
  from jsonb_to_recordset(p_rows) as r(geonameid bigint, name_he text)
  where l.id = r.geonameid and l.name_he is null and coalesce(r.name_he, '') <> '';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_hebrew_wadi_names"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.set_place_category (
  p_id    uuid,
  p_index integer,
  p_slug  text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  e        public.events;
  v_cat    public.event_categories;
  v_locs   jsonb;
  v_idx    integer := p_index;
  v_item   jsonb;
  v_rest   jsonb;
  v_group  text;
  v_sib    uuid;
  v_new    uuid;
  v_first  jsonb;
  v_he     text;
  v_title  text;
  v_name   text;
  v_on_main boolean;
begin
  select * into e from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and e.created_by = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  select * into v_cat from public.event_categories where slug = p_slug and is_active;
  if v_cat.id is null then raise exception 'Unknown category.' using errcode = '22023'; end if;

  v_locs := case when jsonb_typeof(e.locations) = 'array' then e.locations else '[]'::jsonb end;
  -- The main pin: the listed place standing on it (within ~300 m).
  if v_idx is null and e.latitude is not null then
    select (i - 1)::int into v_idx from jsonb_array_elements(v_locs) with ordinality as t(x, i)
    where jsonb_typeof(x -> 'lat') = 'number'
      and abs((x ->> 'lat')::numeric - e.latitude) < 0.003 and abs((x ->> 'lng')::numeric - e.longitude) < 0.003
    order by i limit 1;
  end if;

  -- One icon only (or the main pin of an event without a list): the whole event changes kind.
  if jsonb_array_length(v_locs) <= 1 or v_idx is null then
    update public.events set category_id = v_cat.id,
      locations = (select coalesce(jsonb_agg(case when x ? 'category_slug' then x || jsonb_build_object('category_slug', p_slug) else x end order by i), '[]'::jsonb)
                   from jsonb_array_elements(v_locs) with ordinality as t(x, i))
    where id = p_id;
    return p_id;
  end if;
  if v_idx < 0 or v_idx >= jsonb_array_length(v_locs) then raise exception 'Place not found.' using errcode = 'P0002'; end if;
  if v_cat.id = e.category_id and coalesce(v_locs -> v_idx ->> 'category_slug', p_slug) = p_slug then return p_id; end if;

  v_item := (v_locs -> v_idx) || jsonb_build_object('category_slug', p_slug);
  v_rest := v_locs - v_idx;
  v_group := coalesce(e.ai_suggestions ->> 'split_from', e.id::text);
  v_name := coalesce(nullif(v_item ->> 'name', ''), v_item ->> 'name_en', '');

  -- The report's event of that kind, if there is one.
  select s.id into v_sib from public.events s
  where s.deleted_at is null and s.id <> e.id and s.category_id = v_cat.id
    and (s.id::text = v_group or s.ai_suggestions ->> 'split_from' = v_group)
  order by s.created_at limit 1;

  if v_sib is not null then
    update public.events set locations = coalesce(locations, '[]'::jsonb) || jsonb_build_array(v_item) where id = v_sib;
  else
    v_he := case p_slug
      when 'airstrike' then 'תקיפה אווירית' when 'artillery-shelling' then 'הפגזה ארטילרית' when 'explosion' then 'פיצוץ'
      when 'uav' then 'כטב"מ' when 'drone' then 'רחפן' when 'shooting-gunfire' then 'ירי נשק קל'
      when 'missile-rocket-attack' then 'ירי רקטות וטילים' when 'assassination' then 'חיסול' when 'military-activity' then 'פעילות צבאית'
      when 'force-sighting' then 'זיהוי כוחות' when 'infiltration' then 'חדירה' when 'fire' then 'שריפה'
      when 'terror-security-incident' then 'אירוע טרור או ביטחוני' else v_cat.name end;
    v_title := left(v_he || ': ' || v_name, 200);
    insert into public.events (title, description, original_report_text, category_id, suggested_category_id, status, severity,
      latitude, longitude, location_name, location_precision, geocoding_confidence, country, region, city,
      source_name, source_url, source_type, occurred_at, published_at, created_by, approved_by,
      is_breaking, is_verified, classification_confidence, sources, whatsapp_text, translations, locations, ai_suggestions)
    values (v_title, e.description, e.original_report_text, v_cat.id, v_cat.id, e.status, e.severity,
      (v_item ->> 'lat')::numeric, (v_item ->> 'lng')::numeric, left(v_name, 200), coalesce(v_item ->> 'precision', 'exact'), 0.9,
      e.country, e.region, e.city, e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.created_by, e.approved_by,
      e.is_breaking, e.is_verified, e.classification_confidence, e.sources, e.whatsapp_text,
      coalesce(e.translations, '{}'::jsonb)
        || jsonb_build_object('he', coalesce(e.translations -> 'he', '{}'::jsonb) || jsonb_build_object('title', v_title))
        || jsonb_build_object('en', coalesce(e.translations -> 'en', '{}'::jsonb) || jsonb_build_object('title',
             left(regexp_replace(v_cat.name, '\s*\(.*\)$', '') || ': ' || coalesce(nullif(v_item ->> 'name_en', ''), v_name), 200))),
      jsonb_build_array(v_item),
      (coalesce(e.ai_suggestions, '{}'::jsonb) - 'split_into') || jsonb_build_object('split_from', v_group, 'split_by_hand', true))
    returning id into v_sib;
    -- The report's first event now knows it was split (the map links the group).
    update public.events set ai_suggestions = coalesce(ai_suggestions, '{}'::jsonb)
      || jsonb_build_object('split_into', coalesce(ai_suggestions -> 'split_into', '[]'::jsonb) || to_jsonb(v_sib::text))
    where id::text = v_group;
  end if;

  -- The event keeps its other places; its main pin moves if it stood on the place that left.
  v_on_main := e.latitude is not null and jsonb_typeof(v_item -> 'lat') = 'number'
    and abs((v_item ->> 'lat')::numeric - e.latitude) < 0.003 and abs((v_item ->> 'lng')::numeric - e.longitude) < 0.003;
  select x into v_first from jsonb_array_elements(v_rest) with ordinality as t(x, i)
  where jsonb_typeof(x -> 'lat') = 'number' order by i limit 1;
  update public.events set locations = v_rest,
    latitude  = case when v_on_main and v_first is not null then (v_first ->> 'lat')::numeric else latitude end,
    longitude = case when v_on_main and v_first is not null then (v_first ->> 'lng')::numeric else longitude end,
    location_name = case when v_on_main and v_first is not null then left(coalesce(v_first ->> 'name', location_name), 200) else location_name end
  where id = p_id;
  return v_sib;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_place_category"(uuid, integer, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_place_location (
  p_id    uuid,
  p_index integer,
  p_lat   double precision,
  p_lng   double precision,
  p_name  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_index is null then
    perform public.move_event_pin(p_id, p_lat, p_lng, p_name);
    return;
  end if;
  -- Checks the permission and learns the place.
  perform public.move_event_place(p_id, p_index, p_lat, p_lng);
  if coalesce(btrim(p_name), '') <> '' then
    update public.events set locations = jsonb_set(locations, array[p_index::text], (locations -> p_index) || jsonb_build_object('name', left(btrim(p_name), 120)))
    where id = p_id;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_place_location"(uuid, integer, double precision, double precision, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.south_lebanon_missing_hebrew (
  p_limit integer DEFAULT 120
)
  RETURNS TABLE (
    geonameid bigint,
    name_ar   text,
    name      text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select g.geonameid, g.name_ar, g.name from public.geo_places g
  where g.country_code = 'LB' and g.feature_class = 'P' and g.name_he is null
    and extensions.st_y(g.geom) between 33.04 and 33.62 and extensions.st_x(g.geom) between 35.1 and 35.95
  order by g.population desc, g.geonameid limit p_limit
$function$;

REVOKE ALL ON FUNCTION "public"."south_lebanon_missing_hebrew"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.telegram_channel_event_counts()
  RETURNS TABLE (
    username text,
    events   integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select lower(m[1]) as username, count(distinct e.id)::int as events
  from public.events e
  cross join lateral (
    select e.source_url as u
    union all
    select s ->> 'url' from jsonb_array_elements(case when jsonb_typeof(e.sources) = 'array' then e.sources else '[]'::jsonb end) s
  ) x
  cross join lateral regexp_match(x.u, '^https://t\.me/(?:s/)?([A-Za-z0-9_]{4,64})/\d+') m
  where e.deleted_at is null and x.u like 'https://t.me/%'
  group by 1
$function$;

REVOKE ALL ON FUNCTION "public"."telegram_channel_event_counts"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.telegram_poll_tick()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_secret text;
begin
  if not exists (select 1 from public.telegram_channels where active) then return; end if;
  select value into v_secret from public.intel_config where key = 'cron_secret';
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/whatsapp-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"telegram_poll": true}'::jsonb,
    timeout_milliseconds := 5000);
end $function$;

REVOKE ALL ON FUNCTION "public"."telegram_poll_tick"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.upsert_osm_waterways (
  p_rows jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_n integer;
begin
  insert into public.osm_waterways (way_id, kind, name, name_ar, name_en, name_he, geom, synced_at)
  select r.way_id, r.kind, r.name, nullif(r.name_ar, ''), nullif(r.name_en, ''), nullif(r.name_he, ''),
         extensions.st_setsrid(extensions.st_geomfromgeojson(r.geometry::text), 4326), now()
  from jsonb_to_recordset(p_rows) as r(way_id bigint, kind text, name text, name_ar text, name_en text, name_he text, geometry jsonb)
  where r.way_id is not null and coalesce(r.name, '') <> ''
  on conflict (way_id) do update set kind = excluded.kind, name = excluded.name, name_ar = excluded.name_ar,
    name_en = excluded.name_en, name_he = excluded.name_he, geom = excluded.geom, synced_at = excluded.synced_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."upsert_osm_waterways"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.use_feature (
  p_key text
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select public.consume_feature(auth.uid(), p_key);
$function$;

REVOKE ALL ON FUNCTION "public"."use_feature"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.use_search_quota (
  p_query text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_day   date := (now() at time zone 'Asia/Jerusalem')::date;
  v_q     text := lower(btrim(coalesce(p_query, '')));
  v_used  integer;
  v_limit constant integer := 3;
begin
  if v_uid is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_uid and status = 'active';
  if v_role is null then raise exception 'Not a member.' using errcode = '42501'; end if;
  if v_role = 'super_admin' then return jsonb_build_object('ok', true, 'unlimited', true); end if;
  if v_q = '' then return jsonb_build_object('ok', true, 'remaining', null); end if;
  select count(distinct query) into v_used from public.search_quota_log where user_id = v_uid and day = v_day;
  if exists (select 1 from public.search_quota_log where user_id = v_uid and day = v_day and query = left(v_q, 120)) then
    return jsonb_build_object('ok', true, 'remaining', greatest(v_limit - v_used, 0), 'limit', v_limit);
  end if;
  if v_used >= v_limit then
    return jsonb_build_object('ok', false, 'remaining', 0, 'limit', v_limit);
  end if;
  insert into public.search_quota_log (user_id, day, query) values (v_uid, v_day, left(v_q, 120));
  return jsonb_build_object('ok', true, 'remaining', v_limit - v_used - 1, 'limit', v_limit);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."use_search_quota"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.wadi_lines_geojson()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', extensions.st_asgeojson(extensions.st_simplify(l.geom, 0.0002), 5)::jsonb,
    'properties', jsonb_build_object('id', l.id, 'kind', l.kind, 'name', l.name, 'ar', l.name_ar, 'en', l.name_en,
                                     'he', l.name_he, 'ai', l.he_from_ai, 'km', l.length_km)
  )), '[]'::jsonb))
  from public.wadi_lines l
  where (select public.is_member())
$function$;

REVOKE ALL ON FUNCTION "public"."wadi_lines_geojson"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.wadi_lines_missing_hebrew (
  p_limit integer DEFAULT 120
)
  RETURNS TABLE (
    id      bigint,
    name_ar text,
    name    text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select l.id, l.name_ar, coalesce(l.name_en, l.name) from public.wadi_lines l
  where l.name_he is null order by (extensions.st_y(extensions.st_centroid(l.geom)) < 33.62) desc, l.length_km desc nulls last, l.id limit p_limit
$function$;

REVOKE ALL ON FUNCTION "public"."wadi_lines_missing_hebrew"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.write_audit (
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata, ip_address)
  values (
    case when exists (select 1 from public.profiles where id = v_actor) then v_actor else null end,
    p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb), public.request_ip()
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."write_audit"(text, text, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."administrator_invitations"
  ADD CONSTRAINT "administrator_invitations_message_check" CHECK ((char_length(message) <= 1000));

ALTER TABLE "public"."ai_usage"
  ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."ais_crossings"
  ADD CONSTRAINT "ais_crossings_gate_fkey" FOREIGN KEY (gate) REFERENCES public.ais_gates(id);

ALTER TABLE "public"."api_keys"
  ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."api_keys"
  ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."api_keys"
  ADD CONSTRAINT "api_keys_tier_fkey" FOREIGN KEY (tier) REFERENCES public.api_tiers(id);

ALTER TABLE "public"."api_usage"
  ADD CONSTRAINT "api_usage_key_id_fkey" FOREIGN KEY (key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;

ALTER TABLE "public"."api_usage_minute"
  ADD CONSTRAINT "api_usage_minute_key_id_fkey" FOREIGN KEY (key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_media"
  ADD CONSTRAINT "event_media_thumb_id_fkey" FOREIGN KEY (thumb_id) REFERENCES public.event_media(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_address_check" CHECK ((char_length(address) <= 300));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_ai_suggestions_check" CHECK ((jsonb_typeof(ai_suggestions) = 'object'::text));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.event_categories(id) ON DELETE RESTRICT;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_city_check" CHECK ((char_length(city) <= 100));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_classification_confidence_check" CHECK (((classification_confidence >= (0)::numeric) AND (classification_confidence <= (1)::numeric)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_country_check" CHECK ((char_length(country) <= 100));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_geocoding_confidence_check" CHECK (((geocoding_confidence >= (0)::numeric) AND (geocoding_confidence <= (1)::numeric)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_latitude_check" CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_location_name_check" CHECK ((char_length(location_name) <= 200));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_location_name_en_check" CHECK ((char_length(location_name_en) <= 200));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_location_name_he_check" CHECK ((char_length(location_name_he) <= 200));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_location_precision_check" CHECK ((location_precision = ANY (ARRAY['exact'::text, 'city'::text, 'region'::text, 'country'::text])));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_locations_is_array" CHECK (((jsonb_typeof(locations) = 'array'::text) AND (jsonb_array_length(locations) <= 30)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_longitude_check" CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_not_own_duplicate" CHECK (((duplicate_of_event_id IS NULL) OR (duplicate_of_event_id <> id)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_occurred_at_sane" CHECK (((occurred_at > '1990-01-01 00:00:00+00'::timestamp with time zone) AND (occurred_at < (now() + '1 day'::interval))));

ALTER TABLE "public"."category_corrections"
  ADD CONSTRAINT "category_corrections_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."event_history"
  ADD CONSTRAINT "event_history_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_internal_notes"
  ADD CONSTRAINT "event_internal_notes_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_media"
  ADD CONSTRAINT "event_media_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_duplicate_of_event_id_fkey" FOREIGN KEY (duplicate_of_event_id) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_publish_requirements" CHECK (((status <> 'published'::public.event_status) OR ((category_id IS NOT NULL) AND (char_length(btrim(title)) > 0))));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_region_check" CHECK ((char_length(region) <= 100));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_rejection_reason_check" CHECK ((char_length(rejection_reason) <= 1000));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_rejection_reason_required" CHECK (((status <> 'rejected'::public.event_status) OR (char_length(btrim(COALESCE(rejection_reason, ''::text))) > 0)));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_source_name_check" CHECK ((char_length(source_name) <= 200));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_source_url_check" CHECK (((source_url IS NULL) OR ((char_length(source_url) <= 2048) AND (source_url ~* '^https?://[^\s<>"''`]+$'::text))));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_sources_check" CHECK ((jsonb_typeof(sources) = 'array'::text));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_suggested_category_id_fkey" FOREIGN KEY (suggested_category_id) REFERENCES public.event_categories(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_translations_check" CHECK ((jsonb_typeof(translations) = 'object'::text));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_whatsapp_text_check" CHECK ((char_length(whatsapp_text) <= 8000));

ALTER TABLE "public"."feature_usage"
  ADD CONSTRAINT "feature_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."geoloc_jobs"
  ADD CONSTRAINT "geoloc_jobs_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."geoloc_jobs"
  ADD CONSTRAINT "geoloc_jobs_media_id_fkey" FOREIGN KEY (media_id) REFERENCES public.event_media(id) ON DELETE SET NULL;

ALTER TABLE "public"."hfc_alerts"
  ADD CONSTRAINT "hfc_alerts_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."hfc_alerts"
  ADD CONSTRAINT "hfc_alerts_cluster_id_fkey" FOREIGN KEY (cluster_id) REFERENCES public.hfc_clusters(id) ON DELETE SET NULL;

ALTER TABLE "public"."hfc_clusters"
  ADD CONSTRAINT "hfc_clusters_merged_into_fkey" FOREIGN KEY (merged_into) REFERENCES public.hfc_clusters(id) ON DELETE SET NULL;

ALTER TABLE "public"."insight_alert_queue"
  ADD CONSTRAINT "insight_alert_queue_alert_id_fkey" FOREIGN KEY (alert_id) REFERENCES public.insight_alerts(id) ON DELETE CASCADE;

ALTER TABLE "public"."insight_alerts"
  ADD CONSTRAINT "insight_alerts_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.insight_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."insight_forecasts"
  ADD CONSTRAINT "insight_forecasts_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.insight_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."insight_lexicon"
  ADD CONSTRAINT "insight_lexicon_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.insight_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."insight_resolutions"
  ADD CONSTRAINT "insight_resolutions_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.insight_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."insight_resolutions"
  ADD CONSTRAINT "insight_resolutions_forecast_id_fkey" FOREIGN KEY (forecast_id) REFERENCES public.insight_forecasts(id) ON DELETE SET NULL;

ALTER TABLE "public"."insight_signals"
  ADD CONSTRAINT "insight_signals_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.insight_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."insight_signal_readings"
  ADD CONSTRAINT "insight_signal_readings_signal_id_fkey" FOREIGN KEY (signal_id) REFERENCES public.insight_signals(id) ON DELETE CASCADE;

ALTER TABLE "public"."intel_items"
  ADD CONSTRAINT "intel_items_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."intel_sources"
  ADD CONSTRAINT "intel_sources_agent_fkey" FOREIGN KEY (agent) REFERENCES public.intel_agents(agent) ON DELETE CASCADE;

ALTER TABLE "public"."intel_items"
  ADD CONSTRAINT "intel_items_source_id_fkey" FOREIGN KEY (source_id) REFERENCES public.intel_sources(id) ON DELETE SET NULL;

ALTER TABLE "public"."learned_places"
  ADD CONSTRAINT "learned_places_learned_from_fkey" FOREIGN KEY (learned_from) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."learned_terms"
  ADD CONSTRAINT "learned_terms_learned_from_fkey" FOREIGN KEY (learned_from) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."license_redemptions"
  ADD CONSTRAINT "license_redemptions_key_fkey" FOREIGN KEY (key) REFERENCES public.license_keys(key);

ALTER TABLE "public"."plan_features"
  ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_billing_period_check" CHECK ((billing_period = ANY (ARRAY['monthly'::text, 'yearly'::text])));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."administrator_invitations"
  ADD CONSTRAINT "administrator_invitations_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."category_corrections"
  ADD CONSTRAINT "category_corrections_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."event_history"
  ADD CONSTRAINT "event_history_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."event_internal_notes"
  ADD CONSTRAINT "event_internal_notes_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_review_requested_by_fkey" FOREIGN KEY (review_requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."geoloc_jobs"
  ADD CONSTRAINT "geoloc_jobs_released_by_fkey" FOREIGN KEY (released_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."geoloc_jobs"
  ADD CONSTRAINT "geoloc_jobs_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."insight_resolutions"
  ADD CONSTRAINT "insight_resolutions_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."learned_places"
  ADD CONSTRAINT "learned_places_learned_by_fkey" FOREIGN KEY (learned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_plan_check" CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'max'::text, 'intel'::text])));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_plan_source_check" CHECK ((plan_source = ANY (ARRAY['default'::text, 'eval'::text, 'paid'::text])));

ALTER TABLE "public"."severity_corrections"
  ADD CONSTRAINT "severity_corrections_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."social_results"
  ADD CONSTRAINT "social_results_search_id_fkey" FOREIGN KEY (search_id) REFERENCES public.social_searches(id) ON DELETE CASCADE;

ALTER TABLE "public"."social_searches"
  ADD CONSTRAINT "social_searches_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."terms_acceptances"
  ADD CONSTRAINT "terms_acceptances_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_sessions"
  ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_ingest_log"
  ADD CONSTRAINT "whatsapp_ingest_log_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id);

CREATE VIEW "public"."active_hfc_alerts" WITH (security_barrier=true, security_invoker=true) AS  SELECT id,
    threat,
    started_at,
    last_alert_at,
    expires_at,
    areas,
    areas_en,
    zones_he,
    zones_en,
    alert_count,
    geojson,
    center_lat,
    center_lng,
    area_points
   FROM public.hfc_clusters
  WHERE ((merged_into IS NULL) AND (expires_at > now()));

CREATE VIEW "public"."ai_usage_daily" WITH (security_invoker=true) AS  SELECT ((at AT TIME ZONE 'Asia/Jerusalem'::text))::date AS day,
    fn,
    purpose,
    model,
    count(*) AS calls,
    sum(input_tokens) AS input_tokens,
    sum(output_tokens) AS output_tokens,
    sum(cache_read) AS cache_read,
    sum(cache_write) AS cache_write,
    sum(web_searches) AS web_searches,
    round(sum(cost_usd), 4) AS cost_usd
   FROM public.ai_usage
  GROUP BY (((at AT TIME ZONE 'Asia/Jerusalem'::text))::date), fn, purpose, model;

CREATE VIEW "public"."archived_events" AS  SELECT e.id,
    e.title,
    e.description,
    e.severity,
    e.latitude,
    e.longitude,
    e.location_name,
    e.country,
    e.region,
    e.city,
    e.source_name,
    e.source_url,
    e.source_type,
    e.occurred_at,
    e.published_at,
    e.updated_at,
    e.is_breaking,
    e.is_verified,
    ((((((e.translations #- '{he,details}'::text[]) #- '{he,religious}'::text[]) #- '{he,implications}'::text[]) #- '{en,details}'::text[]) #- '{en,religious}'::text[]) #- '{en,implications}'::text[]) AS translations,
    e.category_id,
    c.slug AS category_slug,
    c.name AS category_name,
    c.icon AS category_icon,
    c.color AS category_color,
    c.marker_color AS category_marker_color,
    e.location_precision,
    e.expired_at,
    e.sources,
    e.locations,
    e.location_name_he,
    e.location_name_en,
    public.event_media_kinds(e.id) AS media_kinds,
    COALESCE((e.ai_suggestions ->> 'split_from'::text),
        CASE
            WHEN (jsonb_typeof((e.ai_suggestions -> 'split_into'::text)) = 'array'::text) THEN (e.id)::text
            ELSE NULL::text
        END) AS report_group
   FROM (public.events e
     LEFT JOIN public.event_categories c ON (((c.id = e.category_id) AND c.is_active)))
  WHERE ((e.status = 'archived'::public.event_status) AND (e.expired_at IS NOT NULL) AND (e.deleted_at IS NULL) AND ( SELECT public.is_member() AS is_member) AND ((( SELECT public.my_archive_days() AS d) IS NULL) OR (e.occurred_at > (now() - make_interval(days => ( SELECT public.my_archive_days() AS d))))));

REVOKE ALL ON TABLE "public"."archived_events" FROM "anon";

CREATE VIEW "public"."published_events" AS  SELECT e.id,
    e.title,
    e.description,
    e.severity,
    e.latitude,
    e.longitude,
    e.location_name,
    e.country,
    e.region,
    e.city,
    e.source_name,
    e.source_url,
    e.source_type,
    e.occurred_at,
    e.published_at,
    e.updated_at,
    e.is_breaking,
    e.is_verified,
    ((((((e.translations #- '{he,details}'::text[]) #- '{he,religious}'::text[]) #- '{he,implications}'::text[]) #- '{en,details}'::text[]) #- '{en,religious}'::text[]) #- '{en,implications}'::text[]) AS translations,
    e.category_id,
    c.slug AS category_slug,
    c.name AS category_name,
    c.icon AS category_icon,
    c.color AS category_color,
    c.marker_color AS category_marker_color,
    e.location_precision,
    e.sources,
    e.locations,
    e.location_name_he,
    e.location_name_en,
    public.event_media_kinds(e.id) AS media_kinds,
    COALESCE((e.ai_suggestions ->> 'split_from'::text),
        CASE
            WHEN (jsonb_typeof((e.ai_suggestions -> 'split_into'::text)) = 'array'::text) THEN (e.id)::text
            ELSE NULL::text
        END) AS report_group
   FROM (public.events e
     LEFT JOIN public.event_categories c ON (((c.id = e.category_id) AND c.is_active)))
  WHERE ((e.status = 'published'::public.event_status) AND (e.deleted_at IS NULL) AND (cardinality(e.hfc_areas) = 0) AND (( SELECT public.is_member() AS is_member) OR (e.occurred_at > (now() - '24:00:00'::interval))));

CREATE INDEX ai_search_log_user_at ON public.ai_search_log USING btree (user_id, at DESC);

CREATE INDEX ai_usage_at_idx ON public.ai_usage USING btree (at DESC);

CREATE INDEX ai_usage_user_at ON public.ai_usage USING btree (user_id, at)
  WHERE (user_id IS NOT NULL);

CREATE INDEX ais_crossings_at_idx ON public.ais_crossings USING btree (at);

CREATE INDEX ais_crossings_gate_at_idx ON public.ais_crossings USING btree (gate, at DESC);

CREATE INDEX ais_crossings_mmsi_idx ON public.ais_crossings USING btree (mmsi, gate, at DESC);

CREATE INDEX ais_vessels_pos_idx ON public.ais_vessels USING btree (lat, lng);

CREATE INDEX ais_vessels_updated_idx ON public.ais_vessels USING btree (updated_at DESC);

CREATE INDEX audit_logs_created_idx ON public.audit_logs USING btree (created_at DESC);

CREATE INDEX audit_logs_entity_idx ON public.audit_logs USING btree (entity_type, entity_id);

CREATE INDEX audit_logs_user_idx ON public.audit_logs USING btree (user_id, created_at DESC);

CREATE INDEX category_corrections_created_idx ON public.category_corrections USING btree (created_at DESC);

CREATE INDEX control_areas_region_idx ON public.control_areas USING btree (region);

CREATE INDEX event_history_event_idx ON public.event_history USING btree (event_id, created_at DESC);

CREATE INDEX event_media_event_idx ON public.event_media USING btree (event_id);

CREATE INDEX event_media_event_sha_idx ON public.event_media USING btree (event_id, sha256);

CREATE INDEX event_media_thumb_idx ON public.event_media USING btree (thumb_id)
  WHERE (thumb_id IS NOT NULL);

CREATE INDEX event_media_video_fifo_idx ON public.event_media USING btree (created_at)
  WHERE (kind = 'video'::text);

CREATE INDEX events_archive_idx ON public.events USING btree (occurred_at DESC)
  WHERE ((status = 'archived'::public.event_status) AND (expired_at IS NOT NULL));

CREATE INDEX events_category_idx ON public.events USING btree (category_id);

CREATE INDEX events_created_by_idx ON public.events USING btree (created_by);

CREATE INDEX events_expiry_idx ON public.events USING btree (occurred_at)
  WHERE ((status = 'published'::public.event_status) AND (deleted_at IS NULL));

CREATE INDEX events_location_idx ON public.events USING btree (latitude, longitude)
  WHERE (latitude IS NOT NULL);

CREATE INDEX events_public_feed_idx ON public.events USING btree (occurred_at DESC)
  WHERE ((status = 'published'::public.event_status) AND (deleted_at IS NULL));

CREATE INDEX events_review_requested_idx ON public.events USING btree (review_requested_at)
  WHERE (review_requested_at IS NOT NULL);

CREATE INDEX events_source_url_idx ON public.events USING btree (source_url)
  WHERE (source_url IS NOT NULL);

CREATE INDEX events_status_idx ON public.events USING btree (status, updated_at DESC);

CREATE INDEX geo_places_geom_gist ON public.geo_places USING gist (geom);

CREATE INDEX geo_places_lb_no_he_idx ON public.geo_places USING btree (geonameid)
  WHERE ((country_code = 'LB'::text) AND (name_he IS NULL));

CREATE INDEX geo_places_names_gin ON public.geo_places USING gin (names);

CREATE INDEX geoloc_jobs_event_idx ON public.geoloc_jobs USING btree (event_id);

CREATE UNIQUE INDEX geoloc_jobs_event_media_uq ON public.geoloc_jobs USING btree (event_id, media_id)
  WHERE (media_id IS NOT NULL);

CREATE INDEX geoloc_jobs_queue_idx ON public.geoloc_jobs USING btree (created_at)
  WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX hfc_alerts_cluster_idx ON public.hfc_alerts USING btree (cluster_id);

CREATE INDEX hfc_alerts_time_idx ON public.hfc_alerts USING btree (alerted_at DESC);

CREATE INDEX hfc_areas_geom_idx ON public.hfc_areas USING gist (geom);

CREATE INDEX hfc_clusters_active_idx ON public.hfc_clusters USING btree (expires_at)
  WHERE (merged_into IS NULL);

CREATE INDEX hfc_clusters_threat_idx ON public.hfc_clusters USING btree (threat, last_alert_at DESC)
  WHERE (merged_into IS NULL);

CREATE INDEX insight_alerts_event ON public.insight_alerts USING btree (event_id)
  WHERE enabled;

CREATE INDEX insight_forecasts_event_ts ON public.insight_forecasts USING btree (event_id, ts DESC);

CREATE INDEX insight_signal_readings_signal_ts ON public.insight_signal_readings USING btree (signal_id, ts DESC);

CREATE INDEX intel_items_created_idx ON public.intel_items USING btree (created_at DESC);

CREATE INDEX intel_sources_agent_idx ON public.intel_sources USING btree (agent)
  WHERE active;

CREATE UNIQUE INDEX invitations_one_pending_per_email ON public.administrator_invitations USING btree (lower(email))
  WHERE (status = 'pending'::public.invitation_status);

CREATE UNIQUE INDEX invitations_token_key ON public.administrator_invitations USING btree (token);

CREATE UNIQUE INDEX learned_terms_term_idx ON public.learned_terms USING btree (lower(btrim(term)));

CREATE INDEX license_attempts_user ON public.license_attempts USING btree (user_id, at DESC);

CREATE INDEX plan_audit_at ON public.plan_audit USING btree (at DESC);

CREATE UNIQUE INDEX profiles_email_lower_key ON public.profiles USING btree (lower(email));

CREATE INDEX profiles_role_status_idx ON public.profiles USING btree (ROLE, status);

CREATE INDEX search_quota_log_user_day ON public.search_quota_log USING btree (user_id, day);

CREATE INDEX social_searches_area ON public.social_searches USING btree (scheduled_area, created_at DESC)
  WHERE (scheduled_area IS NOT NULL);

CREATE INDEX social_searches_cache ON public.social_searches USING btree (cache_key, created_at DESC);

CREATE INDEX social_searches_user_at ON public.social_searches USING btree (user_id, created_at DESC);

CREATE INDEX translation_log_at_idx ON public.translation_log USING btree (at DESC);

CREATE INDEX user_sessions_user ON public.user_sessions USING btree (user_id, last_seen DESC);

CREATE INDEX wadi_lines_geom_gist ON public.wadi_lines USING gist (geom);

CREATE INDEX whatsapp_ingest_log_pending_idx ON public.whatsapp_ingest_log USING btree (sent_at)
  WHERE (decision = 'pending'::text);

CREATE INDEX whatsapp_ingest_log_sent_at_idx ON public.whatsapp_ingest_log USING btree (sent_at DESC);

CREATE INDEX whatsapp_ingest_log_text_md5 ON public.whatsapp_ingest_log USING btree (md5(message_text));

CREATE INDEX whatsapp_ingest_log_tg_group ON public.whatsapp_ingest_log USING btree (tg_group)
  WHERE (tg_group IS NOT NULL);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_updated();

CREATE TRIGGER invitations_after_change
  AFTER INSERT OR UPDATE ON public.administrator_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.invitations_after_change();

CREATE TRIGGER invitations_before_insert
  BEFORE INSERT ON public.administrator_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.invitations_before_insert();

CREATE TRIGGER invitations_before_update
  BEFORE UPDATE ON public.administrator_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.invitations_before_update();

CREATE TRIGGER app_settings_stamp
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.app_settings_stamp();

CREATE TRIGGER event_internal_notes_stamp
  BEFORE INSERT OR UPDATE ON public.event_internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.event_internal_notes_stamp();

CREATE TRIGGER event_internal_notes_touch
  BEFORE INSERT OR UPDATE ON public.event_internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER event_media_geoloc_enqueue
  AFTER INSERT ON public.event_media
  FOR EACH ROW
  EXECUTE FUNCTION public.geoloc_enqueue_media();

CREATE TRIGGER events_a_resolve_location
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_resolve_location();

CREATE TRIGGER events_aa_editor_review
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_editor_review();

CREATE TRIGGER events_after_change
  AFTER INSERT OR DELETE OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_after_change();

CREATE TRIGGER events_auto_verify
  BEFORE INSERT OR UPDATE OF sources, source_name, source_url ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_auto_verify();

CREATE TRIGGER events_b_lifecycle
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_lifecycle();

CREATE TRIGGER events_before_insert
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_before_insert();

CREATE TRIGGER events_before_update
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_before_update();

CREATE TRIGGER events_learn_from_correction
  AFTER UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_learn_from_correction();

CREATE TRIGGER events_send_to_editor
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_send_to_editor();

CREATE TRIGGER events_z_hfc_alert
  AFTER INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_hfc_alert();

CREATE TRIGGER events_zz_promote_listed_place
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_listed_place();

CREATE TRIGGER events_zz_pulse
  AFTER INSERT OR DELETE OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_bump_pulse();

CREATE TRIGGER events_zzz_learned_place
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_apply_learned_place();

CREATE TRIGGER events_zzzz_no_map
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_no_map();

CREATE TRIGGER events_zzzzz_hfc_wave_no_areas
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.hfc_wave_events_no_areas();

CREATE TRIGGER hfc_alerts_to_event
  AFTER INSERT ON public.hfc_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.hfc_alerts_to_event_trg();

CREATE TRIGGER insight_alerts_guard
  BEFORE INSERT OR UPDATE ON public.insight_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.insight_alerts_guard();

CREATE TRIGGER insight_events_manual
  AFTER INSERT ON public.insight_events
  FOR EACH ROW
  EXECUTE FUNCTION public.insight_events_add_manual();

CREATE TRIGGER insight_events_updated_at
  BEFORE UPDATE ON public.insight_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER insight_signals_updated_at
  BEFORE UPDATE ON public.insight_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER on_profile_active_notify
  AFTER INSERT OR UPDATE OF status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_signup();

CREATE TRIGGER profiles_after_delete
  AFTER DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_after_change();

CREATE TRIGGER profiles_after_update
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_after_change();

CREATE TRIGGER profiles_before_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_before_delete();

CREATE TRIGGER profiles_before_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_before_update();

CREATE TRIGGER profiles_plan_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_plan_guard();

CREATE POLICY "invitations: create" ON "public"."administrator_invitations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT public.has_permission('user.invite'::text) AS has_permission));

CREATE POLICY "invitations: read" ON "public"."administrator_invitations"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('user.invite'::text) AS has_permission));

CREATE POLICY "invitations: revoke" ON "public"."administrator_invitations"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT public.has_permission('user.invite'::text) AS has_permission))
  WITH CHECK (( SELECT public.has_permission('user.invite'::text) AS has_permission));

CREATE POLICY "ai usage: staff read" ON "public"."ai_usage"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('ai.usage.view'::text) AS has_permission));

CREATE POLICY "crossings: anyone reads" ON "public"."ais_crossings"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "gates: anyone reads" ON "public"."ais_gates"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "ais: anyone reads" ON "public"."ais_vessels"
  FOR SELECT
  TO "anon"
  USING (true);

CREATE POLICY "ais: members read" ON "public"."ais_vessels"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_member() AS is_member));

CREATE POLICY "api keys: super admin read" ON "public"."api_keys"
  FOR SELECT
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "api tiers: super admin" ON "public"."api_tiers"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "api usage: super admin read" ON "public"."api_usage"
  FOR SELECT
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "settings: anyone reads plan and terms switches" ON "public"."app_settings"
  FOR SELECT
  TO "anon"
  USING ((key = ANY (ARRAY['enforce_plans'::text, 'require_terms'::text, 'terms_version'::text, 'privacy_version'::text, 'ads_enabled'::text, 'ads_feed_every'::text])));

CREATE POLICY "settings: managers write" ON "public"."app_settings"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission))
  WITH CHECK (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "settings: members read ad switches" ON "public"."app_settings"
  FOR SELECT
  TO "authenticated"
  USING ((key = ANY (ARRAY['ads_enabled'::text, 'ads_feed_every'::text])));

CREATE POLICY "settings: members read plan and terms switches" ON "public"."app_settings"
  FOR SELECT
  TO "authenticated"
  USING (((key = ANY (ARRAY['enforce_plans'::text, 'require_terms'::text, 'terms_version'::text, 'privacy_version'::text])) AND ( SELECT public.is_member() AS is_member)));

CREATE POLICY "settings: staff read" ON "public"."app_settings"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "audit: read" ON "public"."audit_logs"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('audit.view'::text) AS has_permission));

CREATE POLICY "category corrections: managers delete" ON "public"."category_corrections"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "category corrections: staff read" ON "public"."category_corrections"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "control: anyone reads" ON "public"."control_areas"
  FOR SELECT
  TO "anon"
  USING (true);

CREATE POLICY "control: members read" ON "public"."control_areas"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_member() AS is_member));

CREATE POLICY "categories: managers delete" ON "public"."event_categories"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT public.has_permission('category.manage'::text) AS has_permission));

CREATE POLICY "categories: managers insert" ON "public"."event_categories"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT public.has_permission('category.manage'::text) AS has_permission));

CREATE POLICY "categories: managers update" ON "public"."event_categories"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT public.has_permission('category.manage'::text) AS has_permission))
  WITH CHECK (( SELECT public.has_permission('category.manage'::text) AS has_permission));

CREATE POLICY "categories: public reads active" ON "public"."event_categories"
  FOR SELECT
  TO "anon"
  USING (is_active);

CREATE POLICY "categories: staff read" ON "public"."event_categories"
  FOR SELECT
  TO "authenticated"
  USING ((is_active OR ( SELECT public.has_permission('category.manage'::text) AS has_permission)));

CREATE POLICY "history: read" ON "public"."event_history"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT public.has_permission('event.view.internal'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_history.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.has_permission('event.edit.own'::text) AS has_permission))))));

CREATE POLICY "notes: read" ON "public"."event_internal_notes"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT public.has_permission('event.view.internal'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_internal_notes.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT public.has_permission('event.edit.own'::text) AS has_permission))))));

CREATE POLICY "notes: update" ON "public"."event_internal_notes"
  FOR UPDATE
  TO "authenticated"
  USING ((( SELECT public.has_permission('event.edit.any'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE
    ((e.id = event_internal_notes.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)) AND (e.status = ANY (ARRAY['draft'::public.event_status,
    'rejected'::public.event_status])) AND ( SELECT public.has_permission('event.edit.own'::text) AS has_permission))))))
  WITH CHECK ((( SELECT public.has_permission('event.edit.any'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE
    ((e.id = event_internal_notes.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)) AND (e.status = ANY (ARRAY['draft'::public.event_status,
    'rejected'::public.event_status])) AND ( SELECT public.has_permission('event.edit.own'::text) AS has_permission))))));

CREATE POLICY "notes: write" ON "public"."event_internal_notes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((( SELECT public.has_permission('event.edit.any'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE
    ((e.id = event_internal_notes.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)) AND (e.status = ANY (ARRAY['draft'::public.event_status,
    'rejected'::public.event_status])) AND ( SELECT public.has_permission('event.edit.own'::text) AS has_permission))))));

CREATE POLICY "event_media: public reads published" ON "public"."event_media"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((ready AND public.event_is_public(event_id) AND (( SELECT public.is_member() AS is_member) OR public.event_is_recent(event_id))));

CREATE POLICY "events: edit own drafts or any with permission" ON "public"."events"
  FOR UPDATE
  TO "authenticated"
  USING
    ((( SELECT public.has_permission('event.edit.any'::text) AS has_permission) OR ((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT
    public.has_permission('event.edit.own'::text) AS has_permission) AND (status = ANY (ARRAY['draft'::public.event_status, 'rejected'::public.event_status])) AND
    (deleted_at IS NULL))))
  WITH
    CHECK
    ((( SELECT public.has_permission('event.edit.any'::text) AS has_permission) OR ((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT
    public.has_permission('event.edit.own'::text) AS has_permission) AND (deleted_at IS NULL) AND
    ((status = ANY (ARRAY['draft'::public.event_status, 'pending_review'::public.event_status])) OR ((status = 'published'::public.event_status) AND ( SELECT
    public.has_permission('event.publish'::text) AS has_permission))))));

CREATE POLICY "events: permanent delete" ON "public"."events"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT public.has_permission('event.delete'::text) AS has_permission));

CREATE POLICY "events: public archive" ON "public"."events"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((status = 'archived'::public.event_status) AND (expired_at IS
    NOT NULL) AND (deleted_at IS NULL) AND ( SELECT public.has_permission('event.view.operational'::text) AS has_permission)));

CREATE POLICY "events: public reads published" ON "public"."events"
  FOR SELECT
  TO "anon"
  USING (false);

CREATE POLICY "events: reporters create" ON "public"."events"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    ((( SELECT public.has_permission('event.create'::text) AS has_permission) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((status = ANY (ARRAY['draft'::public.event_status,
    'pending_review'::public.event_status])) OR
    ((status = 'published'::public.event_status) AND ( SELECT public.can_publish_from('draft'::public.event_status) AS can_publish_from)))));

CREATE POLICY "events: staff read" ON "public"."events"
  FOR SELECT
  TO "authenticated"
  USING
    ((( SELECT public.has_permission('event.view.internal'::text) AS has_permission) OR ((deleted_at IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT
    public.has_permission('event.edit.own'::text) AS has_permission)) OR
    ((deleted_at IS NULL) AND (status <> 'draft'::public.event_status) AND ( SELECT public.has_permission('event.view.operational'::text) AS has_permission))));

CREATE POLICY "events pulse: public read" ON "public"."events_pulse"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "feature usage: own rows" ON "public"."feature_usage"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "geo places: staff read" ON "public"."geo_places"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "geoloc_jobs_staff_read" ON "public"."geoloc_jobs"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('event.edit.any'::text) AS has_permission));

CREATE POLICY "hfc alerts: staff read" ON "public"."hfc_alerts"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "hfc areas: staff read" ON "public"."hfc_areas"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "hfc clusters: anyone reads active" ON "public"."hfc_clusters"
  FOR SELECT
  TO "anon"
  USING (((merged_into IS NULL) AND (expires_at > (now() - '00:01:00'::interval))));

CREATE POLICY "hfc clusters: public active" ON "public"."hfc_clusters"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((merged_into IS NULL) AND (expires_at > (now() - '00:01:00'::interval))));

CREATE POLICY "hfc status: staff read" ON "public"."hfc_ingest_status"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "hfc pulse: public read" ON "public"."hfc_pulse"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "ofi: super admin" ON "public"."insight_events"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "ofi: super admin" ON "public"."insight_forecasts"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "ofi: super admin" ON "public"."insight_lexicon"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "ofi: super admin" ON "public"."insight_resolutions"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "ofi: super admin" ON "public"."insight_signal_readings"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "ofi: super admin" ON "public"."insight_signals"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "ofi: super admin" ON "public"."insight_source_cache"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "intel agents: staff read" ON "public"."intel_agents"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "intel items: staff read" ON "public"."intel_items"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "intel sources: managers delete" ON "public"."intel_sources"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "intel sources: managers insert" ON "public"."intel_sources"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "intel sources: managers update" ON "public"."intel_sources"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission))
  WITH CHECK (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "intel sources: staff read" ON "public"."intel_sources"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "layer sync: anyone reads" ON "public"."layer_sync"
  FOR SELECT
  TO "anon"
  USING (true);

CREATE POLICY "layer sync: members read" ON "public"."layer_sync"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_member() AS is_member));

CREATE POLICY "learned places: managers delete" ON "public"."learned_places"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "learned places: staff read" ON "public"."learned_places"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "learned terms: managers delete" ON "public"."learned_terms"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "learned terms: managers update" ON "public"."learned_terms"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission))
  WITH CHECK (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "learned terms: staff read" ON "public"."learned_terms"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "learned terms: staff write" ON "public"."learned_terms"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT (public.has_permission('settings.manage'::text) OR public.has_permission('event.edit.any'::text) OR public.has_permission('event.edit.own'::text))));

CREATE POLICY "sects: anyone reads" ON "public"."lebanon_sects"
  FOR SELECT
  TO "anon"
  USING (true);

CREATE POLICY "sects: members read" ON "public"."lebanon_sects"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_member() AS is_member));

CREATE POLICY "license keys: super admin reads" ON "public"."license_keys"
  FOR SELECT
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "license redemptions: super admin reads" ON "public"."license_redemptions"
  FOR SELECT
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "gazetteer: managers write" ON "public"."place_gazetteer"
  FOR ALL
  TO "authenticated"
  USING (( SELECT public.has_permission('category.manage'::text) AS has_permission))
  WITH CHECK (( SELECT public.has_permission('category.manage'::text) AS has_permission));

CREATE POLICY "gazetteer: staff read" ON "public"."place_gazetteer"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "plan audit: super admin reads" ON "public"."plan_audit"
  FOR SELECT
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "plan features: anyone reads" ON "public"."plan_features"
  FOR SELECT
  TO "anon"
  USING (true);

CREATE POLICY "plan features: members read" ON "public"."plan_features"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "plan features: super admin writes" ON "public"."plan_features"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "plans: anyone reads" ON "public"."plans"
  FOR SELECT
  TO "anon"
  USING (true);

CREATE POLICY "plans: members read" ON "public"."plans"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "plans: super admin writes" ON "public"."plans"
  FOR ALL
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "profiles: read own or managed" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING
    (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_permission('user.manage'::text) AS has_permission) OR ( SELECT public.has_permission('user.invite'::text) AS
    has_permission)));

CREATE POLICY "profiles: remove managed users" ON "public"."profiles"
  FOR DELETE
  TO "authenticated"
  USING ((( SELECT public.has_permission('user.manage'::text) AS has_permission) AND (id <> ( SELECT auth.uid() AS uid))));

CREATE POLICY "profiles: update own or managed" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_permission('user.manage'::text) AS has_permission)))
  WITH CHECK (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_permission('user.manage'::text) AS has_permission)));

CREATE POLICY "severity corrections: staff read" ON "public"."severity_corrections"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('event.view.internal'::text) AS has_permission));

CREATE POLICY "social results: own or staff" ON "public"."social_results"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.social_searches s
  WHERE ((s.id = social_results.search_id) AND ((s.user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role <> 'viewer'::public.app_role) AND (p.status = 'active'::public.user_status)))))))));

CREATE POLICY "social searches: own or staff" ON "public"."social_searches"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role <> 'viewer'::public.app_role) AND (p.status = 'active'::public.user_status))))));

CREATE POLICY "telegram channels: managers delete" ON "public"."telegram_channels"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "telegram channels: managers insert" ON "public"."telegram_channels"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "telegram channels: managers update" ON "public"."telegram_channels"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT public.has_permission('settings.manage'::text) AS has_permission))
  WITH CHECK (( SELECT public.has_permission('settings.manage'::text) AS has_permission));

CREATE POLICY "telegram channels: staff read" ON "public"."telegram_channels"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.has_permission('dashboard.view'::text) AS has_permission));

CREATE POLICY "terms: own rows read" ON "public"."terms_acceptances"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.is_super_admin()));

CREATE POLICY "sessions: own or admin read" ON "public"."user_sessions"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_permission('user.manage'::text) AS has_permission)));

CREATE POLICY "wadis: members read" ON "public"."wadi_lines"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_member() AS is_member));

CREATE POLICY "geoloc_proofs_read" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'geoloc-proofs'::text) AND ( SELECT public.geoloc_proof_allowed(objects.name) AS geoloc_proof_allowed)));

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."events_pulse";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."hfc_pulse";

COMMENT ON EXTENSION "fuzzystrmatch" IS 'determine similarities and distance between strings';

COMMENT ON EXTENSION "http" IS 'HTTP client for PostgreSQL, allows web page retrieval inside the database.';

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

COMMENT ON EXTENSION "pg_net" IS 'Async HTTP';

COMMENT ON EXTENSION "postgis" IS 'PostGIS geometry and geography spatial types and functions';

REVOKE ALL ON FUNCTION "public"."_plan_set"(uuid, text, text, timestamp WITH time zone, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_plan_set"(uuid, text, text, timestamp WITH time zone, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_plan_set"(uuid, text, text, timestamp WITH time zone, text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."accept_terms"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."accept_terms"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."accept_terms"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."accept_terms"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."active_hfc_shapes"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."active_hfc_shapes"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."active_hfc_shapes"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."active_hfc_shapes"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."active_hfc_shapes"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."add_event_place"(uuid, double precision, double precision, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_event_place"(uuid, double precision, double precision, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_event_place"(uuid, double precision, double precision, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_event_place"(uuid, double precision, double precision, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_create_license"(text, integer, text, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_create_license"(text, integer, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_create_license"(text, integer, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_create_license"(text, integer, text, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_delete_license"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_delete_license"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_delete_license"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_delete_license"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_extend_eval"(uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_extend_eval"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_extend_eval"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_extend_eval"(uuid, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_remove_plan"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_remove_plan"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_remove_plan"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_remove_plan"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_revoke_license"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_revoke_license"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_revoke_license"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_revoke_license"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_set_plan"(uuid, text, text, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_set_plan"(uuid, text, text, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_set_plan"(uuid, text, text, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_set_plan"(uuid, text, text, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ai_quota"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ai_quota"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ai_quota"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ai_search_candidates"(timestamp WITH time zone, timestamp WITH time zone, text[], text[], text[], text[], integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ai_search_candidates"(timestamp WITH time zone, timestamp WITH time zone, text[], text[], text[], text[], integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ai_search_candidates"(timestamp WITH time zone, timestamp WITH time zone, text[], text[], text[], text[], integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ais_gate_crossings"(double precision, double precision, double precision, double precision) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."ais_gate_crossings"(double precision, double precision, double precision, double precision) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ais_gate_crossings"(double precision, double precision, double precision, double precision) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ais_gate_crossings"(double precision, double precision, double precision, double precision) TO "service_role";

GRANT EXECUTE
  ON FUNCTION "public"."ais_side"(double precision, double precision, double precision, double precision, double precision, double precision)
  TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."ais_side"(double precision, double precision, double precision, double precision, double precision, double precision) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ais_side"(double precision, double precision, double precision, double precision, double precision, double precision) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ais_side"(double precision, double precision, double precision, double precision, double precision, double precision) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ais_upsert"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ais_upsert"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ais_upsert"(jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."api_create_key"(text, text, text, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."api_create_key"(text, text, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_create_key"(text, text, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_create_key"(text, text, text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."api_events"(text, timestamp WITH time zone, timestamp WITH time zone, text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."api_events"(text, timestamp WITH time zone, timestamp WITH time zone, text, text, integer) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."api_events"(text, timestamp WITH time zone, timestamp WITH time zone, text, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_events"(text, timestamp WITH time zone, timestamp WITH time zone, text, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_events"(text, timestamp WITH time zone, timestamp WITH time zone, text, text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."api_insights"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."api_insights"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."api_insights"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_insights"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_insights"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."api_revoke_key"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."api_revoke_key"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_revoke_key"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."api_revoke_key"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."app_settings_stamp"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."app_settings_stamp"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."app_settings_stamp"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."approve_event_review"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."approve_event_review"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."approve_event_review"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."approve_event_review"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."arabic_place_variants"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."arabic_place_variants"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."arabic_place_variants"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."arabic_place_variants"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."backfill_place_names"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."backfill_place_names"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."backfill_place_names"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."build_wadi_lines"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."build_wadi_lines"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."build_wadi_lines"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_geolocate"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."can_geolocate"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."can_geolocate"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_geolocate"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_geolocate"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_publish_from"(public.event_status) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."can_publish_from"(public.event_status) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_publish_from"(public.event_status) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_publish_from"(public.event_status) TO "service_role";

REVOKE ALL ON FUNCTION "public"."chokepoint_stats"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."chokepoint_stats"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."chokepoint_stats"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."chokepoint_stats"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."chokepoint_stats"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."cleanup_auto_drafts"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cleanup_auto_drafts"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cleanup_auto_drafts"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."consume_feature"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."consume_feature"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."consume_feature"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."country_iso"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."country_iso"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."country_iso"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."country_iso"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."edit_event_text"(uuid, text, text, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."edit_event_text"(uuid, text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."edit_event_text"(uuid, text, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."edit_event_text"(uuid, text, text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_internal_notes_stamp"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_internal_notes_stamp"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_internal_notes_stamp"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_is_public"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."event_is_public"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."event_is_public"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_is_public"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_is_public"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."event_is_recent"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."event_is_recent"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_is_recent"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_is_recent"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_media_kinds"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."event_media_kinds"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."event_media_kinds"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_media_kinds"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_media_kinds"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."event_source_text"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."event_source_text"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_source_text"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."event_source_text"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_after_change"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_after_change"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_after_change"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_apply_learned_place"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_apply_learned_place"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_apply_learned_place"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_auto_verify"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_auto_verify"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_auto_verify"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_before_insert"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_before_insert"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_before_insert"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_before_update"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_before_update"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_before_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_bump_pulse"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_bump_pulse"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_bump_pulse"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_editor_review"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_editor_review"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_editor_review"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_hfc_alert"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_hfc_alert"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_hfc_alert"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_learn_from_correction"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_learn_from_correction"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_learn_from_correction"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_lifecycle"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_lifecycle"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_lifecycle"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."events_no_map"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."events_no_map"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_no_map"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_no_map"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_resolve_location"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_resolve_location"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_resolve_location"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."events_send_to_editor"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_send_to_editor"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."events_send_to_editor"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_events"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_events"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_events"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_plans"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_plans"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_plans"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."foreign_share"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."foreign_share"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."foreign_share"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."foreign_share"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."gaza_strip"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."gaza_strip"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."gaza_strip"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."gaza_strip"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."generate_invite_token"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."generate_invite_token"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."generate_invite_token"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."geo_lookup"(text, text, double precision, double precision) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."geo_lookup"(text, text, double precision, double precision) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geo_lookup"(text, text, double precision, double precision) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geo_lookup"(text, text, double precision, double precision) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."geo_nearest_place"(double precision, double precision) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."geo_nearest_place"(double precision, double precision) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geo_nearest_place"(double precision, double precision) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geo_nearest_place"(double precision, double precision) TO "service_role";

REVOKE ALL ON FUNCTION "public"."geoloc_claim"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_claim"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_claim"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."geoloc_enqueue_media"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."geoloc_enqueue_media"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_enqueue_media"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_enqueue_media"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."geoloc_finish"(uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_finish"(uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_finish"(uuid, text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."geoloc_for_event"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."geoloc_for_event"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_for_event"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_for_event"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."geoloc_proof_allowed"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."geoloc_proof_allowed"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_proof_allowed"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_proof_allowed"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."geoloc_review"(uuid, boolean, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."geoloc_review"(uuid, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_review"(uuid, boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."geoloc_review"(uuid, boolean, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_auth_user_updated"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_auth_user_updated"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_auth_user_updated"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_auth_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_auth_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."has_hebrew"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."has_hebrew"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_hebrew"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_hebrew"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."has_permission"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."has_permission"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_permission"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_permission"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_alert_to_event"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_alert_to_event"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_alert_to_event"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."hfc_alerts_to_event_trg"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."hfc_alerts_to_event_trg"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_alerts_to_event_trg"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_alerts_to_event_trg"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_guess_threat"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_guess_threat"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_guess_threat"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_ingest_batch"(text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_ingest_batch"(text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_ingest_batch"(text, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_ingest_report"(text, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_ingest_report"(text, boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_ingest_report"(text, boolean, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_match_areas"(text, text, numeric, numeric, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_match_areas"(text, text, numeric, numeric, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_match_areas"(text, text, numeric, numeric, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_record_alert"(text, integer, timestamp WITH time zone, boolean, text, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_refresh_cluster"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_refresh_cluster"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_refresh_cluster"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_ring_to_geom"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_ring_to_geom"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_ring_to_geom"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_split_cluster"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_split_cluster"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_split_cluster"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_sync_areas"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_sync_areas"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_sync_areas"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_threat_label"(integer, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_threat_label"(integer, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_threat_label"(integer, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."hfc_wave_events_no_areas"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."hfc_wave_events_no_areas"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_wave_events_no_areas"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_wave_events_no_areas"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."hfc_wave_refresh"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_wave_refresh"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."hfc_wave_refresh"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."import_staged_geonames"(text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."import_staged_geonames"(text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."import_staged_geonames"(text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ingest_cached_decision"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ingest_cached_decision"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ingest_cached_decision"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."insight_alerts_guard"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."insight_alerts_guard"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."insight_alerts_guard"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."insight_events_add_manual"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."insight_events_add_manual"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."insight_events_add_manual"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."intel_crawler_tick"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."intel_crawler_tick"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."intel_crawler_tick"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."invitations_after_change"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."invitations_after_change"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."invitations_after_change"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."invitations_before_insert"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."invitations_before_insert"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."invitations_before_insert"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."invitations_before_update"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."invitations_before_update"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."invitations_before_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_member"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_member"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."is_member"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_member"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_member"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_specific_place"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_specific_place"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_specific_place"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_specific_place"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_valid_event_transition"(public.event_status, public.event_status) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."is_valid_event_transition"(public.event_status, public.event_status) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_valid_event_transition"(public.event_status, public.event_status) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_valid_event_transition"(public.event_status, public.event_status) TO "service_role";

REVOKE ALL ON FUNCTION "public"."learn_places"(jsonb, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."learn_places"(jsonb, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."learn_places"(jsonb, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."learn_places_queue"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."learn_places_queue"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."learn_places_queue"(integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."learn_term"(text, text, text, text[], uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."learn_term"(text, text, text, text[], uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."learn_term"(text, text, text, text[], uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."learn_term"(text, text, text, text[], uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."learned_place"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."learned_place"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."learned_place"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."learned_place"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."lebanon_missing_hebrew"(text, integer, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."lebanon_missing_hebrew"(text, integer, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."lebanon_missing_hebrew"(text, integer, integer, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."load_geo_places"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."load_geo_places"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."load_geo_places"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."load_geo_places_file"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."load_geo_places_file"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."load_geo_places_file"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."load_geo_places_tsv"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."load_geo_places_tsv"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."load_geo_places_tsv"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."lookup_place"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."lookup_place"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."lookup_place"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."lookup_place"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mainstream_outlet"(text, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."mainstream_outlet"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mainstream_outlet"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mainstream_outlet"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."media_storage_usage"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."media_storage_usage"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."media_storage_usage"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."move_event_pin"(uuid, double precision, double precision, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."move_event_pin"(uuid, double precision, double precision, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."move_event_pin"(uuid, double precision, double precision, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."move_event_pin"(uuid, double precision, double precision, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."move_event_place"(uuid, integer, double precision, double precision) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."move_event_place"(uuid, integer, double precision, double precision) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."move_event_place"(uuid, integer, double precision, double precision) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."move_event_place"(uuid, integer, double precision, double precision) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."my_ai_quota"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."my_ai_quota"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_ai_quota"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_ai_quota"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."my_archive_days"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."my_archive_days"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."my_archive_days"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_archive_days"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_archive_days"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."my_feature_usage"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."my_feature_usage"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_feature_usage"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_feature_usage"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."my_permissions"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."my_permissions"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_permissions"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_permissions"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."normalize_place"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."normalize_place"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_place"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_place"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."normalize_places"(text[]) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."normalize_places"(text[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_places"(text[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_places"(text[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."normalize_report_text"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."normalize_report_text"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_report_text"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_report_text"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."notify_signup"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."notify_signup"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."notify_signup"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ofi_admin_manual"(text, integer, text, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ofi_admin_manual"(text, integer, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_admin_manual"(text, integer, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_admin_manual"(text, integer, text, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ofi_admin_resolve"(text, timestamp WITH time zone, boolean, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ofi_admin_resolve"(text, timestamp WITH time zone, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_admin_resolve"(text, timestamp WITH time zone, boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_admin_resolve"(text, timestamp WITH time zone, boolean, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ofi_detail"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ofi_detail"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_detail"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_detail"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ofi_event_id"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ofi_event_id"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_event_id"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_event_id"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ofi_internal_stats"(uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_internal_stats"(uuid, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_internal_stats"(uuid, timestamp WITH time zone) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ofi_list"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ofi_list"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_list"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_list"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."ofi_queue_alerts"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_queue_alerts"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_queue_alerts"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ofi_tick"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_tick"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_tick"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ofi_tier"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ofi_tier"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_tier"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_tier"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."ofi_tier_of"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_tier_of"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_tier_of"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."ofi_track_record"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ofi_track_record"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_track_record"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ofi_track_record"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."password_changed"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."password_changed"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."password_changed"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."password_changed"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."place_jitter"(uuid, text, integer) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."place_jitter"(uuid, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."place_jitter"(uuid, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."place_jitter"(uuid, text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."places_in_polygon"(jsonb, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."places_in_polygon"(jsonb, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."places_in_polygon"(jsonb, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."profiles_after_change"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_after_change"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_after_change"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."profiles_before_delete"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_before_delete"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_before_delete"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."profiles_before_update"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_before_update"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_before_update"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."profiles_plan_guard"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."profiles_plan_guard"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_plan_guard"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."profiles_plan_guard"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."promote_listed_place"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."promote_listed_place"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."promote_listed_place"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."promote_listed_place"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."push_set_min_severity"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."push_set_min_severity"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."push_set_min_severity"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."push_set_min_severity"(text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."push_subscribe"(text, text, text, jsonb, text[], text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."push_subscribe"(text, text, text, jsonb, text[], text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."push_subscribe"(text, text, text, jsonb, text[], text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."push_subscribe"(text, text, text, jsonb, text[], text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."record_login"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."record_login"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_login"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_login"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."redeem_license"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."redeem_license"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."redeem_license"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."redeem_license"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."refine_apply"(uuid, jsonb, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."refine_apply"(uuid, jsonb, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."refine_apply"(uuid, jsonb, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."refine_event_candidates"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."refine_event_candidates"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."refine_event_candidates"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."refine_event_locations"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."refine_event_locations"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."refine_event_locations"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."refund_feature"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."refund_feature"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."refund_feature"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."register_session"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."register_session"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."register_session"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."register_session"(text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."remove_event_pin"(uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."remove_event_pin"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."remove_event_pin"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."remove_event_pin"(uuid, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."request_geolocation"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."request_geolocation"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_geolocation"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_geolocation"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."request_ip"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."request_ip"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_ip"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_ip"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_event_locations"(jsonb, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_event_locations"(jsonb, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_event_locations"(jsonb, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_event_place"(text, text, text, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."resolve_event_place"(text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_event_place"(text, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_event_place"(text, text, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."role_permissions"(public.app_role) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."role_permissions"(public.app_role) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."role_permissions"(public.app_role) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."role_permissions"(public.app_role) TO "service_role";

REVOKE ALL ON FUNCTION "public"."run_osm_merge"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."run_osm_merge"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."run_osm_merge"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."session_active"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."session_active"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."session_active"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."session_active"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_event_category"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_event_category"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_event_category"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_event_category"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_event_severity"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_event_severity"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_event_severity"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_event_severity"(uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_hebrew_place_names"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_hebrew_place_names"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_hebrew_place_names"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_hebrew_wadi_names"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_hebrew_wadi_names"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_hebrew_wadi_names"(jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_place_category"(uuid, integer, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_place_category"(uuid, integer, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_place_category"(uuid, integer, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_place_category"(uuid, integer, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_place_location"(uuid, integer, double precision, double precision, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_place_location"(uuid, integer, double precision, double precision, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_place_location"(uuid, integer, double precision, double precision, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_place_location"(uuid, integer, double precision, double precision, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."south_lebanon_missing_hebrew"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."south_lebanon_missing_hebrew"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."south_lebanon_missing_hebrew"(integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."telegram_channel_event_counts"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."telegram_channel_event_counts"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."telegram_channel_event_counts"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."telegram_channel_event_counts"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."telegram_poll_tick"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."telegram_poll_tick"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."telegram_poll_tick"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."upsert_osm_waterways"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."upsert_osm_waterways"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."upsert_osm_waterways"(jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."use_feature"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."use_feature"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."use_feature"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."use_feature"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."use_search_quota"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."use_search_quota"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."use_search_quota"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."use_search_quota"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."wadi_lines_geojson"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."wadi_lines_geojson"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."wadi_lines_geojson"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."wadi_lines_geojson"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."wadi_lines_missing_hebrew"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."wadi_lines_missing_hebrew"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."wadi_lines_missing_hebrew"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."write_audit"(text, text, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."write_audit"(text, text, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."write_audit"(text, text, uuid, jsonb) TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ai_search_log_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."ai_search_log_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ai_search_log_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ai_search_log_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ai_usage_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."ai_usage_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ai_usage_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ai_usage_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ais_crossings_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."ais_crossings_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ais_crossings_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ais_crossings_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."category_corrections_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."category_corrections_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."category_corrections_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."category_corrections_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."geo_staging_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."geo_staging_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."geo_staging_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."geo_staging_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."hfc_alerts_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."hfc_alerts_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."hfc_alerts_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."hfc_alerts_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."insight_alert_queue_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_alert_queue_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."insight_alert_queue_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_alert_queue_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."insight_alert_queue_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_alert_queue_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."insight_alert_queue_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_alert_queue_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."insight_forecasts_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_forecasts_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."insight_forecasts_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_forecasts_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."insight_forecasts_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_forecasts_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."insight_forecasts_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_forecasts_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."insight_lexicon_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_lexicon_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."insight_lexicon_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_lexicon_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."insight_lexicon_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_lexicon_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."insight_lexicon_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_lexicon_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."insight_resolutions_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_resolutions_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."insight_resolutions_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_resolutions_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."insight_resolutions_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_resolutions_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."insight_resolutions_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_resolutions_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."insight_signal_readings_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_signal_readings_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."insight_signal_readings_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_signal_readings_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."insight_signal_readings_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_signal_readings_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."insight_signal_readings_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."insight_signal_readings_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."intel_items_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."intel_items_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."intel_items_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."intel_items_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."learned_terms_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."learned_terms_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."learned_terms_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."learned_terms_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."license_redemptions_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."license_redemptions_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."license_redemptions_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."license_redemptions_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."license_redemptions_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."license_redemptions_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."license_redemptions_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."license_redemptions_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."plan_audit_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."plan_audit_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."plan_audit_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."plan_audit_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."plan_audit_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."plan_audit_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."plan_audit_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."plan_audit_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."search_quota_log_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."search_quota_log_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."search_quota_log_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."search_quota_log_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."severity_corrections_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."severity_corrections_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."severity_corrections_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."severity_corrections_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."severity_corrections_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."severity_corrections_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."severity_corrections_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."severity_corrections_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."terms_acceptances_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."terms_acceptances_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."terms_acceptances_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."terms_acceptances_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."terms_acceptances_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."terms_acceptances_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."terms_acceptances_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."terms_acceptances_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."translation_log_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."translation_log_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."translation_log_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."translation_log_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."translation_log_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."translation_log_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."translation_log_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."translation_log_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."usage_logs_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."usage_logs_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."usage_logs_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."usage_logs_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."usage_logs_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."usage_logs_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."usage_logs_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."usage_logs_id_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."wadi_lines_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."wadi_lines_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."wadi_lines_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."wadi_lines_id_seq" TO "service_role";

REVOKE ALL ON TABLE "public"."administrator_invitations" FROM "authenticated";

REVOKE ALL ("accepted_at") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("accepted_at") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("created_at") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("created_at") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("email") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("email") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("expires_at") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("expires_at") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("full_name") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("full_name") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("intended_role") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("intended_role") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("invited_by") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("invited_by") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("message") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("message") ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."administrator_invitations" FROM "authenticated";

GRANT SELECT ("status") ON TABLE "public"."administrator_invitations" TO "authenticated";

GRANT INSERT, MAINTAIN, UPDATE ON TABLE "public"."administrator_invitations" TO "authenticated";

REVOKE ALL ON TABLE "public"."administrator_invitations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."administrator_invitations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."administrator_invitations" TO "service_role";

REVOKE ALL ON TABLE "public"."ai_cache" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_cache" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_cache" TO "service_role";

REVOKE ALL ON TABLE "public"."ai_search_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_search_log" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_search_log" TO "service_role";

REVOKE ALL ON TABLE "public"."ai_usage" FROM "authenticated";

GRANT SELECT ON TABLE "public"."ai_usage" TO "authenticated";

REVOKE ALL ON TABLE "public"."ai_usage" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_usage" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_usage" TO "service_role";

REVOKE ALL ON TABLE "public"."ais_crossings" FROM "anon";

GRANT SELECT ON TABLE "public"."ais_crossings" TO "anon";

REVOKE ALL ON TABLE "public"."ais_crossings" FROM "authenticated";

GRANT SELECT ON TABLE "public"."ais_crossings" TO "authenticated";

REVOKE ALL ON TABLE "public"."ais_crossings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ais_crossings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ais_crossings" TO "service_role";

REVOKE ALL ON TABLE "public"."ais_gates" FROM "anon";

GRANT SELECT ON TABLE "public"."ais_gates" TO "anon";

REVOKE ALL ON TABLE "public"."ais_gates" FROM "authenticated";

GRANT SELECT ON TABLE "public"."ais_gates" TO "authenticated";

REVOKE ALL ON TABLE "public"."ais_gates" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ais_gates" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ais_gates" TO "service_role";

REVOKE ALL ON TABLE "public"."ais_vessels" FROM "anon";

GRANT SELECT ON TABLE "public"."ais_vessels" TO "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ais_vessels" TO "authenticated";

REVOKE ALL ON TABLE "public"."ais_vessels" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ais_vessels" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ais_vessels" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_keys" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."api_keys" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_keys" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_keys" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_tiers" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."api_tiers" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_tiers" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_tiers" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_usage" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."api_usage" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_usage" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_usage" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_usage_minute" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."api_usage_minute" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_usage_minute" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."api_usage_minute" TO "service_role";

REVOKE ALL ON TABLE "public"."app_settings" FROM "anon";

GRANT SELECT ON TABLE "public"."app_settings" TO "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_settings" TO "authenticated";

REVOKE ALL ON TABLE "public"."app_settings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_settings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_settings" TO "service_role";

REVOKE ALL ON TABLE "public"."audit_logs" FROM "authenticated";

GRANT MAINTAIN, SELECT ON TABLE "public"."audit_logs" TO "authenticated";

REVOKE ALL ON TABLE "public"."audit_logs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "service_role";

REVOKE ALL ON TABLE "public"."category_corrections" FROM "authenticated";

GRANT DELETE, SELECT ON TABLE "public"."category_corrections" TO "authenticated";

REVOKE ALL ON TABLE "public"."category_corrections" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."category_corrections" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."category_corrections" TO "service_role";

REVOKE ALL ON TABLE "public"."control_areas" FROM "anon";

GRANT SELECT ON TABLE "public"."control_areas" TO "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."control_areas" TO "authenticated";

REVOKE ALL ON TABLE "public"."control_areas" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."control_areas" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."control_areas" TO "service_role";

REVOKE ALL ON TABLE "public"."event_categories" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON TABLE "public"."event_categories" TO "authenticated";

REVOKE ALL ON TABLE "public"."event_categories" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_categories" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_categories" TO "service_role";

REVOKE ALL ON TABLE "public"."event_history" FROM "authenticated";

GRANT MAINTAIN, SELECT ON TABLE "public"."event_history" TO "authenticated";

REVOKE ALL ON TABLE "public"."event_history" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_history" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_history" TO "service_role";

REVOKE ALL ON TABLE "public"."event_internal_notes" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON TABLE "public"."event_internal_notes" TO "authenticated";

REVOKE ALL ON TABLE "public"."event_internal_notes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_internal_notes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_internal_notes" TO "service_role";

REVOKE ALL ON TABLE "public"."event_media" FROM "anon";

GRANT SELECT ON TABLE "public"."event_media" TO "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_media" TO "authenticated";

REVOKE ALL ON TABLE "public"."event_media" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_media" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_media" TO "service_role";

REVOKE ALL ON TABLE "public"."events" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON TABLE "public"."events" TO "authenticated";

REVOKE ALL ON TABLE "public"."events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."events" TO "service_role";

REVOKE ALL ON TABLE "public"."events_pulse" FROM "anon";

GRANT SELECT ON TABLE "public"."events_pulse" TO "anon";

REVOKE ALL ON TABLE "public"."events_pulse" FROM "authenticated";

GRANT SELECT ON TABLE "public"."events_pulse" TO "authenticated";

REVOKE ALL ON TABLE "public"."events_pulse" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."events_pulse" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."events_pulse" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."feature_usage" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."feature_usage" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."feature_usage" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."feature_usage" TO "service_role";

REVOKE ALL ON TABLE "public"."geo_places" FROM "authenticated";

GRANT SELECT ON TABLE "public"."geo_places" TO "authenticated";

REVOKE ALL ON TABLE "public"."geo_places" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."geo_places" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."geo_places" TO "service_role";

REVOKE ALL ON TABLE "public"."geo_staging" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."geo_staging" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."geo_staging" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."geoloc_jobs" TO "authenticated";

REVOKE ALL ON TABLE "public"."geoloc_jobs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."geoloc_jobs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."geoloc_jobs" TO "service_role";

REVOKE ALL ON TABLE "public"."hfc_alerts" FROM "authenticated";

GRANT SELECT ON TABLE "public"."hfc_alerts" TO "authenticated";

REVOKE ALL ON TABLE "public"."hfc_alerts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_alerts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_alerts" TO "service_role";

REVOKE ALL ON TABLE "public"."hfc_areas" FROM "authenticated";

GRANT SELECT ON TABLE "public"."hfc_areas" TO "authenticated";

REVOKE ALL ON TABLE "public"."hfc_areas" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_areas" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_areas" TO "service_role";

REVOKE ALL ON TABLE "public"."hfc_clusters" FROM "anon";

REVOKE ALL ("alert_count") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("alert_count") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("area_points") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("area_points") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("areas_en") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("areas_en") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("areas") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("areas") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("center_lat") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("center_lat") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("center_lng") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("center_lng") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("expires_at") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("expires_at") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("geojson") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("geojson") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("geom") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("geom") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("id") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("id") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("last_alert_at") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("last_alert_at") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("merged_into") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("merged_into") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("started_at") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("started_at") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("threat") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("threat") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("zones_en") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("zones_en") ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ("zones_he") ON TABLE "public"."hfc_clusters" FROM "anon";

GRANT SELECT ("zones_he") ON TABLE "public"."hfc_clusters" TO "anon";

GRANT SELECT ON TABLE "public"."hfc_clusters" TO "anon";

REVOKE ALL ON TABLE "public"."hfc_clusters" FROM "authenticated";

REVOKE ALL ("alert_count") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("alert_count") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("area_points") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("area_points") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("areas_en") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("areas_en") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("areas") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("areas") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("center_lat") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("center_lat") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("center_lng") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("center_lng") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("expires_at") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("expires_at") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("geojson") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("geojson") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("geom") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("geom") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("last_alert_at") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("last_alert_at") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("merged_into") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("merged_into") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("started_at") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("started_at") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("threat") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("threat") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("zones_en") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("zones_en") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ("zones_he") ON TABLE "public"."hfc_clusters" FROM "authenticated";

GRANT SELECT ("zones_he") ON TABLE "public"."hfc_clusters" TO "authenticated";

REVOKE ALL ON TABLE "public"."hfc_clusters" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_clusters" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_clusters" TO "service_role";

REVOKE ALL ON TABLE "public"."hfc_ingest_status" FROM "authenticated";

GRANT SELECT ON TABLE "public"."hfc_ingest_status" TO "authenticated";

REVOKE ALL ON TABLE "public"."hfc_ingest_status" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_ingest_status" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_ingest_status" TO "service_role";

REVOKE ALL ON TABLE "public"."hfc_pulse" FROM "anon";

GRANT SELECT ON TABLE "public"."hfc_pulse" TO "anon";

REVOKE ALL ON TABLE "public"."hfc_pulse" FROM "authenticated";

GRANT SELECT ON TABLE "public"."hfc_pulse" TO "authenticated";

REVOKE ALL ON TABLE "public"."hfc_pulse" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_pulse" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."hfc_pulse" TO "service_role";

REVOKE ALL ON TABLE "public"."ingest_config" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ingest_config" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ingest_config" TO "service_role";

REVOKE ALL ON TABLE "public"."insight_alert_queue" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_alert_queue" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_alert_queue" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_alerts" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_alerts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_alerts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_alerts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_events" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_forecasts" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_forecasts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_forecasts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_forecasts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_lexicon" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_lexicon" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_lexicon" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_lexicon" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_resolutions" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_resolutions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_resolutions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_resolutions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_signal_readings" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_signal_readings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_signal_readings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_signal_readings" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_signals" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_signals" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_signals" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_signals" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_source_cache" TO "authenticated";

REVOKE ALL ON TABLE "public"."insight_source_cache" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_source_cache" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."insight_source_cache" TO "service_role";

REVOKE ALL ON TABLE "public"."intel_agents" FROM "authenticated";

GRANT SELECT ON TABLE "public"."intel_agents" TO "authenticated";

REVOKE ALL ON TABLE "public"."intel_agents" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_agents" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_agents" TO "service_role";

REVOKE ALL ON TABLE "public"."intel_config" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_config" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_config" TO "service_role";

REVOKE ALL ON TABLE "public"."intel_items" FROM "authenticated";

GRANT SELECT ON TABLE "public"."intel_items" TO "authenticated";

REVOKE ALL ON TABLE "public"."intel_items" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_items" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_items" TO "service_role";

REVOKE ALL ON TABLE "public"."intel_sources" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."intel_sources" TO "authenticated";

REVOKE ALL ON TABLE "public"."intel_sources" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_sources" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."intel_sources" TO "service_role";

REVOKE ALL ON TABLE "public"."layer_sync" FROM "anon";

GRANT SELECT ON TABLE "public"."layer_sync" TO "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."layer_sync" TO "authenticated";

REVOKE ALL ON TABLE "public"."layer_sync" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."layer_sync" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."layer_sync" TO "service_role";

REVOKE ALL ON TABLE "public"."learned_places" FROM "authenticated";

GRANT DELETE, SELECT ON TABLE "public"."learned_places" TO "authenticated";

REVOKE ALL ON TABLE "public"."learned_places" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."learned_places" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."learned_places" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."learned_terms" TO "authenticated";

REVOKE ALL ON TABLE "public"."learned_terms" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."learned_terms" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."learned_terms" TO "service_role";

REVOKE ALL ON TABLE "public"."lebanon_sects" FROM "anon";

GRANT SELECT ON TABLE "public"."lebanon_sects" TO "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."lebanon_sects" TO "authenticated";

REVOKE ALL ON TABLE "public"."lebanon_sects" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."lebanon_sects" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."lebanon_sects" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_attempts" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."license_attempts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_attempts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_attempts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_keys" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."license_keys" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_keys" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_keys" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_redemptions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."license_redemptions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_redemptions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."license_redemptions" TO "service_role";

REVOKE ALL ON TABLE "public"."osm_places_stage" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."osm_places_stage" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."osm_places_stage" TO "service_role";

REVOKE ALL ON TABLE "public"."osm_waterways" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."osm_waterways" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."osm_waterways" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."place_gazetteer" TO "authenticated";

REVOKE ALL ON TABLE "public"."place_gazetteer" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."place_gazetteer" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."place_gazetteer" TO "service_role";

REVOKE ALL ON TABLE "public"."place_learn_queue" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."place_learn_queue" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."place_learn_queue" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plan_audit" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."plan_audit" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plan_audit" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plan_audit" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plan_features" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."plan_features" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plan_features" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plan_features" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plans" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."plans" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plans" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plans" TO "service_role";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."push_config" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_config" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_config" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_subscriptions" TO "authenticated";

REVOKE ALL ON TABLE "public"."push_subscriptions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_subscriptions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_subscriptions" TO "service_role";

REVOKE ALL ON TABLE "public"."search_quota_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."search_quota_log" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."search_quota_log" TO "service_role";

REVOKE ALL ON TABLE "public"."self_private_invitations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."self_private_invitations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."self_private_invitations" TO "service_role";

REVOKE ALL ON TABLE "public"."self_private_usage_logs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."self_private_usage_logs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."self_private_usage_logs" TO "service_role";

REVOKE ALL ON TABLE "public"."self_private_users_profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."self_private_users_profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."self_private_users_profiles" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."severity_corrections" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."severity_corrections" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."severity_corrections" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."severity_corrections" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."social_results" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."social_results" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."social_results" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."social_results" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."social_searches" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."social_searches" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."social_searches" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."social_searches" TO "service_role";

REVOKE ALL ON TABLE "public"."telegram_agents" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."telegram_agents" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."telegram_agents" TO "service_role";

REVOKE ALL ON TABLE "public"."telegram_channels" FROM "authenticated";

REVOKE ALL ("active") ON TABLE "public"."telegram_channels" FROM "authenticated";

GRANT UPDATE ("active") ON TABLE "public"."telegram_channels" TO "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."telegram_channels" TO "authenticated";

REVOKE ALL ON TABLE "public"."telegram_channels" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."telegram_channels" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."telegram_channels" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."terms_acceptances" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."terms_acceptances" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."terms_acceptances" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."terms_acceptances" TO "service_role";

REVOKE ALL ON TABLE "public"."translation_cache" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."translation_cache" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."translation_cache" TO "service_role";

REVOKE ALL ON TABLE "public"."translation_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."translation_log" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."translation_log" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_sessions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."user_sessions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_sessions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_sessions" TO "service_role";

REVOKE ALL ON TABLE "public"."wadi_lines" FROM "authenticated";

GRANT SELECT ON TABLE "public"."wadi_lines" TO "authenticated";

REVOKE ALL ON TABLE "public"."wadi_lines" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."wadi_lines" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."wadi_lines" TO "service_role";

REVOKE ALL ON TABLE "public"."whatsapp_ingest_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_ingest_log" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_ingest_log" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."active_hfc_alerts" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."active_hfc_alerts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."active_hfc_alerts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."active_hfc_alerts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_usage_daily" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."ai_usage_daily" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_usage_daily" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_usage_daily" TO "service_role";

REVOKE ALL ON TABLE "public"."archived_events" FROM "authenticated";

GRANT SELECT ON TABLE "public"."archived_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."archived_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."archived_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."archived_events" TO "service_role";

REVOKE ALL ON TABLE "public"."published_events" FROM "anon";

GRANT SELECT ON TABLE "public"."published_events" TO "anon";

REVOKE ALL ON TABLE "public"."published_events" FROM "authenticated";

GRANT SELECT ON TABLE "public"."published_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."published_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."published_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."published_events" TO "service_role";

SELECT cron.schedule_in_database('ai-usage-trim', '17 3 * * *', 'delete from public.ai_usage where at < now() - interval ''180 days''', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-ais', '4-59/5 * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; 
select net.http_post(
  url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/ais-collector'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{}''::jsonb, timeout_milliseconds := 5000)
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-channel-regions', '17,47 * * * *', '
select net.http_post(
  url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{"action":"classify_channels"}''::jsonb, timeout_milliseconds := 5000)
where exists (select 1 from public.telegram_channels where region is null)
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-control-sync', '23 4 * * *', '
select net.http_post(url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{"action":"control_sync"}''::jsonb, timeout_milliseconds := 5000)
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-cron-cleanup', '23 * * * *', 'delete from cron.job_run_details where end_time < now() - interval ''24 hours''', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-dedupe', '8-58/10 * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; 
select net.http_post(
  url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{"action":"dedupe"}''::jsonb, timeout_milliseconds := 5000)
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-draft-cleanup', '37 * * * *', 'select public.cleanup_auto_drafts()', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('osintfront-expire-events', '* * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; select public.expire_events()', 'postgres', NULL,
  true);

SELECT cron.schedule_in_database('osintfront-expire-plans', '11 * * * *', 'select public.expire_plans()', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-hfc-areas', '17 3 * * 0', 'select public.hfc_sync_areas()', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('osintfront-hfc-history', '* * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; select public.hfc_ingest(''history'')', 'postgres',
  NULL, false);

SELECT
  cron.schedule_in_database('osintfront-hfc-live', '15 seconds', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; select public.hfc_ingest(''live'')', 'postgres', NULL,
  false);

SELECT cron.schedule_in_database('osintfront-hfc-poller', '* * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s'';
select net.http_post(
  url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/hfc-poller'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{}''::jsonb, timeout_milliseconds := 5000)
', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('osintfront-intel-crawler', '6-56/10 * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; select public.intel_crawler_tick()',
  'postgres', NULL, true);

SELECT
  cron.schedule_in_database('osintfront-intel-items-cleanup', '41 3 * * *', 'delete from public.intel_items where created_at < now() - interval ''14 days''', 'postgres', NULL,
  true);

SELECT cron.schedule_in_database('osintfront-media-dedupe', '3,13,23,33,43,53 * * * *', '
select net.http_post(
  url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{"action":"media_dedupe","hours":48}''::jsonb, timeout_milliseconds := 5000)
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-ofi-tick', '7,22,37,52 * * * *', 'select public.ofi_tick()', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('osintfront-refine-locations', '2-57/5 * * * *', 'set statement_timeout = ''45s''; set lock_timeout = ''5s''; select public.refine_event_locations(4)',
  'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-sects-sync', '41 3 1 * *', '
select net.http_post(url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{"action":"sects_sync"}''::jsonb, timeout_milliseconds := 5000)
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-social-schedule', '29 * * * *', '
select net.http_post(
  url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/social-search'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{"action":"scheduled"}''::jsonb,
  timeout_milliseconds := 60000)
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('osintfront-south-lebanon-fetch', '51 3 2 * *', '
select net.http_post(url := ''https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent'',
  headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.intel_config where key=''cron_secret'')),
  body := ''{"action":"learn_south_lebanon"}''::jsonb, timeout_milliseconds := 5000)
', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('osintfront-south-lebanon-learn', '7 4 2 * *', ' set statement_timeout = ''600s''; select public.learn_places_queue(2000); ', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('osintfront-telegram-poll', '*/2 * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; select public.telegram_poll_tick()', 'postgres',
  NULL, true);

SELECT cron.schedule_in_database('push-sender', '* * * * *', 'set statement_timeout = ''20s''; set lock_timeout = ''3s''; 
do $$
begin
  if not exists (select 1 from public.push_subscriptions) then
    update public.push_config set value = now()::text, updated_at = now() where key = ''cursor'';
  elsif exists (select 1 from public.events where status = ''published'' and deleted_at is null and published_at > (select value::timestamptz from public.push_config
    where key = ''cursor'')) then
    perform net.http_post(
      url := ''https://osintfront.com/api/push'',
      headers := jsonb_build_object(''content-type'', ''application/json'', ''x-push-secret'', (select value from public.push_config where key = ''secret'')),
      body := ''{}''::jsonb,
      timeout_milliseconds := 60000);
  end if;
end $$;
', 'postgres', NULL, true);

ALTER TABLE "public"."hfc_areas"
  ADD COLUMN "names_norm" text[] GENERATED ALWAYS AS
    (ARRAY[public.normalize_place(name), public.normalize_place(COALESCE(name_en, ''::text)), public.normalize_place(COALESCE(name_ar, ''::text)),
    public.normalize_place(COALESCE(name_ru, ''::text))]) STORED;

ALTER TABLE "public"."hfc_areas"
  ADD COLUMN "base_norm" text[] GENERATED ALWAYS AS
    (ARRAY[public.normalize_place(split_part(name, ' - '::text, 1)), public.normalize_place(split_part(COALESCE(name_en, ''::text), ' - '::text, 1))]) STORED;

ALTER TABLE "public"."insight_alerts"
  ADD CONSTRAINT "insight_alerts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE POLICY "ofi alerts: own" ON "public"."insight_alerts"
  FOR ALL
  TO "authenticated"
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER TABLE "public"."learned_terms"
  ADD CONSTRAINT "learned_terms_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."place_gazetteer"
  ADD COLUMN "names_norm" text[] GENERATED ALWAYS AS (public.normalize_places(names)) STORED;

ALTER TABLE "public"."place_gazetteer"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX push_subscriptions_user ON public.push_subscriptions USING btree (user_id);

CREATE POLICY "push: own rows" ON "public"."push_subscriptions"
  FOR ALL
  TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE INDEX hfc_areas_base_norm_idx ON public.hfc_areas USING gin (base_norm);

CREATE INDEX hfc_areas_names_norm_idx ON public.hfc_areas USING gin (names_norm);

CREATE INDEX place_gazetteer_names_idx ON public.place_gazetteer USING gin (names_norm);

