"""
Phone Number Database - Production Quality

SQLite database for storing validated phone numbers with owner names.
Provides fast local lookups without API calls.

Features:
- Phone number storage and retrieval
- Name-based search (reverse lookup)
- Carrier and line type filtering
- Statistics and analytics
- Fuzzy name matching
"""
import sqlite3
import re
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from datetime import datetime
import difflib

import config


class PhoneDatabase:
    """Manages phone number database operations."""
    
    def __init__(self, db_path: str = None):
        """
        Initialize phone database.
        
        Args:
            db_path: Path to database file (default: data/phone_database.db)
        """
        if db_path is None:
            db_path = config.DATA_DIR / "phone_database.db"
        
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_database()
    
    def _init_database(self):
        """Initialize database schema with comprehensive fields."""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        # Create main phone numbers table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS phone_numbers (
                phone TEXT PRIMARY KEY,
                area_code TEXT NOT NULL,
                exchange TEXT NOT NULL,
                subscriber TEXT NOT NULL,
                carrier TEXT,
                line_type TEXT,
                country TEXT DEFAULT 'US',
                valid INTEGER DEFAULT 0,
                validated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                source TEXT,
                confidence REAL DEFAULT 0.0,
                name TEXT,
                name_normalized TEXT,
                name_match INTEGER DEFAULT 0,
                name_match_score REAL DEFAULT 0.0,
                location TEXT,
                raw_data TEXT
            )
        """)
        
        # Create indexes for fast lookups
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_area_code ON phone_numbers(area_code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_valid ON phone_numbers(valid)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_carrier ON phone_numbers(carrier)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_line_type ON phone_numbers(line_type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_name ON phone_numbers(name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_name_normalized ON phone_numbers(name_normalized)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_confidence ON phone_numbers(confidence)")
        
        # Create FTS5 virtual table for fast name search
        try:
            cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS phone_names_fts USING fts5(
                    phone,
                    name,
                    name_normalized,
                    content='phone_numbers',
                    content_rowid='rowid'
                )
            """)
        except sqlite3.OperationalError:
            # FTS5 might not be available on all SQLite builds
            pass
        
        conn.commit()
        conn.close()
    
    def _normalize_phone(self, phone: str) -> Tuple[str, str, str, str]:
        """
        Normalize phone to standard format and extract components.
        
        Returns:
            (formatted_phone, area_code, exchange, subscriber)
        """
        digits = re.sub(r'[^\d]', '', phone)
        
        if len(digits) == 10:
            area_code = digits[:3]
            exchange = digits[3:6]
            subscriber = digits[6:]
        elif len(digits) == 11 and digits[0] == '1':
            area_code = digits[1:4]
            exchange = digits[4:7]
            subscriber = digits[7:]
        else:
            raise ValueError(f"Invalid phone number format: {phone}")
        
        formatted = f"{area_code}-{exchange}-{subscriber}"
        return formatted, area_code, exchange, subscriber
    
    def _normalize_name(self, name: str) -> str:
        """Normalize name for search (lowercase, no punctuation)."""
        if not name:
            return None
        return re.sub(r'[^a-z\s]', '', name.lower()).strip()
    
    def lookup(self, phone: str) -> Optional[Dict]:
        """
        Lookup a phone number in the database.
        
        Args:
            phone: Phone number in any format
        
        Returns:
            Dictionary with phone data or None
        """
        try:
            formatted, _, _, _ = self._normalize_phone(phone)
        except ValueError:
            return None
        
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM phone_numbers WHERE phone = ?", (formatted,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return dict(row)
        return None
    
    def search_by_name(self, name: str, limit: int = 10, min_confidence: float = 0.5) -> List[Dict]:
        """
        Search for phone numbers by owner name (fuzzy match).
        
        Args:
            name: Name to search for
            limit: Maximum results
            min_confidence: Minimum confidence score
        
        Returns:
            List of matching phone records
        """
        if not name:
            return []
        
        normalized = self._normalize_name(name)
        name_parts = normalized.split()
        
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Try FTS5 search first
        try:
            fts_query = ' OR '.join(f'"{part}"' for part in name_parts if len(part) > 2)
            cursor.execute(f"""
                SELECT p.* FROM phone_numbers p
                JOIN phone_names_fts f ON p.phone = f.phone
                WHERE phone_names_fts MATCH ?
                AND p.confidence >= ?
                ORDER BY p.confidence DESC
                LIMIT ?
            """, (fts_query, min_confidence, limit))
            results = [dict(row) for row in cursor.fetchall()]
            if results:
                conn.close()
                return results
        except:
            pass
        
        # Fallback to LIKE search
        where_clauses = []
        params = []
        for part in name_parts:
            if len(part) > 2:
                where_clauses.append("(name_normalized LIKE ? OR name LIKE ?)")
                params.extend([f"%{part}%", f"%{part}%"])
        
        if not where_clauses:
            conn.close()
            return []
        
        query = f"""
            SELECT * FROM phone_numbers
            WHERE ({' OR '.join(where_clauses)})
            AND confidence >= ?
            AND name IS NOT NULL
            ORDER BY confidence DESC
            LIMIT ?
        """
        params.extend([min_confidence, limit])
        
        cursor.execute(query, params)
        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        # Re-rank by fuzzy match score
        for result in results:
            result_name = result.get('name_normalized') or self._normalize_name(result.get('name', ''))
            result['match_score'] = difflib.SequenceMatcher(None, normalized, result_name).ratio()
        
        results.sort(key=lambda x: (x.get('match_score', 0), x.get('confidence', 0)), reverse=True)
        return results[:limit]
    
    def search_by_area_code(self, area_code: str, limit: int = 100, only_with_names: bool = False) -> List[Dict]:
        """
        Search for phone numbers by area code.
        
        Args:
            area_code: 3-digit area code
            limit: Maximum results
            only_with_names: Only return records with owner names
        
        Returns:
            List of phone records
        """
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = "SELECT * FROM phone_numbers WHERE area_code = ?"
        params = [area_code]
        
        if only_with_names:
            query += " AND name IS NOT NULL AND name != ''"
        
        query += " ORDER BY confidence DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return results
    
    def insert(self, phone_data: Dict) -> bool:
        """
        Insert or update a phone number in the database.
        
        Args:
            phone_data: Dictionary with phone information
        
        Returns:
            True if successful
        """
        phone = phone_data.get('phone', '')
        if not phone:
            return False
        
        try:
            formatted, area_code, exchange, subscriber = self._normalize_phone(phone)
        except ValueError:
            return False
        
        name = phone_data.get('name')
        name_normalized = self._normalize_name(name) if name else None
        
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO phone_numbers 
                (phone, area_code, exchange, subscriber, carrier, line_type, country, 
                 valid, source, confidence, name, name_normalized, name_match, 
                 name_match_score, location, raw_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                formatted,
                area_code,
                exchange,
                subscriber,
                phone_data.get('carrier'),
                phone_data.get('line_type'),
                phone_data.get('country', 'US'),
                1 if phone_data.get('valid') else 0,
                phone_data.get('source', 'unknown'),
                phone_data.get('confidence', 0.0),
                name,
                name_normalized,
                1 if phone_data.get('name_match') else 0,
                phone_data.get('name_match_score', 0.0),
                phone_data.get('location'),
                str(phone_data) if phone_data else None
            ))
            
            conn.commit()
            return True
        except Exception as e:
            print(f"[PhoneDatabase] Insert error: {e}")
            return False
        finally:
            conn.close()
    
    def insert_batch(self, phone_data_list: List[Dict]) -> int:
        """
        Insert multiple phone numbers efficiently.
        
        Args:
            phone_data_list: List of phone data dictionaries
        
        Returns:
            Number of successfully inserted records
        """
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        inserted = 0
        for phone_data in phone_data_list:
            phone = phone_data.get('phone', '')
            if not phone:
                continue
            
            try:
                formatted, area_code, exchange, subscriber = self._normalize_phone(phone)
            except ValueError:
                continue
            
            name = phone_data.get('name')
            name_normalized = self._normalize_name(name) if name else None
            
            try:
                cursor.execute("""
                    INSERT OR REPLACE INTO phone_numbers 
                    (phone, area_code, exchange, subscriber, carrier, line_type, country, 
                     valid, source, confidence, name, name_normalized, name_match, 
                     name_match_score, location, raw_data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    formatted,
                    area_code,
                    exchange,
                    subscriber,
                    phone_data.get('carrier'),
                    phone_data.get('line_type'),
                    phone_data.get('country', 'US'),
                    1 if phone_data.get('valid') else 0,
                    phone_data.get('source', 'unknown'),
                    phone_data.get('confidence', 0.0),
                    name,
                    name_normalized,
                    1 if phone_data.get('name_match') else 0,
                    phone_data.get('name_match_score', 0.0),
                    phone_data.get('location'),
                    str(phone_data) if phone_data else None
                ))
                inserted += 1
            except Exception as e:
                continue
        
        conn.commit()
        conn.close()
        return inserted
    
    def get_stats(self) -> Dict:
        """
        Get comprehensive database statistics.
        
        Returns:
            Dictionary with detailed stats
        """
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        stats = {}
        
        # Total counts
        cursor.execute("SELECT COUNT(*) FROM phone_numbers")
        stats['total_numbers'] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM phone_numbers WHERE valid = 1")
        stats['valid_numbers'] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM phone_numbers WHERE name IS NOT NULL AND name != ''")
        stats['numbers_with_names'] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM phone_numbers WHERE name_match = 1")
        stats['confirmed_name_matches'] = cursor.fetchone()[0]
        
        # Coverage
        cursor.execute("SELECT COUNT(DISTINCT area_code) FROM phone_numbers")
        stats['area_codes_covered'] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(DISTINCT carrier) FROM phone_numbers WHERE carrier IS NOT NULL")
        stats['unique_carriers'] = cursor.fetchone()[0]
        
        # Quality
        cursor.execute("SELECT AVG(confidence) FROM phone_numbers WHERE confidence > 0")
        avg_conf = cursor.fetchone()[0]
        stats['average_confidence'] = round(avg_conf, 3) if avg_conf else 0
        
        cursor.execute("SELECT COUNT(*) FROM phone_numbers WHERE confidence >= 0.8")
        stats['high_confidence_count'] = cursor.fetchone()[0]
        
        # Line type breakdown
        cursor.execute("""
            SELECT line_type, COUNT(*) as cnt 
            FROM phone_numbers 
            WHERE line_type IS NOT NULL 
            GROUP BY line_type 
            ORDER BY cnt DESC
        """)
        stats['line_type_breakdown'] = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Top area codes
        cursor.execute("""
            SELECT area_code, COUNT(*) as cnt 
            FROM phone_numbers 
            GROUP BY area_code 
            ORDER BY cnt DESC 
            LIMIT 10
        """)
        stats['top_area_codes'] = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Top carriers
        cursor.execute("""
            SELECT carrier, COUNT(*) as cnt 
            FROM phone_numbers 
            WHERE carrier IS NOT NULL 
            GROUP BY carrier 
            ORDER BY cnt DESC 
            LIMIT 10
        """)
        stats['top_carriers'] = {row[0]: row[1] for row in cursor.fetchall()}
        
        stats['database_path'] = str(self.db_path)
        
        conn.close()
        return stats
    
    def get_numbers_with_names(self, limit: int = 100, min_confidence: float = 0.6) -> List[Dict]:
        """
        Get all phone numbers that have owner names identified.
        
        Args:
            limit: Maximum results
            min_confidence: Minimum confidence score
        
        Returns:
            List of phone records with names
        """
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM phone_numbers
            WHERE name IS NOT NULL AND name != ''
            AND confidence >= ?
            ORDER BY confidence DESC
            LIMIT ?
        """, (min_confidence, limit))
        
        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return results
    
    def export_csv(self, output_path: str, include_only_names: bool = False) -> int:
        """
        Export database to CSV file.
        
        Args:
            output_path: Path to output CSV file
            include_only_names: Only export records with names
        
        Returns:
            Number of records exported
        """
        import csv
        
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = "SELECT * FROM phone_numbers"
        if include_only_names:
            query += " WHERE name IS NOT NULL AND name != ''"
        query += " ORDER BY confidence DESC"
        
        cursor.execute(query)
        rows = cursor.fetchall()
        
        if not rows:
            conn.close()
            return 0
        
        columns = rows[0].keys()
        
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            for row in rows:
                writer.writerow(dict(row))
        
        conn.close()
        return len(rows)


def lookup_phone_in_database(phone: str, db_path: str = None) -> Optional[Dict]:
    """
    Convenience function to lookup a phone number.
    
    Args:
        phone: Phone number to lookup
        db_path: Optional database path
    
    Returns:
        Phone data dictionary or None
    """
    db = PhoneDatabase(db_path)
    return db.lookup(phone)


def search_name_in_database(name: str, db_path: str = None, limit: int = 10) -> List[Dict]:
    """
    Convenience function to search by name.
    
    Args:
        name: Name to search for
        db_path: Optional database path
        limit: Maximum results
    
    Returns:
        List of matching phone records
    """
    db = PhoneDatabase(db_path)
    return db.search_by_name(name, limit=limit)
