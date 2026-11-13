import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from pjflim_agent.catalog import AgentError, create_demo


class DemoClockChecks(unittest.TestCase):
    def test_explicit_demo_time_does_not_depend_on_the_execution_date(self):
        fixed = datetime(2020, 1, 1, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            catalog = create_demo(Path(folder) / "demo.json", fixed)
            self.assertEqual(catalog.clock(), fixed)
            catalog.ensure_fresh()

    def test_default_demo_still_expires_against_the_live_clock(self):
        fixed = datetime(2026, 11, 14, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as folder, patch("pjflim_agent.catalog.utcnow",
                side_effect=[fixed, fixed, fixed + timedelta(hours=25)]):
            catalog = create_demo(Path(folder) / "demo.json")
            with self.assertRaises(AgentError) as raised:
                catalog.ensure_fresh()
            self.assertEqual(raised.exception.code, "SNAPSHOT_EXPIRED")
