from scripts.export_openapi import OUTPUT, render


def test_committed_openapi_matches_the_api():
    assert OUTPUT.read_text() == render(), "Run: python scripts/export_openapi.py"
