"""Date helpers shared across services that are NOT gamification-specific.

`now_hcm()` is used by quiz_service.py's spaced-repetition scheduling
(graduated 1h/4h/24h/3d/7d/14d/30d review ladder) - kept independent of
GamificationService so it survives the gamification feature's removal.
"""
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Asia/Ho_Chi_Minh")
except Exception:  # pragma: no cover
    from datetime import timezone
    TZ = timezone(timedelta(hours=7))


def now_hcm() -> datetime:
    """Current naive datetime in Asia/Ho_Chi_Minh (review due-times are
    scheduled in hours/days from this moment)."""
    return datetime.now(TZ).replace(tzinfo=None)
