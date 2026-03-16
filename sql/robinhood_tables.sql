-- Robinhood ingestion tables for Options Lab
-- Run this in the Supabase SQL Editor

-- ─── ACCOUNT SNAPSHOTS ──────────────────────────────────────────────────────
create table if not exists rh_account_snapshots (
  id            bigint generated always as identity primary key,
  timestamp     timestamptz not null default now(),
  equity        numeric not null,
  cash          numeric not null,
  buying_power  numeric not null,
  source        text not null default 'robinhood_sync'
);

create index if not exists idx_rh_account_ts on rh_account_snapshots (timestamp desc);

-- ─── STOCK POSITIONS ────────────────────────────────────────────────────────
create table if not exists rh_stock_positions (
  id              bigint generated always as identity primary key,
  symbol          text not null,
  name            text,
  quantity        numeric not null,
  average_cost    numeric not null,
  current_price   numeric,
  equity          numeric,
  unrealized_pnl  numeric,
  pnl_pct         numeric,
  updated_at      timestamptz not null default now(),
  unique (symbol)
);

create index if not exists idx_rh_stock_symbol on rh_stock_positions (symbol);

-- ─── OPTION POSITIONS ───────────────────────────────────────────────────────
create table if not exists rh_option_positions (
  id                bigint generated always as identity primary key,
  chain_symbol      text not null,
  expiration_date   date not null,
  strike_price      numeric not null,
  option_type       text not null,            -- 'call' or 'put'
  quantity          numeric not null,
  average_cost      numeric not null,
  mark_price        numeric,
  equity            numeric,
  unrealized_pnl    numeric,
  pnl_pct           numeric,
  delta             numeric,
  gamma             numeric,
  theta             numeric,
  vega              numeric,
  implied_volatility numeric,
  updated_at        timestamptz not null default now(),
  unique (chain_symbol, expiration_date, strike_price, option_type)
);

create index if not exists idx_rh_option_chain on rh_option_positions (chain_symbol);

-- ─── STOCK ORDERS ───────────────────────────────────────────────────────────
create table if not exists rh_stock_orders (
  id              text primary key,           -- Robinhood order ID
  symbol          text not null,
  side            text not null,              -- 'buy' or 'sell'
  order_type      text not null,              -- 'market', 'limit', 'stop', etc.
  quantity        numeric not null,
  price           numeric,
  executed_price   numeric,
  executed_qty    numeric,
  state           text not null,              -- 'filled', 'cancelled', 'pending', etc.
  created_at      timestamptz not null,
  updated_at      timestamptz not null
);

create index if not exists idx_rh_stock_orders_symbol on rh_stock_orders (symbol);
create index if not exists idx_rh_stock_orders_created on rh_stock_orders (created_at desc);

-- ─── OPTION ORDERS ──────────────────────────────────────────────────────────
create table if not exists rh_option_orders (
  id                text primary key,         -- Robinhood order ID
  chain_symbol      text not null,
  expiration_date   date,
  strike_price      numeric,
  option_type       text,                     -- 'call' or 'put'
  side              text not null,            -- 'buy' or 'sell'
  opening_strategy  text,
  closing_strategy  text,
  quantity          numeric not null,
  price             numeric,
  executed_price    numeric,
  executed_qty      numeric,
  state             text not null,
  created_at        timestamptz not null,
  updated_at        timestamptz not null
);

create index if not exists idx_rh_option_orders_chain on rh_option_orders (chain_symbol);
create index if not exists idx_rh_option_orders_created on rh_option_orders (created_at desc);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
alter table rh_account_snapshots enable row level security;
alter table rh_stock_positions enable row level security;
alter table rh_option_positions enable row level security;
alter table rh_stock_orders enable row level security;
alter table rh_option_orders enable row level security;

-- Allow service_role full access (used by Python ingestion service)
create policy "service_role_all" on rh_account_snapshots for all using (true) with check (true);
create policy "service_role_all" on rh_stock_positions for all using (true) with check (true);
create policy "service_role_all" on rh_option_positions for all using (true) with check (true);
create policy "service_role_all" on rh_stock_orders for all using (true) with check (true);
create policy "service_role_all" on rh_option_orders for all using (true) with check (true);

-- Allow anon key read access (used by frontend)
create policy "anon_read" on rh_account_snapshots for select using (true);
create policy "anon_read" on rh_stock_positions for select using (true);
create policy "anon_read" on rh_option_positions for select using (true);
create policy "anon_read" on rh_stock_orders for select using (true);
create policy "anon_read" on rh_option_orders for select using (true);
