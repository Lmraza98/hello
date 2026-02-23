import tempfile
import unittest
from pathlib import Path

import config
import database as db


class HybridSearchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._old_db_path = config.DB_PATH
        self._old_vector_backend = config.VECTOR_BACKEND
        self._old_refresh_mode = getattr(config, "ENTITY_SEARCH_REFRESH_MODE", "missing")
        config.DB_PATH = Path(self.tmp.name) / "test_outreach.db"
        config.ENTITY_SEARCH_REFRESH_MODE = "missing"
        db.init_database()

        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO linkedin_contacts (company_name, domain, name, title, email_generated, phone, linkedin_url)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("Zco Corporation", "zco.com", "Lucas Raza", "CTO", "lucas@zco.com", "555-1212", "https://linkedin.com/in/lucas"),
            )
            cursor.execute(
                """
                INSERT INTO targets (company_name, domain, tier, vertical, target_reason, wedge, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("Zco Corporation", "zco.com", "A", "Software", "Strong ICP fit", "Outlook compliance pain", "pending"),
            )
            cursor.execute(
                """
                INSERT INTO email_campaigns (name, description, status, num_emails, days_between_emails)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("Outlook Permission Follow-up", "Permission remediation sequence", "active", 3, 3),
            )
        db.refresh_entity_search_index(["contact", "company", "campaign"])
        chunk_id = db.upsert_semantic_chunk(
            source_type="conversation",
            source_id="1",
            chunk_type="summary",
            text="Discussed Outlook permissions and tenant consent with Lucas last week.",
            metadata={"title": "Outlook permission conversation"},
        )
        self.assertTrue(chunk_id.startswith("conversation:1"))

    def tearDown(self):
        config.DB_PATH = self._old_db_path
        config.VECTOR_BACKEND = self._old_vector_backend
        config.ENTITY_SEARCH_REFRESH_MODE = self._old_refresh_mode
        self.tmp.cleanup()

    def test_exact_contact_match_prioritized(self):
        results = db.hybrid_search("Lucas Raza", entity_types=["contact", "company"], k=5)
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(results[0]["entity_type"], "contact")
        self.assertGreater(results[0]["score_exact"], 0)
        required_keys = {
            "entity_type",
            "entity_id",
            "title",
            "snippet",
            "timestamp",
            "score_total",
            "score_exact",
            "score_lex",
            "score_vec",
            "source_refs",
        }
        self.assertTrue(required_keys.issubset(set(results[0].keys())))
        self.assertTrue(isinstance(results[0]["source_refs"], list) and len(results[0]["source_refs"]) > 0)

    def test_natural_language_contact_lookup_is_grounded(self):
        results = db.hybrid_search("Who is Lucas Raza", entity_types=["contact"], k=5)
        self.assertGreaterEqual(len(results), 1)
        top = results[0]
        self.assertEqual(top["entity_type"], "contact")
        self.assertIn("Lucas", top["title"])
        self.assertTrue(isinstance(top.get("source_refs"), list) and len(top["source_refs"]) > 0)

    def test_lexical_company_fallback(self):
        results = db.hybrid_search("compliance pain", entity_types=["company"], k=5)
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(results[0]["entity_type"], "company")
        self.assertGreater(results[0]["score_lex"], 0)

    def test_semantic_chunk_merge(self):
        results = db.hybrid_search(
            "who did we talk to about outlook permissions",
            entity_types=["conversation", "contact"],
            k=5,
        )
        self.assertGreaterEqual(len(results), 1)
        top = results[0]
        self.assertIn(top["entity_type"], {"conversation", "contact"})
        has_refs = any(len(item.get("source_refs") or []) > 0 for item in results)
        self.assertTrue(has_refs)

    def test_sqlite_vec_mode_falls_back_without_vec_schema(self):
        config.VECTOR_BACKEND = "sqlite_vec"
        results = db.hybrid_search(
            "outlook permissions",
            entity_types=["conversation"],
            k=5,
        )
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(results[0]["entity_type"], "conversation")

    def test_missing_mode_does_not_rebuild_when_index_present(self):
        original_refresh = db.refresh_entity_search_index
        calls: list[list[str]] = []

        def _record_refresh(entity_types=None):
            calls.append(list(entity_types or []))
            return original_refresh(entity_types)

        db.refresh_entity_search_index = _record_refresh
        try:
            timings: dict = {}
            results = db.hybrid_search(
                "Lucas Raza",
                entity_types=["contact", "company", "campaign"],
                k=5,
                debug_timing=timings,
            )
            self.assertGreaterEqual(len(results), 1)
            self.assertEqual(calls, [])
            self.assertFalse(timings.get("index_refreshed"))
            self.assertEqual(timings.get("index_refresh_mode"), "missing")
        finally:
            db.refresh_entity_search_index = original_refresh

    def test_resolve_entity_partial_contact_name_fallback(self):
        results = db.resolve_entity("Lucas", entity_types=["contact"], limit=5)
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(results[0]["entity_type"], "contact")
        self.assertIn("Lucas", results[0]["title"])


if __name__ == "__main__":
    unittest.main()
