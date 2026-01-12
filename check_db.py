import sqlite3

conn = sqlite3.connect('data/scraper.db')
cursor = conn.cursor()

# List all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cursor.fetchall()]
print("Tables:", tables)

# Check linkedin_contacts schema
if 'linkedin_contacts' in tables:
    cursor.execute("PRAGMA table_info(linkedin_contacts)")
    cols = cursor.fetchall()
    print("\nlinkedin_contacts columns:")
    for col in cols:
        print(f"  {col[1]} ({col[2]})")
else:
    print("\nlinkedin_contacts table does not exist")

conn.close()


