"""
Phone Database Builder - Production Quality

Orchestrates the generation, validation, and storage of phone numbers.
Uses parallel processing to leverage multi-core CPUs (optimized for AMD Ryzen 7 9800X3D).

Strategy:
1. Generate phone numbers for target area codes
2. Validate using PhoneInfoga (FREE - prioritized)
3. Extract owner names from OSINT results
4. Store in local SQLite database for fast lookups
5. Optionally use Twilio for additional validation (COSTS MONEY)

Performance:
- 8 parallel workers default (matches 8-core CPU)
- Batch processing for memory efficiency
- Rate limiting to avoid API blocks
- Progress reporting
"""
import asyncio
import sqlite3
import time
from typing import List, Dict, Generator, Optional
from pathlib import Path
from datetime import datetime

from .generator import generate_phone_numbers_for_region, get_us_area_codes_by_region
from .validator import validate_and_enrich_phone, reverse_lookup_phone
from .database import PhoneDatabase

import config


class PhoneDatabaseBuilder:
    """
    Builds phone databases using PhoneInfoga OSINT (via Docker).
    Optimized for multi-core CPUs and name extraction.
    Includes rate limiting to avoid being blocked.
    """
    
    def __init__(
        self,
        db_path: str = None,
        max_workers: int = 4,  # Lower default for Docker overhead
        use_twilio: bool = False,
        twilio_limit: int = 900,
        request_delay: float = 0.5  # Delay between requests (rate limiting)
    ):
        """
        Initialize builder.
        
        Args:
            db_path: Path to output database
            max_workers: Number of parallel workers (default: 4 for Docker)
            use_twilio: Enable Twilio (costs money, disabled by default)
            twilio_limit: Max Twilio lookups if enabled
            request_delay: Seconds between requests to avoid rate limiting
        """
        if db_path is None:
            db_path = config.DATA_DIR / "phone_database.db"
        
        self.db_path = Path(db_path)
        self.max_workers = max_workers
        self.use_twilio = use_twilio
        self.twilio_limit = twilio_limit
        self.request_delay = request_delay
        
        self.db = PhoneDatabase(db_path)
        
        # Stats
        self.total_processed = 0
        self.valid_count = 0
        self.names_found = 0
        self.twilio_used = 0
        self.start_time = None
        self.last_request_time = 0
    
    async def build_for_area_codes(
        self,
        area_codes: List[str],
        max_per_area: int = 10000,
        target_names: List[str] = None,
        save_interval: int = 100,
        start_offset: int = 0  # Resume from this number
    ) -> Dict:
        """
        Build phone database for specific area codes.
        
        Args:
            area_codes: List of 3-digit area codes
            max_per_area: Max numbers to generate per area code
            target_names: Optional list of names to search for (for matching)
            save_interval: Save to DB every N validated numbers
            start_offset: Skip this many numbers (for resuming)
        
        Returns:
            Build statistics
        """
        self.start_time = time.time()
        self.total_processed = 0
        self.valid_count = 0
        self.names_found = 0
        self.twilio_used = 0
        
        total_numbers = len(area_codes) * max_per_area
        est_time_hours = (total_numbers * self.request_delay) / 3600
        
        print(f"")
        print(f"================================================================")
        print(f"  PHONE DATABASE BUILDER (Docker)                               ")
        print(f"================================================================")
        print(f"  Area Codes:       {len(area_codes):>6}")
        print(f"  Max per Area:     {max_per_area:>6,}")
        print(f"  Total Numbers:    {total_numbers:>6,}")
        print(f"  Parallel Workers: {self.max_workers:>6}")
        print(f"  Request Delay:    {self.request_delay:>6.1f}s (rate limiting)")
        print(f"  Est. Time:        {est_time_hours:>6.1f}h")
        print(f"----------------------------------------------------------------")
        print(f"  PhoneInfoga:   ENABLED via Docker (free)")
        print(f"  Twilio:        {'ENABLED' if self.use_twilio else 'DISABLED'}")
        print(f"  Database:      {str(self.db_path)}")
        if start_offset > 0:
            print(f"  Resuming from: {start_offset:>6,}")
        print(f"================================================================")
        print(f"")
        
        # Generate phones
        phone_gen = generate_phone_numbers_for_region(area_codes, max_per_area=max_per_area)
        
        # Skip to resume point if needed
        if start_offset > 0:
            print(f"[Builder] Skipping first {start_offset:,} numbers to resume...")
            for _ in range(start_offset):
                try:
                    next(phone_gen)
                except StopIteration:
                    break
        
        # Process in batches
        batch_results = []
        semaphore = asyncio.Semaphore(self.max_workers)
        
        async def validate_one(phone: str):
            async with semaphore:
                # Rate limiting - wait between requests
                current_time = time.time()
                time_since_last = current_time - self.last_request_time
                if time_since_last < self.request_delay:
                    await asyncio.sleep(self.request_delay - time_since_last)
                self.last_request_time = time.time()
                
                self.total_processed += 1
                
                # Progress update
                if self.total_processed % 50 == 0:
                    elapsed = time.time() - self.start_time
                    rate = self.total_processed / elapsed if elapsed > 0 else 0
                    remaining = total_numbers - self.total_processed - start_offset
                    eta_seconds = remaining / rate if rate > 0 else 0
                    eta_hours = eta_seconds / 3600
                    print(f"[Builder] Processed {self.total_processed + start_offset:,}/{total_numbers:,} | "
                          f"Valid: {self.valid_count:,} | "
                          f"Names: {self.names_found:,} | "
                          f"Rate: {rate:.1f}/sec | "
                          f"ETA: {eta_hours:.1f}h")
                
                try:
                    # PhoneInfoga validation via Docker (prioritized, free)
                    should_use_twilio = self.use_twilio and self.twilio_used < self.twilio_limit
                    
                    result = await validate_and_enrich_phone(
                        phone,
                        {'phone': phone},
                        use_twilio=should_use_twilio
                    )
                    
                    if result.get('source') and 'twilio' in result.get('source', '').lower():
                        self.twilio_used += 1
                    
                    if result.get('valid'):
                        self.valid_count += 1
                        if result.get('name'):
                            self.names_found += 1
                            print(f"  [+] {phone} -> {result.get('name')} "
                                  f"({result.get('carrier', 'Unknown carrier')})")
                        elif result.get('carrier'):
                            # Still useful - valid number with carrier info
                            pass
                        return result
                except Exception as e:
                    if self.total_processed <= 3:
                        print(f"[Builder] Error for {phone}: {e}")
                
                return None
        
        # Process in batches of 1000 to manage memory
        batch = []
        batch_size = 1000
        
        for phone in phone_gen:
            batch.append(phone)
            
            if len(batch) >= batch_size:
                # Process batch in parallel
                tasks = [validate_one(p) for p in batch]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Filter valid results
                valid_results = [r for r in results if r and not isinstance(r, Exception) and r.get('valid')]
                batch_results.extend(valid_results)
                
                # Save periodically
                if len(batch_results) >= save_interval:
                    self.db.insert_batch(batch_results)
                    batch_results = []
                
                batch = []
                
                # Check Twilio limit
                if self.use_twilio and self.twilio_used >= self.twilio_limit:
                    print(f"[Builder] Twilio limit reached ({self.twilio_limit}). "
                          f"Continuing with PhoneInfoga only.")
                    self.use_twilio = False
        
        # Process remaining batch
        if batch:
            tasks = [validate_one(p) for p in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            valid_results = [r for r in results if r and not isinstance(r, Exception) and r.get('valid')]
            batch_results.extend(valid_results)
        
        # Final save
        if batch_results:
            self.db.insert_batch(batch_results)
        
        # Final stats
        elapsed = time.time() - self.start_time
        stats = self.db.get_stats()
        
        print(f"")
        print(f"================================================================")
        print(f"  BUILD COMPLETE                                                ")
        print(f"================================================================")
        print(f"  Total Processed:   {self.total_processed:>10,}")
        print(f"  Valid Numbers:     {self.valid_count:>10,}")
        print(f"  Names Found:       {self.names_found:>10,}")
        print(f"  Twilio Lookups:    {self.twilio_used:>10,}")
        print(f"  Time Elapsed:      {elapsed:>10.1f}s")
        print(f"  Rate:              {(self.total_processed/elapsed) if elapsed > 0 else 0:>10.1f}/sec")
        print(f"================================================================")
        print(f"")
        
        return {
            'total_processed': self.total_processed,
            'valid_count': self.valid_count,
            'names_found': self.names_found,
            'twilio_used': self.twilio_used,
            'elapsed_seconds': elapsed,
            'database_path': str(self.db_path),
            'stats': stats
        }
    
    async def reverse_lookup_batch(
        self,
        phones: List[str],
        save_to_db: bool = True
    ) -> List[Dict]:
        """
        Perform reverse lookups on a batch of phone numbers.
        
        Args:
            phones: List of phone numbers
            save_to_db: Whether to save results to database
        
        Returns:
            List of lookup results
        """
        print(f"[Builder] Reverse lookup for {len(phones)} phone numbers...")
        print(f"[Builder] Using {self.max_workers} parallel workers")
        
        semaphore = asyncio.Semaphore(self.max_workers)
        results = []
        found_count = 0
        
        async def lookup_one(phone: str):
            nonlocal found_count
            async with semaphore:
                result = await reverse_lookup_phone(phone)
                if result:
                    found_count += 1
                    print(f"  [+] {phone} -> {result.get('name')} "
                          f"(confidence: {result.get('confidence', 0):.2f})")
                return result
        
        tasks = [lookup_one(p) for p in phones]
        results = await asyncio.gather(*tasks)
        
        # Filter out None results
        valid_results = [r for r in results if r]
        
        # Save to database
        if save_to_db and valid_results:
            self.db.insert_batch(valid_results)
        
        print(f"[Builder] Found names for {found_count}/{len(phones)} numbers")
        return valid_results


async def bulk_validate_phones_parallel(
    phone_generator: Generator[str, None, None],
    max_workers: int = 8,
    batch_size: int = 1000,
    use_twilio: bool = False,
    use_phoneinfoga: bool = True,
    twilio_limit: int = 900
) -> List[Dict]:
    """
    Validate phone numbers in parallel using multi-core CPU.
    
    Args:
        phone_generator: Generator yielding phone numbers
        max_workers: Number of parallel workers (default: 8 for 8-core CPU)
        batch_size: Process in batches to manage memory
        use_twilio: Use Twilio Lookup (disabled by default - costs money)
        use_phoneinfoga: Use PhoneInfoga (enabled by default - free)
        twilio_limit: Stop using Twilio after this many validations
    
    Returns:
        List of validated phone data
    """
    semaphore = asyncio.Semaphore(max_workers)
    results = []
    validated_count = 0
    names_count = 0
    twilio_used = 0
    
    async def validate_phone(phone: str):
        nonlocal validated_count, names_count, twilio_used
        
        async with semaphore:
            try:
                should_use_twilio = use_twilio and twilio_used < twilio_limit
                data = await validate_and_enrich_phone(
                    phone,
                    {'phone': phone},
                    use_twilio=should_use_twilio
                )
                
                if data.get('source') and 'twilio' in data.get('source', '').lower():
                    twilio_used += 1
                
                if data and data.get('valid'):
                    validated_count += 1
                    if data.get('name'):
                        names_count += 1
                    
                    if validated_count % 50 == 0:
                        print(f"[Validator] Valid: {validated_count:,} | "
                              f"Names: {names_count:,} | "
                              f"Twilio: {twilio_used}/{twilio_limit}")
                    return data
            except Exception:
                pass
            return None
    
    batch = []
    for phone in phone_generator:
        batch.append(phone)
        
        if len(batch) >= batch_size:
            tasks = [validate_phone(p) for p in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            valid_results = [r for r in batch_results if r and not isinstance(r, Exception)]
            results.extend(valid_results)
            batch = []
            
            if use_twilio and twilio_used >= twilio_limit:
                print(f"[Validator] Twilio limit reached. Continuing with PhoneInfoga only.")
                use_twilio = False
    
    # Process remaining
    if batch:
        tasks = [validate_phone(p) for p in batch]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        valid_results = [r for r in batch_results if r and not isinstance(r, Exception)]
        results.extend(valid_results)
    
    return results


async def build_phone_database_for_region(
    area_codes: List[str],
    output_db_path: str = None,
    max_per_area: int = 10000,
    max_workers: int = 4,  # Lower default for Docker
    use_twilio: bool = False,
    twilio_limit: int = 900,
    request_delay: float = 0.5,  # Rate limiting
    start_offset: int = 0  # Resume support
) -> Dict:
    """
    Build a database of validated phone numbers for specific area codes.
    Uses PhoneInfoga Docker (free) for name extraction.
    
    Args:
        area_codes: List of area codes (e.g., ["617", "781", "857"])
        output_db_path: Path to database file
        max_per_area: Maximum numbers to generate per area code
        max_workers: Number of parallel Docker containers
        use_twilio: Enable Twilio (disabled by default)
        twilio_limit: Maximum Twilio lookups
        request_delay: Seconds between requests (rate limiting)
        start_offset: Skip this many numbers (for resuming)
    
    Returns:
        Dictionary with build statistics
    """
    builder = PhoneDatabaseBuilder(
        db_path=output_db_path,
        max_workers=max_workers,
        use_twilio=use_twilio,
        twilio_limit=twilio_limit,
        request_delay=request_delay
    )
    
    return await builder.build_for_area_codes(
        area_codes=area_codes,
        max_per_area=max_per_area,
        start_offset=start_offset
    )


async def reverse_lookup_phones(
    phones: List[str],
    db_path: str = None,
    max_workers: int = 8,
    save_to_db: bool = True
) -> List[Dict]:
    """
    Perform reverse lookups on a list of phone numbers.
    Uses PhoneInfoga (free) to find owner names.
    
    Args:
        phones: List of phone numbers to lookup
        db_path: Database path for storing results
        max_workers: Parallel workers
        save_to_db: Whether to save results
    
    Returns:
        List of lookup results with names
    """
    builder = PhoneDatabaseBuilder(
        db_path=db_path,
        max_workers=max_workers,
        use_twilio=False
    )
    
    return await builder.reverse_lookup_batch(phones, save_to_db=save_to_db)
