"""Date helpers shared across services that are NOT gamification-specific.

`today_hcm()` is used by quiz_service.py's spaced-repetition scheduling
(1-3-7 day review cycle) - kept independent of GamificationService so it
survives the gamification feature's removal.
"""
from datetime import date, datetime, timedelta

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Asia/Ho_Chi_Minh")
except Exception:  # pragma: no cover
    from datetime import timezone
    TZ = timezone(timedelta(hours=7))


def today_hcm() -> date:
    """Today's date in Asia/Ho_Chi_Minh (review due-dates are per local day)."""
    return datetime.now(TZ).date()
