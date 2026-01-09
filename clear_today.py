"""Clear LinkedIn contacts from database."""
import database as db
import sys

conn = db.get_connection()
cursor = conn.cursor()

# Count total contacts
cursor.execute("SELECT COUNT(*) as cnt FROM linkedin_contacts")
count = cursor.fetchone()['cnt']
print(f"Total LinkedIn contacts in DB: {count}")

# Delete all
if count > 0:
    cursor.execute("DELETE FROM linkedin_contacts")
    conn.commit()
    print(f"Deleted all {count} contacts")
    print("Database is now clean. Run: python main.py scrape-and-enrich")
else:
    print("Database already empty")

conn.close()
