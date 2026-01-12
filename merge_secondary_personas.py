"""
Merge companies with 'secondary persona' back into main company.
"""
import database as db
import re

def merge_secondary_personas():
    """Merge companies with 'secondary persona' back into main company."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Find all companies with "secondary persona"
        cursor.execute("""
            SELECT DISTINCT company_name 
            FROM linkedin_contacts 
            WHERE company_name LIKE '%secondary persona%'
        """)
        secondary_companies = cursor.fetchall()
        
        if not secondary_companies:
            print("No companies with 'secondary persona' found!")
            return
        
        print(f"Found {len(secondary_companies)} companies with 'secondary persona'\n")
        
        for row in secondary_companies:
            secondary_name = row['company_name']
            # Extract main company name (remove " secondary persona")
            main_name = re.sub(r'\s+secondary\s+persona\s*$', '', secondary_name, flags=re.IGNORECASE).strip()
            
            if main_name and main_name != secondary_name:
                print(f"Merging: '{secondary_name}' -> '{main_name}'")
                
                # Update all contacts
                cursor.execute("""
                    UPDATE linkedin_contacts 
                    SET company_name = ?
                    WHERE company_name = ?
                """, (main_name, secondary_name))
                
                print(f"  Updated {cursor.rowcount} contacts")
        
        conn.commit()
        print(f"\n[OK] Merge complete! Merged {len(secondary_companies)} company groups.")

if __name__ == "__main__":
    merge_secondary_personas()

