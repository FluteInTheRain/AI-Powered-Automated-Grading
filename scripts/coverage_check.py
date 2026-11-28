#!/usr/bin/env python3
"""Run the test-suite coverage checker over the bank: python3 scripts/coverage_check.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from grader.coverage_check import main  # noqa: E402

raise SystemExit(main())
