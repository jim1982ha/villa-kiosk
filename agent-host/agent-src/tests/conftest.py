"""The VESTA Agent's synthetic tests: invented entities only, run by CI.

⚠️ NOTHING FROM A REAL VILLA HERE. The tests that replay a villa's own data live
in tests/villa/ (gitignored) and run locally only.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

collect_ignore_glob = []
if not os.path.isdir(os.path.join(os.path.dirname(__file__), "villa", "fixtures")):
    collect_ignore_glob.append("villa/*")
