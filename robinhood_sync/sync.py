#!/usr/bin/env python3
"""
Robinhood → Supabase ingestion service.

Pulls stock/options positions and order history from Robinhood's private API
via robin_stocks, normalizes data, and writes to Supabase for Options Lab.

Usage:
    python sync.py          # Long-lived 15-minute polling loop
    python sync.py --once   # Single sync cycle then exit
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal

import pyotp
import robin_stocks.robinhood as rh
from dotenv import load_dotenv
from supabase import create_client

# ─── CONFIG ──────────────────────────────────────────────────────────────────

load_dotenv()

RH_EMAIL = os.getenv("RH_EMAIL")
RH_PASSWORD = os.getenv("RH_PASSWORD")
RH_TOTP_SECRET = os.getenv("RH_TOTP_SECRET")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

POLL_INTERVAL = 15 * 60  # 15 minutes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("rh_sync")

# ─── AUTH ────────────────────────────────────────────────────────────────────


def authenticate():
    """Login to Robinhood with TOTP-based MFA."""
    if not all([RH_EMAIL, RH_PASSWORD, RH_TOTP_SECRET]):
        log.error("Missing RH_EMAIL, RH_PASSWORD, or RH_TOTP_SECRET in .env")
        sys.exit(1)

    totp = pyotp.TOTP(RH_TOTP_SECRET)
    mfa_code = totp.now()

    log.info("Authenticating with Robinhood as %s...", RH_EMAIL)
    login = rh.login(
        RH_EMAIL,
        RH_PASSWORD,
        mfa_code=mfa_code,
        store_session=True,
    )

    if not login:
        log.error("Robinhood authentication failed")
        sys.exit(1)

    log.info("Authenticated successfully")
    return login


# ─── SUPABASE CLIENT ────────────────────────────────────────────────────────


def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ─── HELPERS ─────────────────────────────────────────────────────────────────


def safe_float(val, default=0.0):
    """Safely convert a value to float."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def safe_str(val, default=None):
    if val is None:
        return default
    return str(val).strip() or default


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_instrument_symbol(instrument_url):
    """Fetch ticker symbol from an instrument URL (cached by robin_stocks)."""
    try:
        data = rh.stocks.get_instrument_by_url(instrument_url)
        return data.get("symbol") if data else None
    except Exception:
        return None


def get_instrument_name(instrument_url):
    """Fetch company name from an instrument URL."""
    try:
        data = rh.stocks.get_instrument_by_url(instrument_url)
        return data.get("simple_name") or data.get("name") if data else None
    except Exception:
        return None


# ─── SYNC: ACCOUNT SNAPSHOT ─────────────────────────────────────────────────


def sync_account(sb):
    """Pull account profile and insert a snapshot."""
    log.info("Syncing account profile...")
    profile = rh.account.load_portfolio_profile()

    if not profile:
        log.warning("No account profile returned")
        return

    row = {
        "timestamp": now_iso(),
        "equity": safe_float(profile.get("equity")),
        "cash": safe_float(profile.get("withdrawable_amount")),
        "buying_power": safe_float(
            rh.account.load_account_profile().get("buying_power")
        ),
        "source": "robinhood_sync",
    }

    sb.table("rh_account_snapshots").insert(row).execute()
    log.info(
        "  Account: equity=$%.2f  cash=$%.2f  buying_power=$%.2f",
        row["equity"],
        row["cash"],
        row["buying_power"],
    )


# ─── SYNC: STOCK POSITIONS ──────────────────────────────────────────────────


def sync_stock_positions(sb):
    """Pull current stock positions and upsert."""
    log.info("Syncing stock positions...")
    positions = rh.account.get_all_positions()

    if not positions:
        log.info("  No stock positions")
        return 0

    rows = []
    for pos in positions:
        qty = safe_float(pos.get("quantity"))
        if qty == 0:
            continue

        symbol = get_instrument_symbol(pos.get("instrument"))
        if not symbol:
            continue

        name = get_instrument_name(pos.get("instrument"))
        avg_cost = safe_float(pos.get("average_buy_price"))

        # Fetch current quote
        quote = rh.stocks.get_latest_price(symbol)
        current_price = safe_float(quote[0]) if quote else 0

        equity = current_price * qty
        cost_total = avg_cost * qty
        pnl = equity - cost_total
        pnl_pct = (pnl / cost_total) if cost_total > 0 else 0

        rows.append(
            {
                "symbol": symbol,
                "name": name,
                "quantity": qty,
                "average_cost": avg_cost,
                "current_price": current_price,
                "equity": equity,
                "unrealized_pnl": pnl,
                "pnl_pct": pnl_pct,
                "updated_at": now_iso(),
            }
        )

    if rows:
        sb.table("rh_stock_positions").upsert(
            rows, on_conflict="symbol"
        ).execute()

    log.info("  Stock positions: %d", len(rows))
    return len(rows)


# ─── SYNC: OPTION POSITIONS ─────────────────────────────────────────────────


def sync_option_positions(sb):
    """Pull current option positions and upsert."""
    log.info("Syncing option positions...")
    positions = rh.options.get_all_option_positions()

    if not positions:
        log.info("  No option positions")
        return 0

    rows = []
    for pos in positions:
        qty = safe_float(pos.get("quantity"))
        if qty == 0:
            continue

        chain_symbol = safe_str(pos.get("chain_symbol"))
        if not chain_symbol:
            continue

        # Get option contract details
        option_data = None
        try:
            option_url = pos.get("option")
            if option_url:
                option_data = rh.helper.request_get(option_url)
        except Exception:
            pass

        expiration = safe_str(
            pos.get("expiration_date")
            or (option_data.get("expiration_date") if option_data else None)
        )
        strike = safe_float(
            pos.get("strike_price")
            or (option_data.get("strike_price") if option_data else None)
        )
        option_type = safe_str(
            pos.get("type")
            or (option_data.get("type") if option_data else None)
        )

        avg_cost = safe_float(pos.get("average_price")) / 100  # pennies → dollars
        mark = safe_float(pos.get("mark_price"))
        equity = mark * qty * 100  # options are per 100 shares
        cost_total = avg_cost * qty * 100
        pnl = equity - cost_total
        pnl_pct = (pnl / cost_total) if cost_total > 0 else 0

        # Greeks
        greeks = {}
        try:
            md = rh.options.get_option_market_data_by_id(pos.get("option_id"))
            if md and isinstance(md, list) and len(md) > 0:
                md = md[0]
                greeks = {
                    "delta": safe_float(md.get("delta")),
                    "gamma": safe_float(md.get("gamma")),
                    "theta": safe_float(md.get("theta")),
                    "vega": safe_float(md.get("vega")),
                    "implied_volatility": safe_float(
                        md.get("implied_volatility")
                    ),
                }
        except Exception:
            pass

        rows.append(
            {
                "chain_symbol": chain_symbol,
                "expiration_date": expiration,
                "strike_price": strike,
                "option_type": option_type,
                "quantity": qty,
                "average_cost": avg_cost,
                "mark_price": mark,
                "equity": equity,
                "unrealized_pnl": pnl,
                "pnl_pct": pnl_pct,
                "updated_at": now_iso(),
                **greeks,
            }
        )

    if rows:
        sb.table("rh_option_positions").upsert(
            rows,
            on_conflict="chain_symbol,expiration_date,strike_price,option_type",
        ).execute()

    log.info("  Option positions: %d", len(rows))
    return len(rows)


# ─── SYNC: STOCK ORDERS ─────────────────────────────────────────────────────


def sync_stock_orders(sb):
    """Pull stock order history and upsert new orders."""
    log.info("Syncing stock orders...")

    # Find latest order we already have
    latest = (
        sb.table("rh_stock_orders")
        .select("created_at")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    since = latest.data[0]["created_at"] if latest.data else None

    orders = rh.orders.get_all_stock_orders()
    if not orders:
        log.info("  No stock orders")
        return 0

    rows = []
    for order in orders:
        order_id = order.get("id")
        created = order.get("created_at")

        # Skip orders we already have
        if since and created and created <= since:
            continue

        symbol = get_instrument_symbol(order.get("instrument"))
        if not symbol:
            continue

        # Get average execution price from executions list
        executions = order.get("executions", [])
        exec_price = None
        exec_qty = 0
        if executions:
            total_cost = sum(
                safe_float(e.get("price")) * safe_float(e.get("quantity"))
                for e in executions
            )
            exec_qty = sum(safe_float(e.get("quantity")) for e in executions)
            exec_price = (total_cost / exec_qty) if exec_qty > 0 else None

        rows.append(
            {
                "id": order_id,
                "symbol": symbol,
                "side": safe_str(order.get("side"), "unknown"),
                "order_type": safe_str(order.get("type"), "unknown"),
                "quantity": safe_float(order.get("quantity")),
                "price": safe_float(order.get("price")),
                "executed_price": exec_price,
                "executed_qty": exec_qty,
                "state": safe_str(order.get("state"), "unknown"),
                "created_at": created,
                "updated_at": order.get("updated_at") or created,
            }
        )

    if rows:
        sb.table("rh_stock_orders").upsert(rows, on_conflict="id").execute()

    log.info("  Stock orders: %d new", len(rows))
    return len(rows)


# ─── SYNC: OPTION ORDERS ────────────────────────────────────────────────────


def sync_option_orders(sb):
    """Pull option order history and upsert new orders."""
    log.info("Syncing option orders...")

    latest = (
        sb.table("rh_option_orders")
        .select("created_at")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    since = latest.data[0]["created_at"] if latest.data else None

    orders = rh.orders.get_all_option_orders()
    if not orders:
        log.info("  No option orders")
        return 0

    rows = []
    for order in orders:
        order_id = order.get("id")
        created = order.get("created_at")

        if since and created and created <= since:
            continue

        # Extract leg details (first leg for single-leg orders)
        legs = order.get("legs", [])
        leg = legs[0] if legs else {}

        chain_symbol = safe_str(order.get("chain_symbol"))
        if not chain_symbol:
            continue

        # Get option details from leg
        option_url = leg.get("option")
        option_data = None
        if option_url:
            try:
                option_data = rh.helper.request_get(option_url)
            except Exception:
                pass

        expiration = None
        strike = None
        option_type = None
        if option_data:
            expiration = option_data.get("expiration_date")
            strike = safe_float(option_data.get("strike_price"))
            option_type = option_data.get("type")

        # Execution info
        executions = leg.get("executions", [])
        exec_price = None
        exec_qty = 0
        if executions:
            total_cost = sum(
                safe_float(e.get("price")) * safe_float(e.get("quantity"))
                for e in executions
            )
            exec_qty = sum(safe_float(e.get("quantity")) for e in executions)
            exec_price = (total_cost / exec_qty) if exec_qty > 0 else None

        rows.append(
            {
                "id": order_id,
                "chain_symbol": chain_symbol,
                "expiration_date": expiration,
                "strike_price": strike,
                "option_type": option_type,
                "side": safe_str(leg.get("side"), safe_str(order.get("direction"), "unknown")),
                "opening_strategy": safe_str(order.get("opening_strategy")),
                "closing_strategy": safe_str(order.get("closing_strategy")),
                "quantity": safe_float(order.get("quantity")),
                "price": safe_float(order.get("price")),
                "executed_price": exec_price,
                "executed_qty": exec_qty,
                "state": safe_str(order.get("state"), "unknown"),
                "created_at": created,
                "updated_at": order.get("updated_at") or created,
            }
        )

    if rows:
        sb.table("rh_option_orders").upsert(rows, on_conflict="id").execute()

    log.info("  Option orders: %d new", len(rows))
    return len(rows)


# ─── MAIN SYNC CYCLE ────────────────────────────────────────────────────────


def run_sync(sb):
    """Execute one full sync cycle."""
    start = time.time()
    log.info("═══ Sync cycle starting ═══")

    try:
        sync_account(sb)
    except Exception as e:
        log.error("Account sync failed: %s", e)

    try:
        sync_stock_positions(sb)
    except Exception as e:
        log.error("Stock positions sync failed: %s", e)

    try:
        sync_option_positions(sb)
    except Exception as e:
        log.error("Option positions sync failed: %s", e)

    try:
        sync_stock_orders(sb)
    except Exception as e:
        log.error("Stock orders sync failed: %s", e)

    try:
        sync_option_orders(sb)
    except Exception as e:
        log.error("Option orders sync failed: %s", e)

    elapsed = time.time() - start
    log.info("═══ Sync cycle complete (%.1fs) ═══", elapsed)


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Robinhood → Supabase sync")
    parser.add_argument(
        "--once", action="store_true", help="Run a single sync then exit"
    )
    args = parser.parse_args()

    authenticate()
    sb = get_supabase()

    if args.once:
        run_sync(sb)
        return

    log.info("Starting polling loop (every %ds)...", POLL_INTERVAL)
    while True:
        try:
            run_sync(sb)
        except Exception as e:
            log.error("Sync cycle crashed: %s", e)

        log.info("Sleeping %d minutes until next cycle...", POLL_INTERVAL // 60)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
