-- schema.sql


-- first we load the extensions for uuid and maps stuff
create extension if not exists "uuid-ossp";
create extension if not exists "postgis";

-- simple lookup table for zones so we know where these taxis are actually going
create table zones (
    id            integer primary key,
    borough       varchar(50),
    zone_name     varchar(100),
    service_zone  varchar(50)
);

-- this holds the map shapes for the dashboard so it's not just boring numbers
create table zone_shapes (
    id           serial primary key,
    location_id  integer,
    area         numeric,
    len          numeric,
    geom         geometry(multipolygon, 2263), -- local ny map coords
    geom_web     geometry(multipolygon, 4326), -- standard lat/long for the web
    mappable     boolean default true,
    notes        text
);

-- indexing the shapes so the map doesn't take une eternite to load
create index shape_id_idx on zone_shapes(location_id);
create index spatial_idx on zone_shapes using gist(geom_web);

-- the absolute unit of a table. 7m+ rows in here.
create table trips (
    id                 uuid primary key default uuid_generate_v4(),
    vendor             smallint,
    pickup_time        timestamptz not null,
    dropoff_time       timestamptz not null,
    passengers         smallint,
    distance           numeric(8, 2) default 0,
    rate_id            smallint,
    store_fwd          char(1),
    
    -- connecting to the zones table so we don't have to save the name every time
    pickup_zone       integer references zones(id) deferrable initially deferred,
    dropoff_zone      integer references zones(id) deferrable initially deferred,

    payment_type      smallint,
    fare              numeric(10, 2),
    extra             numeric(8, 2),
    tax               numeric(8, 2),
    tip               numeric(10, 2),
    tolls             numeric(8, 2),
    surcharge         numeric(8, 2),
    total             numeric(10, 2),
    congestion        numeric(8, 2),

    -- columns we calculated to make the data more interesting
    duration_min      numeric(8, 2),
    speed_mph         numeric(8, 2),
    money_per_min     numeric(10, 4),
    tip_pct           numeric(8, 2),
    cost_per_mile     numeric(10, 4),

    -- extra columns so the chart queries don't take forever
    hour_of_day       smallint,
    day_of_week       smallint, -- 0-6
    is_peak           boolean,
    created_at        timestamptz default now()
);

-- indexing the columns we filter by so the api doesn't flop
create index pickup_time_idx on trips(pickup_time);
create index pickup_zone_idx on trips(pickup_zone);
create index dropoff_zone_idx on trips(dropoff_zone);

-- where we dump the bad data we found during the cleanup phase
create table error_log (
    err_id      uuid primary key default uuid_generate_v4(),
    row_num     bigint,
    err_type    varchar(100),
    details     jsonb,
    raw_data    jsonb,
    created_at  timestamptz default now()
);

-- materialized views are great—they pre-save the math for the graphs
create materialized view hourly_stats as
select
    date_trunc('hour', pickup_time) as hour_block,
    hour_of_day,
    count(*) as total_trips,
    avg(total) as avg_price,
    avg(tip) as avg_tip,
    avg(tip_pct) as avg_tip_pct,
    avg(duration_min) as avg_duration,
    avg(speed_mph) as avg_speed,
    sum(total) as revenue,
    avg(money_per_min) as earnings_per_min
from trips
group by 1, 2;

create unique index hourly_stats_idx on hourly_stats(hour_block);

-- map summary table. basically a resume for every zone
create materialized view zone_stats as
select
    z.id as location_id,
    z.borough,
    z.zone_name,
    count(t.id) as trip_count,
    avg(t.total) as avg_fare,
    sum(t.total) as total_money,
    avg(t.tip_pct) as avg_tip_pct,
    avg(t.money_per_min) as avg_money_min,
    -- check if we actually have a shape to draw so the map doesn't look broken
    exists (select 1 from zone_shapes s where s.location_id = z.id and s.mappable = true) as has_shape
from zones z
left join trips t on t.pickup_zone = z.id
group by z.id, z.borough, z.zone_name;

create unique index zone_stats_idx on zone_stats(location_id);

-- run this after an import to update the charts and maps
create or replace function update_stats()
returns void as $$
begin
    refresh materialized view concurrently hourly_stats;
    refresh materialized view concurrently zone_stats;
end;
$$ language plpgsql;